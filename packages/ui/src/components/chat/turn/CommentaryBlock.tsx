import * as React from 'react'
import { cn } from '../../../lib/utils'
import { Markdown, type FileOpenHandler } from '../../markdown'
import type { ActivityItem } from '../TurnCard'
import { INSERT_DROP } from './turn-classes'

export interface CommentaryBlockProps {
  activity: ActivityItem
  onOpenUrl?: (url: string) => void
  onOpenFile?: FileOpenHandler
  animateInsert?: boolean
}

const COMMENTARY_PROSE = [
  'text-[13.5px] leading-[1.6] text-foreground/85 select-text',
  '[&_.markdown-content_p]:my-1.5 [&_.markdown-content_p]:leading-[inherit]',
  '[&_.markdown-content>:first-child]:mt-0 [&_.markdown-content>:last-child]:mb-0',
  '[&_.markdown-content_ul]:my-1.5 [&_.markdown-content_ol]:my-1.5',
].join(' ')

/**
 * Renders top-level AI intermediate commentary directly in the conversation timeline
 * (Codex-style live progress updates) so users always see what the agent is doing
 * or asking for without expanding collapsed tool logs.
 */
export function CommentaryBlock({
  activity,
  onOpenUrl,
  onOpenFile,
  animateInsert = false,
}: CommentaryBlockProps) {
  const text = activity.content?.trim()
  if (!text) return null

  return (
    <div
      data-commentary-id={activity.id}
      className={cn(
        'min-w-0 py-0.5',
        COMMENTARY_PROSE,
        animateInsert && INSERT_DROP,
      )}
    >
      <Markdown
        mode="minimal"
        onUrlClick={onOpenUrl}
        onFileClick={onOpenFile}
        hideFirstMermaidExpand={false}
      >
        {text}
      </Markdown>
    </div>
  )
}
