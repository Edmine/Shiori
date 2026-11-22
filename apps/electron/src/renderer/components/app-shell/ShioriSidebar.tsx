import * as React from 'react'
import { useTranslation } from 'react-i18next'
import {
  ArrowLeft,
  Calendar,
  Command,
  Folder,
  Hand,
  Moon,
  Search,
  Settings,
  Sun,
} from 'lucide-react'
import { Spinner, Tooltip, TooltipTrigger, TooltipContent } from '@craft-agent/ui'
import { cn } from '@/lib/utils'
import { useTheme } from '@/context/ThemeContext'
import { SquarePenRounded } from '../icons/SquarePenRounded'
import { PanelLeftRounded } from '../icons/PanelLeftRounded'
import { WorkspaceSwitcher } from './WorkspaceSwitcher'
import { AppMenu } from '../AppMenu'
import { isMac, isWebUI } from '@/lib/platform'
import type { Workspace } from '../../../shared/types'
import type { SettingsMenuItem } from '../../../shared/menu-schema'
import type { ChatGroupingMode } from './SessionList'

export type SidebarFilterMode = 'include' | 'exclude'

export type ShioriSidebarSection =
  | 'sessions'
  | 'board'
  | 'pages'
  | 'sources'
  | 'skills'
  | 'projects'
  | 'automations'
  | 'settings'

export interface ShioriProjectOption {
  id: string
  slug: string
  name: string
  color?: string
}

export interface ShioriActiveRadarItem {
  id: string
  title: string
  state: 'needs-you' | 'working'
  isSelected?: boolean
}

export interface ShioriSidebarProps {
  paneRef: React.RefObject<HTMLDivElement>
  width: number
  workspaces: Workspace[]
  activeWorkspaceId: string | null
  onSelectWorkspace: (workspaceId: string, openInNewWindow?: boolean) => void | Promise<void>
  workspaceUnreadMap?: Record<string, boolean>
  onWorkspaceCreated?: (workspace: Workspace) => void
  onWorkspaceRemoved?: () => void
  onNewSession: (openInNewWindow?: boolean) => void
  newSessionLabel: string
  newSessionHotkey?: string
  onNewWindow?: () => void
  onAddBrowserPanel?: () => void
  onOpenSettingsSubpage: (subpage: SettingsMenuItem['id']) => void
  onOpenKeyboardShortcuts: () => void
  onOpenStoredUserPreferences: () => void
  onToggleSidebar: () => void
  onToggleFocusMode: () => void
  activeSection: ShioriSidebarSection
  listTitle: string
  isFilteredSessionSubView: boolean
  searchActive: boolean
  onToggleSearch: () => void
  projects: ShioriProjectOption[]
  projectFilter: Map<string, SidebarFilterMode>
  onSelectProjectFilter: (projectId: string | null) => void
  /** Live running or needs-approval sessions surfaced at the top of the sidebar */
  activeRadarItems?: ShioriActiveRadarItem[]
  onSelectRadarSession?: (sessionId: string) => void
  /** Quick folder/date grouping toggle in the sidebar header */
  groupingMode?: ChatGroupingMode
  canToggleGrouping?: boolean
  onToggleQuickGrouping?: () => void
  headerActions?: React.ReactNode
  onAllSessions: () => void
  onSettings: () => void
  onOpenCommandPalette?: () => void
  commandPaletteHotkey?: string
  children: React.ReactNode
}

