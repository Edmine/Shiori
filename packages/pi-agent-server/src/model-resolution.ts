import type { ModelRegistry as PiModelRegistry } from '@earendil-works/pi-coding-agent';
import type { CustomEndpointModelConfig } from './custom-endpoint-models.ts';
import { normalizeCustomEndpointModelEntry, stripPiPrefix } from './custom-endpoint-models.ts';

// Re-export from shared so the auth-aware mini-model denylist has a single
// source of truth (also used by `getMiniModel()` at selection time).
export { isDeniedMiniModelId } from '../../shared/src/config/llm-connections.ts';

// Re-export the PiModel type used by callers
type PiModel<T = any> = ReturnType<PiModelRegistry['find']>;

/**
 * Resolve a Pi SDK model from the registry, with optional custom-endpoint precedence.
 *
 * Resolution order:
 * 1. If `preferCustomEndpoint` is true, try `'custom-endpoint'` provider first
 * 2. Exact provider+model lookup via `piAuthProvider`
 * 3. Full `getAll()` scan by id/name
 * 4. Common provider fallback list (includes 'custom-endpoint')
 */
export function resolvePiModel(
  modelRegistry: PiModelRegistry,
  modelId: string,
  piAuthProvider?: string,
  preferCustomEndpoint?: boolean,
): PiModel | undefined {
  // Strip Craft's pi/ prefix — Pi SDK uses bare model IDs (e.g. "claude-sonnet-4-6")
  const bareId = modelId.startsWith('pi/') ? modelId.slice(3) : modelId;

  // Custom-endpoint takes precedence when configured
  if (preferCustomEndpoint) {
    const custom = modelRegistry.find('custom-endpoint', bareId);
    if (custom) return custom;
  }

  // If we know the auth provider, do an exact provider+model lookup first.
  // This avoids the getAll() ambiguity where the same model ID exists under
  // multiple providers (e.g., "gpt-5.2" under both "openai" and
  // "azure") and the wrong one matches first.
  if (piAuthProvider) {
    const exact = modelRegistry.find(piAuthProvider, bareId);
    if (exact) {
      // MiniMax CN API rejects model IDs with the 'MiniMax-' prefix (e.g. 500 for
      // 'MiniMax-M2.5-highspeed') but accepts bare names ('M2.5-highspeed').
      if (piAuthProvider === 'minimax-cn' && exact.id.startsWith('MiniMax-')) {
        return { ...exact, id: exact.id.slice('MiniMax-'.length) };
      }
      return exact;
    }
  }

  // Fallback: search all available models.
  // When piAuthProvider is set, only return models from the same provider
  // (or 'custom-endpoint'). Without this guard, a model that exists under
  // a different provider (e.g. "gpt-5.4" under "azure"
  // when authed as "github-copilot") would be returned, and the Pi SDK
  // would fail with "No API key found for <wrong-provider>".
  const allModels = modelRegistry.getAll();
  const match = allModels.find(m =>
    (m.id === bareId || m.name === bareId) &&
    (!piAuthProvider || (m as any).provider === piAuthProvider || (m as any).provider === 'custom-endpoint'),
  );
  if (match) return match;

  // Try common providers with the model ID
  const providers = ['custom-endpoint', 'anthropic', 'openai', 'google'];
  for (const provider of providers) {
    // Skip providers incompatible with the authenticated provider
    if (piAuthProvider && provider !== piAuthProvider && provider !== 'custom-endpoint') continue;
    const model = modelRegistry.find(provider, bareId);
    if (model) return model;
  }

  return undefined;
}

const PREFERRED_TEMPLATE_IDS_BY_PROVIDER: Record<string, readonly string[]> = {
  openai: ['gpt-6.1-sol', 'gpt-6-astra', 'gpt-6-sol', 'gpt-5.6-sol', 'gpt-5.5', 'gpt-5.4'],
  'openai-codex': ['gpt-6.1-sol', 'gpt-6-astra', 'gpt-6-sol', 'gpt-5.6-sol', 'gpt-5.5', 'gpt-5.4'],
  anthropic: ['claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5', 'claude-sonnet-4-6'],
};

