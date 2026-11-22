import { describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import {
  CONFIG_DIR,
  DEFAULT_CONFIG_DIR_NAME,
  LEGACY_CONFIG_DIR_NAME,
  migrateLegacyConfigDir,
  resolveConfigDir,
} from '../paths.ts';

// OSS #1062: SHIORI_CONFIG_DIR / CRAFT_CONFIG_DIR must be the single switch for where the app keeps
// its state; every module joins onto CONFIG_DIR instead of homedir().
describe('resolveConfigDir', () => {
  it('defaults to ~/.shiori', () => {
    expect(DEFAULT_CONFIG_DIR_NAME).toBe('.shiori');
    expect(resolveConfigDir({}, '/Users/me')).toBe(join('/Users/me', DEFAULT_CONFIG_DIR_NAME));
    expect(resolveConfigDir({ CRAFT_CONFIG_DIR: '' }, '/Users/me')).toBe(join('/Users/me', DEFAULT_CONFIG_DIR_NAME));
    expect(resolveConfigDir({ CRAFT_CONFIG_DIR: '   ' }, '/Users/me')).toBe(join('/Users/me', DEFAULT_CONFIG_DIR_NAME));
  });

  it('honors SHIORI_CONFIG_DIR and CRAFT_CONFIG_DIR', () => {
    expect(resolveConfigDir({ SHIORI_CONFIG_DIR: '/tmp/shiori-dev' }, '/Users/me')).toBe('/tmp/shiori-dev');
    expect(resolveConfigDir({ SHIORI_CONFIG_DIR: '/tmp/shiori-dev', CRAFT_CONFIG_DIR: '/tmp/craft-dev' }, '/Users/me')).toBe('/tmp/shiori-dev');
    expect(resolveConfigDir({ CRAFT_CONFIG_DIR: '/tmp/craft-dev' }, '/Users/me')).toBe('/tmp/craft-dev');
    expect(resolveConfigDir({ CRAFT_CONFIG_DIR: ' /tmp/craft-dev ' }, '/Users/me')).toBe('/tmp/craft-dev');
  });

  it('CONFIG_DIR is the resolver evaluated against the real environment', () => {
    expect(CONFIG_DIR).toBe(resolveConfigDir(process.env, homedir()));
  });
});

describe('migrateLegacyConfigDir', () => {
  it('copies ~/.craft-agent to ~/.shiori, preserves existing files like magpie.json, and rewrites legacy paths', () => {
    const fakeHome = mkdtempSync(join(tmpdir(), 'shiori-migrate-'));
    try {
      const legacyDir = join(fakeHome, LEGACY_CONFIG_DIR_NAME);
      const targetDir = join(fakeHome, DEFAULT_CONFIG_DIR_NAME);
      mkdirSync(join(legacyDir, 'workspaces', 'ws1'), { recursive: true });
      mkdirSync(join(legacyDir, 'logs'), { recursive: true });
      mkdirSync(targetDir, { recursive: true });

      writeFileSync(join(targetDir, 'magpie.json'), '{"provider":"magpie"}', 'utf-8');
      writeFileSync(join(legacyDir, 'magpie.json'), '{"provider":"stale"}', 'utf-8');
      writeFileSync(join(legacyDir, '.server.lock'), '1234', 'utf-8');
      writeFileSync(join(legacyDir, 'logs', 'main.log'), 'old log', 'utf-8');
      writeFileSync(join(legacyDir, 'workspaces', 'ws1', 'meta.json'), '{"ok":true}', 'utf-8');
      writeFileSync(
        join(legacyDir, 'config.json'),
        JSON.stringify({
          workspaces: [
            { id: 'w1', rootPath: join(legacyDir, 'workspaces', 'ws1') },
            { id: 'w2', rootPath: 'D:\\ClaudeWork' },
          ],
        }),
        'utf-8',
      );

      const first = migrateLegacyConfigDir({ env: {}, home: fakeHome });
      expect(first).toEqual({ migrated: true, reason: 'migrated' });
      expect(readFileSync(join(targetDir, 'magpie.json'), 'utf-8')).toBe('{"provider":"magpie"}');
      expect(existsSync(join(targetDir, '.server.lock'))).toBe(false);
      expect(existsSync(join(targetDir, 'logs'))).toBe(false);
      expect(existsSync(join(targetDir, 'workspaces', 'ws1', 'meta.json'))).toBe(true);
      const migratedCfg = JSON.parse(readFileSync(join(targetDir, 'config.json'), 'utf-8'));
      expect(migratedCfg.workspaces[0].rootPath).toBe(join(targetDir, 'workspaces', 'ws1'));
      expect(migratedCfg.workspaces[1].rootPath).toBe('D:\\ClaudeWork');
      // Legacy backup remains untouched
      expect(existsSync(join(legacyDir, 'config.json'))).toBe(true);

      // Second run is a no-op
      const second = migrateLegacyConfigDir({ env: {}, home: fakeHome });
      expect(second).toEqual({ migrated: false, reason: 'already_initialized' });
    } finally {
      rmSync(fakeHome, { recursive: true, force: true });
    }
  });
});
