import * as React from 'react'

export interface InteractiveUiActionPayload {
  /** Primary human-readable message or instruction to send to the active session */
  message: string
  /** Optional short label describing the triggered control */
  label?: string
  /** Optional structured data submitted from the interactive UI */
  data?: unknown
  /** Optional title of the originating widget */
  widgetTitle?: string
}

export interface InteractiveUiContextValue {
  /** Sends a user-initiated action from an interactive UI block into the active chat session */
  onAction: (payload: InteractiveUiActionPayload) => void
  /** True while the enclosing assistant turn is still streaming */
  isStreaming?: boolean
}

const MAX_MESSAGE_CHARS = 3000
const MAX_DATA_CHARS = 2000

/**
 * Format a widget action into a concise, readable user message for the chat session.
 * Preserves natural language intent while attaching structured JSON data when provided.
 */
export function formatInteractiveUiActionMessage(payload: InteractiveUiActionPayload): string {
  const message = (payload.message || '').trim().slice(0, MAX_MESSAGE_CHARS)
  const label = (payload.label || '').trim().slice(0, 120)
  const widgetTitle = (payload.widgetTitle || '').trim().slice(0, 120)

  let dataBlock = ''
  if (payload.data !== undefined && payload.data !== null) {
    try {
      const serialized = JSON.stringify(payload.data, null, 2)
      if (serialized && serialized !== '{}' && serialized !== '[]') {
        const clipped = serialized.length > MAX_DATA_CHARS
          ? `${serialized.slice(0, MAX_DATA_CHARS)}\n...`
          : serialized
        dataBlock = `\n\n\`\`\`json\n${clipped}\n\`\`\``
      }
    } catch {
      // Ignore non-serializable payloads
    }
  }

  if (message) {
    return `${message}${dataBlock}`
  }

  const header = widgetTitle
    ? `[${widgetTitle}] ${label || '交互操作'}`
    : (label || '交互操作')

  return `${header}${dataBlock}`
}

const InteractiveUiContext = React.createContext<InteractiveUiContextValue | null>(null)

export const InteractiveUiProvider = InteractiveUiContext.Provider

export function useInteractiveUi(): InteractiveUiContextValue | null {
  return React.useContext(InteractiveUiContext)
}