function selectTemplateModelForProvider(
  modelRegistry: PiModelRegistry,
  piAuthProvider: string,
): PiModel | undefined {
  const candidates = modelRegistry
    .getAll()
    .filter((m) => (m as any).provider === piAuthProvider && (m as any).api !== 'openai-decisions');
  if (candidates.length === 0) return undefined;

  const preferredIds = PREFERRED_TEMPLATE_IDS_BY_PROVIDER[piAuthProvider];
  if (preferredIds) {
    for (const id of preferredIds) {
      const preferred = candidates.find((m) => m.id === id);
      if (preferred) return preferred;
    }
  }

  return [...candidates].sort((a, b) => {
    const reasoningDiff = Number(Boolean(b.reasoning)) - Number(Boolean(a.reasoning));
    if (reasoningDiff !== 0) return reasoningDiff;
    const maxTokensDiff = ((b as any).maxTokens ?? 0) - ((a as any).maxTokens ?? 0);
    if (maxTokensDiff !== 0) return maxTokensDiff;
    return (b.contextWindow ?? 0) - (a.contextWindow ?? 0);
  })[0];
}

/**
 * Resolve a Pi SDK model and apply per-model overrides from `customModels`
 * (contextWindow, supportsImages, supportsThinking, name). If the requested
 * model is not in the built-in Pi SDK catalog but was explicitly configured
 * in `customModels` for an authenticated `piAuthProvider`, synthesize a model
 * definition cloned from an existing template model of the same provider so
 * newly added subscription/API models work immediately.
 */
export function resolvePiModelWithOverrides(
  modelRegistry: PiModelRegistry,
  modelId: string,
  piAuthProvider?: string,
  preferCustomEndpoint?: boolean,
  customModels?: CustomEndpointModelConfig[],
): PiModel | undefined {
  const bareId = stripPiPrefix(modelId);
  const normalizedCustom = customModels?.map(normalizeCustomEndpointModelEntry);
  const overrideEntry = normalizedCustom?.find((entry) => entry.id === bareId);

  const resolved = resolvePiModel(modelRegistry, modelId, piAuthProvider, preferCustomEndpoint);
  if (resolved) {
    if (!overrideEntry) return resolved;
    const nextInput = overrideEntry.supportsImages === undefined
      ? resolved.input
      : (overrideEntry.supportsImages ? ['text', 'image'] : ['text']);
    return {
      ...resolved,
      ...(overrideEntry.name ? { name: overrideEntry.name } : {}),
      ...(overrideEntry.contextWindow ? { contextWindow: overrideEntry.contextWindow } : {}),
      ...(overrideEntry.supportsThinking !== undefined ? { reasoning: overrideEntry.supportsThinking } : {}),
      input: nextInput,
    } as PiModel;
  }

  // Synthesize from an existing model of the same authenticated provider when the user
  // explicitly added a newer or custom model ID to a subscription/provider connection.
  if (piAuthProvider && overrideEntry) {
    const template = selectTemplateModelForProvider(modelRegistry, piAuthProvider);
    if (template) {
      const nextInput = overrideEntry.supportsImages === undefined
        ? (template.input ?? ['text', 'image'])
        : (overrideEntry.supportsImages ? ['text', 'image'] : ['text']);
      return {
        ...template,
        id: bareId,
        name: overrideEntry.name || bareId,
        contextWindow: overrideEntry.contextWindow ?? template.contextWindow,
        reasoning: overrideEntry.supportsThinking ?? template.reasoning,
        input: nextInput,
      } as PiModel;
    }
  }

  return undefined;
}

/**
 * Returns true when an error message indicates the requested model is unavailable and a
 * different model should be tried. Matches both the standard OpenAI "model not found"
 * shapes and the ChatGPT-account Codex "… is not supported" refusal.
 */
export function isModelNotFoundError(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes('model_not_found') ||
    normalized.includes('does not exist') ||
    normalized.includes('no such model') ||
    normalized.includes('is not supported') ||
    (normalized.includes('requested model') && normalized.includes('not') && normalized.includes('exist'))
  );
}

/**
 * Stricter variant of `isModelNotFoundError` for contexts where a 400 can also mean a
 * rejected *tool* or parameter — e.g. the ChatGPT Codex search path, where a hosted-tool
 * refusal ("Hosted tool 'web_search' is not supported") must not be mistaken for a model
 * rejection (that would skip the tool-type retry and burn every candidate model instead).
 * The ambiguous phrasings ("is not supported", "does not exist") only count when the
 * message names the requested model — the known Codex refusal quotes it verbatim
 * ("The 'gpt-5.3-codex' model is not supported when using Codex with a ChatGPT account.").
 */
export function isModelRejectionError(message: string, modelId: string): boolean {
  if (!isModelNotFoundError(message)) return false;
  const normalized = message.toLowerCase();
  if (
    normalized.includes('model_not_found') ||
    normalized.includes('no such model') ||
    normalized.includes('requested model')
  ) {
    return true;
  }
  return modelId.length > 0 && normalized.includes(modelId.toLowerCase());
}
