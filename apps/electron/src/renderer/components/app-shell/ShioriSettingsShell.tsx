import * as React from 'react'
import { useTranslation } from 'react-i18next'
import {
  ArrowLeft,
  DatabaseZap,
  Webhook,
  Zap,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { isMac, isWebUI } from '@/lib/platform'
import { SETTINGS_ICONS } from '@/components/icons/SettingsIcons'
import { ShioriSymbol } from '@/components/icons/ShioriSymbol'
import { AppShellProvider, useAppShellContext } from '@/context/AppShellContext'
import { MainContentPanel } from './MainContentPanel'
import type { NavigationState, SettingsSubpage } from '../../../shared/types'

export type ShioriSettingsSection = 'settings' | 'sources' | 'skills' | 'automations'

interface SettingsNavGroup {
  id: string
  labelKey: string
  fallbackLabel: string
  items: Array<
    | { kind: 'settings'; id: SettingsSubpage; labelKey: string }
    | { kind: 'sources' | 'skills' | 'automations'; id: 'sources' | 'skills' | 'automations'; labelKey: string }
  >
}

const SETTINGS_GROUPS: SettingsNavGroup[] = [
  {
    id: 'general',
    labelKey: 'settings.groups.general',
    fallbackLabel: '通用',
    items: [
      { kind: 'settings', id: 'app', labelKey: 'settings.app.title' },
      { kind: 'settings', id: 'appearance', labelKey: 'settings.appearance.title' },
      { kind: 'settings', id: 'input', labelKey: 'settings.input.title' },
      { kind: 'settings', id: 'shortcuts', labelKey: 'settings.shortcuts.title' },
      { kind: 'settings', id: 'preferences', labelKey: 'settings.preferences.title' },
    ],
  },
  {
    id: 'workspace',
    labelKey: 'settings.groups.workspace',
    fallbackLabel: 'AI 与工作区',
    items: [
      { kind: 'settings', id: 'ai', labelKey: 'settings.ai.title' },
      { kind: 'settings', id: 'workspace', labelKey: 'settings.workspace.title' },
      { kind: 'settings', id: 'permissions', labelKey: 'settings.permissions.title' },
      { kind: 'settings', id: 'labels', labelKey: 'settings.labels.title' },
    ],
  },
  {
    id: 'capabilities',
    labelKey: 'settings.groups.capabilities',
    fallbackLabel: '能力与扩展',
    items: [
      { kind: 'sources', id: 'sources', labelKey: 'sidebar.sources' },
      { kind: 'skills', id: 'skills', labelKey: 'sidebar.skills' },
      { kind: 'automations', id: 'automations', labelKey: 'sidebar.automations' },
    ],
  },
  {
    id: 'connectivity',
    labelKey: 'settings.groups.connectivity',
    fallbackLabel: '连接与服务',
    items: [
      { kind: 'settings', id: 'messaging', labelKey: 'settings.messaging.title' },
      { kind: 'settings', id: 'server', labelKey: 'settings.server.title' },
    ],
  },
]

const CAPABILITY_ICONS = {
  sources: DatabaseZap,
  skills: Zap,
  automations: Webhook,
} as const

export interface ShioriSettingsShellProps {
  navState: NavigationState
  activeSection: ShioriSettingsSection
  selectedSubpage: SettingsSubpage | null
  listTitle: string
  listHeaderActions?: React.ReactNode
  listContent?: React.ReactNode
  counts: {
    sources: number
    skills: number
    automations: number
  }
  onBackToApp: () => void
  onSelectSettingsSubpage: (subpage: SettingsSubpage) => void
  onSelectSources: () => void
  onSelectSkills: () => void
  onSelectAutomations: () => void
}

export function ShioriSettingsShell({
  navState,
  activeSection,
  selectedSubpage,
  listTitle,
  listHeaderActions,
  listContent,
  counts,
  onBackToApp,
  onSelectSettingsSubpage,
  onSelectSources,
  onSelectSkills,
  onSelectAutomations,
}: ShioriSettingsShellProps) {
  const { t } = useTranslation()
  const parentContext = useAppShellContext()

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      const target = event.target as HTMLElement | null
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable ||
          target.closest('[role="dialog"], [role="menu"], [data-radix-popper-content-wrapper]'))
      ) {
        return
      }
      onBackToApp()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onBackToApp])

  const settingsContext = React.useMemo(
    () => ({
      ...parentContext,
      leadingAction: undefined,
      rightSidebarButton: undefined,
      isAtRightEdge: true,
    }),
    [parentContext],
  )

  const isCapabilitySection =
    activeSection === 'sources' ||
    activeSection === 'skills' ||
    activeSection === 'automations'

  const activeSettingsId: SettingsSubpage = selectedSubpage ?? 'app'
  const needsMacStoplightInset = isMac && !isWebUI

  return (
    <AppShellProvider value={settingsContext}>
      <div
        className="flex h-full w-full min-w-0 bg-navigator text-foreground select-none overflow-hidden"
        data-shiori-settings-shell="true"
      >
        <aside
          aria-label={t('sidebar.settings')}
          className="w-[236px] shrink-0 h-full flex flex-col border-r border-subtle bg-navigator"
        >
          <div
            className="shrink-0 h-11 px-2.5 flex items-center titlebar-drag-region"
            style={needsMacStoplightInset ? { paddingLeft: 84 } : undefined}
          >
            <button
              type="button"
              onClick={onBackToApp}
              className={cn(
                'titlebar-no-drag inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-label font-medium',
                'text-secondary hover:bg-fill-hover hover:text-foreground transition-colors duration-micro cursor-pointer',
                'focus-visible:outline-2 focus-visible:outline-focus-ring focus-visible:-outline-offset-2',
              )}
            >
              <ArrowLeft className="size-3.5 shrink-0" />
              <span>{t('settings.backToApp', { defaultValue: '返回应用' })}</span>
            </button>
          </div>

          <nav className="flex-1 min-h-0 overflow-y-auto px-2 py-2 space-y-4">
            {SETTINGS_GROUPS.map((group) => (
              <div key={group.id} className="space-y-0.5">
                <div className="px-2.5 pb-1 text-[11px] font-medium tracking-[0.01em] text-tertiary">
                  {t(group.labelKey, { defaultValue: group.fallbackLabel })}
                </div>
                {group.items.map((item) => {
                  const isActive =
                    item.kind === 'settings'
                      ? activeSection === 'settings' && activeSettingsId === item.id
                      : activeSection === item.kind

                  const Icon =
                    item.kind === 'settings'
                      ? SETTINGS_ICONS[item.id]
                      : CAPABILITY_ICONS[item.kind]

                  const count =
                    item.kind === 'sources'
                      ? counts.sources
                      : item.kind === 'skills'
                        ? counts.skills
                        : item.kind === 'automations'
                          ? counts.automations
                          : 0

                  const handleClick = () => {
                    if (item.kind === 'settings') {
                      onSelectSettingsSubpage(item.id)
                    } else if (item.kind === 'sources') {
                      onSelectSources()
                    } else if (item.kind === 'skills') {
                      onSelectSkills()
                    } else {
                      onSelectAutomations()
                    }
                  }

                  return (
                    <button
                      key={`${item.kind}:${item.id}`}
                      type="button"
                      onClick={handleClick}
                      aria-current={isActive ? 'page' : undefined}
                      className={cn(
                        'relative flex w-full h-8 items-center gap-2.5 rounded-lg px-2.5 text-left text-label transition-colors duration-micro cursor-pointer',
                        'focus-visible:outline-2 focus-visible:outline-focus-ring focus-visible:-outline-offset-2',
                        isActive
                          ? 'bg-black/[0.06] dark:bg-white/[0.09] font-medium text-foreground'
                          : 'text-secondary hover:bg-black/[0.035] dark:hover:bg-white/[0.05] hover:text-foreground',
                      )}
                    >
                      {isActive && (
                        <span
                          aria-hidden="true"
                          className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-r-full bg-accent-solid"
                        />
                      )}
                      <Icon
                        className={cn(
                          'size-4 shrink-0',
                          isActive ? 'text-accent' : 'text-tertiary',
                        )}
                      />
                      <span className="flex-1 truncate">{t(item.labelKey)}</span>
                      {count > 0 && (
                        <span className="text-[11px] text-tertiary tabular-nums shrink-0">
                          {count}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            ))}
          </nav>

          <div className="shrink-0 h-10 px-3 border-t border-subtle flex items-center gap-2 text-caption text-tertiary">
            <ShioriSymbol className="size-[18px] shrink-0" />
            <span className="font-medium text-secondary">Shiori</span>
          </div>
        </aside>

        <div className="flex-1 min-w-0 h-full flex bg-panel overflow-hidden">
          {isCapabilitySection && listContent && (
            <div
              className="w-[276px] shrink-0 h-full flex flex-col border-r border-subtle bg-panel min-w-0"
              style={{ '--list-surface': 'var(--surface-panel)' } as React.CSSProperties}
            >
              <div className="shrink-0 h-11 px-3 flex items-center justify-between gap-2 border-b border-subtle titlebar-drag-region">
                <h2 className="text-label font-semibold text-foreground truncate">
                  {listTitle}
                </h2>
                {listHeaderActions && (
                  <div className="titlebar-no-drag flex items-center gap-0.5 shrink-0">
                    {listHeaderActions}
                  </div>
                )}
              </div>
              <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                {listContent}
              </div>
            </div>
          )}

          <div className="flex-1 min-w-0 h-full flex flex-col overflow-hidden">
            <MainContentPanel navStateOverride={navState} />
          </div>
        </div>
      </div>
    </AppShellProvider>
  )
}
