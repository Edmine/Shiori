import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

export const DEFAULT_CONFIG_DIR_NAME = '.shiori';
export const LEGACY_CONFIG_DIR_NAME = '.craft-agent';

const MIGRATION_MARKER_FILE = '.migrated-from-craft-agent';
const MIGRATION_SKIP_ENTRIES = new Set(['.server.lock', 'logs']);

/**
 * Resolve the config directory: SHIORI_CONFIG_DIR or CRAFT_CONFIG_DIR wins,
 * otherwise `<home>/.shiori`. Pure; `CONFIG_DIR` is this evaluated once at load.
 */
export function resolveConfigDir(env: NodeJS.ProcessEnv = process.env, home: string = homedir()): string {
  const override = env.SHIORI_CONFIG_DIR?.trim() || env.CRAFT_CONFIG_DIR?.trim();
  return override ? override : join(home, DEFAULT_CONFIG_DIR_NAME);
}

function copyDirMergeNoOverwrite(srcDir: string, destDir: string, skipTopLevel: boolean): void {
  mkdirSync(destDir, { recursive: true });
  const entries = readdirSync(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    if (skipTopLevel && MIGRATION_SKIP_ENTRIES.has(entry.name)) continue;
    const srcPath = join(srcDir, entry.name);
    const destPath = join(destDir, entry.name);
    if (entry.isDirectory()) {
      copyDirMergeNoOverwrite(srcPath, destPath, false);
    } else if (entry.isFile() && !existsSync(destPath)) {
      copyFileSync(srcPath, destPath);
    }
  }
}

function rewriteLegacyPathString(value: string, legacyDir: string, targetDir: string): string {
  const normalizedValue = value.replace(/\\/g, '/');
  const normalizedLegacy = legacyDir.replace(/\\/g, '/').replace(/\/+$/, '');
  const normalizedTarget = targetDir.replace(/\\/g, '/').replace(/\/+$/, '');
  const isWindows = process.platform === 'win32' || /^[A-Za-z]:\//.test(normalizedLegacy);
  const haystack = isWindows ? normalizedValue.toLowerCase() : normalizedValue;
  const needle = isWindows ? normalizedLegacy.toLowerCase() : normalizedLegacy;

  if (haystack === needle || haystack.startsWith(`${needle}/`)) {
    const suffix = normalizedValue.slice(normalizedLegacy.length);
    const replaced = `${normalizedTarget}${suffix}`;
    return value.includes('\\') && !value.includes('/') ? replaced.replace(/\//g, '\\') : replaced;
  }
  return value;
}

function rewriteLegacyPathsInValue(value: unknown, legacyDir: string, targetDir: string): unknown {
  if (typeof value === 'string') {
    return rewriteLegacyPathString(value, legacyDir, targetDir);
  }
  if (Array.isArray(value)) {
    return value.map((item) => rewriteLegacyPathsInValue(item, legacyDir, targetDir));
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = rewriteLegacyPathsInValue(v, legacyDir, targetDir);
    }
    return out;
  }
  return value;
}

function rewriteMigratedJsonFile(filePath: string, legacyDir: string, targetDir: string): void {
  if (!existsSync(filePath)) return;
  try {
    const raw = readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    const rewritten = rewriteLegacyPathsInValue(parsed, legacyDir, targetDir);
    writeFileSync(filePath, JSON.stringify(rewritten, null, 2), 'utf-8');
  } catch {
    // Keep original copied file if parsing fails
  }
}

export interface LegacyMigrationResult {
  migrated: boolean;
  reason: 'migrated' | 'custom_override' | 'already_initialized' | 'no_legacy_config' | 'error';
}

/**
 * One-time non-destructive migration from `~/.craft-agent/` to `~/.shiori/`.
 * Preserves any pre-existing files in `~/.shiori/` (such as `magpie.json`) and
 * leaves `~/.craft-agent/` untouched as a backup.
 */
export function migrateLegacyConfigDir(options?: {
  env?: NodeJS.ProcessEnv;
  home?: string;
}): LegacyMigrationResult {
  const env = options?.env ?? process.env;
  const home = options?.home ?? homedir();
  if (env.SHIORI_CONFIG_DIR?.trim() || env.CRAFT_CONFIG_DIR?.trim()) {
    return { migrated: false, reason: 'custom_override' };
  }

  const targetDir = join(home, DEFAULT_CONFIG_DIR_NAME);
  const legacyDir = join(home, LEGACY_CONFIG_DIR_NAME);
  const markerPath = join(targetDir, MIGRATION_MARKER_FILE);

  if (existsSync(join(targetDir, 'config.json')) || existsSync(markerPath)) {
    return { migrated: false, reason: 'already_initialized' };
  }
  if (!existsSync(join(legacyDir, 'config.json'))) {
    return { migrated: false, reason: 'no_legacy_config' };
  }

  try {
    copyDirMergeNoOverwrite(legacyDir, targetDir, true);
    rewriteMigratedJsonFile(join(targetDir, 'config.json'), legacyDir, targetDir);
    rewriteMigratedJsonFile(join(targetDir, 'window-state.json'), legacyDir, targetDir);
    writeFileSync(
      markerPath,
      JSON.stringify({ migratedAt: new Date().toISOString(), from: legacyDir, to: targetDir }, null, 2),
      'utf-8',
    );
    return { migrated: true, reason: 'migrated' };
  } catch {
    return { migrated: false, reason: 'error' };
  }
}

migrateLegacyConfigDir();

export const CONFIG_DIR = resolveConfigDir();
