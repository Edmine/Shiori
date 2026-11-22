import { ShioriSymbol } from './ShioriSymbol'

interface CraftAgentsLogoProps {
  className?: string
}

export function CraftAgentsLogo({ className }: CraftAgentsLogoProps) {
  return (
    <span className={`inline-flex items-center gap-2 font-sans font-semibold tracking-tight ${className ?? ''}`}>
      <ShioriSymbol className="h-[1em] w-[1em] shrink-0" />
      <span>Shiori</span>
    </span>
  )
}
