/**
 * Protocol types for the real-time Git Diff review drawer.
 */

export type GitFileChangeStatus =
  | 'modified'
  | 'added'
  | 'deleted'
  | 'renamed'
  | 'untracked'
  | 'copied'
  | 'unmerged'

export interface GitChangedFile {
  /** Repo-relative POSIX path (destination path for renames/copies) */
  path: string
  /** Original repo-relative POSIX path when renamed or copied */
  oldPath?: string
  /** Normalized change kind */
  status: GitFileChangeStatus
  /** Short single-letter badge code: M, A, D, R, ?, C, U */
  code: string
  staged: boolean
  unstaged: boolean
  additions: number
  deletions: number
  isBinary: boolean
}

export interface GitStatusSummary {
  isRepo: boolean
  repoRoot: string | null
  branch: string | null
  files: GitChangedFile[]
  totalAdditions: number
  totalDeletions: number
  /** True when the repo has more changed files than the drawer cap */
  truncated: boolean
}

export interface GitFileDiffOptions {
  oldPath?: string
  status?: GitFileChangeStatus
}

export interface GitFileDiffPayload {
  filePath: string
  oldPath?: string
  status: GitFileChangeStatus
  original: string
  modified: string
  isBinary: boolean
  tooLarge?: boolean
  error?: string
}
