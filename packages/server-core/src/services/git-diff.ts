/**
 * Lightweight, read-only Git status and file diff inspection service
 * for Shiori's real-time Diff review drawer.
 *
 * Uses `execFile('git', ...)` without a shell and `-z` NUL-delimited output so
 * Unicode / Chinese filenames and spaces work reliably across Windows & POSIX.
 */

import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import type {
  GitChangedFile,
  GitFileChangeStatus,
  GitFileDiffOptions,
  GitFileDiffPayload,
  GitStatusSummary,
} from '@craft-agent/shared/protocol'
import { runGit } from './git'

const GIT_DIFF_TIMEOUT_MS = 8_000
const MAX_STATUS_FILES = 200
const MAX_DIFF_FILE_BYTES = 512 * 1024
const MAX_UNTRACKED_LINECOUNT_FILES = 40
const MAX_UNTRACKED_LINECOUNT_BYTES = 256 * 1024

interface RawExecResult {
  ok: boolean
  stdout: Buffer
  stderr: string
}

function runGitRaw(
  dir: string,
  args: string[],
  timeoutMs = GIT_DIFF_TIMEOUT_MS,
  maxBuffer = 4 * 1024 * 1024,
): Promise<RawExecResult> {
  return new Promise((done) => {
    execFile(
      'git',
      ['-C', dir, ...args],
      { timeout: timeoutMs, maxBuffer, encoding: 'buffer', windowsHide: true },
      (error, stdout, stderr) => {
        done({
          ok: !error,
          stdout: Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout ?? ''),
          stderr: Buffer.isBuffer(stderr) ? stderr.toString('utf8') : String(stderr ?? ''),
        })
      },
    )
  })
}

export function isBinaryBuffer(buf: Buffer): boolean {
  const inspectLength = Math.min(buf.length, 8192)
  for (let i = 0; i < inspectLength; i += 1) {
    if (buf[i] === 0) return true
  }
  return false
}

export function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

export interface NumstatEntry {
  additions: number
  deletions: number
  isBinary: boolean
}

/**
 * Parse `git diff --numstat -z` output into a map keyed by repo-relative POSIX path.
 */
export function parseNumstatZ(raw: string): Map<string, NumstatEntry> {
  const stats = new Map<string, NumstatEntry>()
  if (!raw) return stats

  const tokens = raw.split('\0')
  let i = 0
  while (i < tokens.length) {
    const token = tokens[i]
    if (!token) {
      i += 1
      continue
    }

    const firstTab = token.indexOf('\t')
    if (firstTab === -1) {
      i += 1
      continue
    }
    const secondTab = token.indexOf('\t', firstTab + 1)
    if (secondTab === -1) {
      i += 1
      continue
    }

    const addRaw = token.slice(0, firstTab)
    const delRaw = token.slice(firstTab + 1, secondTab)
    let filePath = token.slice(secondTab + 1)

    // For renames under `-z`, path after second tab is empty and followed by `oldPath\0newPath\0`
    if (filePath === '' && i + 2 < tokens.length) {
      filePath = tokens[i + 2]
      i += 3
    } else {
      i += 1
    }

    if (!filePath) continue

    const isBinary = addRaw === '-' || delRaw === '-'
    const additions = isBinary ? 0 : (Number.parseInt(addRaw, 10) || 0)
    const deletions = isBinary ? 0 : (Number.parseInt(delRaw, 10) || 0)

    const prev = stats.get(filePath)
    if (prev) {
      stats.set(filePath, {
        additions: prev.additions + additions,
        deletions: prev.deletions + deletions,
        isBinary: prev.isBinary || isBinary,
      })
    } else {
      stats.set(filePath, { additions, deletions, isBinary })
    }
  }

  return stats
}

function resolveStatusAndCode(x: string, y: string): { status: GitFileChangeStatus; code: string } {
  if (x === '?' && y === '?') return { status: 'untracked', code: '?' }
  if (x === 'U' || y === 'U' || (x === 'A' && y === 'A') || (x === 'D' && y === 'D')) {
    return { status: 'unmerged', code: 'U' }
  }
  if (x === 'R' || y === 'R') return { status: 'renamed', code: 'R' }
  if (x === 'C' || y === 'C') return { status: 'copied', code: 'C' }
  if (x === 'A' && y !== 'D') return { status: 'added', code: 'A' }
  if (x === 'D' || y === 'D') return { status: 'deleted', code: 'D' }
  return { status: 'modified', code: 'M' }
}

