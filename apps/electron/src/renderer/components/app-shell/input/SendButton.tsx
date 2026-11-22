import { useTranslation } from 'react-i18next'
import { ArrowUp, CornerDownLeft, Square } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@craft-agent/ui'
import { Button } from '@/components/ui/button'

/**
 * Round send control, the same 28px as the toolbar chips beside it (36px ≤ 768px via the
 * `send-btn` hook, like the chips' `input-toolbar-btn`). Neutral while empty (the primary's
 * disabled fill), solid accent when ready, and the same solid accent as Stop while processing —
 * the control morphs instead of going grey, so a running turn reads as live and stoppable.
 * Press scales to .94 (spec §6.3).
 */
const SEND_BASE = 'send-btn shrink-0 rounded-full enabled:active:[transform:scale(calc(1_-_0.06*var(--motion-scale)))]'

interface SendButtonProps {
  /** Processing: renders Stop instead of Send */
  isProcessing: boolean
  /** Processing with drafted input: exposes non-interrupting steer submit alongside Stop */
  canSteer?: boolean
  /** Send is not possible (no content, disabled input or tutorial gate) */
  disabled: boolean
  onStop: () => void
}

export function SendButton({ isProcessing, canSteer = false, disabled, onStop }: SendButtonProps) {
  const { t } = useTranslation()

  if (isProcessing) {
    if (canSteer) {
      return (
        <div className="flex items-center gap-1.5 shrink-0">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="secondary"
                size="icon"
                aria-label={t('chat.stopResponse')}
                data-state="stop"
                className={SEND_BASE}
                onClick={onStop}
              >
                <Square className="size-2.5 fill-current" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('chat.stopResponse')}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="submit"
                variant="primary"
                size="sm"
                aria-label={t('chat.steerTooltip')}
                data-state="steer"
                className="h-[28px] shrink-0 rounded-full px-2.5 gap-1 text-[12px] font-medium enabled:active:[transform:scale(calc(1_-_0.06*var(--motion-scale)))]"
              >
                <CornerDownLeft className="size-3.5" />
                <span>{t('chat.steerButton')}</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('chat.steerTooltip')}</TooltipContent>
          </Tooltip>
        </div>
      )
    }

    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="primary"
            size="icon"
            aria-label={t('chat.stopResponse')}
            data-state="stop"
            className={SEND_BASE}
            onClick={onStop}
          >
            <Square className="size-2.5 fill-current" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t('chat.stopResponse')}</TooltipContent>
      </Tooltip>
    )
  }

  return (
    <Button
      type="submit"
      variant="primary"
      size="icon"
      aria-label={t('shortcuts.sendMessage')}
      data-state={disabled ? 'idle' : 'ready'}
      className={SEND_BASE}
      disabled={disabled}
      data-tutorial="send-button"
    >
      <ArrowUp className="size-4" />
    </Button>
  )
}
