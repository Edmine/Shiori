import type { GitChangedFile } from '@craft-agent/shared/protocol'

export interface PaletteSessionCandidate {
  id: string
  title: string
  folderName?: string
  lastMessageAt?: number
  isProcessing?: boolean
  needsApproval?: boolean
  isSelected?: boolean
}

export function rankPaletteSessions<T extends PaletteSessionCandidate>(
  sessions: readonly T[],
  limit = 20,
): T[] {
  return [...sessions]
    .sort((first, second) => {
      const firstPriority = first.needsApproval ? 2 : first.isProcessing ? 1 : 0
      const secondPriority = second.needsApproval ? 2 : second.isProcessing ? 1 : 0
      if (firstPriority !== secondPriority) return secondPriority - firstPriority
      return (second.lastMessageAt ?? 0) - (first.lastMessageAt ?? 0)
    })
    .slice(0, limit)
}

export function appendFileMentionToDraft(currentDraft: string, relativePath: string): string {
  const normalizedPath = relativePath.trim().replace(/\\/g, '/')
  if (!normalizedPath) return currentDraft

  const mentionToken = `@${normalizedPath}`
  const trimmed = currentDraft.trimEnd()
  if (!trimmed) return `${mentionToken} `

  if (trimmed.endsWith(mentionToken)) {
    return `${trimmed} `
  }

  return `${trimmed} ${mentionToken} `
}

export function filterGitChangedFiles(
  files: readonly GitChangedFile[],
  query: string,
): GitChangedFile[] {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) return [...files]

  return files.filter((file) => {
    const pathMatch = file.path.toLowerCase().includes(normalizedQuery)
    const oldPathMatch = file.oldPath ? file.oldPath.toLowerCase().includes(normalizedQuery) : false
    return pathMatch || oldPathMatch
  })
}
