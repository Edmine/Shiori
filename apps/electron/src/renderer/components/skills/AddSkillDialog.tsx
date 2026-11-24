/**
 * AddSkillDialog — Structured modal for creating a new workspace Skill (SKILL.md).
 *
 * Replaces the ambiguous blank EditPopover chat drawer as the primary "+" flow while
 * keeping an explicit "Ask Shiori to write it" fallback for AI-assisted authoring.
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { useRegisterModal } from '@/context/ModalContext'
import type { LoadedSkill } from '@craft-agent/shared/skills'

export interface AddSkillDialogProps {
  open: boolean
  workspaceId: string
  onOpenChange: (open: boolean) => void
  onCreated?: (skill: LoadedSkill) => void
  onAskShiori?: () => void
}

interface SkillTemplate {
  id: string
  labelKey: string
  nameKey: string
  descriptionKey: string
  contentKey: string
}

const SKILL_TEMPLATES: SkillTemplate[] = [
  {
    id: 'code-review',
    labelKey: 'addSkillDialog.template.codeReview.label',
    nameKey: 'addSkillDialog.template.codeReview.name',
    descriptionKey: 'addSkillDialog.template.codeReview.description',
    contentKey: 'addSkillDialog.template.codeReview.content',
  },
  {
    id: 'writing-style',
    labelKey: 'addSkillDialog.template.writingStyle.label',
    nameKey: 'addSkillDialog.template.writingStyle.name',
    descriptionKey: 'addSkillDialog.template.writingStyle.description',
    contentKey: 'addSkillDialog.template.writingStyle.content',
  },
  {
    id: 'weekly-summary',
    labelKey: 'addSkillDialog.template.weeklySummary.label',
    nameKey: 'addSkillDialog.template.weeklySummary.name',
    descriptionKey: 'addSkillDialog.template.weeklySummary.description',
    contentKey: 'addSkillDialog.template.weeklySummary.content',
  },
]

export function AddSkillDialog({
  open,
  workspaceId,
  onOpenChange,
  onCreated,
  onAskShiori,
}: AddSkillDialogProps) {
  const { t } = useTranslation()

  const [name, setName] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [content, setContent] = React.useState('')
  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const handleClose = React.useCallback(() => {
    if (!isSubmitting) onOpenChange(false)
  }, [isSubmitting, onOpenChange])

  useRegisterModal(open, handleClose)

  React.useEffect(() => {
    if (open) {
      setName('')
      setDescription('')
      setContent('')
      setError(null)
    }
  }, [open])

  const canSubmit = name.trim().length > 0 && description.trim().length > 0

  const handleApplyTemplate = (tpl: SkillTemplate) => {
    setName(t(tpl.nameKey))
    setDescription(t(tpl.descriptionKey))
    setContent(t(tpl.contentKey))
    setError(null)
  }

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!canSubmit || isSubmitting) return

    setError(null)
    setIsSubmitting(true)
    try {
      const created = await window.electronAPI.createSkill(workspaceId, {
        name: name.trim(),
        description: description.trim(),
        content: content.trim(),
      })
      toast.success(t('addSkillDialog.createdToast', { name: created.metadata.name }))
      onCreated?.(created)
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && handleClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('addSkillDialog.title')}</DialogTitle>
          <DialogDescription>{t('addSkillDialog.subtitle')}</DialogDescription>
        </DialogHeader>

        {/* Quick starter templates */}
        <div className="space-y-1.5">
          <div className="text-label-sm text-tertiary">{t('addSkillDialog.quickTemplates')}</div>
          <div className="flex flex-wrap gap-1.5">
            {SKILL_TEMPLATES.map((tpl) => (
              <button
                key={tpl.id}
                type="button"
                onClick={() => handleApplyTemplate(tpl)}
                className="rounded-md border border-default bg-raised px-2.5 py-1 text-label-sm text-secondary transition-colors hover:bg-fill-hover hover:text-foreground"
              >
                {t(tpl.labelKey)}
              </button>
            ))}
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="skill-name">{t('addSkillDialog.nameLabel')}</Label>
            <Input
              id="skill-name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('addSkillDialog.namePlaceholder')}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="skill-description">{t('addSkillDialog.descriptionLabel')}</Label>
            <Input
              id="skill-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('addSkillDialog.descriptionPlaceholder')}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="skill-content">{t('addSkillDialog.contentLabel')}</Label>
            <Textarea
              id="skill-content"
              rows={6}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder={t('addSkillDialog.contentPlaceholder')}
              className="text-sm leading-relaxed"
            />
          </div>

          {error && (
            <div className="rounded-md bg-destructive/10 px-3 py-2 text-label-sm text-destructive">
              {error}
            </div>
          )}

          <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
            {onAskShiori ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="gap-1.5 text-secondary hover:text-foreground"
                onClick={() => {
                  onOpenChange(false)
                  onAskShiori()
                }}
              >
                <Sparkles className="size-3.5" />
                {t('addSkillDialog.askShiori')}
              </Button>
            ) : (
              <div />
            )}

            <div className="flex items-center justify-end gap-2">
              <Button type="button" variant="ghost" onClick={handleClose} disabled={isSubmitting}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" variant="primary" disabled={!canSubmit || isSubmitting}>
                {isSubmitting ? t('common.saving') : t('addSkillDialog.submitButton')}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
