import * as React from 'react'
import { useTranslation } from 'react-i18next'
import {
  Check,
  DatabaseZap,
  Folder,
  FolderOpen,
  GitBranch,
  Hand,
  Keyboard,
  Moon,
  PanelLeft,
  Settings,
  SquarePen,
  Sun,
  Webhook,
  Zap,
} from 'lucide-react'
import { Spinner } from '@craft-agent/ui'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from '@/components/ui/command'
import { WorkspaceAvatar } from '@/components/ui/workspace-avatar'
import { useActionLabel } from '@/actions'
import { cn } from '@/lib/utils'
import { rankPaletteSessions, type PaletteSessionCandidate } from './command-palette-helpers'
import type { SettingsSubpage, Workspace } from '../../../shared/types'

export const SHIORI_TOGGLE_RIGHT_PANEL_EVENT = 'shiori:toggle-right-panel'

export interface ShioriCommandPaletteProps {
  open: boolean
  openedWithKeyboard: boolean
  onOpenChange: (open: boolean) => void
  sessions: PaletteSessionCandidate[]
  workspaces: Workspace[]
  activeWorkspaceId: string | null
  hasActiveSession: boolean
  isDark: boolean
  onNewChat: () => void
  onSelectSession: (sessionId: string) => void
  onSelectWorkspace: (workspaceId: string) => void | Promise<void>
  onToggleTheme: () => void
  onToggleSidebar: () => void
  onOpenSettings: (subpage?: SettingsSubpage) => void
  onOpenSources: () => void
  onOpenSkills: () => void
  onOpenAutomations: () => void
  onOpenKeyboardShortcuts: () => void
}

export function dispatchToggleRightPanel(tab: 'diff' | 'files'): void {
  window.dispatchEvent(new CustomEvent<{ tab: 'diff' | 'files' }>(SHIORI_TOGGLE_RIGHT_PANEL_EVENT, {
    detail: { tab },
  }))
}

