/**
 * ChatHeader — the chat panel's header (design spec §7.3).
 *
 * Desktop: status glyph · title (click to rename) · "workspace · folder" · PR chip (Coding mode) ·
 * label chips · Info · Share · ⋯ · close. Session metadata lives here rather than in a badge row
 * above the composer.
 *
 * Compact shell: back · status glyph · title · ⋯. The drawer behind ⋯ also holds Session info and
 * Share, and the status glyph opens it on its Status pane. The panel's close button is dropped:
 * back closes the same panel.
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Folder, FolderOpen, GitBranch, Info, MoreHorizontal, Pencil } from 'lucide-react'
import { Tooltip, TooltipTrigger, TooltipContent } from '@craft-agent/ui'
import type { GitStatusSummary } from '@craft-agent/shared/protocol'
import { PanelHeaderCenterButton } from '@/components/ui/PanelHeaderCenterButton'
import { RenameDialog } from '@/components/ui/rename-dialog'
import { DropdownMenu, DropdownMenuTrigger, StyledDropdownMenuContent } from '@/components/ui/styled-dropdown'
import { useAppShellContext } from '@/context/AppShellContext'
import type { SessionMeta } from '@/atoms/sessions'
import { routes } from '@/lib/navigate'
import { useOpenTaskEditor } from '@/hooks/useOpenTaskEditor'
import { cn } from '@/lib/utils'
import { getSessionStatus } from '@/utils/session'
import { PanelHeader } from '../PanelHeader'
import { BrowserTabStrip } from '../../browser/BrowserTabStrip'
import { SessionMenu } from '../SessionMenu'
import { CompactSessionMenu } from '../CompactSessionMenu'
import { SessionInfoPopover } from '../SessionInfoPopover'
import { deriveSelectionFlags } from '../input/use-working-directory-state'
import { ChatHeaderStatusButton } from './ChatHeaderStatusButton'
import { ChatHeaderLabels } from './ChatHeaderLabels'
import { ChatShareMenu } from './ChatShareMenu'
import { CHAT_HEADER_CODING_MAX_LABELS } from './label-strip-layout'
import { ChatHeaderPrChip } from './pr-watch/ChatHeaderPrChip'
import { isPrWatchVisible, type PrEntry, type PrMergeMethod, type PrWatchState } from './pr-watch/pr-watch-state'
import type { PrAutoFixView, PrAutoMergeChange, PrWatchNav } from '@/hooks/usePrWatch'

export interface ChatHeaderProps {
  sessionId: string
  /** Session metadata. Without it the header shows only the title. */
  item?: SessionMeta
  title: string
  /** Shimmer while the title is being regenerated */
  isRegeneratingTitle?: boolean
  /** Published viewer link; the loaded session can know it before the metadata does */
  sharedUrl?: string | null
  workingDirectory?: string
  sessionFolderPath?: string
  /** The active pull request; shown only for Coding-mode sessions, on the desktop layout */
  prWatch?: PrWatchState
  /** The session's PRs (branch PR + pinned PRs); with more than one the chip shows "+N" and the card its tabs */
  prWatchNav?: PrWatchNav
  /** Where the active PR came from — only `bound` PRs get an Unpin action */
  prWatchActiveOrigin?: PrEntry['origin']
  onRefreshPrWatch?: () => void
  /** Remove the active (bound) PR from the session */
  onUnbindPr?: (ref: string) => void
  /** Toggle GitHub auto-merge on the active PR; resolves with GitHub's answer */
  onSetPrAutoMerge?: (ref: string, enabled: boolean, method?: PrMergeMethod) => Promise<PrAutoMergeChange>
  /** Auto-fix (the card's Fix toggle) for the active PR */
  prWatchAutoFix?: PrAutoFixView
  onSetPrAutoFix?: (enabled: boolean) => void
  /** The PR card opened or closed (details load while it is open) */
  onPrCardOpenChange?: (open: boolean) => void
  /** Whether the on-demand session Files panel is expanded */
  isFilesPanelOpen?: boolean
  /** Toggle the on-demand session Files panel */
  onToggleFilesPanel?: () => void
  /** Live Git status summary for the session's repository */
  gitStatus?: GitStatusSummary | null
  /** Whether the right-hand Git Diff review drawer is currently active */
  isDiffPanelOpen?: boolean
  /** Toggle the right-hand Git Diff review drawer */
  onToggleDiffPanel?: () => void
}

