import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Check, CodeXml, DatabaseZap, SlidersHorizontal } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Button, IconButton } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { SourceAvatar } from '@/components/ui/source-avatar'
import { cn } from '@/lib/utils'
import type { LoadedSource } from '../../../../shared/types'

interface ComposerOptionsMenuProps {
  disabled?: boolean
  isEmptySession: boolean
  /** Code-only toolset mode (formerly "Coding") */
  codingMode: boolean
  onToggleCodingMode?: (enabled: boolean) => void
  onContinueWithCodingMode?: (enabled: boolean) => void
  /** External sources */
  sources: LoadedSource[]
  selectedSourceSlugs: string[]
  onToggleSourceSlug?: (slug: string) => void
}

/**
 * Progressive-disclosure popover for infrequent session options (code-only toolset mode,
 * external sources). Project folder selection lives directly on the composer bar so there
 * is only one place to bind or switch a session's directory.
 */
export function ComposerOptionsMenu({
  disabled = false,
  isEmptySession,
  codingMode,
  onToggleCodingMode,
  onContinueWithCodingMode,
  sources,
  selectedSourceSlugs,
  onToggleSourceSlug,
}: ComposerOptionsMenuProps) {
  const { t } = useTranslation()
  const [open, setOpen] = React.useState(false)

  const hasAnySection = Boolean((onToggleCodingMode && onContinueWithCodingMode) || onToggleSourceSlug)
  if (!hasAnySection) return null

  const activeOverrideCount =
    (codingMode ? 1 : 0) +
    (selectedSourceSlugs.length > 0 ? 1 : 0)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div className="relative inline-flex shrink-0">
          <IconButton
            aria-label={t('chat.options.title')}
            tooltip={open ? undefined : t('chat.options.tooltip')}
            icon={<SlidersHorizontal />}
            disabled={disabled}
            className={cn(
              'input-toolbar-btn',
              activeOverrideCount > 0 && 'text-accent',
            )}
          />
          {activeOverrideCount > 0 && (
            <span
              aria-hidden="true"
              className="pointer-events-none absolute top-1 right-1 size-1.5 rounded-full bg-accent-solid"
            />
          )}
        </div>
      </PopoverTrigger>

      <PopoverContent
        side="top"
        align="start"
        sideOffset={8}
        className="w-[316px] max-w-[calc(100vw-24px)] overflow-hidden rounded-xl border border-default bg-floating p-0 shadow-elev-2"
      >
        <div className="border-b border-subtle px-3.5 py-2.5">
          <div className="font-serif text-[13px] font-medium tracking-[0.04em] text-foreground">
            {t('chat.options.title')}
          </div>
        </div>

        <div className="divide-y divide-subtle">
          {/* Code-only toolset mode */}
          {onToggleCodingMode && onContinueWithCodingMode && (
            <div className="px-3.5 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 text-label font-medium text-foreground">
                    <CodeXml aria-hidden className="size-3.5 shrink-0 text-tertiary" />
                    <span>{t('chat.options.codeOnlyLabel')}</span>
                  </div>
                  <p className="mt-0.5 text-label-sm leading-relaxed text-tertiary">
                    {t('chat.options.codeOnlyDesc')}
                  </p>
                </div>
                {isEmptySession && (
                  <Switch
                    checked={codingMode}
                    disabled={disabled}
                    onCheckedChange={(checked) => {
                      onToggleCodingMode(checked)
                    }}
                    aria-label={t('chat.options.codeOnlyLabel')}
                    className="mt-0.5 shrink-0"
                  />
                )}
              </div>
              {!isEmptySession && (
                <div className="mt-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    className="h-7 px-2.5 text-label-sm"
                    onClick={() => {
                      setOpen(false)
                      onContinueWithCodingMode(!codingMode)
                    }}
                  >
                    {t('chat.options.codeOnlySwitch')}
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* External sources */}
          {onToggleSourceSlug && (
            <div className="px-3.5 py-3">
              <div className="flex items-center gap-1.5 text-label font-medium text-foreground">
                <DatabaseZap aria-hidden className="size-3.5 shrink-0 text-tertiary" />
                <span>{t('chat.options.sourcesLabel')}</span>
              </div>
              {sources.length === 0 ? (
                <p className="mt-0.5 text-label-sm leading-relaxed text-tertiary">
                  {t('chat.options.sourcesEmpty')}
                </p>
              ) : (
                <div className="mt-2 flex max-h-36 flex-col gap-0.5 overflow-y-auto">
                  {sources.map((source) => {
                    const slug = source.config.slug
                    const selected = selectedSourceSlugs.includes(slug)
                    return (
                      <button
                        key={slug}
                        type="button"
                        onClick={() => onToggleSourceSlug(slug)}
                        className={cn(
                          'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-label transition-colors hover:bg-fill-hover',
                          selected ? 'bg-accent-tint/60 text-foreground' : 'text-secondary',
                        )}
                      >
                        <SourceAvatar source={source} size="xs" />
                        <span className="min-w-0 flex-1 truncate">{source.config.name}</span>
                        {selected && <Check aria-hidden className="size-3.5 shrink-0 text-accent" />}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
