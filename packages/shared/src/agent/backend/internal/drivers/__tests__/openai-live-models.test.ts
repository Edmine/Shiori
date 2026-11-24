import { describe, expect, it } from 'bun:test';
import type { ModelDefinition } from '../../../../../config/models.ts';
import {
  buildOpenAiModelsFromLiveIds,
  buildOpenAiModelsUrl,
  fetchOpenAiLiveModels,
  formatOpenAiModelDisplayName,
  isEligibleOpenAiLiveModelId,
} from '../openai-live-models.ts';

const MOCK_STATIC_CATALOG: ModelDefinition[] = [
  {
    id: 'pi/gpt-6-astra',
    name: 'GPT-6 Astra',
    shortName: 'GPT-6 Astra',
    description: 'openai model via Shiori Backend',
    provider: 'pi',
    contextWindow: 272_000,
    supportsThinking: true,
    supportsImages: true,
  },
  {
    id: 'pi/gpt-6.1-sol',
    name: 'GPT-6.1 Sol',
    shortName: 'GPT-6.1 Sol',
    description: 'openai model via Shiori Backend',
    provider: 'pi',
    contextWindow: 272_000,
    supportsThinking: true,
    supportsImages: true,
  },
  {
    id: 'pi/gpt-6.2-astra',
    name: 'GPT-6.2 Astra',
    shortName: 'GPT-6.2 Astra',
    description: 'openai model via Shiori Backend',
    provider: 'pi',
    contextWindow: 272_000,
    supportsThinking: true,
    supportsImages: true,
  },
  {
    id: 'pi/gpt-6.2-sol',
    name: 'GPT-6.2 Sol',
    shortName: 'GPT-6.2 Sol',
    description: 'openai model via Shiori Backend',
    provider: 'pi',
    contextWindow: 272_000,
    supportsThinking: true,
    supportsImages: true,
  },
];