export function ShioriCommandPalette({
  open,
  openedWithKeyboard,
  onOpenChange,
  sessions,
  workspaces,
  activeWorkspaceId,
  hasActiveSession,
  isDark,
  onNewChat,
  onSelectSession,
  onSelectWorkspace,
  onToggleTheme,
  onToggleSidebar,
  onOpenSettings,
  onOpenSources,
  onOpenSkills,
  onOpenAutomations,
  onOpenKeyboardShortcuts,
}: ShioriCommandPaletteProps) {
  const { t } = useTranslation()
  const newChatHotkey = useActionLabel('app.newChat').hotkey
  const diffHotkey = useActionLabel('view.toggleDiffDrawer').hotkey
  const toggleThemeHotkey = useActionLabel('app.toggleTheme').hotkey
  const toggleSidebarHotkey = useActionLabel('view.toggleSidebar').hotkey
  const settingsHotkey = useActionLabel('app.settings').hotkey
  const shortcutsHotkey = useActionLabel('app.keyboardShortcuts').hotkey

  const rankedSessions = React.useMemo(
    () => rankPaletteSessions(sessions, 16),
    [sessions],
  )

  const runAndClose = React.useCallback(
    (action: () => void) => {
      onOpenChange(false)
      action()
    },
    [onOpenChange],
  )

  const settingsDestinations = React.useMemo(
    () => [
      { id: 'ai' as const, label: t('settings.ai.title'), keywords: 'ai model api magpie 模型' },
      { id: 'workspace' as const, label: t('settings.workspace.title'), keywords: 'workspace 工作区 默认项目目录' },
      { id: 'appearance' as const, label: t('settings.appearance.title'), keywords: 'appearance theme 主题 外观' },
      { id: 'permissions' as const, label: t('settings.permissions.title'), keywords: 'permissions 权限' },
      { id: 'shortcuts' as const, label: t('settings.shortcuts.title'), keywords: 'shortcuts hotkeys 快捷键' },
      { id: 'app' as const, label: t('settings.app.title'), keywords: 'app notifications 应用 代理' },
    ],
    [t],
  )

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      openedWithKeyboard={openedWithKeyboard}
      title={t('commandPalette.title', { defaultValue: '命令面板' })}
    >
      <CommandInput
        placeholder={t('commandPalette.placeholder', {
          defaultValue: '搜索会话、工作区、设置或执行操作…',
        })}
      />
      <CommandList className="max-h-[380px]">
        <CommandEmpty>
          {t('commandPalette.empty', { defaultValue: '没有找到匹配项' })}
        </CommandEmpty>

        <CommandGroup heading={t('commandPalette.groupActions', { defaultValue: '快速操作' })}>
          <CommandItem
            value={`new chat session 新建会话 ${t('session.newSession')}`}
            onSelect={() => runAndClose(onNewChat)}
          >
            <SquarePen className="size-4 text-accent" />
            <span>{t('session.newSession')}</span>
            {newChatHotkey && <CommandShortcut>{newChatHotkey}</CommandShortcut>}
          </CommandItem>

          {hasActiveSession && (
            <>
              <CommandItem
                value={`git diff code changes 代码改动 ${t('commandPalette.openDiff', { defaultValue: '查看代码改动' })}`}
                onSelect={() => runAndClose(() => dispatchToggleRightPanel('diff'))}
              >
                <GitBranch className="size-4 text-accent" />
                <span>{t('commandPalette.openDiff', { defaultValue: '查看代码改动' })}</span>
                {diffHotkey && <CommandShortcut>{diffHotkey}</CommandShortcut>}
              </CommandItem>

              <CommandItem
                value={`session files 会话文件 ${t('commandPalette.openFiles', { defaultValue: '查看会话文件' })}`}
                onSelect={() => runAndClose(() => dispatchToggleRightPanel('files'))}
              >
                <FolderOpen className="size-4" />
                <span>{t('commandPalette.openFiles', { defaultValue: '查看会话文件' })}</span>
              </CommandItem>
            </>
          )}

          <CommandItem
            value="theme dark light 切换主题 深色 浅色"
            onSelect={() => runAndClose(onToggleTheme)}
          >
            {isDark ? <Sun className="size-4" /> : <Moon className="size-4" />}
            <span>
              {isDark
                ? t('commandPalette.switchToLight', { defaultValue: '切换为浅色主题' })
                : t('commandPalette.switchToDark', { defaultValue: '切换为深色主题' })}
            </span>
            {toggleThemeHotkey && <CommandShortcut>{toggleThemeHotkey}</CommandShortcut>}
          </CommandItem>

          <CommandItem
            value="toggle sidebar 切换侧栏 收起侧栏"
            onSelect={() => runAndClose(onToggleSidebar)}
          >
            <PanelLeft className="size-4" />
            <span>{t('menu.toggleSidebar')}</span>
            {toggleSidebarHotkey && <CommandShortcut>{toggleSidebarHotkey}</CommandShortcut>}
          </CommandItem>

          <CommandItem
            value="settings preferences 设置"
            onSelect={() => runAndClose(() => onOpenSettings())}
          >
            <Settings className="size-4" />
            <span>{t('sidebar.settings')}</span>
            {settingsHotkey && <CommandShortcut>{settingsHotkey}</CommandShortcut>}
          </CommandItem>

          <CommandItem
            value="keyboard shortcuts 快捷键"
            onSelect={() => runAndClose(onOpenKeyboardShortcuts)}
          >
            <Keyboard className="size-4" />
            <span>{t('shortcuts.action.keyboardShortcuts')}</span>
            {shortcutsHotkey && <CommandShortcut>{shortcutsHotkey}</CommandShortcut>}
          </CommandItem>
        </CommandGroup>

        {rankedSessions.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading={t('commandPalette.groupSessions', { defaultValue: '最近会话' })}>
              {rankedSessions.map((sessionItem) => (
                <CommandItem
                  key={sessionItem.id}
                  value={`session ${sessionItem.title} ${sessionItem.folderName ?? ''} ${sessionItem.id}`}
                  onSelect={() => runAndClose(() => onSelectSession(sessionItem.id))}
                >
                  <span className="inline-grid size-4 shrink-0 place-items-center" aria-hidden="true">
                    {sessionItem.needsApproval ? (
                      <Hand className="size-3.5 text-amber-600 dark:text-amber-400" />
                    ) : sessionItem.isProcessing ? (
                      <Spinner className="text-[11px] text-accent" />
                    ) : (
                      <span
                        className={cn(
                          'size-1.5 rounded-full',
                          sessionItem.isSelected ? 'bg-accent-solid' : 'bg-foreground/25',
                        )}
                      />
                    )}
                  </span>
                  <span className={cn('flex-1 truncate', sessionItem.isSelected && 'font-medium')}>
                    {sessionItem.title}
                  </span>
                  {sessionItem.folderName && (
                    <span className="inline-flex max-w-[140px] shrink-0 items-center gap-1 rounded-md bg-black/[0.045] dark:bg-white/[0.08] px-1.5 py-0.5 text-[11px] text-tertiary">
                      <Folder className="size-3 shrink-0" aria-hidden="true" />
                      <span className="truncate">{sessionItem.folderName}</span>
                    </span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        {workspaces.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading={t('commandPalette.groupWorkspaces', { defaultValue: '切换工作区' })}>
              {workspaces.map((workspace) => {
                const isActive = workspace.id === activeWorkspaceId
                return (
                  <CommandItem
                    key={workspace.id}
                    value={`workspace 工作区 ${workspace.name} ${workspace.id}`}
                    onSelect={() => runAndClose(() => void onSelectWorkspace(workspace.id))}
                  >
                    <WorkspaceAvatar
                      workspaceId={workspace.id}
                      workspaceName={workspace.name}
                      className="size-4 rounded-[4px] text-[10px]"
                    />
                    <span className={cn('flex-1 truncate', isActive && 'font-medium')}>
                      {workspace.name}
                    </span>
                    {isActive && (
                      <span className="inline-flex items-center gap-1 text-[11px] text-accent">
                        <Check className="size-3.5 text-accent" />
                        <span>{t('commandPalette.activeWorkspace', { defaultValue: '当前' })}</span>
                      </span>
                    )}
                  </CommandItem>
                )
              })}
            </CommandGroup>
          </>
        )}

        <CommandSeparator />
        <CommandGroup heading={t('commandPalette.groupSettings', { defaultValue: '跳转设置' })}>
          {settingsDestinations.map((dest) => (
            <CommandItem
              key={dest.id}
              value={`settings 设置 ${dest.label} ${dest.keywords}`}
              onSelect={() => runAndClose(() => onOpenSettings(dest.id))}
            >
              <Settings className="size-3.5" />
              <span>{dest.label}</span>
            </CommandItem>
          ))}
          <CommandItem
            value={`sources 数据源 ${t('sidebar.sources')}`}
            onSelect={() => runAndClose(onOpenSources)}
          >
            <DatabaseZap className="size-3.5" />
            <span>{t('sidebar.sources')}</span>
          </CommandItem>
          <CommandItem
            value={`skills 技能 ${t('sidebar.skills')}`}
            onSelect={() => runAndClose(onOpenSkills)}
          >
            <Zap className="size-3.5" />
            <span>{t('sidebar.skills')}</span>
          </CommandItem>
          <CommandItem
            value={`automations 自动化 ${t('sidebar.automations')}`}
            onSelect={() => runAndClose(onOpenAutomations)}
          >
            <Webhook className="size-3.5" />
            <span>{t('sidebar.automations')}</span>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  )
}