/**
 * Parse `git status --porcelain=v1 -z -uall` combined with staged & unstaged numstat outputs.
 */
export function parseGitStatusAndNumstat(
  porcelainZ: string,
  unstagedNumstatZ: string,
  stagedNumstatZ: string,
  maxFiles = MAX_STATUS_FILES,
): { files: GitChangedFile[]; truncated: boolean } {
  const unstagedStats = parseNumstatZ(unstagedNumstatZ)
  const stagedStats = parseNumstatZ(stagedNumstatZ)

  const files: GitChangedFile[] = []
  let truncated = false
  if (!porcelainZ) return { files, truncated }

  const tokens = porcelainZ.split('\0')
  let i = 0
  while (i < tokens.length) {
    const entry = tokens[i]
    if (!entry || entry.length < 4) {
      i += 1
      continue
    }

    const x = entry[0]
    const y = entry[1]
    // Skip ignored entries (`!!`)
    if (x === '!' && y === '!') {
      i += 1
      continue
    }

    const filePath = entry.slice(3)
    let oldPath: string | undefined
    if ((x === 'R' || x === 'C' || y === 'R' || y === 'C') && i + 1 < tokens.length) {
      oldPath = tokens[i + 1] || undefined
      i += 2
    } else {
      i += 1
    }

    if (!filePath) continue

    if (files.length >= maxFiles) {
      truncated = true
      break
    }

    const { status, code } = resolveStatusAndCode(x, y)
    const staged = x !== ' ' && x !== '?'
    const unstaged = y !== ' ' || status === 'untracked'
    const uStat = unstagedStats.get(filePath)
    const sStat = stagedStats.get(filePath)

    files.push({
      path: filePath,
      ...(oldPath ? { oldPath } : {}),
      status,
      code,
      staged,
      unstaged,
      additions: (uStat?.additions ?? 0) + (sStat?.additions ?? 0),
      deletions: (uStat?.deletions ?? 0) + (sStat?.deletions ?? 0),
      isBinary: Boolean(uStat?.isBinary || sStat?.isBinary),
    })
  }

  return { files, truncated }
}

function countTextLines(buf: Buffer): number {
  if (buf.length === 0) return 0
  let count = 1
  for (let i = 0; i < buf.length; i += 1) {
    if (buf[i] === 0x0a) count += 1
  }
  // Avoid double-counting a trailing newline
  if (buf[buf.length - 1] === 0x0a) count -= 1
  return Math.max(count, 1)
}

export function isPathInsideRoot(repoRoot: string, targetAbsolutePath: string): boolean {
  const normalizedRoot = resolve(repoRoot)
  const normalizedTarget = resolve(targetAbsolutePath)
  const rel = relative(normalizedRoot, normalizedTarget)
  if (!rel || isAbsolute(rel)) return false
  const relPosix = rel.replace(/\\/g, '/')
  return relPosix !== '..' && !relPosix.startsWith('../')
}

/**
 * Inspect working-tree git status and aggregate +/- line counts for `dirPath`.
 */