describe('openai-live-models', () => {
  it('builds /v1/models URLs cleanly for default and custom endpoints', () => {
    expect(buildOpenAiModelsUrl()).toBe('https://api.openai.com/v1/models');
    expect(buildOpenAiModelsUrl('https://api.openai.com')).toBe('https://api.openai.com/v1/models');
    expect(buildOpenAiModelsUrl('https://api.openai.com/v1/')).toBe('https://api.openai.com/v1/models');
    expect(buildOpenAiModelsUrl('https://proxy.example.com/v1')).toBe('https://proxy.example.com/v1/models');
    expect(buildOpenAiModelsUrl('https://proxy.example.com/v1/models')).toBe('https://proxy.example.com/v1/models');
  });

  it('formats OpenAI model IDs into readable names', () => {
    expect(formatOpenAiModelDisplayName('gpt-6.2-sol')).toBe('GPT-6.2 Sol');
    expect(formatOpenAiModelDisplayName('gpt-6.2-astra')).toBe('GPT-6.2 Astra');
    expect(formatOpenAiModelDisplayName('gpt-7-pro')).toBe('GPT-7 Pro');
    expect(formatOpenAiModelDisplayName('o5-mini')).toBe('o5-mini');
    expect(formatOpenAiModelDisplayName('codex-2')).toBe('Codex 2');
  });

  it('filters out non-chat, legacy, fine-tuned, and dated snapshot models while allowing future generations', () => {
    const staticIds = new Set(['gpt-6-astra', 'gpt-6.1-sol', 'gpt-6.2-astra', 'gpt-6.2-sol']);

    // Allowed current & future models
    expect(isEligibleOpenAiLiveModelId('gpt-6.2-sol', staticIds, 'openai')).toBe(true);
    expect(isEligibleOpenAiLiveModelId('gpt-6.2-astra', staticIds, 'openai')).toBe(true);
    expect(isEligibleOpenAiLiveModelId('gpt-6.5-astra', staticIds, 'openai')).toBe(true);
    expect(isEligibleOpenAiLiveModelId('gpt-7', staticIds, 'openai')).toBe(true);
    expect(isEligibleOpenAiLiveModelId('o5-mini', staticIds, 'openai')).toBe(true);
    expect(isEligibleOpenAiLiveModelId('codex-2', staticIds, 'openai')).toBe(true);

    // Excluded legacy, media, utility, fine-tuned, and snapshots
    expect(isEligibleOpenAiLiveModelId('gpt-4o', staticIds, 'openai')).toBe(false);
    expect(isEligibleOpenAiLiveModelId('gpt-4.1', staticIds, 'openai')).toBe(false);
    expect(isEligibleOpenAiLiveModelId('gpt-3.5-turbo', staticIds, 'openai')).toBe(false);
    expect(isEligibleOpenAiLiveModelId('text-embedding-3-large', staticIds, 'openai')).toBe(false);
    expect(isEligibleOpenAiLiveModelId('whisper-1', staticIds, 'openai')).toBe(false);
    expect(isEligibleOpenAiLiveModelId('tts-1-hd', staticIds, 'openai')).toBe(false);
    expect(isEligibleOpenAiLiveModelId('dall-e-3', staticIds, 'openai')).toBe(false);
    expect(isEligibleOpenAiLiveModelId('gpt-image-1', staticIds, 'openai')).toBe(false);
    expect(isEligibleOpenAiLiveModelId('gpt-realtime-2.1', staticIds, 'openai')).toBe(false);
    expect(isEligibleOpenAiLiveModelId('omni-moderation-latest', staticIds, 'openai')).toBe(false);
    expect(isEligibleOpenAiLiveModelId('sora-2', staticIds, 'openai')).toBe(false);
    expect(isEligibleOpenAiLiveModelId('codex-mini-latest', staticIds, 'openai')).toBe(false);
    expect(isEligibleOpenAiLiveModelId('ft:gpt-5:org::123', staticIds, 'openai')).toBe(false);
    expect(isEligibleOpenAiLiveModelId('gpt-6.2-sol-2026-11-15', staticIds, 'openai')).toBe(false);
  });

  it('enriches known models, synthesizes future models, and sorts future releases first', () => {
    const models = buildOpenAiModelsFromLiveIds(
      [
        'text-embedding-3-small',
        'gpt-4o',
        'gpt-6-astra',
        'gpt-6.1-sol',
        'gpt-6.2-sol',
        'gpt-6.2-astra',
        'gpt-6.2-sol-2026-11-10',
        'gpt-6.5-sol',
        'gpt-7-astra',
        'o5-mini',
      ],
      MOCK_STATIC_CATALOG,
      'openai',
    );

    expect(models.map((m) => m.id)).toEqual([
      'pi/gpt-7-astra',
      'pi/gpt-6.5-sol',
      'pi/o5-mini',
      'pi/gpt-6.2-astra',
      'pi/gpt-6.2-sol',
      'pi/gpt-6-astra',
      'pi/gpt-6.1-sol',
    ]);

    const gpt7 = models[0]!;
    expect(gpt7.name).toBe('GPT-7 Astra');
    expect(gpt7.contextWindow).toBe(272_000);
    expect(gpt7.supportsThinking).toBe(true);
    expect(gpt7.supportsImages).toBe(true);

    const o5Mini = models[2]!;
    expect(o5Mini.name).toBe('o5-mini');
    expect(o5Mini.contextWindow).toBe(200_000);
  });

  it('retries once with a refreshed OAuth token on HTTP 401', async () => {
    const seenTokens: string[] = [];
    const mockFetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      const auth = (init?.headers as Record<string, string>)?.Authorization ?? '';
      seenTokens.push(auth);
      if (auth === 'Bearer expired-token') {
        return new Response('Unauthorized', { status: 401 });
      }
      return new Response(
        JSON.stringify({
          data: [{ id: 'gpt-6.2-sol' }, { id: 'gpt-7-sol' }, { id: 'whisper-1' }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as unknown as typeof fetch;

    const models = await fetchOpenAiLiveModels({
      token: 'expired-token',
      piAuthProvider: 'openai',
      timeoutMs: 5_000,
      refreshAccessToken: async () => 'fresh-token',
      fetchImpl: mockFetch,
      staticCatalog: MOCK_STATIC_CATALOG,
    });

    expect(seenTokens).toEqual(['Bearer expired-token', 'Bearer fresh-token']);
    expect(models.map((m) => m.id)).toEqual(['pi/gpt-7-sol', 'pi/gpt-6.2-sol']);
  });

  it('falls back gracefully to the static catalog (+ supplemental GPT-6.2) on network failure', async () => {
    const failingFetch = (async () => {
      throw new Error('network unreachable');
    }) as unknown as typeof fetch;

    const models = await fetchOpenAiLiveModels({
      token: 'valid-token',
      piAuthProvider: 'openai',
      timeoutMs: 5_000,
      fetchImpl: failingFetch,
      staticCatalog: MOCK_STATIC_CATALOG,
    });

    expect(models.map((m) => m.id)).toEqual([
      'pi/gpt-6.2-astra',
      'pi/gpt-6.2-sol',
      'pi/gpt-6-astra',
      'pi/gpt-6.1-sol',
    ]);
  });
});
