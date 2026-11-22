/**
 * WorkspaceAvatar - Thin wrapper around CrossfadeAvatar for workspace icons.
 *
 * When no icon is set, renders a deterministic colored initial-letter fallback
 * derived from the workspace ID (so the same workspace always gets the same
 * color across sessions and across surfaces).
 *
 * Sizing/shape is fully controlled by `className` (e.g. `h-4 w-4 rounded-full`).
 */

import * as React from 'react'
import { useAtomValue } from 'jotai'
import { CrossfadeAvatar } from './avatar'
import { cn } from '@/lib/utils'
import { workspaceAvatarColorsAtom } from '@/atoms/workspace-avatar-colors'
import { workspaceAvatarBackground } from './workspace-avatar-color'

function hashString(str: string): number {
  let hash = 5381
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i)
  }
  return Math.abs(hash)
}

function getWorkspaceHue(id: string): number {
  return hashString(id) % 360
}

interface WorkspaceAvatarProps {
  /** Workspace id. If omitted, the fallback uses a neutral muted background. */
  workspaceId?: string
  workspaceName?: string
  src?: string | null
  className?: string
  /** Override font size for the initial letter (default `text-[10px]`). */
  fallbackClassName?: string
  /** 'auto' uses deterministic HSL hue; 'neutral' uses a calm monochrome tile unless a color override exists. */
  tone?: 'auto' | 'neutral'
}

export function WorkspaceAvatar({
  workspaceId,
  workspaceName,
  src,
  className,
  fallbackClassName,
  tone = 'auto',
}: WorkspaceAvatarProps) {
  const colorOverrides = useAtomValue(workspaceAvatarColorsAtom)
  const initial = (workspaceName?.trim().charAt(0) || 'W').toUpperCase()
  const hasId = !!workspaceId
  const override = hasId ? colorOverrides[workspaceId!] : undefined
  const useNeutralTile = tone === 'neutral' && !override
  const bgStyle = hasId && !useNeutralTile
    ? {
        backgroundColor:
          override || workspaceAvatarBackground(getWorkspaceHue(workspaceId!)),
      }
    : undefined

  return (
    <CrossfadeAvatar
      src={src ?? undefined}
      alt={workspaceName}
      className={className}
      fallbackClassName={cn('text-[10px]', (!hasId || useNeutralTile) && 'bg-muted', fallbackClassName)}
      fallback={
        hasId ? (
          <div
            className={cn(
              'flex h-full w-full items-center justify-center font-semibold',
              useNeutralTile
                ? 'bg-foreground/[0.08] text-foreground/80 ring-1 ring-inset ring-border/70 dark:bg-white/[0.10] dark:text-foreground/90'
                : 'text-white',
            )}
            style={bgStyle}
          >
            {initial}
          </div>
        ) : (
          initial
        )
      }
    />
  )
}