export async function getGitStatusSummary(dirPath: string): Promise<GitStatusSummary> {
  const empty: GitStatusSummary = {
    isRepo: false,
    repoRoot: null,
    branch: null,
    files: [],
    totalAdditions: 0,
    totalDeletions: 0,
    truncated: false,
  }

  if (!dirPath || !existsSync(dirPath)) return empty

  const repoRoot = await runGit(dirPath, ['rev-parse', '--show-toplevel'])
  if (!repoRoot) return empty

  const [branchSymbolic, headShort, statusRes, unstagedRes, stagedRes] = await Promise.all([
    runGit(repoRoot, ['symbolic-ref', '--quiet', '--short', 'HEAD']),
    runGit(repoRoot, ['rev-parse', '--short', 'HEAD']),
    runGitRaw(repoRoot, ['status', '--porcelain=v1', '-z', '-uall']),
    runGitRaw(repoRoot, ['diff', '--numstat', '-z']),
    runGitRaw(repoRoot, ['diff', '--cached', '--numstat', '-z']),
  ])

  const branch = branchSymbolic ?? (headShort ? `HEAD@${headShort}` : 'HEAD')
  const { files, truncated } = parseGitStatusAndNumstat(
    statusRes.ok ? statusRes.stdout.toString('utf8') : '',
    unstagedRes.ok ? unstagedRes.stdout.toString('utf8') : '',
    stagedRes.ok ? stagedRes.stdout.toString('utf8') : '',
  )

  // Estimate line counts for untracked text files (bounded for speed)
  let untrackedMeasured = 0
  await Promise.all(
    files.map(async (file) => {
      if (file.status !== 'untracked') return
      if (untrackedMeasured >= MAX_UNTRACKED_LINECOUNT_FILES) return
      untrackedMeasured += 1
      try {
        const absPath = resolve(repoRoot, file.path)
        if (!isPathInsideRoot(repoRoot, absPath)) return
        const info = await stat(absPath)
        if (!info.isFile() || info.size > MAX_UNTRACKED_LINECOUNT_BYTES) return
        const buf = await readFile(absPath)
        if (isBinaryBuffer(buf)) {
          file.isBinary = true
          return
        }
        file.additions = countTextLines(buf)
      } catch {
        // Best-effort line count; ignore transient FS errors
      }
    }),
  )

  let totalAdditions = 0
  let totalDeletions = 0
  for (const file of files) {
    totalAdditions += file.additions
    totalDeletions += file.deletions
  }

  return {
    isRepo: true,
    repoRoot,
    branch,
    files,
    totalAdditions,
    totalDeletions,
    truncated,
  }
}

/**
 * Load original (HEAD) and modified (working tree) text contents for a single file
 * inside the repository containing `dirPath`.
 */
export async function getGitFileDiff(
  dirPath: string,
  filePath: string,
  options?: GitFileDiffOptions,
): Promise<GitFileDiffPayload> {
  const status: GitFileChangeStatus = options?.status ?? 'modified'
  const oldPath = options?.oldPath

  const fail = (error: string): GitFileDiffPayload => ({
    filePath,
    ...(oldPath ? { oldPath } : {}),
    status,
    original: '',
    modified: '',
    isBinary: false,
    error,
  })

  if (!dirPath || !filePath) return fail('Missing repository path or file path')

  const repoRoot = await runGit(dirPath, ['rev-parse', '--show-toplevel'])
  if (!repoRoot) return fail('Not a git repository')

  const normalizedRel = filePath.replace(/\\/g, '/')
  const absPath = resolve(repoRoot, normalizedRel)
  if (!isPathInsideRoot(repoRoot, absPath)) {
    return fail('File path escapes repository root')
  }

  // 1. Read original content from HEAD (empty for untracked/newly added files)
  let original = ''
  let isBinary = false
  if (status !== 'untracked') {
    const headRel = (oldPath ?? normalizedRel).replace(/\\/g, '/')
    const headRes = await runGitRaw(
      repoRoot,
      ['show', `HEAD:${headRel}`],
      GIT_DIFF_TIMEOUT_MS,
      MAX_DIFF_FILE_BYTES + 64 * 1024,
    )
    if (headRes.ok) {
      if (headRes.stdout.length > MAX_DIFF_FILE_BYTES) {
        return {
          filePath: normalizedRel,
          ...(oldPath ? { oldPath } : {}),
          status,
          original: '',
          modified: '',
          isBinary: false,
          tooLarge: true,
        }
      }
      if (isBinaryBuffer(headRes.stdout)) {
        isBinary = true
      } else {
        original = normalizeLineEndings(headRes.stdout.toString('utf8'))
      }
    }
  }

  // 2. Read modified content from working tree (empty for deleted files)
  let modified = ''
  if (status !== 'deleted' && !isBinary) {
    try {
      const info = await stat(absPath)
      if (info.isFile()) {
        if (info.size > MAX_DIFF_FILE_BYTES) {
          return {
            filePath: normalizedRel,
            ...(oldPath ? { oldPath } : {}),
            status,
            original: '',
            modified: '',
            isBinary: false,
            tooLarge: true,
          }
        }
        const buf = await readFile(absPath)
        if (isBinaryBuffer(buf)) {
          isBinary = true
        } else {
          modified = normalizeLineEndings(buf.toString('utf8'))
        }
      }
    } catch {
      // File may have been deleted between status check and diff load
      modified = ''
    }
  }

  return {
    filePath: normalizedRel,
    ...(oldPath ? { oldPath } : {}),
    status,
    original: isBinary ? '' : original,
    modified: isBinary ? '' : modified,
    isBinary,
  }
}
