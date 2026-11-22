/**
 * GitDiffDrawer — Lightweight real-time Git Diff review panel for Shiori's right drawer.
 *
 * Displays current branch, changed files with +/- stats, and a syntax-highlighted
 * unified/split diff powered by ShikiDiffViewer.
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import {
  AtSign,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Columns2,
  Copy,
  ExternalLink,
  FileCode2,
  FolderOpen,
  GitBranch,
  RefreshCw,
  Rows2,
  Search,
  X,
} from 'lucide-react'
import { Spinner } from '@craft-agent/ui'
import type {
  GitChangedFile,
  GitFileDiffPayload,
  GitStatusSummary,
} from '@craft-agent/shared/protocol'
import { ShikiDiffViewer } from '@/components/shiki/ShikiDiffViewer'
import { filterGitChangedFiles } from '@/components/app-shell/command-palette-helpers'
import { cn } from '@/lib/utils'

export interface GitDiffDrawerProps {
  /** Effective directory inspected for git status */
  dirPath?: string
  /** Latest git status snapshot from ChatPage */
  gitStatus: GitStatusSummary | null
  /** True while refreshing git status */
  isLoading: boolean
  /** Manually re-fetch git status and active file diff */
  onRefresh: () => void
  /** Open a file in the configured editor / viewer */
  onOpenFile?: (absolutePath: string) => void
  /** Reference a changed file (`@path`) directly in the active chat composer */
  onMentionFile?: (relativePath: string) => void
}

function statusBadgeStyle(code: string): string {
  switch (code) {
    case 'A':
    case '?':
      return 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 border-emerald-500/25'
    case 'D':
      return 'bg-rose-500/12 text-rose-700 dark:text-rose-300 border-rose-500/25'
    case 'R':
    case 'C':
      return 'bg-sky-500/12 text-sky-700 dark:text-sky-300 border-sky-500/25'
    case 'U':
      return 'bg-orange-500/12 text-orange-700 dark:text-orange-300 border-orange-500/25'
    default:
      return 'bg-amber-500/12 text-amber-700 dark:text-amber-300 border-amber-500/25'
  }
}

function splitFilePath(relPath: string): { fileName: string; parentDir: string } {
  const idx = relPath.lastIndexOf('/')
  if (idx === -1) return { fileName: relPath, parentDir: '' }
  return {
    fileName: relPath.slice(idx + 1),
    parentDir: relPath.slice(0, idx),
  }
}

function joinRepoPath(repoRoot: string, relPath: string): string {
  const isWindows = /^[a-zA-Z]:/.test(repoRoot) || repoRoot.includes('\\')
  const cleanRoot = repoRoot.replace(/[\\/]+$/, '')
  const cleanRel = relPath.replace(/^[\\/]+/, '')
  return isWindows
    ? `${cleanRoot}\\${cleanRel.replace(/\//g, '\\')}`
    : `${cleanRoot}/${cleanRel}`
}

