import type { ModelDefinition } from '../../../../config/models.ts';
import { getPiModelsForAuthProvider, isExcludedPiModel } from '../../../../config/models-pi.ts';
import {
  isDeniedMiniModelId,
  PI_PREFERRED_DEFAULTS,
  preferredModelRank,
} from '../../../../config/llm-connections.ts';

const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1';

/** Non-chat, media, utility, and legacy models returned by OpenAI's /v1/models endpoint. */
const NON_CHAT_MODEL_PATTERN =
  /(?:embedding|whisper|tts|dall-e|moderation|transcribe|sora|gpt-image|chatgpt-image|image-|^babbage|^davinci|^curie|^ada|-audio\b|\baudio-|-realtime\b|\brealtime\b|-search-|\bsearch-preview\b|computer-use|omni-moderation|^text-|^code-|-instruct\b)/i;

/** Dated snapshot suffixes like -2025-08-07 or -0125. */
const DATED_SNAPSHOT_PATTERN = /(?:-\d{4}-\d{2}-\d{2}|-\d{4})$/;

/** Chat/reasoning model families that should be picked up automatically as OpenAI ships new versions. */
const ELIGIBLE_FAMILY_PATTERNS: readonly RegExp[] = [
  /^gpt-(?:[5-9]|[1-9]\d)(?:$|[.-])/i,
  /^o[1-9]\d*(?:$|-)/i,
  /^chatgpt-/i,
  /^codex-/i,
];

const TIER_RANK: Record<string, number> = {
  astra: 0,
  pro: 1,
  sol: 2,
  terra: 3,
  codex: 4,
  spark: 5,
  mini: 6,
  luna: 7,
  nano: 8,
};

export interface FetchOpenAiLiveModelsOptions {
  token?: string;
  baseUrl?: string;
  piAuthProvider: string;
  timeoutMs: number;
  refreshAccessToken?: () => Promise<string | undefined>;
  fetchImpl?: typeof fetch;
  staticCatalog?: ModelDefinition[];
}

/**
 * Resolve the /models URL for OpenAI or an OpenAI-compatible base URL.
 */
export function buildOpenAiModelsUrl(baseUrl?: string): string {
  const trimmed = (baseUrl?.trim() || DEFAULT_OPENAI_BASE_URL).replace(/\/+$/, '');
  if (trimmed.endsWith('/models')) {
    return trimmed;
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.hostname === 'api.openai.com' && (parsed.pathname === '' || parsed.pathname === '/')) {
      return `${trimmed}/v1/models`;
    }
  } catch {
    // Use trimmed URL directly if parsing fails
  }
  return `${trimmed}/models`;
}

/**
 * Determine whether a bare model ID returned by OpenAI's /v1/models should be
 * included in Shiori's chat model list.
 */
export function isEligibleOpenAiLiveModelId(
  bareId: string,
  staticCatalogIds: ReadonlySet<string>,
  piAuthProvider?: string,
): boolean {
  const id = bareId.trim();
  if (!id || /\s/.test(id)) return false;

  if (isExcludedPiModel(id)) return false;
  if (isDeniedMiniModelId(id, piAuthProvider)) return false;

  // Exclude fine-tuned models
  if (id.startsWith('ft:') || id.includes(':ft-')) return false;

  // Exclude non-chat / media / utility / realtime endpoints
  if (NON_CHAT_MODEL_PATTERN.test(id)) return false;

  // Keep canonical aliases and skip dated snapshots unless already pinned in static catalog
  if (DATED_SNAPSHOT_PATTERN.test(id) && !staticCatalogIds.has(id)) {
    return false;
  }

  if (staticCatalogIds.has(id)) return true;
  return ELIGIBLE_FAMILY_PATTERNS.some((pattern) => pattern.test(id));
}

/**
 * Convert a bare OpenAI model ID into a clean human-readable display name.
 */
export function formatOpenAiModelDisplayName(bareId: string): string {
  // Keep o-series canonical lowercase styling (e.g. o3, o4-mini, o5-pro)
  if (/^o[1-9]\d*(?:$|-)/i.test(bareId)) {
    return bareId.toLowerCase();
  }

  const gptMatch = bareId.match(/^gpt-([0-9]+(?:\.[0-9]+)?)(?:-(.+))?$/i);
  if (gptMatch) {
    const version = gptMatch[1]!;
    const suffix = gptMatch[2];
    if (!suffix) return `GPT-${version}`;
    const formattedSuffix = suffix
      .split('-')
      .filter(Boolean)
      .map((part) => {
        const lower = part.toLowerCase();
        if (lower === 'latest') return '(latest)';
        if (/^[0-9]+(?:\.[0-9]+)?$/.test(part)) return part;
        return part.charAt(0).toUpperCase() + part.slice(1);
      })
      .join(' ');
    return `GPT-${version} ${formattedSuffix}`;
  }

  const codexMatch = bareId.match(/^codex-(.+)$/i);
  if (codexMatch) {
    const rest = codexMatch[1]!
      .split('-')
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
    return `Codex ${rest}`;
  }

  const chatGptMatch = bareId.match(/^chatgpt-(.+)$/i);
  if (chatGptMatch) {
    const rest = chatGptMatch[1]!
      .split('-')
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
    return `ChatGPT ${rest}`;
  }

  return bareId;
}

