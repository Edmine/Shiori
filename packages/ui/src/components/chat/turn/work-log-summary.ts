/**
 * Text for the collapsed work log row. Same sources as before (intent, running tools, latest
 * commentary, task description); the error count moved out of the text into a failure chip.
 */
import i18n from 'i18next'
import { isParentTaskTool } from '@craft-agent/shared/utils/toolNames'
import type { ActivityItem } from '../TurnCard'
import { getToolDisplayName } from './tool-display'

export interface WorkLogPreview {
  /** Preview text after the step count, or undefined for the plain "N steps completed" summary */
  text?: string
}

/** Activities whose status is `error` — shown as a "N failed" chip on the collapsed row. */
export function countFailedActivities(activities: ActivityItem[]): number {
  let failed = 0
  for (const activity of activities) {
    if (activity.status === 'error') failed++
  }
  return failed
}

/** Get the preview text for the collapsed state */
export function getWorkLogPreview(
  activities: ActivityItem[],
  intent?: string,
  isStreaming?: boolean,
  hasResponse?: boolean,
  isComplete?: boolean
): WorkLogPreview {
  const reversed = [...activities].reverse()

  // While actively executing, prioritize live/latest work so the header tracks progress
  // instead of freezing on step 1's old intent.
  if (!isComplete) {
    if (isStreaming && hasResponse) return { text: i18n.t('turnCard.responding') }

    const runningTask = reversed.find(a => isParentTaskTool(a.toolName ?? '') && a.status === 'running')
    if (runningTask?.toolInput?.description) {
      return { text: runningTask.toolInput.description as string }
    }

    const runningWithIntent = reversed.find(a => a.status === 'running' && a.intent)
    if (runningWithIntent?.intent) {
      return { text: runningWithIntent.intent }
    }

    const runningTools = reversed.filter(a => a.status === 'running' && a.toolName)
    if (runningTools.length > 0) {
      const toolNames = runningTools
        .map(a => a.displayName || getToolDisplayName(a.toolName!))
        .slice(0, 3)
      return { text: `${toolNames.join(', ')}...` }
    }

    const latestIntermediate = reversed.find(a => a.type === 'intermediate' && a.content?.trim())
    if (latestIntermediate?.content) {
      return { text: latestIntermediate.content.trim() }
    }

    const latestWithIntent = reversed.find(a => a.intent)
    if (latestWithIntent?.intent) {
      return { text: latestWithIntent.intent }
    }

    if (intent) return { text: intent }

    return { text: i18n.t('turnCard.starting') }
  }

  // Completed state: show latest meaningful intent or task description for quick scanning
  const latestWithIntent = reversed.find(a => a.intent)
  if (latestWithIntent?.intent) {
    return { text: latestWithIntent.intent }
  }

  if (intent) return { text: intent }

  const latestTask = reversed.find(a => isParentTaskTool(a.toolName ?? '') && a.toolInput?.description)
  if (latestTask?.toolInput?.description) {
    return { text: latestTask.toolInput.description as string }
  }

  // Fallback: step count carries the summary ("N steps completed")
  return {}
}
