/**
 * SettingsNavigator
 *
 * Navigator panel content for settings. Displays a list of settings sections
 * (App, Workspace, Shortcuts, Preferences) that can be selected to show in the details panel.
 *
 * Styling follows SessionList/SourcesListPanel patterns for visual consistency.
 */

import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  MoreHorizontal,
  AppWindow,
  ChevronRight,
  DatabaseZap,
  Zap,
  Webhook,
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  StyledDropdownMenuContent,
  StyledDropdownMenuItem,
} from '@/components/ui/styled-dropdown'
import { DropdownMenuProvider } from '@/components/ui/menu-context'
import { cn } from '@/lib/utils'
import { isWebUI } from '@/lib/platform'
import type { DetailsPageMeta } from '@/lib/navigation-registry'
import type { SettingsSubpage } from '../../../shared/types'
import { SETTINGS_ITEMS } from '../../../shared/menu-schema'
import { SETTINGS_ICONS } from '@/components/icons/SettingsIcons'

export const meta: DetailsPageMeta = {
  navigator: 'settings',
  slug: 'navigator',
}

interface SettingsNavigatorProps {
  /**
   * Currently selected settings subpage. `null` means the bare `settings`
   * route (no row highlighted) — happens in compact mode where the navigator
   * stands alone before the user drills into a subpage.
   */
  selectedSubpage: SettingsSubpage | null
  /** Called when a subpage is selected */
  onSelectSubpage: (subpage: SettingsSubpage) => void
  /** Compact/mobile layout shows touch chevrons, hides desktop-only shortcuts, and includes capability entries */
  isCompact?: boolean
  counts?: {
    sources: number
    skills: number
    automations: number
  }
  onSelectSources?: () => void
  onSelectSkills?: () => void
  onSelectAutomations?: () => void
}

interface SettingsItem {
  id: SettingsSubpage
  label: string
  icon: React.ComponentType<{ className?: string }>
  description: string
}

interface SettingsItemRowProps {
  item: SettingsItem
  isSelected: boolean
  isFirst: boolean
  isCompact?: boolean
  onSelect: () => void
}

/**
 * SettingsItemRow - Individual settings item with dropdown menu
 * Tracks menu open state to keep "..." button visible when menu is open
 */
