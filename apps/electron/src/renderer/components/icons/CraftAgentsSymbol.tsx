import { ShioriSymbol } from './ShioriSymbol'

interface CraftAgentsSymbolProps {
  className?: string
}

export function CraftAgentsSymbol({ className }: CraftAgentsSymbolProps) {
  return <ShioriSymbol className={className} />
}
