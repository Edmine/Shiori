import {
  isLocalConnection,
  type LlmConnection,
} from '@config/llm-connections'

/**
 * Format token count for display (e.g., 1500 -> "1.5k", 200000 -> "200k").
 * Shared by the desktop model dropdown and the compact (drawer) model picker.
 */
export function formatTokenCount(tokens: number): string {
  if (tokens >= 1000000) {
    return `${(tokens / 1000000).toFixed(1)}M`
  }
  if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(tokens >= 10000 ? 0 : 1)}k`
  }
  return tokens.toString()
}

/**
 * Strip the "pi/" prefix from model IDs/display names so the user sees a
 * provider-agnostic label in the picker (e.g., "pi/claude-opus" → "claude-opus").
 */
export function stripPiPrefixForDisplay(value: string): string {
  return value.startsWith('pi/') ? value.slice(3) : value
}

const BOILERPLATE_MODEL_DESC_RE = /\bmodel via (?:Shiori|Craft Agents) Backend\b/i

/**
 * Returns true if a model description is an auto-generated backend boilerplate
 * string (e.g. "openai model via Shiori Backend") that adds visual noise to
 * model pickers.
 */
export function isBoilerplateModelDescription(description: string | undefined): boolean {
  if (!description) return true
  return BOILERPLATE_MODEL_DESC_RE.test(description.trim())
}

/**
 * Resolve a model's human-meaningful subtitle for display in model pickers,
 * suppressing repetitive auto-generated boilerplate strings.
 */
export function getVisibleModelDescription(
  model: string | { description?: string; descriptionKey?: string },
  t: (key: string) => string,
): string {
  if (typeof model === 'string') return ''
  if (model.descriptionKey) {
    return t(model.descriptionKey)
  }
  const raw = typeof model.description === 'string' ? model.description.trim() : ''
  if (!raw || isBoilerplateModelDescription(raw)) return ''
  return raw
}

export type ConnectionGroup = [groupName: string, connections: LlmConnection[]]

/**
 * Group connections by provider type for hierarchical picker rendering.
 * Each provider section can contain multiple connections (API Key, OAuth, …).
 * Order is significant for UI: Anthropic, Local, Shiori Backend.
 * Empty groups are dropped.
 */
export function groupConnectionsByProvider<T extends LlmConnection>(
  connections: readonly T[],
): Array<[string, T[]]> {
  const groups: Record<string, T[]> = {
    'Anthropic': [],
    'Local': [],
    'Shiori Backend': [],
  }
  for (const conn of connections) {
    const provider = conn.providerType || 'anthropic'
    if (provider === 'anthropic') {
      groups['Anthropic'].push(conn)
    } else if (provider === 'pi_compat' && isLocalConnection(conn)) {
      groups['Local'].push(conn)
    } else if (provider === 'pi' || provider === 'pi_compat') {
      groups['Shiori Backend'].push(conn)
    }
  }
  return Object.entries(groups).filter(([, conns]) => conns.length > 0)
}
