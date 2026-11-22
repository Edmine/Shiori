/**
 * Pure helpers for grouping sessions by working directory (project folder).
 *
 * Keeps Windows and POSIX path variations unified so sessions pointed at
 * `D:\ClaudeWork\Shiori`, `d:/ClaudeWork/Shiori/`, etc. land in the same group.
 */

export const WORKSPACE_FOLDER_GROUP_KEY = 'folder:__workspace__'
const FOLDER_GROUP_PREFIX = 'folder:'

/**
 * Normalize a working directory path into a stable grouping key segment.
 * Returns null when the directory is empty/unset.
 */
export function normalizeWorkingDirForGroup(dir?: string | null): string | null {
  if (!dir) return null
  const trimmed = dir.trim()
  if (!trimmed) return null

  let normalized = trimmed.replace(/\\/g, '/')

  // Collapse repeated slashes except leading UNC double-slash (//server/share)
  if (normalized.startsWith('//')) {
    normalized = '//' + normalized.slice(2).replace(/\/+/g, '/')
  } else {
    normalized = normalized.replace(/\/+/g, '/')
  }

  // Strip trailing slashes unless it's root `/` or Windows drive root `C:/`
  if (normalized.length > 1 && !/^[a-zA-Z]:\/$/.test(normalized)) {
    normalized = normalized.replace(/\/+$/, '')
  }

  // Normalize Windows drive letter casing (C:/... -> c:/...)
  if (/^[A-Z]:/.test(normalized)) {
    normalized = normalized[0].toLowerCase() + normalized.slice(1)
  }

  // Case-fold Windows paths (drive paths and UNC paths) for consistent grouping
  if (/^[a-z]:(\/|$)/.test(normalized) || normalized.startsWith('//')) {
    normalized = normalized.toLowerCase()
  }

  return normalized
}

/**
 * Build the deterministic collapse/grouping key for a session's workingDirectory.
 */
export function getFolderGroupKey(workingDirectory?: string | null): string {
  const normalized = normalizeWorkingDirForGroup(workingDirectory)
  return normalized ? `${FOLDER_GROUP_PREFIX}${normalized}` : WORKSPACE_FOLDER_GROUP_KEY
}

/**
 * Extract a concise human-readable folder name (basename) for group headers.
 */
export function getFolderGroupLabel(
  workingDirectory: string | null | undefined,
  fallbackLabel: string,
): string {
  if (!workingDirectory) return fallbackLabel
  const trimmed = workingDirectory.trim()
  if (!trimmed) return fallbackLabel

  const unified = trimmed.replace(/\\/g, '/')
  if (unified === '/') return '/'
  if (/^[a-zA-Z]:\/?$/.test(unified)) {
    return unified.slice(0, 2).toUpperCase() + '\\'
  }

  const withoutTrailing = unified.replace(/\/+$/, '')
  const segments = withoutTrailing.split('/').filter(Boolean)
  return segments[segments.length - 1] || fallbackLabel
}

/**
 * Derive a display label from a persisted collapsed folder group key when no
 * expanded session items are present in the current window.
 */
export function getFolderLabelFromGroupKey(
  groupKey: string,
  fallbackLabel: string,
): string {
  if (groupKey === WORKSPACE_FOLDER_GROUP_KEY || !groupKey.startsWith(FOLDER_GROUP_PREFIX)) {
    return fallbackLabel
  }
  return getFolderGroupLabel(groupKey.slice(FOLDER_GROUP_PREFIX.length), fallbackLabel)
}
