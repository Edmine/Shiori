import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  getMagpieBridgeApiKey,
  loadMagpieBridgeConnection,
  mergeMagpieBridgeConnection,
  resolveShioriDir,
  SHIORI_MAGPIE_SLUG,
  updateMagpieBridgeDefaultModel,
} from '../magpie-bridge.ts';
import type { LlmConnection } from '../llm-connections.ts';

const tempDirs: string[] = [];

function makeTempFile(content?: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'shiori-magpie-bridge-'));
  tempDirs.push(dir);
  const filePath = join(dir, 'magpie.json');
  if (content !== undefined) {
    writeFileSync(filePath, JSON.stringify(content, null, 2), 'utf-8');
  }
  return filePath;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }
});

describe('magpie-bridge', () => {
  it('resolves ~/.shiori by default and honors SHIORI_CONFIG_DIR', () => {
    expect(resolveShioriDir({}, '/Users/demo')).toBe(join('/Users/demo', '.shiori'));
    expect(resolveShioriDir({ SHIORI_CONFIG_DIR: ' /tmp/shiori-custom ' }, '/Users/demo')).toBe('/tmp/shiori-custom');
  });

  it('returns null when magpie.json is missing or disconnected (empty object)', () => {
    const missing = makeTempFile();
    expect(loadMagpieBridgeConnection(missing)).toBeNull();

    const empty = makeTempFile({});
    expect(loadMagpieBridgeConnection(empty)).toBeNull();
    expect(getMagpieBridgeApiKey(SHIORI_MAGPIE_SLUG, empty)).toBeNull();
  });

  it('builds a pi_compat LlmConnection and strips magpie/ prefix from default model', () => {
    const filePath = makeTempFile({
      version: 1,
      agentId: 'shiori',
      name: 'Magpie',
      baseUrl: 'http://127.0.0.1:3425/v1',
      apiKey: 'magpie-shiori',
      api: 'openai-completions',
      model: 'magpie/codex/gpt-6.2-sol',
      models: [
        {
          id: 'codex/gpt-6.2-sol',
          name: 'GPT-6.2-Sol · Codex',
          contextWindow: 500000,
          supportsImages: true,
          supportsThinking: true,
        },
        {
          id: 'devin/claude-opus-5-5',
          name: 'Claude Opus 5.5 · Devin',
          contextWindow: 1000000,
          supportsImages: true,
        },
      ],
    });

    const connection = loadMagpieBridgeConnection(filePath);
    expect(connection).not.toBeNull();
    expect(connection!.slug).toBe('magpie');
    expect(connection!.providerType).toBe('pi_compat');
    expect(connection!.authType).toBe('none');
    expect(connection!.baseUrl).toBe('http://127.0.0.1:3425/v1');
    expect(connection!.defaultModel).toBe('codex/gpt-6.2-sol');
    expect(connection!.modelSelectionMode).toBe('userDefined3Tier');
    expect(connection!.customEndpoint).toEqual({ api: 'openai-completions' });
    expect(connection!.models).toHaveLength(2);
    expect(getMagpieBridgeApiKey('magpie', filePath)).toBe('magpie-shiori');
    expect(getMagpieBridgeApiKey('other', filePath)).toBeNull();
  });

  it('overrides legacy craft-agents magpie entry while keeping other connections', () => {
    const legacyMagpie: LlmConnection = {
      slug: 'magpie',
      name: 'magpie',
      providerType: 'pi_compat',
      authType: 'none',
      createdAt: 1,
      baseUrl: 'http://127.0.0.1:3425/agent/craft-agents/v1',
    };
    const directAnthropic: LlmConnection = {
      slug: 'anthropic',
      name: 'Anthropic',
      providerType: 'anthropic',
      authType: 'api_key',
      createdAt: 2,
    };
    const bridge: LlmConnection = {
      slug: 'magpie',
      name: 'Magpie',
      providerType: 'pi_compat',
      authType: 'none',
      createdAt: 0,
      baseUrl: 'http://127.0.0.1:3425/v1',
    };

    const merged = mergeMagpieBridgeConnection([legacyMagpie, directAnthropic], bridge);
    expect(merged).toHaveLength(2);
    expect(merged[0]!.baseUrl).toBe('http://127.0.0.1:3425/v1');
    expect(merged[1]!.slug).toBe('anthropic');
  });

  it('updates default model back into magpie.json', () => {
    const filePath = makeTempFile({
      version: 1,
      baseUrl: 'http://127.0.0.1:3425/v1',
      apiKey: 'magpie-shiori',
      model: 'codex/gpt-6.2-sol',
      models: [
        { id: 'codex/gpt-6.2-sol', name: 'GPT-6.2-Sol' },
        { id: 'devin/claude-opus-5-5', name: 'Claude Opus 5.5' },
      ],
    });

    expect(updateMagpieBridgeDefaultModel('devin/claude-opus-5-5', filePath)).toBe(true);
    const saved = JSON.parse(readFileSync(filePath, 'utf-8'));
    expect(saved.model).toBe('devin/claude-opus-5-5');
    expect(loadMagpieBridgeConnection(filePath)!.defaultModel).toBe('devin/claude-opus-5-5');
  });
});