function inferOpenAiContextWindow(bareId: string): number {
  const lower = bareId.toLowerCase();
  if (/^o[1-9]\d*(?:$|-)/.test(lower)) return 200_000;
  if (/^gpt-5(?:\.[0-3])?(?:$|-)/.test(lower)) return 400_000;
  return 272_000;
}

function inferOpenAiSupportsThinking(bareId: string): boolean {
  const lower = bareId.toLowerCase();
  if (lower.startsWith('gpt-4') || lower.includes('-chat-latest')) {
    return false;
  }
  return true;
}

function parseGptVersion(bareId: string): { major: number; minor: number } | null {
  const match = bareId.match(/^gpt-(\d+)(?:\.(\d+))?(?:$|-)/i);
  if (!match) return null;
  return {
    major: Number.parseInt(match[1]!, 10),
    minor: match[2] ? Number.parseInt(match[2], 10) : 0,
  };
}

function parseOSeriesVersion(bareId: string): number | null {
  const match = bareId.match(/^o(\d+)(?:$|-)/i);
  if (!match) return null;
  return Number.parseInt(match[1]!, 10);
}

function inferTierRank(bareId: string): number {
  const tokens = bareId.toLowerCase().split('-');
  for (const token of tokens) {
    if (token in TIER_RANK) {
      return TIER_RANK[token]!;
    }
  }
  return 50;
}

function isFutureNewerThanPreferred(bareId: string): boolean {
  const gpt = parseGptVersion(bareId);
  if (gpt) {
    return gpt.major > 6 || (gpt.major === 6 && gpt.minor > 2);
  }
  const oSeries = parseOSeriesVersion(bareId);
  if (oSeries !== null) {
    return oSeries >= 5;
  }
  return false;
}

/**
 * Sort OpenAI models so:
 * 1. Brand-new future generations (e.g. gpt-6.3+, gpt-7+, o5+) automatically float to the top
 * 2. Known preferred models keep their PI_PREFERRED_DEFAULTS ranking
 * 3. Remaining models sort by newest version descending, then alphabetically
 */
export function sortOpenAiModels(
  models: ModelDefinition[],
  piAuthProvider: string,
): ModelDefinition[] {
  const preferred = PI_PREFERRED_DEFAULTS[piAuthProvider] ?? PI_PREFERRED_DEFAULTS.openai ?? [];

  return [...models].sort((a, b) => {
    const bareA = a.id.startsWith('pi/') ? a.id.slice(3) : a.id;
    const bareB = b.id.startsWith('pi/') ? b.id.slice(3) : b.id;

    const rankA = preferredModelRank(a.id, preferred);
    const rankB = preferredModelRank(b.id, preferred);

    const futureA = rankA < 0 && isFutureNewerThanPreferred(bareA);
    const futureB = rankB < 0 && isFutureNewerThanPreferred(bareB);

    const bucketA = futureA ? 0 : (rankA >= 0 ? 1 : 2);
    const bucketB = futureB ? 0 : (rankB >= 0 ? 1 : 2);
    if (bucketA !== bucketB) return bucketA - bucketB;

    if (bucketA === 1) {
      if (rankA !== rankB) return rankA - rankB;
      return bareA.localeCompare(bareB);
    }

    const gptA = parseGptVersion(bareA);
    const gptB = parseGptVersion(bareB);
    if (gptA && gptB) {
      if (gptA.major !== gptB.major) return gptB.major - gptA.major;
      if (gptA.minor !== gptB.minor) return gptB.minor - gptA.minor;
      const tierDiff = inferTierRank(bareA) - inferTierRank(bareB);
      if (tierDiff !== 0) return tierDiff;
      return bareA.localeCompare(bareB);
    }
    if (gptA && !gptB) return -1;
    if (!gptA && gptB) return 1;

    const oA = parseOSeriesVersion(bareA);
    const oB = parseOSeriesVersion(bareB);
    if (oA !== null && oB !== null) {
      if (oA !== oB) return oB - oA;
      const tierDiff = inferTierRank(bareA) - inferTierRank(bareB);
      if (tierDiff !== 0) return tierDiff;
      return bareA.localeCompare(bareB);
    }
    if (oA !== null && oB === null) return -1;
    if (oA === null && oB !== null) return 1;

    return bareA.localeCompare(bareB);
  });
}

/**
 * Build a synthesized ModelDefinition for a newly-discovered OpenAI model ID
 * not yet present in the static Pi SDK catalog or supplemental metadata.
 */
