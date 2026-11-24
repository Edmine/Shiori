import type { ActivityItem, ResponseContent } from '../TurnCard'

export type TurnTimelineSegment =
  | {
      kind: 'commentary'
      id: string
      activity: ActivityItem
    }
  | {
      kind: 'work'
      id: string
      activities: ActivityItem[]
    }

function isDuplicateOfFinalResponse(activity: ActivityItem, response?: ResponseContent): boolean {
  if (!response) return false
  if (response.messageId && response.messageId === activity.id) return true
  const activityText = activity.content?.trim()
  const responseText = response.text?.trim()
  if (!activityText || !responseText) return false
  return !response.isStreaming && activityText === responseText
}

/**
 * Determine whether an activity should surface directly on the conversation timeline
 * as a Codex-style live AI commentary update instead of staying buried inside a
 * collapsed tool work log.
 */
export function isSurfaceableCommentary(
  activity: ActivityItem,
  response?: ResponseContent,
): boolean {
  if (activity.type !== 'intermediate') return false
  // Subagent commentary belongs nested inside its parent Task/Agent group
  if (activity.parentId) return false
  if (!activity.content?.trim()) return false
  if (isDuplicateOfFinalResponse(activity, response)) return false
  return true
}

/**
 * Split chronological non-plan activities into interleaved timeline segments:
 * - `commentary`: top-level AI progress updates rendered directly in the chat stream
 * - `work`: contiguous tool/status/subagent activities rendered as compact collapsible work logs
 */
export function buildTurnTimelineSegments(
  sortedActivities: ActivityItem[],
  response?: ResponseContent,
): TurnTimelineSegment[] {
  const segments: TurnTimelineSegment[] = []
  let currentWork: ActivityItem[] = []

  const flushWork = () => {
    if (currentWork.length === 0) return
    segments.push({
      kind: 'work',
      id: `work-${currentWork[0]!.id}`,
      activities: currentWork,
    })
    currentWork = []
  }

  for (const activity of sortedActivities) {
    // Skip an intermediate activity that has already been promoted to the final response
    if (activity.type === 'intermediate' && !activity.parentId && isDuplicateOfFinalResponse(activity, response)) {
      continue
    }

    if (isSurfaceableCommentary(activity, response)) {
      flushWork()
      segments.push({
        kind: 'commentary',
        id: `commentary-${activity.id}`,
        activity,
      })
    } else {
      currentWork.push(activity)
    }
  }

  flushWork()
  return segments
}
