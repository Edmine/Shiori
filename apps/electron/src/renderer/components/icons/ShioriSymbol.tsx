import shioriIcon from '@/assets/shiori-icon.png'
import { cn } from '@/lib/utils'

interface ShioriSymbolProps {
  className?: string
}

/**
 * ShioriSymbol - Shiori sculpted profile & bookmark emblem.
 */
export function ShioriSymbol({ className }: ShioriSymbolProps) {
  return (
    <img
      src={shioriIcon}
      alt=""
      aria-hidden="true"
      draggable={false}
      className={cn(
        'rounded-[24%] object-cover select-none ring-1 ring-black/[0.08] dark:ring-white/[0.12]',
        className,
      )}
    />
  )
}