function SettingsItemRow({ item, isSelected, isCompact, onSelect }: SettingsItemRowProps) {
  const { t } = useTranslation()
  const [menuOpen, setMenuOpen] = useState(false)
  const Icon = item.icon
  const showNewWindowMenu = !isCompact && !isWebUI

  // Open settings page in a new window via deep link
  const handleOpenInNewWindow = () => {
    window.electronAPI.openUrl(`craftagents://settings/${item.id}?window=focused`)
  }

  return (
    <div className="settings-item" data-selected={isSelected || undefined}>
      {/* Same anatomy as the other list rows (EntityRow): icon · title / description, mail-style full-bleed
          fill on hover/selection, a hairline from the text edge; the "⋯" button is a named sibling
          revealed on hover/focus. */}
      <div className="settings-content relative group select-none after:pointer-events-none after:absolute after:right-0 after:bottom-0 after:left-[calc(var(--gutter)+26px)] after:h-px after:bg-separator in-data-[selected]:after:hidden">
        <button
          type="button"
          onClick={onSelect}
          className={cn(
            'entity-row-btn flex w-full items-center gap-3 py-[9px] pl-gutter text-left text-label -outline-offset-2',
            showNewWindowMenu ? 'pr-9 items-start gap-2.5' : 'pr-4',
            'transition-[background-color] duration-micro ease-out-subtle hover:duration-instant',
            isSelected ? 'bg-fill-selected' : 'hover:bg-fill-hover'
          )}
        >
          <Icon
            className={cn(
              isCompact ? 'size-[18px] shrink-0' : 'size-4 shrink-0 mt-px',
              isSelected ? 'text-foreground' : 'text-tertiary'
            )}
          />
          <div className="flex flex-col gap-0.5 min-w-0 flex-1">
            <span data-slot="entity-row-title" className="font-medium text-foreground truncate">
              {item.label}
            </span>
            <span data-slot="entity-row-subtitle" className="text-label-sm text-secondary line-clamp-1">
              {item.description}
            </span>
          </div>
          {isCompact && (
            <ChevronRight className="size-4 shrink-0 text-tertiary/70" strokeWidth={1.75} />
          )}
        </button>
        {showNewWindowMenu && (
          <div
            data-touch-reveal="true"
            className={cn(
              'absolute right-3 top-1.5 z-10',
              menuOpen
                ? 'opacity-100'
                : 'opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto'
            )}
          >
            <DropdownMenu modal={true} onOpenChange={setMenuOpen}>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  tabIndex={-1}
                  aria-label={t('common.more')}
                  className="inline-grid place-items-center size-6 rounded-sm text-secondary hover:bg-fill-pressed hover:text-foreground data-[state=open]:bg-fill-pressed data-[state=open]:text-foreground"
                >
                  <MoreHorizontal className="size-4" />
                </button>
              </DropdownMenuTrigger>
              <StyledDropdownMenuContent align="end">
                <DropdownMenuProvider>
                  <StyledDropdownMenuItem onClick={handleOpenInNewWindow}>
                    <AppWindow className="h-3.5 w-3.5" />
                    <span className="flex-1">{t("sessionMenu.openInNewWindow")}</span>
                  </StyledDropdownMenuItem>
                </DropdownMenuProvider>
              </StyledDropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>
    </div>
  )
}

export default function SettingsNavigator({
  selectedSubpage,
  onSelectSubpage,
  isCompact = false,
  counts,
  onSelectSources,
  onSelectSkills,
  onSelectAutomations,
}: SettingsNavigatorProps) {
  const { t } = useTranslation()

  const settingsItems: SettingsItem[] = useMemo(() =>
    SETTINGS_ITEMS
      .filter((item) => !(isCompact && item.id === 'shortcuts'))
      .map((item) => ({
        id: item.id,
        label: t(item.labelKey),
        icon: SETTINGS_ICONS[item.id],
        description: t(item.descriptionKey),
      })),
    [t, isCompact]
  )

  const capabilityRows = useMemo(() => {
    if (!isCompact) return []
    const rows: Array<{
      id: string
      label: string
      count?: number
      icon: React.ComponentType<{ className?: string }>
      onClick: () => void
    }> = []
    if (onSelectSources) {
      rows.push({ id: 'sources', label: t('sidebar.sources'), count: counts?.sources, icon: DatabaseZap, onClick: onSelectSources })
    }
    if (onSelectSkills) {
      rows.push({ id: 'skills', label: t('sidebar.skills'), count: counts?.skills, icon: Zap, onClick: onSelectSkills })
    }
    if (onSelectAutomations) {
      rows.push({ id: 'automations', label: t('sidebar.automations'), count: counts?.automations, icon: Webhook, onClick: onSelectAutomations })
    }
    return rows
  }, [isCompact, counts, onSelectSources, onSelectSkills, onSelectAutomations, t])

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div
        className="flex-1 min-h-0 overflow-y-auto overscroll-contain touch-pan-y"
        data-list-role="settings"
      >
        <div className="pt-1 pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))]">
          {settingsItems.map((item, index) => (
            <SettingsItemRow
              key={item.id}
              item={item}
              isSelected={selectedSubpage === item.id}
              isFirst={index === 0}
              isCompact={isCompact}
              onSelect={() => onSelectSubpage(item.id)}
            />
          ))}
          {capabilityRows.length > 0 && (
            <div className="mt-3 pt-2 border-t border-separator">
              <div className="px-gutter py-1.5 text-caption font-medium text-tertiary">
                {t('settings.groups.capabilities', { defaultValue: '能力与扩展' })}
              </div>
              {capabilityRows.map((row) => {
                const RowIcon = row.icon
                return (
                  <div
                    key={row.id}
                    className="relative select-none after:pointer-events-none after:absolute after:right-0 after:bottom-0 after:left-[calc(var(--gutter)+30px)] after:h-px after:bg-separator last:after:hidden"
                  >
                    <button
                      type="button"
                      onClick={row.onClick}
                      className="entity-row-btn flex w-full items-center gap-3 py-[9px] pl-gutter pr-4 text-left text-label transition-[background-color] duration-micro ease-out-subtle hover:bg-fill-hover"
                    >
                      <RowIcon className="size-[18px] shrink-0 text-tertiary" />
                      <span data-slot="entity-row-title" className="flex-1 min-w-0 font-medium text-foreground truncate">
                        {row.label}
                      </span>
                      {typeof row.count === 'number' && row.count > 0 && (
                        <span className="text-caption tabular-nums text-tertiary">{row.count}</span>
                      )}
                      <ChevronRight className="size-4 shrink-0 text-tertiary/70" strokeWidth={1.75} />
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