type DrawerState = { open: boolean; view: 'root' | 'status' }

function sameFields<T extends object>(a: T | undefined, b: T | undefined): boolean {
  if (a === b) return true
  if (!a || !b) return false
  const keys = Object.keys(a) as Array<keyof T>
  return keys.length === Object.keys(b).length && keys.every(key => Object.is(a[key], b[key]))
}

/**
 * ChatPage re-renders on every streamed delta, and each delta also writes a fresh (field-for-field equal)
 * session-meta object. Comparing the meta by fields lets the header skip those renders.
 */
function sameHeaderProps(prev: ChatHeaderProps, next: ChatHeaderProps): boolean {
  return prev.sessionId === next.sessionId
    && prev.title === next.title
    && prev.isRegeneratingTitle === next.isRegeneratingTitle
    && prev.sharedUrl === next.sharedUrl
    && prev.workingDirectory === next.workingDirectory
    && prev.sessionFolderPath === next.sessionFolderPath
    && prev.prWatch === next.prWatch
    && prev.prWatchNav === next.prWatchNav
    && prev.prWatchActiveOrigin === next.prWatchActiveOrigin
    && prev.onRefreshPrWatch === next.onRefreshPrWatch
    && prev.onUnbindPr === next.onUnbindPr
    && prev.onSetPrAutoMerge === next.onSetPrAutoMerge
    && prev.prWatchAutoFix === next.prWatchAutoFix
    && prev.onSetPrAutoFix === next.onSetPrAutoFix
    && prev.onPrCardOpenChange === next.onPrCardOpenChange
    && prev.isFilesPanelOpen === next.isFilesPanelOpen
    && prev.onToggleFilesPanel === next.onToggleFilesPanel
    && prev.gitStatus === next.gitStatus
    && prev.isDiffPanelOpen === next.isDiffPanelOpen
    && prev.onToggleDiffPanel === next.onToggleDiffPanel
    && sameFields(prev.item, next.item)
}

