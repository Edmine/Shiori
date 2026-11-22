import { describe, expect, it } from 'bun:test'
import {
  appendFileMentionToDraft,
  filterGitChangedFiles,
  rankPaletteSessions,
} from '../command-palette-helpers'

describe('rankPaletteSessions', () => {
  it('places needsApproval and isProcessing sessions ahead of idle sessions', () => {
    const ranked = rankPaletteSessions([
      { id: 'idle-new', title: 'Idle New', lastMessageAt: 500 },
      { id: 'working', title: 'Working', lastMessageAt: 100, isProcessing: true },
      { id: 'approval', title: 'Needs Approval', lastMessageAt: 50, needsApproval: true },
      { id: 'idle-old', title: 'Idle Old', lastMessageAt: 200 },
    ])

    expect(ranked.map((item) => item.id)).toEqual([
      'approval',
      'working',
      'idle-new',
      'idle-old',
    ])
  })

  it('respects the maximum limit', () => {
    const items = Array.from({ length: 10 }, (_, index) => ({
      id: `s-${index}`,
      title: `Session ${index}`,
      lastMessageAt: index,
    }))
    const ranked = rankPaletteSessions(items, 3)
    expect(ranked.map((item) => item.id)).toEqual(['s-9', 's-8', 's-7'])
  })
})

describe('appendFileMentionToDraft', () => {
  it('formats a clean @mention when draft is empty', () => {
    expect(appendFileMentionToDraft('', 'src\\app\\App.tsx')).toBe('@src/app/App.tsx ')
  })

  it('appends with a single space when draft already has text', () => {
    expect(appendFileMentionToDraft('请帮我看看', 'src/index.ts')).toBe('请帮我看看 @src/index.ts ')
  })

  it('avoids duplicating an identical trailing mention', () => {
    expect(appendFileMentionToDraft('检查 @src/index.ts ', 'src/index.ts')).toBe('检查 @src/index.ts ')
  })
})

describe('filterGitChangedFiles', () => {
  const sampleFiles = [
    { path: 'apps/electron/src/AppShell.tsx', status: 'modified' as const, code: 'M', additions: 5, deletions: 2, isBinary: false, staged: false, unstaged: true },
    { path: 'packages/shared/src/i18n/zh-Hans.json', status: 'modified' as const, code: 'M', additions: 10, deletions: 1, isBinary: false, staged: false, unstaged: true },
    { path: 'src/new-name.ts', oldPath: 'src/legacy-name.ts', status: 'renamed' as const, code: 'R', additions: 0, deletions: 0, isBinary: false, staged: true, unstaged: false },
  ]

  it('returns all files for empty or whitespace queries', () => {
    expect(filterGitChangedFiles(sampleFiles, '   ')).toHaveLength(3)
  })

  it('matches case-insensitively on both path and oldPath', () => {
    expect(filterGitChangedFiles(sampleFiles, 'appshell').map((file) => file.path)).toEqual([
      'apps/electron/src/AppShell.tsx',
    ])
    expect(filterGitChangedFiles(sampleFiles, 'LEGACY').map((file) => file.path)).toEqual([
      'src/new-name.ts',
    ])
  })
})
