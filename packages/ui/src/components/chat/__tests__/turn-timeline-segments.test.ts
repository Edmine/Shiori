import { describe, it, expect } from 'bun:test'
import type { ActivityItem, ResponseContent } from '../TurnCard'
import { buildTurnTimelineSegments } from '../turn/timeline-segments'
import { getWorkLogPreview } from '../turn/work-log-summary'

function makeTool(id: string, overrides: Partial<ActivityItem> = {}): ActivityItem {
  return {
    id,
    type: 'tool',
    status: 'completed',
    toolName: 'Bash',
    timestamp: 1000,
    ...overrides,
  }
}

function makeCommentary(id: string, content: string, overrides: Partial<ActivityItem> = {}): ActivityItem {
  return {
    id,
    type: 'intermediate',
    status: 'completed',
    content,
    timestamp: 1000,
    ...overrides,
  }
}

describe('Turn timeline segmentation (Codex-style live commentary)', () => {
  it('interleaves top-level intermediate commentary directly between tool work groups', () => {
    const activities: ActivityItem[] = [
      makeTool('t1', { timestamp: 1, intent: '检查实例锁' }),
      makeCommentary('c1', '请先完成 Tailscale 登录，我会继续检查。', { timestamp: 2 }),
      makeTool('t2', { timestamp: 3, intent: '查 Tailscale 登录状态' }),
      makeTool('t3', { timestamp: 4, intent: '确认 IP' }),
      makeCommentary('c2', 'Tailscale 已上线：100.115.127.96。现在继续。', { timestamp: 5 }),
      makeTool('t4', { timestamp: 6, status: 'running', intent: '启动独立配置目录服务' }),
    ]

    const segments = buildTurnTimelineSegments(activities)
    expect(segments.map(s => s.kind)).toEqual(['work', 'commentary', 'work', 'commentary', 'work'])
    expect(segments[0]!.kind === 'work' && segments[0]!.activities.map(a => a.id)).toEqual(['t1'])
    expect(segments[1]!.kind === 'commentary' && segments[1]!.activity.content).toContain('Tailscale 登录')
    expect(segments[2]!.kind === 'work' && segments[2]!.activities.map(a => a.id)).toEqual(['t2', 't3'])
    expect(segments[3]!.kind === 'commentary' && segments[3]!.activity.content).toContain('100.115.127.96')
    expect(segments[4]!.kind === 'work' && segments[4]!.activities.map(a => a.id)).toEqual(['t4'])
  })

  it('keeps subagent intermediate commentary nested inside work segments', () => {
    const activities: ActivityItem[] = [
      makeTool('task1', { toolName: 'Agent', toolUseId: 'tu-1', timestamp: 1 }),
      makeCommentary('sub-c1', '子代理内部思考', { parentId: 'tu-1', depth: 1, timestamp: 2 }),
      makeTool('sub-t1', { parentId: 'tu-1', depth: 1, timestamp: 3 }),
    ]

    const segments = buildTurnTimelineSegments(activities)
    expect(segments).toHaveLength(1)
    expect(segments[0]!.kind).toBe('work')
    if (segments[0]!.kind === 'work') {
      expect(segments[0]!.activities.map(a => a.id)).toEqual(['task1', 'sub-c1', 'sub-t1'])
    }
  })

  it('deduplicates intermediate commentary already promoted to final response', () => {
    const activities: ActivityItem[] = [
      makeTool('t1', { timestamp: 1 }),
      makeCommentary('c-final', '全部已完成，服务已启动。', { timestamp: 2 }),
    ]
    const response: ResponseContent = {
      text: '全部已完成，服务已启动。',
      isStreaming: false,
      messageId: 'c-final',
    }

    const segments = buildTurnTimelineSegments(activities, response)
    expect(segments).toHaveLength(1)
    expect(segments[0]!.kind).toBe('work')
  })

  it('collapses non-final commentary and tool groups into one work log once complete', () => {
    const activities: ActivityItem[] = [
      makeCommentary('c1', '先检查现有配置文件。', { timestamp: 1 }),
      makeTool('t1', { timestamp: 2, intent: '读取配置' }),
      makeCommentary('c2', '已定位原因，开始修改代码。', { timestamp: 3 }),
      makeTool('t2', { timestamp: 4, intent: '修改文件' }),
      makeCommentary('c-empty', '   ', { timestamp: 5 }),
      makeCommentary('c-final', '全部修复完成。', { timestamp: 6 }),
    ]
    const response: ResponseContent = {
      text: '全部修复完成。',
      isStreaming: false,
      messageId: 'c-final',
    }

    const segments = buildTurnTimelineSegments(activities, response, { collapseNonFinal: true })
    expect(segments).toHaveLength(1)
    expect(segments[0]!.kind).toBe('work')
    if (segments[0]!.kind === 'work') {
      expect(segments[0]!.activities.map(a => a.id)).toEqual(['c1', 't1', 'c2', 't2'])
    }
  })

  it('returns no work log when collapsed turn only had the promoted final commentary', () => {
    const activities: ActivityItem[] = [
      makeCommentary('c-final', '直接完成回复。', { timestamp: 1 }),
    ]
    const response: ResponseContent = {
      text: '直接完成回复。',
      isStreaming: false,
      messageId: 'c-final',
    }

    const segments = buildTurnTimelineSegments(activities, response, { collapseNonFinal: true })
    expect(segments).toHaveLength(0)
  })

  it('falls back to stripped intermediate commentary for completed preview when tools have no intent', () => {
    const activities: ActivityItem[] = [
      makeCommentary('c1', '已定位到 **TurnCard** 折叠逻辑并完成调整。', { timestamp: 1 }),
      makeTool('t1', { status: 'completed', timestamp: 2 }),
    ]

    const preview = getWorkLogPreview(activities, undefined, false, true, true)
    expect(preview.text).toBe('已定位到 TurnCard 折叠逻辑并完成调整。')
  })

  it('shows the currently running or latest step intent in getWorkLogPreview instead of freezing on step 1', () => {
    const activities: ActivityItem[] = [
      makeTool('t1', { status: 'completed', intent: '确认 Git 搬到 C 盘后 bash 工具可用', timestamp: 1 }),
      makeTool('t2', { status: 'completed', intent: '查 Tailscale 登录状态', timestamp: 2 }),
      makeTool('t3', { status: 'running', intent: '绑定 Tailscale IP 启动服务', timestamp: 3 }),
    ]

    const livePreview = getWorkLogPreview(activities, '确认 Git 搬到 C 盘后 bash 工具可用', true, false, false)
    expect(livePreview.text).toBe('绑定 Tailscale IP 启动服务')

    const doneActivities = activities.map(a => ({ ...a, status: 'completed' as const }))
    const donePreview = getWorkLogPreview(doneActivities, '确认 Git 搬到 C 盘后 bash 工具可用', false, true, true)
    expect(donePreview.text).toBe('绑定 Tailscale IP 启动服务')
  })
})
