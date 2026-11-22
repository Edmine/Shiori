import { BookOpenText, CalendarDays, CircleDot, Compass, Feather, FileText, GitPullRequest, Lightbulb, ListTodo, Mail, MessageSquare, Zap, type LucideIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { newChatSuggestionDescription, newChatSuggestionLabel, type NewChatSuggestion, type NewChatSuggestionKind } from './new-chat-suggestions'

const KIND_ICONS: Record<NewChatSuggestionKind, LucideIcon> = {
  email: Mail,
  calendar: CalendarDays,
  chat: MessageSquare,
  tasks: ListTodo,
  issues: CircleDot,
  code: GitPullRequest,
  docs: FileText,
  source: Lightbulb,
  exploreProject: Compass,
  reviewCode: BookOpenText,
  draftPlan: Feather,
  custom: Zap,
}

const CLASSICAL_INDEX = ['壹', '贰', '叁'] as const

/** Classical bookmark-slip starter cards under the new-chat crest; a click sends the prompt. */
export function NewChatSuggestions({ suggestions, onSelect }: {
  suggestions: NewChatSuggestion[]
  onSelect: (suggestion: NewChatSuggestion) => void
}) {
  const { t } = useTranslation()
  if (suggestions.length === 0) return null
  return (
    <div
      role="group"
      aria-label={t('chat.suggestions.label')}
      className="grid w-full max-w-[612px] grid-cols-1 gap-2.5 sm:grid-cols-3"
    >
      {suggestions.map((suggestion, index) => {
        const Icon = KIND_ICONS[suggestion.kind]
        const label = newChatSuggestionLabel(suggestion, (key, options) => t(key, options))
        const description = newChatSuggestionDescription(suggestion, (key, options) => t(key, options))
        const numeral = CLASSICAL_INDEX[index] ?? String(index + 1)
        return (
          <button
            // Custom starters share a kind and have no source, so the position keeps their keys unique
            key={`${suggestion.kind}:${suggestion.sourceSlug ?? ''}:${index}`}
            type="button"
            onClick={() => onSelect(suggestion)}
            title={label}
            className="group motion-press relative flex min-w-0 flex-col items-start rounded-xl border border-default/80 bg-raised/75 py-3 pr-3.5 pl-4 text-left transition-colors duration-fast hover:border-accent/40 hover:bg-raised active:bg-fill-hover before:absolute before:top-3.5 before:bottom-3.5 before:left-0 before:w-[2px] before:rounded-r-full before:bg-accent/25 before:transition-colors hover:before:bg-accent/75"
          >
            <div className="flex w-full items-center justify-between gap-2">
              <span className="font-serif text-[11px] tracking-[0.18em] text-accent/80">{numeral}</span>
              <Icon aria-hidden className="size-3.5 shrink-0 text-tertiary transition-colors group-hover:text-accent" />
            </div>
            <span className="mt-2 line-clamp-2 font-serif text-[14px] font-medium leading-snug tracking-[0.02em] text-foreground">
              {label}
            </span>
            {description && (
              <span className="mt-1 line-clamp-2 text-[12px] leading-[1.55] text-tertiary">
                {description}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