export function synthesizeOpenAiModelDefinition(
  bareId: string,
  piAuthProvider: string,
): ModelDefinition {
  const name = formatOpenAiModelDisplayName(bareId);
  const shortName = name.length > 20 ? (name.split(/[\s-]/).pop() ?? name) : name;

  return {
    id: `pi/${bareId}`,
    name,
    shortName,
    description: `${piAuthProvider} model (live synced)`,
    provider: 'pi',
    contextWindow: inferOpenAiContextWindow(bareId),
    supportsThinking: inferOpenAiSupportsThinking(bareId),
    supportsImages: true,
  };
}

/**
 * Filter, enrich, and sort a raw list of OpenAI model IDs from /v1/models.
 */
export function buildOpenAiModelsFromLiveIds(
  rawIds: readonly string[],
  staticCatalog: readonly ModelDefinition[],
  piAuthProvider: string,
): ModelDefinition[] {
  const staticByBareId = new Map<string, ModelDefinition>();
  for (const model of staticCatalog) {
    const bare = model.id.startsWith('pi/') ? model.id.slice(3) : model.id;
    staticByBareId.set(bare, model);
  }
  const staticIds = new Set(staticByBareId.keys());

  const seen = new Set<string>();
  const resolved: ModelDefinition[] = [];

  for (const rawId of rawIds) {
    if (typeof rawId !== 'string') continue;
    const bareId = rawId.trim();
    if (!bareId || seen.has(bareId)) continue;
    if (!isEligibleOpenAiLiveModelId(bareId, staticIds, piAuthProvider)) continue;

    seen.add(bareId);
    const known = staticByBareId.get(bareId);
    if (known) {
      resolved.push({ ...known });
    } else {
      resolved.push(synthesizeOpenAiModelDefinition(bareId, piAuthProvider));
    }
  }

  return sortOpenAiModels(resolved, piAuthProvider);
}

async function requestOpenAiModelIds(
  url: string,
  token: string,
  timeoutMs: number,
  fetchImpl: typeof fetch,
): Promise<{ status: number; ids: string[]; errorText?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetchImpl(url, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    });

    if (!res.ok) {
      const errorText = await res.text().catch(() => '');
      return { status: res.status, ids: [], errorText: errorText.slice(0, 300) };
    }

    const payload = (await res.json()) as Record<string, unknown>;
    const rawList = Array.isArray(payload.data)
      ? payload.data
      : Array.isArray(payload.models)
        ? payload.models
        : [];

    const ids = rawList
      .map((entry) => {
        if (typeof entry === 'string') return entry;
        if (entry && typeof entry === 'object' && typeof (entry as { id?: unknown }).id === 'string') {
          return (entry as { id: string }).id;
        }
        return null;
      })
      .filter((id): id is string => !!id);

    return { status: res.status, ids };
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      throw new Error('OpenAI models API timed out');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch live OpenAI models via GET /v1/models with automatic 401 OAuth refresh
 * retry and graceful fallback to the static Pi catalog (+ supplemental GPT-6.2).
 */
export async function fetchOpenAiLiveModels(
  options: FetchOpenAiLiveModelsOptions,
): Promise<ModelDefinition[]> {
  const {
    baseUrl,
    piAuthProvider,
    timeoutMs,
    refreshAccessToken,
    fetchImpl = fetch,
  } = options;

  const staticCatalog = options.staticCatalog ?? getPiModelsForAuthProvider(piAuthProvider);
  const fallback = sortOpenAiModels(staticCatalog, piAuthProvider);

  let activeToken = options.token?.trim();
  if (!activeToken) {
    return fallback;
  }

  const url = buildOpenAiModelsUrl(baseUrl);

  try {
    let response = await requestOpenAiModelIds(url, activeToken, timeoutMs, fetchImpl);

    if (response.status === 401 && refreshAccessToken) {
      const refreshed = (await refreshAccessToken().catch(() => undefined))?.trim();
      if (refreshed && refreshed !== activeToken) {
        activeToken = refreshed;
        response = await requestOpenAiModelIds(url, activeToken, timeoutMs, fetchImpl);
      }
    }

    if (response.status < 200 || response.status >= 300) {
      console.warn(
        `[fetchOpenAiLiveModels] GET ${url} returned HTTP ${response.status}: ${response.errorText ?? ''}`,
      );
      return fallback;
    }

    const liveModels = buildOpenAiModelsFromLiveIds(response.ids, staticCatalog, piAuthProvider);
    if (liveModels.length > 0) {
      console.warn(
        `[fetchOpenAiLiveModels] GET ${url} synced ${liveModels.length} chat models from ${response.ids.length} raw entries`,
      );
      return liveModels;
    }

    console.warn(
      `[fetchOpenAiLiveModels] GET ${url} returned ${response.ids.length} entries but 0 eligible chat models; falling back to static catalog`,
    );
    return fallback;
  } catch (err) {
    console.warn(
      `[fetchOpenAiLiveModels] Live fetch failed (${url}): ${err instanceof Error ? err.message : String(err)}; falling back to static catalog`,
    );
    return fallback;
  }
}