export function GitDiffDrawer({
  dirPath,
  gitStatus,
  isLoading,
  onRefresh,
  onOpenFile,
  onMentionFile,
}: GitDiffDrawerProps) {
  const { t } = useTranslation()
  const [selectedPath, setSelectedPath] = React.useState<string | null>(null)
  const [diffStyle, setDiffStyle] = React.useState<'unified' | 'split'>('unified')
  const [diffPayload, setDiffPayload] = React.useState<GitFileDiffPayload | null>(null)
  const [diffLoading, setDiffLoading] = React.useState(false)
  const [diffNonce, setDiffNonce] = React.useState(0)
  const [fileQuery, setFileQuery] = React.useState('')
  const [copiedPath, setCopiedPath] = React.useState<string | null>(null)

  const files = gitStatus?.files ?? []
  const filteredFiles = React.useMemo(
    () => filterGitChangedFiles(files, fileQuery),
    [files, fileQuery],
  )

  React.useEffect(() => {
    setFileQuery('')
  }, [gitStatus?.repoRoot, dirPath])

  // Keep selectedPath valid as files appear/disappear
  React.useEffect(() => {
    if (filteredFiles.length === 0) {
      setSelectedPath(null)
      setDiffPayload(null)
      return
    }
    setSelectedPath((prev) => {
      if (prev && filteredFiles.some((file) => file.path === prev)) return prev
      return (filteredFiles.find((file) => !file.isBinary) ?? filteredFiles[0]).path
    })
  }, [filteredFiles])

  const selectedFile: GitChangedFile | null = React.useMemo(
    () => (selectedPath ? filteredFiles.find((file) => file.path === selectedPath) ?? null : null),
    [filteredFiles, selectedPath],
  )

  const selectedIndex = React.useMemo(
    () => (selectedFile ? filteredFiles.findIndex((file) => file.path === selectedFile.path) : -1),
    [filteredFiles, selectedFile],
  )

  const handleStepFile = React.useCallback(
    (delta: -1 | 1) => {
      if (filteredFiles.length <= 1 || selectedIndex === -1) return
      const nextIndex = (selectedIndex + delta + filteredFiles.length) % filteredFiles.length
      setSelectedPath(filteredFiles[nextIndex].path)
    },
    [filteredFiles, selectedIndex],
  )

  const handleCopyRelativePath = React.useCallback((relativePath: string) => {
    void navigator.clipboard?.writeText(relativePath)
    setCopiedPath(relativePath)
    window.setTimeout(() => {
      setCopiedPath((current) => (current === relativePath ? null : current))
    }, 1400)
  }, [])

  // Load file diff whenever selection, repo, or refresh nonce changes
  React.useEffect(() => {
    const effectiveRoot = gitStatus?.repoRoot ?? dirPath
    if (!effectiveRoot || !selectedFile) {
      setDiffPayload(null)
      return
    }

    let cancelled = false
    setDiffLoading(true)
    window.electronAPI
      .getGitFileDiff(effectiveRoot, selectedFile.path, {
        oldPath: selectedFile.oldPath,
        status: selectedFile.status,
      })
      .then((payload) => {
        if (!cancelled) setDiffPayload(payload)
      })
      .catch((err) => {
        if (!cancelled) {
          setDiffPayload({
            filePath: selectedFile.path,
            status: selectedFile.status,
            original: '',
            modified: '',
            isBinary: false,
            error: err instanceof Error ? err.message : String(err),
          })
        }
      })
      .finally(() => {
        if (!cancelled) setDiffLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [gitStatus?.repoRoot, dirPath, selectedFile?.path, selectedFile?.oldPath, selectedFile?.status, diffNonce])

  const handleRefreshAll = React.useCallback(() => {
    onRefresh()
    setDiffNonce((n) => n + 1)
  }, [onRefresh])

  if (!dirPath || !gitStatus?.isRepo) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2.5 px-6 text-center">
        <div className="size-10 rounded-xl border border-subtle bg-surface-paper flex items-center justify-center text-tertiary">
          <GitBranch className="size-4.5" />
        </div>
        <div className="space-y-1">
          <p className="text-label font-medium text-foreground">
            {t('gitDiff.notARepoTitle', { defaultValue: '当前目录不是 Git 仓库' })}
          </p>
          <p className="text-caption text-tertiary leading-relaxed">
            {t('gitDiff.notARepoHint', {
              defaultValue: '在输入框底部「选择目录」中选择一个 Git 项目目录后，即可在此实时查看代码改动。',
            })}
          </p>
        </div>
      </div>
    )
  }

  const selectedAbsolutePath =
    selectedFile && gitStatus.repoRoot ? joinRepoPath(gitStatus.repoRoot, selectedFile.path) : null

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Branch + Aggregate Stats + Controls Bar */}
      <div className="shrink-0 flex items-center justify-between gap-2 border-b border-subtle px-3 py-2 bg-surface-paper/60">
        <div className="flex items-center gap-2 min-w-0">
          <span
            title={gitStatus.repoRoot ?? dirPath}
            className="inline-flex items-center gap-1 rounded-md bg-black/[0.045] dark:bg-white/[0.07] px-1.5 py-0.5 text-[11.5px] font-medium text-foreground max-w-[140px]"
          >
            <GitBranch className="size-3 shrink-0 text-accent" aria-hidden="true" />
            <span className="truncate">{gitStatus.branch ?? 'HEAD'}</span>
          </span>
          {files.length > 0 && (
            <div className="flex items-center gap-1.5 text-[11.5px] tabular-nums shrink-0">
              <span className="text-tertiary">
                {t('gitDiff.filesCount', { count: files.length, defaultValue: `${files.length} 个文件` })}
              </span>
              {gitStatus.totalAdditions > 0 && (
                <span className="font-medium text-emerald-600 dark:text-emerald-400">
                  +{gitStatus.totalAdditions}
                </span>
              )}
              {gitStatus.totalDeletions > 0 && (
                <span className="font-medium text-rose-600 dark:text-rose-400">
                  -{gitStatus.totalDeletions}
                </span>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {files.length > 0 && (
            <div
              role="group"
              aria-label={t('gitDiff.viewMode', { defaultValue: 'Diff 视图模式' })}
              className="inline-flex items-center rounded-md border border-subtle bg-surface-paper p-0.5"
            >
              <button
                type="button"
                onClick={() => setDiffStyle('unified')}
                title={t('gitDiff.unifiedView', { defaultValue: '合并视图' })}
                aria-pressed={diffStyle === 'unified'}
                className={cn(
                  'inline-grid place-items-center size-5 rounded-[4px] transition-colors cursor-pointer',
                  diffStyle === 'unified'
                    ? 'bg-accent-tint text-accent'
                    : 'text-tertiary hover:text-foreground',
                )}
              >
                <Rows2 className="size-3" />
              </button>
              <button
                type="button"
                onClick={() => setDiffStyle('split')}
                title={t('gitDiff.splitView', { defaultValue: '分栏对比' })}
                aria-pressed={diffStyle === 'split'}
                className={cn(
                  'inline-grid place-items-center size-5 rounded-[4px] transition-colors cursor-pointer',
                  diffStyle === 'split'
                    ? 'bg-accent-tint text-accent'
                    : 'text-tertiary hover:text-foreground',
                )}
              >
                <Columns2 className="size-3" />
              </button>
            </div>
          )}
          <button
            type="button"
            onClick={handleRefreshAll}
            title={t('common.refresh', { defaultValue: '刷新' })}
            aria-label={t('common.refresh', { defaultValue: '刷新' })}
            className="inline-grid place-items-center size-6 rounded-md text-tertiary hover:bg-fill-hover hover:text-foreground transition-colors cursor-pointer"
          >
            <RefreshCw className={cn('size-3.5', isLoading && 'animate-spin')} />
          </button>
        </div>
      </div>

      {files.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 px-6 text-center">
          <CheckCircle2 className="size-6 text-emerald-600/80 dark:text-emerald-400/80" />
          <p className="text-label font-medium text-foreground">
            {t('gitDiff.cleanTreeTitle', { defaultValue: '工作区干净' })}
          </p>
          <p className="text-caption text-tertiary">
            {t('gitDiff.cleanTreeHint', { defaultValue: '当前分支暂无未提交的改动。' })}
          </p>
        </div>
      ) : (
        <>
          {files.length >= 4 && (
            <div className="shrink-0 border-b border-subtle px-2.5 py-1.5 bg-surface-paper/40">
              <div className="flex h-7 items-center gap-1.5 rounded-md border border-subtle bg-surface-paper px-2 focus-within:border-accent/60">
                <Search className="size-3.5 shrink-0 text-tertiary" aria-hidden="true" />
                <input
                  type="text"
                  value={fileQuery}
                  onChange={(event) => setFileQuery(event.target.value)}
                  placeholder={t('gitDiff.filterPlaceholder', { defaultValue: '筛选变更文件…' })}
                  aria-label={t('gitDiff.filterPlaceholder', { defaultValue: '筛选变更文件…' })}
                  className="h-full w-full min-w-0 bg-transparent text-[12px] text-foreground outline-none placeholder:text-tertiary"
                />
                {fileQuery && (
                  <>
                    <span className="shrink-0 text-[10.5px] font-mono tabular-nums text-tertiary">
                      {filteredFiles.length}/{files.length}
                    </span>
                    <button
                      type="button"
                      onClick={() => setFileQuery('')}
                      aria-label={t('common.clear', { defaultValue: '清除' })}
                      className="inline-grid size-4 shrink-0 place-items-center rounded text-tertiary hover:bg-fill-hover hover:text-foreground cursor-pointer"
                    >
                      <X className="size-3" />
                    </button>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Changed File List */}
          <div className="shrink-0 max-h-[34%] overflow-y-auto border-b border-subtle py-1">
            {filteredFiles.length === 0 ? (
              <div className="px-3 py-4 text-center text-caption text-tertiary">
                {t('gitDiff.noFilterMatch', { defaultValue: '没有匹配的变更文件' })}
              </div>
            ) : filteredFiles.map((file) => {
              const isSelected = file.path === selectedPath
              const { fileName, parentDir } = splitFilePath(file.path)
              return (
                <button
                  key={file.path}
                  type="button"
                  onClick={() => setSelectedPath(file.path)}
                  title={file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
                  className={cn(
                    'flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors duration-micro cursor-pointer',
                    isSelected
                      ? 'bg-accent-tint/90 text-foreground'
                      : 'text-foreground/85 hover:bg-fill-hover',
                  )}
                >
                  <span
                    className={cn(
                      'inline-grid place-items-center size-4 shrink-0 rounded-[4px] border text-[10px] font-semibold font-mono',
                      statusBadgeStyle(file.code),
                    )}
                  >
                    {file.code}
                  </span>
                  <div className="flex-1 min-w-0 flex items-baseline gap-1.5">
                    <span className={cn('truncate text-[12.5px]', isSelected && 'font-medium')}>
                      {fileName}
                    </span>
                    {parentDir && (
                      <span className="truncate text-[11px] text-tertiary">
                        {parentDir}
                      </span>
                    )}
                  </div>
                  <div className="shrink-0 flex items-center gap-1 text-[11px] font-mono tabular-nums">
                    {file.isBinary ? (
                      <span className="text-tertiary">{t('gitDiff.binaryShort', { defaultValue: 'BIN' })}</span>
                    ) : (
                      <>
                        {file.additions > 0 && (
                          <span className="text-emerald-600 dark:text-emerald-400">+{file.additions}</span>
                        )}
                        {file.deletions > 0 && (
                          <span className="text-rose-600 dark:text-rose-400">-{file.deletions}</span>
                        )}
                      </>
                    )}
                  </div>
                </button>
              )
            })}
            {gitStatus.truncated && (
              <div className="px-3 py-1.5 text-[11px] text-tertiary">
                {t('gitDiff.truncatedNotice', { defaultValue: '仅展示前 200 个变更文件。' })}
              </div>
            )}
          </div>

          {/* Active File Diff Viewer */}
          <div className="flex-1 min-h-0 flex flex-col bg-surface-paper">
            {selectedFile && (
              <div className="shrink-0 flex items-center justify-between gap-2 border-b border-subtle px-3 py-1.5">
                <div className="flex items-center gap-1.5 min-w-0">
                  <FileCode2 className="size-3.5 shrink-0 text-tertiary" aria-hidden="true" />
                  <span className="truncate font-mono text-[11.5px] text-secondary" title={selectedFile.path}>
                    {selectedFile.path}
                  </span>
                </div>
                <div className="flex items-center gap-0.5 shrink-0">
                  {filteredFiles.length > 1 && (
                    <>
                      <button
                        type="button"
                        onClick={() => handleStepFile(-1)}
                        title={t('gitDiff.prevFile', { defaultValue: '上一个文件' })}
                        aria-label={t('gitDiff.prevFile', { defaultValue: '上一个文件' })}
                        className="inline-grid place-items-center size-6 rounded-md text-tertiary hover:bg-fill-hover hover:text-foreground transition-colors cursor-pointer"
                      >
                        <ChevronUp className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleStepFile(1)}
                        title={t('gitDiff.nextFile', { defaultValue: '下一个文件' })}
                        aria-label={t('gitDiff.nextFile', { defaultValue: '下一个文件' })}
                        className="inline-grid place-items-center size-6 rounded-md text-tertiary hover:bg-fill-hover hover:text-foreground transition-colors cursor-pointer"
                      >
                        <ChevronDown className="size-3.5" />
                      </button>
                    </>
                  )}
                  {onMentionFile && (
                    <button
                      type="button"
                      onClick={() => onMentionFile(selectedFile.path)}
                      title={t('gitDiff.mentionInChat', { defaultValue: '引用到对话' })}
                      aria-label={t('gitDiff.mentionInChat', { defaultValue: '引用到对话' })}
                      className="inline-grid place-items-center size-6 rounded-md text-accent hover:bg-accent-tint transition-colors cursor-pointer"
                    >
                      <AtSign className="size-3.5" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => handleCopyRelativePath(selectedFile.path)}
                    title={
                      copiedPath === selectedFile.path
                        ? t('gitDiff.copied', { defaultValue: '已复制路径' })
                        : t('gitDiff.copyPath', { defaultValue: '复制相对路径' })
                    }
                    aria-label={t('gitDiff.copyPath', { defaultValue: '复制相对路径' })}
                    className={cn(
                      'inline-grid place-items-center size-6 rounded-md transition-colors cursor-pointer',
                      copiedPath === selectedFile.path
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-tertiary hover:bg-fill-hover hover:text-foreground',
                    )}
                  >
                    {copiedPath === selectedFile.path ? <Check className="size-3" /> : <Copy className="size-3" />}
                  </button>
                  {selectedAbsolutePath && onOpenFile && selectedFile.status !== 'deleted' && (
                    <button
                      type="button"
                      onClick={() => onOpenFile(selectedAbsolutePath)}
                      title={t('gitDiff.openFile', { defaultValue: '打开文件' })}
                      aria-label={t('gitDiff.openFile', { defaultValue: '打开文件' })}
                      className="inline-grid place-items-center size-6 rounded-md text-tertiary hover:bg-fill-hover hover:text-foreground transition-colors cursor-pointer"
                    >
                      <ExternalLink className="size-3" />
                    </button>
                  )}
                  {selectedAbsolutePath && (
                    <button
                      type="button"
                      onClick={() => window.electronAPI.showInFolder(selectedAbsolutePath)}
                      title={t('gitDiff.revealInFolder', { defaultValue: '在文件夹中显示' })}
                      aria-label={t('gitDiff.revealInFolder', { defaultValue: '在文件夹中显示' })}
                      className="inline-grid place-items-center size-6 rounded-md text-tertiary hover:bg-fill-hover hover:text-foreground transition-colors cursor-pointer"
                    >
                      <FolderOpen className="size-3" />
                    </button>
                  )}
                </div>
              </div>
            )}

            <div className="flex-1 min-h-0 overflow-auto">
              {diffLoading ? (
                <div className="h-full flex items-center justify-center gap-2 text-caption text-tertiary">
                  <Spinner className="text-caption text-accent" />
                  <span>{t('gitDiff.loadingDiff', { defaultValue: '正在加载改动…' })}</span>
                </div>
              ) : diffPayload?.error ? (
                <div className="p-4 text-caption text-destructive">{diffPayload.error}</div>
              ) : diffPayload?.isBinary ? (
                <div className="h-full flex flex-col items-center justify-center gap-2 px-6 text-center text-caption text-tertiary">
                  <p>{t('gitDiff.binaryFileNotice', { defaultValue: '二进制文件不支持文本差异预览。' })}</p>
                </div>
              ) : diffPayload?.tooLarge ? (
                <div className="h-full flex flex-col items-center justify-center gap-2 px-6 text-center text-caption text-tertiary">
                  <p>{t('gitDiff.tooLargeNotice', { defaultValue: '文件超过 512 KB，已跳过内联预览。' })}</p>
                </div>
              ) : diffPayload && selectedFile ? (
                <ShikiDiffViewer
                  original={diffPayload.original}
                  modified={diffPayload.modified}
                  filePath={selectedFile.path}
                  diffStyle={diffStyle}
                  disableFileHeader
                  className="min-h-full"
                />
              ) : null}
            </div>
          </div>
        </>
      )}

      {/* Repo root footer */}
      {gitStatus.repoRoot && (
        <div className="shrink-0 border-t border-subtle px-3 py-1.5 bg-surface-sunken/40">
          <button
            type="button"
            onClick={() => window.electronAPI.showInFolder(gitStatus.repoRoot!)}
            title={gitStatus.repoRoot}
            className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-caption text-tertiary hover:bg-fill-hover hover:text-foreground transition-colors cursor-pointer"
          >
            <FolderOpen className="size-3 shrink-0" />
            <span className="truncate font-mono">{gitStatus.repoRoot}</span>
          </button>
        </div>
      )}
    </div>
  )
}
