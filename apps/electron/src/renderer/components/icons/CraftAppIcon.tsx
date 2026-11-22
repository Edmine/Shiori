import shioriIcon from '@/assets/shiori-icon.png'
import { cn } from '@/lib/utils'

interface CraftAppIconProps {
  className?: string
  size?: number
}

export function CraftAppIcon({ className, size = 64 }: CraftAppIconProps) {
  return (
    <img
      src={shioriIcon}
      alt="Shiori"
      width={size}
      height={size}
      draggable={false}
      className={cn(
        'rounded-[24%] object-cover select-none ring-1 ring-black/[0.08] dark:ring-white/[0.12]',
        className,
      )}
    />
  )
}
