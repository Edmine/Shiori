import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Sparkles, Check } from 'lucide-react'
import {
  CREATIVE_LENSES,
  CREATIVE_LENS_IDS,
  isCreativeLensId,
  type CreativeLensId,
} from '@craft-agent/shared/prompts/creative-lenses'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

const STORAGE_KEY = 'shiori:creative-lens'

function loadStoredLens(): CreativeLensId {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (isCreativeLensId(raw)) return raw
  } catch {
    // Ignore storage errors in restricted environments
  }
  return 'natural'
}

function applyLensToDocument(lens: CreativeLensId): void {
  if (typeof document === 'undefined') return
  if (lens === 'natural') {
    delete document.documentElement.dataset.creativeLens
  } else {
    document.documentElement.dataset.creativeLens = lens
  }
}

export interface CreativeLensChipProps {
  disabled?: boolean
  compact?: boolean
}

export function CreativeLensChip({ disabled = false, compact = false }: CreativeLensChipProps) {
  const { i18n } = useTranslation()
  const isZh = (i18n.language || '').toLowerCase().startsWith('zh')
  const [lens, setLens] = React.useState<CreativeLensId>(() => loadStoredLens())
  const [open, setOpen] = React.useState(false)

  React.useEffect(() => {
    applyLensToDocument(lens)
  }, [lens])

  // Hydrate from persisted backend preferences.json on mount
  React.useEffect(() => {
    let cancelled = false
    window.electronAPI?.getCreativeLens?.().then((persisted) => {
      if (!cancelled && isCreativeLensId(persisted)) {
        setLens(persisted)
        try {
          window.localStorage.setItem(STORAGE_KEY, persisted)
        } catch {
          // Ignore storage errors
        }
      }
    }).catch(() => {
      // Ignore IPC errors in non-Electron environments
    })
    return () => { cancelled = true }
  }, [])

  const handleSelect = (next: CreativeLensId) => {
    setLens(next)
    try {
      window.localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // Ignore storage errors
    }
    window.electronAPI?.setCreativeLens?.(next).catch(() => {
      // Ignore IPC errors
    })
    setOpen(false)
  }

  const current = CREATIVE_LENSES[lens]
  const isActive = lens !== 'natural'

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          title={`${isZh ? current.zhName : current.name} — ${isZh ? current.zhTagline : current.tagline}`}
          className={cn(
            'inline-flex h-control items-center gap-1.5 rounded-md px-2 text-xs transition-colors cursor-pointer select-none',
            isActive
              ? 'bg-fill-subtle text-primary font-medium'
              : 'text-tertiary hover:bg-fill-hover hover:text-secondary',
            disabled && 'opacity-50 pointer-events-none',
          )}
        >
          <span
            className="inline-block size-2 rounded-full shrink-0"
            style={{
              backgroundColor: current.accentHint ?? 'currentColor',
              opacity: isActive ? 0.9 : 0.45,
            }}
          />
          {!compact && (
            <span className="truncate max-w-[96px]">
              {isActive ? (isZh ? current.zhName : current.name) : (isZh ? '透镜' : 'Lens')}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" side="top" className="w-72 p-1.5">
        <div className="flex items-center gap-1.5 px-2 py-1.5 text-[11px] font-medium text-tertiary">
          <Sparkles className="size-3.5" />
          <span>{isZh ? '美学透镜 · Creative Lens' : 'Creative Lens'}</span>
        </div>
        <div className="flex flex-col gap-0.5">
          {CREATIVE_LENS_IDS.map((id) => {
            const def = CREATIVE_LENSES[id]
            const selected = id === lens
            return (
              <button
                key={id}
                type="button"
                onClick={() => handleSelect(id)}
                className={cn(
                  'flex w-full items-start gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors cursor-pointer',
                  selected ? 'bg-fill-subtle text-primary' : 'hover:bg-fill-hover text-secondary',
                )}
              >
                <span
                  className="mt-1.5 inline-block size-2 shrink-0 rounded-full"
                  style={{
                    backgroundColor: def.accentHint ?? 'currentColor',
                    opacity: def.accentHint ? 0.9 : 0.35,
                  }}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-primary">{isZh ? def.zhName : def.name}</span>
                    {selected && <Check className="size-3.5 text-accent shrink-0" />}
                  </div>
                  <p className="mt-0.5 text-[11px] leading-snug text-tertiary">{isZh ? def.zhTagline : def.tagline}</p>
                </div>
              </button>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}