export const ChatHeader = React.memo(function ChatHeader({
  sessionId,
  item: metaItem,
  title,
  isRegeneratingTitle,
  sharedUrl,
  workingDirectory,
  sessionFolderPath,
  prWatch,
  prWatchNav,
  prWatchActiveOrigin,
  onRefreshPrWatch,
  onUnbindPr,
  onSetPrAutoMerge,
  prWatchAutoFix,
  onSetPrAutoFix,
  onPrCardOpenChange,
  isFilesPanelOpen = false,
  onToggleFilesPanel,
  gitStatus,
  isDiffPanelOpen = false,
  onToggleDiffPanel,
}: ChatHeaderProps) {
  const { t } = useTranslation()
  const {
    isCompactMode,
    leadingAction,
    rightSidebarButton,
    sessionStatuses = [],
    labels = [],
    projects = [],
    onRenameSession,
    onFlagSession,
    onUnflagSession,
    onArchiveSession,
    onUnarchiveSession,
    onMarkSessionUnread,
    onSessionStatusChange,
    onSessionLabelsChange,
    onDeleteSession,
  } = useAppShellContext()
  const compact = !!isCompactMode

  const item = React.useMemo(() => {
    if (!metaItem || !sharedUrl || metaItem.sharedUrl === sharedUrl) return metaItem
    return { ...metaItem, sharedUrl }
  }, [metaItem, sharedUrl])

  // ── Session actions (shared by the desktop ⋯ menu and the compact drawer) ──
  const [renameOpen, setRenameOpen] = React.useState(false)
  const [renameValue, setRenameValue] = React.useState('')
  const openRename = React.useCallback(() => {
    setRenameValue(title)
    setRenameOpen(true)
  }, [title])
  const submitRename = React.useCallback(() => {
    const next = renameValue.trim()
    if (next && next !== title) onRenameSession(sessionId, next)
    setRenameOpen(false)
  }, [renameValue, title, onRenameSession, sessionId])

  const handleLabelsChange = React.useCallback((next: string[]) => {
    onSessionLabelsChange?.(sessionId, next)
  }, [onSessionLabelsChange, sessionId])
  const handleStatusChange = React.useCallback((statusId: string) => {
    onSessionStatusChange(sessionId, statusId)
  }, [onSessionStatusChange, sessionId])
  const handleFlag = React.useCallback(() => onFlagSession(sessionId), [onFlagSession, sessionId])
  const handleUnflag = React.useCallback(() => onUnflagSession(sessionId), [onUnflagSession, sessionId])
  const handleArchive = React.useCallback(() => onArchiveSession(sessionId), [onArchiveSession, sessionId])
  const handleUnarchive = React.useCallback(() => onUnarchiveSession(sessionId), [onUnarchiveSession, sessionId])
  const handleMarkUnread = React.useCallback(() => onMarkSessionUnread(sessionId), [onMarkSessionUnread, sessionId])
  const handleDelete = React.useCallback(async () => {
    await onDeleteSession(sessionId)
  }, [onDeleteSession, sessionId])
  const handleOpenInNewWindow = React.useCallback(async () => {
    const route = routes.view.allSessions(sessionId)
    const separator = route.includes('?') ? '&' : '?'
    try {
      await window.electronAPI?.openUrl(`craftagents://${route}${separator}window=focused`)
    } catch (error) {
      console.error('[ChatHeader] openUrl failed:', error)
    }
  }, [sessionId])

  // Task orchestrator sessions (spec-backed, top-level) get an "Edit task" action that opens the
  // board's full-pane Task editor prefilled from task.yaml.
  const taskSlug = item?.taskSlug
  const isTaskOrchestrator = !!taskSlug && !item?.parentSessionId
  const openTaskEditor = useOpenTaskEditor()
  const handleEditTask = React.useCallback(() => {
    if (taskSlug) openTaskEditor(sessionId, taskSlug, title)
  }, [taskSlug, sessionId, title, openTaskEditor])

  // ── Compact: one drawer for ⋯ and the status glyph, plus the Session info sheet ──
  const [drawer, setDrawer] = React.useState<DrawerState>({ open: false, view: 'root' })
  // Stable: CompactSessionMenu closes itself whenever this identity changes.
  const handleDrawerOpenChange = React.useCallback((open: boolean) => {
    setDrawer(current => ({ ...current, open }))
  }, [])
  const [infoOpen, setInfoOpen] = React.useState(false)
  const infoOpenRef = React.useRef(false)
  infoOpenRef.current = infoOpen
  const showInfo = React.useCallback(() => setInfoOpen(true), [])
  // The drawer has no trigger of its own (⋯ and the status glyph both open it), so focus goes back to
  // whichever opened it, unless "Session info" handed off to the info sheet.
  const drawerOpenerRef = React.useRef<HTMLElement | null>(null)
  const openDrawer = React.useCallback((view: DrawerState['view'], opener: HTMLElement) => {
    drawerOpenerRef.current = opener
    setDrawer({ open: true, view })
  }, [])
  const handleDrawerCloseAutoFocus = React.useCallback((event: Event) => {
    event.preventDefault()
    if (!infoOpenRef.current) drawerOpenerRef.current?.focus()
  }, [])
  // Overlays of one layout must not come back open when the window crosses the compact breakpoint and back.
  React.useEffect(() => {
    setDrawer(current => (current.open ? { ...current, open: false } : current))
    setInfoOpen(false)
  }, [compact])

  // State, not a ref: the label strip measures this row in a layout effect, which runs before React attaches
  // the row's ref (children's layout effects run first), so the strip needs a re-render once the row exists.
  const [titleRowEl, setTitleRowEl] = React.useState<HTMLDivElement | null>(null)
  // The session folder arrives with the loaded session; until then a reset folder would read as its id.
  // Only the folder: the workspace is always named in the top bar, so repeating it here
  // ("Design Audit · design-audit") was noise that competed with the title.
  const folderName = sessionFolderPath ? deriveSelectionFlags(workingDirectory, sessionFolderPath).folderName : undefined
  const meta = folderName ?? ''
  const boundProject = React.useMemo(
    () => (item?.projectId ? projects.find(project => project.id === item.projectId) : undefined),
    [item?.projectId, projects],
  )
  const codingMode = !!item?.codingMode
  const showPrChip = codingMode && !compact && isPrWatchVisible(prWatch)
  // The PR chip, measured by the label strip (state: it mounts after the strip's first layout)
  const [prReserveEl, setPrReserveEl] = React.useState<HTMLElement | null>(null)

  const titleRow = (
    <div ref={setTitleRowEl} className="flex min-w-0 flex-1 items-center gap-1.5">
      {compact && item && sessionStatuses.length > 0 && (
        <div className="titlebar-no-drag shrink-0 flex items-center">
        <ChatHeaderStatusButton
          sessionId={sessionId}
          statusId={getSessionStatus(item)}
          statuses={sessionStatuses}
          onSelect={handleStatusChange}
          onOpenCompact={compact ? (opener) => openDrawer('status', opener) : undefined}
          compactExpanded={drawer.open && drawer.view === 'status'}
        />
        </div>
      )}
      {/* After the status glyph the title starts 10px from it, as row text does after a row glyph
          (-ml-2 absorbs the flex gap and the glyph button's inner padding) */}
      <h1 className={cn('min-w-0 shrink font-sans text-label-lg font-medium text-foreground', compact && item && sessionStatuses.length > 0 && '-ml-2')}>
        <button
          type="button"
          onClick={openRename}
          title={t('chat.renameSession')}
          className={cn(
            // Renaming is a tap target in the compact header too: 44px tall there, like its buttons.
            'titlebar-no-drag block h-control in-data-compact:h-11 max-w-full truncate rounded-md px-1.5 text-left',
            'hover:bg-fill-hover active:bg-fill-pressed transition-[background-color] duration-micro ease-out-subtle hover:duration-instant',
          )}
        >
          <span className={cn(isRegeneratingTitle && 'animate-shimmer-text')}>{title}</span>
        </button>
      </h1>
      {/* Truncates first: the title keeps its room until the meta has none left */}
      {boundProject && !meta && !compact && (
        <span
          className="inline-flex min-w-0 max-w-[140px] shrink-[40] items-center gap-1.5 rounded-full bg-fill-hover px-2 py-0.5 text-caption font-medium text-secondary"
          title={boundProject.name}
        >
          <span
            className="size-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: boundProject.color || 'var(--accent-solid)' }}
            aria-hidden="true"
          />
          <span className="truncate">{boundProject.name}</span>
        </span>
      )}
      {meta && !compact && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => {
                if (workingDirectory) void window.electronAPI?.showInFolder(workingDirectory)
              }}
              className="titlebar-no-drag inline-flex h-6 min-w-0 max-w-[180px] shrink-[100] items-center gap-1 rounded-md px-1.5 text-label-sm text-tertiary transition-colors duration-micro hover:bg-fill-hover hover:text-foreground cursor-pointer"
            >
              <Folder className="size-3 shrink-0 opacity-75" aria-hidden="true" />
              <span className="truncate">{meta}</span>
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <span className="flex flex-col gap-0.5">
              <span className="font-medium">{t('chat.projectFolder', { defaultValue: '项目目录' })}</span>
              {workingDirectory && <span className="text-label-sm opacity-80">{workingDirectory}</span>}
            </span>
          </TooltipContent>
        </Tooltip>
      )}
      {showPrChip && prWatch && (
        <div className="titlebar-no-drag shrink-0 flex items-center">
        <ChatHeaderPrChip
          sessionId={sessionId}
          state={prWatch}
          nav={prWatchNav}
          activeOrigin={prWatchActiveOrigin}
          onRefresh={onRefreshPrWatch}
          onUnbind={onUnbindPr}
          onSetAutoMerge={onSetPrAutoMerge}
          autoFix={prWatchAutoFix}
          onSetAutoFix={onSetPrAutoFix}
          onCardOpenChange={onPrCardOpenChange}
          onReserveElChange={setPrReserveEl}
        />
        </div>
      )}
      {item && !compact && (item.labels?.length ?? 0) > 0 && (
        <div className="titlebar-no-drag min-w-0 flex items-center">
        <ChatHeaderLabels
          item={item}
          labels={labels}
          onLabelsChange={handleLabelsChange}
          rowEl={titleRowEl}
          maxLabels={codingMode ? CHAT_HEADER_CODING_MAX_LABELS : undefined}
          reserveEl={showPrChip ? prReserveEl : null}
        />
        </div>
      )}
    </div>
  )

  const moreLabel = t('session.actionsFor', { title })
  const actions = (
    <div className="flex items-center gap-0.5">
      {!compact && (
        <div className="mr-1 min-w-0">
          <BrowserTabStrip activeSessionId={sessionId} maxVisibleBadges={2} />
        </div>
      )}
      {isTaskOrchestrator && (
        <PanelHeaderCenterButton
          icon={<Pencil className="h-4 w-4" />}
          tooltip={t('kanban.editTask')}
          onClick={handleEditTask}
        />
      )}
      {item && !compact && gitStatus?.isRepo && onToggleDiffPanel && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={onToggleDiffPanel}
              aria-pressed={isDiffPanelOpen}
              className={cn(
                'titlebar-no-drag inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[12px] transition-colors duration-micro cursor-pointer',
                'focus-visible:outline-2 focus-visible:outline-focus-ring focus-visible:-outline-offset-2',
                isDiffPanelOpen
                  ? 'bg-accent-tint text-accent font-medium'
                  : gitStatus.files.length > 0
                    ? 'bg-black/[0.04] dark:bg-white/[0.07] text-foreground hover:bg-black/[0.07] dark:hover:bg-white/[0.11]'
                    : 'text-tertiary hover:bg-fill-hover hover:text-foreground',
              )}
            >
              <GitBranch className="size-3.5 shrink-0 text-accent" aria-hidden="true" />
              {gitStatus.branch && (
                <span className="max-w-[96px] truncate font-medium">{gitStatus.branch}</span>
              )}
              {gitStatus.files.length > 0 && (
                <span className="inline-flex items-center gap-1 font-mono text-[11px] tabular-nums">
                  {gitStatus.totalAdditions > 0 && (
                    <span className="text-emerald-600 dark:text-emerald-400">+{gitStatus.totalAdditions}</span>
                  )}
                  {gitStatus.totalDeletions > 0 && (
                    <span className="text-rose-600 dark:text-rose-400">-{gitStatus.totalDeletions}</span>
                  )}
                  {gitStatus.totalAdditions === 0 && gitStatus.totalDeletions === 0 && (
                    <span className="text-tertiary">{gitStatus.files.length}</span>
                  )}
                </span>
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {gitStatus.files.length > 0
              ? t('gitDiff.headerTooltipDirty', {
                  count: gitStatus.files.length,
                  defaultValue: `查看 ${gitStatus.files.length} 个文件的代码改动`,
                })
              : t('gitDiff.headerTooltipClean', { defaultValue: '查看 Git 改动面板' })}
          </TooltipContent>
        </Tooltip>
      )}
      {item && !compact && onToggleFilesPanel && (
        <PanelHeaderCenterButton
          icon={<FolderOpen className="h-4 w-4" />}
          tooltip={t('chat.sessionFiles')}
          aria-pressed={isFilesPanelOpen}
          onClick={onToggleFilesPanel}
          className={cn(isFilesPanelOpen && 'bg-accent-tint text-accent hover:bg-accent-tint hover:text-accent')}
        />
      )}
      {item && !compact && (
        <SessionInfoPopover
          sessionId={sessionId}
          sessionFolderPath={sessionFolderPath}
          side="bottom"
          align="end"
          trigger={<PanelHeaderCenterButton icon={<Info className="h-4 w-4" />} aria-label={t('chat.sessionInfo')} />}
        />
      )}
      {item && !compact && Boolean(item.sharedUrl) && <ChatShareMenu item={item} />}
      {item && !compact && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <PanelHeaderCenterButton icon={<MoreHorizontal className="h-4 w-4" />} aria-label={moreLabel} />
          </DropdownMenuTrigger>
          <StyledDropdownMenuContent align="end" sideOffset={8}>
            <SessionMenu
              item={item}
              sessionStatuses={sessionStatuses}
              labels={labels}
              onLabelsChange={handleLabelsChange}
              onRename={openRename}
              onFlag={handleFlag}
              onUnflag={handleUnflag}
              onArchive={handleArchive}
              onUnarchive={handleUnarchive}
              onMarkUnread={handleMarkUnread}
              onSessionStatusChange={handleStatusChange}
              onOpenInNewWindow={handleOpenInNewWindow}
              onDelete={handleDelete}
            />
          </StyledDropdownMenuContent>
        </DropdownMenu>
      )}
      {item && compact && (
        <PanelHeaderCenterButton
          icon={<MoreHorizontal className="h-4 w-4" />}
          aria-label={moreLabel}
          aria-haspopup="dialog"
          aria-expanded={drawer.open && drawer.view === 'root'}
          onClick={(event) => openDrawer('root', event.currentTarget)}
        />
      )}
    </div>
  )

  return (
    <>
      <PanelHeader
        titleRow={titleRow}
        actions={actions}
        leadingAction={leadingAction}
        rightSidebarButton={compact && leadingAction ? undefined : rightSidebarButton}
        className={!compact ? 'border-b border-subtle/70' : undefined}
      />
      {item && compact && (
        <>
          <CompactSessionMenu
            title={title}
            item={item}
            sessionStatuses={sessionStatuses}
            labels={labels}
            onLabelsChange={handleLabelsChange}
            onRename={openRename}
            onFlag={handleFlag}
            onUnflag={handleUnflag}
            onArchive={handleArchive}
            onUnarchive={handleUnarchive}
            onMarkUnread={handleMarkUnread}
            onSessionStatusChange={handleStatusChange}
            onOpenInNewWindow={handleOpenInNewWindow}
            onDelete={handleDelete}
            onShowInfo={showInfo}
            open={drawer.open}
            onOpenChange={handleDrawerOpenChange}
            initialView={drawer.view}
            onCloseAutoFocus={handleDrawerCloseAutoFocus}
          />
          <SessionInfoPopover
            sessionId={sessionId}
            sessionFolderPath={sessionFolderPath}
            presentation="drawer"
            open={infoOpen}
            onOpenChange={setInfoOpen}
          />
        </>
      )}
      <RenameDialog
        open={renameOpen}
        onOpenChange={setRenameOpen}
        title={t('chat.renameSession')}
        value={renameValue}
        onValueChange={setRenameValue}
        onSubmit={submitRename}
        placeholder={t('chat.enterSessionName')}
      />
    </>
  )
}, sameHeaderProps)
