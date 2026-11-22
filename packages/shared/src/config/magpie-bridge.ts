import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';
import type { CustomEndpointApi, LlmConnection } from './llm-connections.ts';
import type { ModelDefinition } from './models.ts';
import { debug } from '../utils/debug.ts';

export const DEFAULT_SHIORI_DIR_NAME = '.shiori';
export const SHIORI_MAGPIE_FILENAME = 'magpie.json';
export const SHIORI_MAGPIE_SLUG = 'magpie';

export function resolveShioriDir(
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): string {
  const override = env.SHIORI_CONFIG_DIR?.trim();
  return override ? override : join(home, DEFAULT_SHIORI_DIR_NAME);
}

export const SHIORI_DIR = resolveShioriDir();
export const SHIORI_MAGPIE_FILE = join(SHIORI_DIR, SHIORI_MAGPIE_FILENAME);

export interface MagpieBridgeModelEntry {
  id: string;
  name?: string;
  shortName?: string;
  description?: string;
  contextWindow?: number;
  maxTokens?: number;
  supportsImages?: boolean;
  supportsThinking?: boolean;
}

export interface MagpieBridgeFile {
  version?: number;
  agentId?: string;
  name?: string;
  baseUrl?: string;
  apiKey?: string;
  api?: CustomEndpointApi;
  model?: string;
  models?: MagpieBridgeModelEntry[];
  createdAt?: number;
}

export function ensureShioriDir(dirPath: string = SHIORI_DIR): void {
  try {
    if (!existsSync(dirPath)) {
      mkdirSync(dirPath, { recursive: true });
    }
  } catch (error) {
    debug('[magpie-bridge] Failed to ensure Shiori directory:', error);
  }
}

function stripMagpieModelPrefix(modelId: string): string {
  const trimmed = modelId.trim();
  return trimmed.startsWith('magpie/') ? trimmed.slice('magpie/'.length) : trimmed;
}

export function loadMagpieBridgeConfig(
  filePath: string = SHIORI_MAGPIE_FILE,
): MagpieBridgeFile | null {
  try {
    if (!existsSync(filePath)) {
      return null;
    }
    const raw = readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    const candidate = parsed as MagpieBridgeFile;
    if (typeof candidate.baseUrl !== 'string' || !candidate.baseUrl.trim()) {
      return null;
    }
    return candidate;
  } catch (error) {
    debug('[magpie-bridge] Failed to read magpie bridge file:', error);
    return null;
  }
}

function normalizeBridgeModels(entries?: MagpieBridgeModelEntry[]): ModelDefinition[] {
  if (!Array.isArray(entries)) return [];
  const seen = new Set<string>();
  const models: ModelDefinition[] = [];

  for (const item of entries) {
    if (!item || typeof item.id !== 'string') continue;
    const id = stripMagpieModelPrefix(item.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);

    const displayName = typeof item.name === 'string' && item.name.trim()
      ? item.name.trim()
      : id;
    const shortName = typeof item.shortName === 'string' && item.shortName.trim()
      ? item.shortName.trim()
      : displayName;

    const modelDef: ModelDefinition = {
      id,
      name: displayName,
      shortName,
      description: typeof item.description === 'string' ? item.description : '',
      provider: 'pi',
      contextWindow:
        typeof item.contextWindow === 'number' && item.contextWindow > 0
          ? item.contextWindow
          : 128_000,
    };

    if (typeof item.supportsImages === 'boolean') {
      modelDef.supportsImages = item.supportsImages;
    }
    if (typeof item.supportsThinking === 'boolean') {
      modelDef.supportsThinking = item.supportsThinking;
    }

    models.push(modelDef);
  }

  return models;
}

export function loadMagpieBridgeConnection(
  filePath: string = SHIORI_MAGPIE_FILE,
): LlmConnection | null {
  const bridge = loadMagpieBridgeConfig(filePath);
  if (!bridge || !bridge.baseUrl) {
    return null;
  }

  const models = normalizeBridgeModels(bridge.models);
  const requestedModel = typeof bridge.model === 'string' && bridge.model.trim()
    ? stripMagpieModelPrefix(bridge.model)
    : undefined;

  let defaultModel: string | undefined;
  if (requestedModel && (models.length === 0 || models.some(model => model.id === requestedModel))) {
    defaultModel = requestedModel;
  } else if (models.length > 0) {
    defaultModel = models[0]!.id;
  } else {
    defaultModel = requestedModel;
  }

  const api: CustomEndpointApi = bridge.api === 'anthropic-messages'
    ? 'anthropic-messages'
    : 'openai-completions';

  return {
    slug: SHIORI_MAGPIE_SLUG,
    name: typeof bridge.name === 'string' && bridge.name.trim() ? bridge.name.trim() : 'Magpie',
    providerType: 'pi_compat',
    authType: 'none',
    createdAt: typeof bridge.createdAt === 'number' ? bridge.createdAt : 0,
    baseUrl: bridge.baseUrl.trim(),
    models,
    defaultModel,
    modelSelectionMode: 'userDefined3Tier',
    customEndpoint: { api },
  };
}

export function getMagpieBridgeApiKey(
  slug?: string,
  filePath: string = SHIORI_MAGPIE_FILE,
): string | null {
  if (slug !== SHIORI_MAGPIE_SLUG) {
    return null;
  }
  const bridge = loadMagpieBridgeConfig(filePath);
  const apiKey = typeof bridge?.apiKey === 'string' ? bridge.apiKey.trim() : '';
  return apiKey || null;
}

export function mergeMagpieBridgeConnection(
  storedConnections: LlmConnection[],
  bridgeConnection: LlmConnection | null,
): LlmConnection[] {
  if (!bridgeConnection) {
    return storedConnections;
  }
  const filtered = storedConnections.filter(conn => conn.slug !== bridgeConnection.slug);
  return [bridgeConnection, ...filtered];
}

export function updateMagpieBridgeDefaultModel(
  modelId: string,
  filePath: string = SHIORI_MAGPIE_FILE,
): boolean {
  const bridge = loadMagpieBridgeConfig(filePath);
  if (!bridge) {
    return false;
  }
  const normalized = stripMagpieModelPrefix(modelId);
  if (!normalized) {
    return false;
  }

  try {
    const next: MagpieBridgeFile = {
      ...bridge,
      model: normalized,
    };
    const parent = dirname(filePath);
    if (!existsSync(parent)) {
      mkdirSync(parent, { recursive: true });
    }
    writeFileSync(filePath, JSON.stringify(next, null, 2) + '\n', 'utf-8');
    return true;
  } catch (error) {
    debug('[magpie-bridge] Failed to update default model in magpie.json:', error);
    return false;
  }
}