export function ShioriSidebar({
  paneRef,
  width,
  workspaces,
  activeWorkspaceId,
  onSelectWorkspace,
  workspaceUnreadMap,
  onWorkspaceCreated,
  onWorkspaceRemoved,
  onNewSession,
  newSessionLabel,
  newSessionHotkey,
  onNewWindow,
  onAddBrowserPanel,
  onOpenSettingsSubpage,
  onOpenKeyboardShortcuts,
  onOpenStoredUserPreferences,
  onToggleSidebar,
  onToggleFocusMode,
  activeSection,
  listTitle,
  isFilteredSessionSubView,
  searchActive,
  onToggleSearch,
  projects,
  projectFilter,
  onSelectProjectFilter,
  activeRadarItems = [],
  onSelectRadarSession,
  groupingMode,
  canToggleGrouping = false,
  onToggleQuickGrouping,
  headerActions,
  onAllSessions,
  onSettings,
  onOpenCommandPalette,
  commandPaletteHotkey,
  children,
}: ShioriSidebarProps) {
  const { t } = useTranslation()
  const { isDark, setMode } = useTheme()

  const isSessionListShown = activeSection === 'sessions' || activeSection === 'board' || activeSection === 'pages'
  const needsYouCount = activeRadarItems.filter(item => item.state === 'needs-you').length
  const workingCount = activeRadarItems.filter(item => item.state === 'working').length

  const includedProjectIds = React.useMemo(() => {
    const ids: string[] = []
    for (const [id, mode] of projectFilter.entries()) {
      if (mode === 'include') ids.push(id)
    }
    return ids
  }, [projectFilter])

  const activeSingleProjectId = includedProjectIds.length === 1 ? includedProjectIds[0] : null

  const handleToggleThemeMode = React.useCallback(() => {
    setMode(isDark ? 'light' : 'dark')
  }, [isDark, setMode])

  const needsMacStoplightInset = isMac && !isWebUI

  return (
    <div
      role="complementary"
      ref={paneRef}
      tabIndex={-1}
      aria-label={t('sidebar.allSessions')}
      style={{
        width,
        '--list-surface': 'var(--surface-navigator)',
      } as React.CSSProperties}
      className="h-full flex flex-col min-w-0 select-none bg-transparent text-foreground focus:outline-none"
    >
      {/* Row 1 (44px, aligned with ChatHeader): App menu + Workspace switcher ... Search + Collapse */}
      <div
        className="shrink-0 h-11 px-2 flex items-center gap-0.5 min-w-0 titlebar-drag-region"
        style={needsMacStoplightInset ? { paddingLeft: 84 } : undefined}
      >
        <div className="titlebar-no-drag shrink-0">
          <AppMenu
            compact
            onNewChat={() => onNewSession(false)}
            onNewWindow={onNewWindow}
            onAddBrowserPanel={onAddBrowserPanel}
            onOpenSettings={onSettings}
            onOpenSettingsSubpage={onOpenSettingsSubpage}
            onOpenKeyboardShortcuts={onOpenKeyboardShortcuts}
            onOpenStoredUserPreferences={onOpenStoredUserPreferences}
            onToggleSidebar={onToggleSidebar}
            onToggleFocusMode={onToggleFocusMode}
          />
        </div>

        <div className="titlebar-no-drag flex-1 min-w-0">
          <WorkspaceSwitcher
            variant="sidebar"
            workspaces={workspaces}
            activeWorkspaceId={activeWorkspaceId}
            onSelect={onSelectWorkspace}
            onWorkspaceCreated={onWorkspaceCreated}
            onWorkspaceRemoved={onWorkspaceRemoved}
            workspaceUnreadMap={workspaceUnreadMap}
          />
        </div>

        <div className="titlebar-no-drag flex items-center gap-0.5 shrink-0">
          {isSessionListShown && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={onToggleSearch}
                  aria-label={t('common.search')}
                  aria-pressed={searchActive}
                  className={cn(
                    'inline-grid place-items-center size-7 shrink-0 rounded-md transition-colors duration-micro cursor-pointer',
                    'focus-visible:outline-2 focus-visible:outline-focus-ring focus-visible:-outline-offset-2',
                    searchActive
                      ? 'bg-accent-tint text-accent'
                      : 'text-tertiary hover:bg-fill-hover hover:text-foreground',
                  )}
                >
                  <Search className="size-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">{t('common.search')}</TooltipContent>
            </Tooltip>
          )}

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={onToggleSidebar}
                aria-label={t('menu.toggleSidebar')}
                className={cn(
                  'inline-grid place-items-center size-7 shrink-0 rounded-md text-tertiary transition-colors duration-micro cursor-pointer',
                  'hover:bg-fill-hover hover:text-foreground',
                  'focus-visible:outline-2 focus-visible:outline-focus-ring focus-visible:-outline-offset-2',
                )}
              >
                <PanelLeftRounded className="size-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{t('menu.toggleSidebar')}</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Row 2: Calm, Codex/Claude-style New Session action row */}
      <div className="shrink-0 px-2 pb-1.5">
        <button
          type="button"
          onClick={(event) => onNewSession(event.metaKey || event.ctrlKey)}
          className={cn(
            'group flex w-full h-8 items-center gap-2 rounded-lg px-2.5 text-label font-medium',
            'text-foreground hover:bg-black/[0.045] active:bg-black/[0.075] dark:hover:bg-white/[0.06] dark:active:bg-white/[0.09]',
            'transition-colors duration-micro cursor-pointer',
            'focus-visible:outline-2 focus-visible:outline-focus-ring focus-visible:-outline-offset-2',
          )}
        >
          <SquarePenRounded className="size-4 shrink-0 text-accent" />
          <span className="flex-1 truncate text-left">{newSessionLabel}</span>
          {newSessionHotkey && (
            <kbd className="shrink-0 font-sans text-[11px] font-normal text-tertiary opacity-70 group-hover:opacity-100 transition-opacity">
              {newSessionHotkey}
            </kbd>
          )}
        </button>
      </div>

      {/* Live Active Radar Strip: only shown when >=1 session is running or awaiting approval */}
      {isSessionListShown && activeRadarItems.length > 0 && (
        <div className="shrink-0 px-2 pb-1.5">
          <div
            role="region"
            aria-label={t('sidebar.activeRadar', { defaultValue: '实时状态' })}
            className={cn(
              'rounded-lg border px-2 py-1.5 space-y-1',
              needsYouCount > 0
                ? 'border-amber-500/30 bg-amber-500/[0.07] dark:bg-amber-400/[0.09]'
                : 'border-accent/25 bg-accent-tint/70',
            )}
          >
            <div className="flex items-center justify-between gap-2 px-0.5 text-[11px] font-medium">
              <div className="flex items-center gap-2 min-w-0">
                {needsYouCount > 0 && (
                  <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-300">
                    <span className="size-1.5 rounded-full bg-amber-500 animate-pulse" aria-hidden="true" />
                    <span>{t('sidebar.radarNeedsYou', { count: needsYouCount, defaultValue: `待审批 ${needsYouCount}` })}</span>
                  </span>
                )}
                {workingCount > 0 && (
                  <span className="inline-flex items-center gap-1 text-accent">
                    <Spinner className="text-[10px] text-accent shrink-0" />
                    <span>{t('sidebar.radarWorking', { count: workingCount, defaultValue: `运行中 ${workingCount}` })}</span>
                  </span>
                )}
              </div>
            </div>
            <div className="flex flex-col gap-0.5">
              {activeRadarItems.slice(0, 3).map((radarItem) => (
                <button
                  key={radarItem.id}
                  type="button"
                  onClick={() => onSelectRadarSession?.(radarItem.id)}
                  className={cn(
                    'flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-[12px] leading-tight transition-colors duration-micro cursor-pointer',
                    radarItem.isSelected
                      ? 'bg-black/[0.07] dark:bg-white/[0.11] font-medium text-foreground'
                      : 'text-foreground/85 hover:bg-black/[0.045] dark:hover:bg-white/[0.07]',
                  )}
                >
                  {radarItem.state === 'needs-you' ? (
                    <Hand className="size-3 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
                  ) : (
                    <span className="size-1.5 shrink-0 rounded-full bg-accent animate-pulse ml-0.5 mr-0.5" aria-hidden="true" />
                  )}
                  <span className="flex-1 truncate">{radarItem.title}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Row 3: Single slim contextual bar (project tabs + filter OR secondary section header) */}
      {isSessionListShown ? (
        <div className="shrink-0 flex items-center justify-between gap-1.5 px-2.5 pb-1.5 min-h-7">
          {isFilteredSessionSubView || activeSection === 'board' || activeSection === 'pages' ? (
            <button
              type="button"
              onClick={onAllSessions}
              className="inline-flex min-w-0 items-center gap-1 rounded-md px-1 py-0.5 text-label-sm font-medium text-accent hover:bg-accent-tint transition-colors cursor-pointer"
            >
              <ArrowLeft className="size-3 shrink-0" />
              <span className="truncate">{listTitle}</span>
            </button>
          ) : projects.length > 0 && groupingMode !== 'folder' ? (
            <div
              role="group"
              aria-label={t('sidebar.projects')}
              className="flex flex-1 min-w-0 items-center gap-0.5 overflow-x-auto scrollbar-hide"
            >
              <button
                type="button"
                onClick={() => onSelectProjectFilter(null)}
                aria-pressed={projectFilter.size === 0}
                className={cn(
                  'shrink-0 h-6 rounded-md px-1.5 text-[11.5px] transition-colors duration-micro cursor-pointer whitespace-nowrap',
                  'focus-visible:outline-2 focus-visible:outline-focus-ring focus-visible:-outline-offset-2',
                  projectFilter.size === 0
                    ? 'bg-black/[0.055] dark:bg-white/[0.08] font-medium text-foreground'
                    : 'text-tertiary hover:bg-fill-hover hover:text-foreground',
                )}
              >
                {t('kanban.allProjects')}
              </button>
              {projects.map((project) => {
                const isSelected = activeSingleProjectId === project.id
                return (
                  <button
                    key={project.id}
                    type="button"
                    onClick={() => onSelectProjectFilter(isSelected ? null : project.id)}
                    aria-pressed={isSelected}
                    title={project.name}
                    className={cn(
                      'inline-flex shrink-0 max-w-[104px] h-6 items-center rounded-md px-1.5 text-[11.5px] transition-colors duration-micro cursor-pointer',
                      'focus-visible:outline-2 focus-visible:outline-focus-ring focus-visible:-outline-offset-2',
                      isSelected
                        ? 'bg-black/[0.055] dark:bg-white/[0.08] font-medium text-foreground'
                        : 'text-tertiary hover:bg-fill-hover hover:text-foreground',
                    )}
                  >
                    <span className="truncate">{project.name}</span>
                  </button>
                )
              })}
            </div>
          ) : (
            <span className="truncate px-1.5 text-[11.5px] font-medium text-tertiary">
              {listTitle}
            </span>
          )}

          <div className="flex items-center gap-0.5 shrink-0">
            {canToggleGrouping && onToggleQuickGrouping && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={onToggleQuickGrouping}
                    aria-label={
                      groupingMode === 'folder'
                        ? t('sidebar.switchToDateGrouping', { defaultValue: '切换为按时间分组' })
                        : t('sidebar.switchToFolderGrouping', { defaultValue: '切换为按目录分组' })
                    }
                    className={cn(
                      'inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[11px] font-medium transition-colors duration-micro cursor-pointer',
                      'focus-visible:outline-2 focus-visible:outline-focus-ring focus-visible:-outline-offset-2',
                      groupingMode === 'folder'
                        ? 'bg-accent-tint/80 text-accent hover:bg-accent-tint'
                        : 'text-tertiary hover:bg-fill-hover hover:text-foreground',
                    )}
                  >
                    {groupingMode === 'folder' ? (
                      <>
                        <Folder className="size-3 shrink-0" aria-hidden="true" />
                        <span>{t('sidebar.groupByFolderShort', { defaultValue: '目录' })}</span>
                      </>
                    ) : (
                      <>
                        <Calendar className="size-3 shrink-0" aria-hidden="true" />
                        <span>{t('sidebar.groupByDateShort', { defaultValue: '时间' })}</span>
                      </>
                    )}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  {groupingMode === 'folder'
                    ? t('sidebar.switchToDateGrouping', { defaultValue: '切换为按时间分组' })
                    : t('sidebar.switchToFolderGrouping', { defaultValue: '切换为按目录分组' })}
                </TooltipContent>
              </Tooltip>
            )}
            {headerActions}
          </div>
        </div>
      ) : (
        <div className="shrink-0 flex items-center justify-between gap-1 px-2.5 pb-2 border-b border-subtle">
          <div className="flex items-center gap-1 min-w-0">
            <button
              type="button"
              onClick={onAllSessions}
              aria-label={t('sidebar.allSessions')}
              className="inline-grid place-items-center size-6 shrink-0 rounded-md text-secondary hover:bg-fill-hover hover:text-foreground transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-focus-ring"
            >
              <ArrowLeft className="size-3.5" />
            </button>
            <span className="truncate text-label font-medium text-foreground">{listTitle}</span>
          </div>
          <div className="flex items-center gap-0.5 shrink-0">
            {headerActions}
          </div>
        </div>
      )}

      {/* Main list area: Sessions (default) or active secondary section */}
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        {children}
      </div>

      {/* Minimal Codex-style footer: Settings on left, theme toggle on right (Sources & Skills live inside Settings) */}
      <div className="shrink-0 h-10 border-t border-subtle px-2 flex items-center justify-between gap-1">
        <button
          type="button"
          onClick={onSettings}
          aria-label={t('sidebar.settings')}
          className={cn(
            'inline-flex flex-1 min-w-0 h-7 items-center gap-2 rounded-md px-2 text-label text-secondary',
            'hover:bg-fill-hover hover:text-foreground transition-colors duration-micro cursor-pointer',
            'focus-visible:outline-2 focus-visible:outline-focus-ring focus-visible:-outline-offset-2',
          )}
        >
          <Settings className="size-3.5 shrink-0 text-tertiary" />
          <span className="truncate">{t('sidebar.settings')}</span>
        </button>

        {onOpenCommandPalette && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={onOpenCommandPalette}
                aria-label={t('commandPalette.title', { defaultValue: '命令面板' })}
                className={cn(
                  'inline-grid place-items-center size-7 shrink-0 rounded-md text-tertiary',
                  'hover:bg-fill-hover hover:text-foreground transition-colors duration-micro cursor-pointer',
                  'focus-visible:outline-2 focus-visible:outline-focus-ring focus-visible:-outline-offset-2',
                )}
              >
                <Command className="size-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">
              <span>{t('commandPalette.tooltip', { defaultValue: '命令面板' })}</span>
              {commandPaletteHotkey && (
                <span className="ml-1.5 text-tertiary">{commandPaletteHotkey}</span>
              )}
            </TooltipContent>
          </Tooltip>
        )}

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={handleToggleThemeMode}
              aria-label={isDark ? t('settings.appearance.light') : t('settings.appearance.dark')}
              className={cn(
                'inline-grid place-items-center size-7 shrink-0 rounded-md text-tertiary',
                'hover:bg-fill-hover hover:text-foreground transition-colors duration-micro cursor-pointer',
                'focus-visible:outline-2 focus-visible:outline-focus-ring focus-visible:-outline-offset-2',
              )}
            >
              {isDark ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">
            {isDark ? t('settings.appearance.light') : t('settings.appearance.dark')}
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  )
}
