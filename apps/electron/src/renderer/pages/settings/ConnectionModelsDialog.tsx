import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Search,
  Plus,
  Star,
  Trash2,
  ChevronUp,
  SlidersHorizontal,
  RefreshCcw,
  Check,
  Sparkles,
  Image as ImageIcon,
  ArrowUp,
  ArrowDown,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button, IconButton } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { ConnectionIcon } from '@/components/icons/ConnectionIcon'
import { useRegisterModal } from '@/context/ModalContext'
import { cn } from '@/lib/utils'
import {
  ANTHROPIC_MODELS,
  getModelShortName,
  type ModelDefinition,
  type ModelProvider,
} from '@config/models'
import {
  getModelsForProviderType,
  isCompatProvider,
  type LlmConnection,
  type LlmConnectionWithStatus,
} from '@config/llm-connections'

interface ConnectionModelsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  connection: LlmConnectionWithStatus | null
  onSaved: () => Promise<void> | void
}

interface EditableModel extends ModelDefinition {
  _rowKey: string
}

interface CatalogModelItem {
  id: string
  name: string
  contextWindow: number
  supportsThinking: boolean
  description?: string
}

const CONTEXT_PRESETS = [128_000, 200_000, 272_000, 400_000, 1_000_000]

function formatContextWindow(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens <= 0) return '128K'
  if (tokens >= 1_000_000) {
    const millions = tokens / 1_000_000
    return Number.isInteger(millions) ? `${millions}M` : `${millions.toFixed(2).replace(/\.?0+$/, '')}M`
  }
  return `${Math.round(tokens / 1000)}K`
}

function defaultModelProviderForConnection(conn: LlmConnectionWithStatus): ModelProvider {
  if (conn.providerType === 'anthropic') return 'anthropic'
  return 'pi'
}

function normalizeModelIdForConnection(rawId: string, conn: LlmConnectionWithStatus): string {
  const trimmed = rawId.trim()
  if (!trimmed) return ''
  if (conn.providerType === 'pi' && !trimmed.startsWith('pi/')) {
    return `pi/${trimmed}`
  }
  return trimmed
}

function toEditableModels(conn: LlmConnectionWithStatus, nextKey: () => string): EditableModel[] {
  const fallbackProvider = defaultModelProviderForConnection(conn)
  const registryFallback = getModelsForProviderType(conn.providerType, conn.piAuthProvider)
  const registryMap = new Map<string, ModelDefinition>(
    [...ANTHROPIC_MODELS, ...registryFallback].map((m) => [m.id, m]),
  )

  const source = conn.models && conn.models.length > 0 ? conn.models : registryFallback
  const seen = new Set<string>()
  const result: EditableModel[] = []

  for (const item of source) {
    if (typeof item === 'string') {
      const id = item.trim()
      if (!id || seen.has(id)) continue
      seen.add(id)
      const known = registryMap.get(id)
      if (known) {
        result.push({ ...known, _rowKey: nextKey() })
      } else {
        const shortName = getModelShortName(id)
        result.push({
          _rowKey: nextKey(),
          id,
          name: shortName,
          shortName,
          description: '',
          provider: fallbackProvider,
          contextWindow: 128_000,
          supportsThinking: true,
        })
      }
      continue
    }

    const id = item.id?.trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    const known = registryMap.get(id)
    const fallbackName = item.name?.trim() || known?.name || getModelShortName(id)
    result.push({
      _rowKey: nextKey(),
      id,
      name: fallbackName,
      shortName: item.shortName?.trim() || known?.shortName || fallbackName,
      description: item.description ?? known?.description ?? '',
      ...(item.descriptionKey ? { descriptionKey: item.descriptionKey } : {}),
      provider: item.provider ?? known?.provider ?? fallbackProvider,
      contextWindow:
        typeof item.contextWindow === 'number' && item.contextWindow > 0
          ? item.contextWindow
          : (known?.contextWindow ?? 128_000),
      supportsThinking:
        item.supportsThinking !== undefined
          ? item.supportsThinking
          : (known?.supportsThinking ?? true),
      ...(item.supportsImages !== undefined ? { supportsImages: item.supportsImages } : {}),
      ...(item.thinkingAlwaysOn !== undefined ? { thinkingAlwaysOn: item.thinkingAlwaysOn } : {}),
    })
  }

  return result
}

function stripRowKey(model: EditableModel): ModelDefinition {
  const { _rowKey: _ignored, ...rest } = model
  return rest
}

function serializeModelsSnapshot(models: EditableModel[], defaultModel: string): string {
  return JSON.stringify({
    defaultModel,
    models: models.map((m) => ({
      id: m.id,
      name: m.name,
      shortName: m.shortName,
      description: m.description,
      contextWindow: m.contextWindow,
      supportsThinking: m.supportsThinking,
      supportsImages: m.supportsImages,
    })),
  })
}

export function ConnectionModelsDialog({
  open,
  onOpenChange,
  connection,
  onSaved,
}: ConnectionModelsDialogProps) {
  const { t } = useTranslation()
  useRegisterModal(open, () => onOpenChange(false))

  const keySeqRef = useRef(0)
  const nextKey = useCallback(() => {
    keySeqRef.current += 1
    return `model-row-${keySeqRef.current}`
  }, [])

  const [models, setModels] = useState<EditableModel[]>([])
  const [defaultModel, setDefaultModel] = useState('')
  const [initialSnapshot, setInitialSnapshot] = useState('')
  const [expandedRowKey, setExpandedRowKey] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [activeTab, setActiveTab] = useState<'configured' | 'catalog'>('configured')

  const [showAddForm, setShowAddForm] = useState(false)
  const [newModelId, setNewModelId] = useState('')
  const [newModelName, setNewModelName] = useState('')
  const [newContextWindow, setNewContextWindow] = useState('200000')
  const [newSupportsThinking, setNewSupportsThinking] = useState(true)
  const [newSupportsImages, setNewSupportsImages] = useState(true)
  const [addError, setAddError] = useState<string | null>(null)

  const [catalogModels, setCatalogModels] = useState<CatalogModelItem[]>([])
  const [catalogLoading, setCatalogLoading] = useState(false)
  const [catalogSearch, setCatalogSearch] = useState('')
  const [catalogOnlyMissing, setCatalogOnlyMissing] = useState(false)

  const [saving, setSaving] = useState(false)
  const [resetting, setResetting] = useState(false)

  const canBrowseCatalog = useMemo(() => {
    if (!connection) return false
    if (isCompatProvider(connection.providerType)) return false
    return connection.providerType === 'anthropic' || !!connection.piAuthProvider
  }, [connection])

  useEffect(() => {
    if (!open || !connection) return
    const nextModels = toEditableModels(connection, nextKey)
    const resolvedDefault =
      connection.defaultModel && nextModels.some((m) => m.id === connection.defaultModel)
        ? connection.defaultModel
        : (nextModels[0]?.id ?? '')

    setModels(nextModels)
    setDefaultModel(resolvedDefault)
    setInitialSnapshot(serializeModelsSnapshot(nextModels, resolvedDefault))
    setExpandedRowKey(null)
    setSearchQuery('')
    setCatalogSearch('')
    setCatalogOnlyMissing(false)
    setActiveTab('configured')
    setShowAddForm(false)
    setNewModelId('')
    setNewModelName('')
    setNewContextWindow('200000')
    setNewSupportsThinking(true)
    setNewSupportsImages(!isCompatProvider(connection.providerType))
    setAddError(null)
  }, [open, connection, nextKey])

  useEffect(() => {
    if (!open || !connection || !canBrowseCatalog) {
      setCatalogModels([])
      return
    }
    let cancelled = false
    setCatalogLoading(true)

    const loadCatalog = async () => {
      try {
        if (connection.providerType === 'anthropic') {
          if (!cancelled) {
            setCatalogModels(
              ANTHROPIC_MODELS.map((m) => ({
                id: m.id,
                name: m.name,
                contextWindow: m.contextWindow,
                supportsThinking: m.supportsThinking !== false,
                description: m.description,
              })),
            )
          }
          return
        }

        if (connection.piAuthProvider && window.electronAPI?.getPiProviderModels) {
          const result = await window.electronAPI.getPiProviderModels(connection.piAuthProvider)
          if (!cancelled) {
            setCatalogModels(
              (result?.models ?? []).map((m) => ({
                id: m.id,
                name: m.name,
                contextWindow: m.contextWindow,
                supportsThinking: m.reasoning,
              })),
            )
          }
        }
      } catch (err) {
        console.error('Failed to load provider model catalog:', err)
        if (!cancelled) setCatalogModels([])
      } finally {
        if (!cancelled) setCatalogLoading(false)
      }
    }

    void loadCatalog()
    return () => {
      cancelled = true
    }
  }, [open, connection, canBrowseCatalog])

  const isDirty = useMemo(() => {
    if (!open || !connection) return false
    return serializeModelsSnapshot(models, defaultModel) !== initialSnapshot
  }, [open, connection, models, defaultModel, initialSnapshot])

  const configuredIds = useMemo(() => new Set(models.map((m) => m.id)), [models])

  const filteredModels = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    if (!query) return models
    return models.filter(
      (m) =>
        m.id.toLowerCase().includes(query) ||
        m.name.toLowerCase().includes(query) ||
        m.shortName.toLowerCase().includes(query),
    )
  }, [models, searchQuery])

  const filteredCatalog = useMemo(() => {
    const query = catalogSearch.trim().toLowerCase()
    return catalogModels.filter((m) => {
      if (catalogOnlyMissing && configuredIds.has(m.id)) return false
      if (!query) return true
      return m.id.toLowerCase().includes(query) || m.name.toLowerCase().includes(query)
    })
  }, [catalogModels, catalogSearch, catalogOnlyMissing, configuredIds])

  const handleUpdateModel = useCallback(
    (rowKey: string, previousId: string, patch: Partial<ModelDefinition>) => {
      setModels((prev) =>
        prev.map((m) => {
          if (m._rowKey !== rowKey) return m
          const next = { ...m, ...patch }
          if ('description' in patch) {
            delete next.descriptionKey
          }
          return next
        }),
      )
      if (patch.id !== undefined && patch.id !== previousId) {
        setDefaultModel((prevDefault) => (prevDefault === previousId ? patch.id! : prevDefault))
      }
    },
    [],
  )

  const handleRemoveModel = useCallback((rowKey: string, modelId: string) => {
    setModels((prev) => {
      if (prev.length <= 1) return prev
      const next = prev.filter((m) => m._rowKey !== rowKey)
      setDefaultModel((prevDefault) => (prevDefault === modelId ? (next[0]?.id ?? '') : prevDefault))
      return next
    })
    setExpandedRowKey((prev) => (prev === rowKey ? null : prev))
  }, [])

  const handleMoveModel = useCallback((index: number, direction: -1 | 1) => {
    setModels((prev) => {
      const targetIndex = index + direction
      if (targetIndex < 0 || targetIndex >= prev.length) return prev
      const next = [...prev]
      const [moved] = next.splice(index, 1)
      next.splice(targetIndex, 0, moved!)
      return next
    })
  }, [])

  const handleAddCustomModel = useCallback(() => {
    if (!connection) return
    const normalizedId = normalizeModelIdForConnection(newModelId, connection)
    if (!normalizedId) {
      setAddError(t('settings.ai.modelsDialog.modelIdRequired'))
      return
    }
    if (models.some((m) => m.id === normalizedId)) {
      setAddError(t('settings.ai.modelsDialog.modelIdDuplicate'))
      return
    }
    const parsedCtx = Number(newContextWindow.replace(/[,_\s]/g, ''))
    const contextWindow = Number.isFinite(parsedCtx) && parsedCtx >= 1024 ? Math.round(parsedCtx) : 200_000
    const displayName = newModelName.trim() || getModelShortName(normalizedId)
    const rowKey = nextKey()

    const added: EditableModel = {
      _rowKey: rowKey,
      id: normalizedId,
      name: displayName,
      shortName: displayName,
      description: '',
      provider: defaultModelProviderForConnection(connection),
      contextWindow,
      supportsThinking: newSupportsThinking,
      supportsImages: newSupportsImages,
    }

    setModels((prev) => [added, ...prev])
    if (!defaultModel) setDefaultModel(added.id)
    setNewModelId('')
    setNewModelName('')
    setAddError(null)
    setShowAddForm(false)
    setExpandedRowKey(rowKey)
  }, [
    connection,
    newModelId,
    newModelName,
    newContextWindow,
    newSupportsThinking,
    newSupportsImages,
    models,
    defaultModel,
    nextKey,
    t,
  ])

  const handleToggleCatalogModel = useCallback(
    (item: CatalogModelItem) => {
      if (!connection) return
      const existing = models.find((m) => m.id === item.id)
      if (existing) {
        if (models.length <= 1) {
          toast.error(t('settings.ai.modelsDialog.atLeastOneModel'))
          return
        }
        handleRemoveModel(existing._rowKey, existing.id)
        return
      }
      const added: EditableModel = {
        _rowKey: nextKey(),
        id: item.id,
        name: item.name,
        shortName: item.name.length > 20 ? (item.name.split(/[\s-]/).pop() ?? item.name) : item.name,
        description: item.description ?? '',
        provider: defaultModelProviderForConnection(connection),
        contextWindow: item.contextWindow || 128_000,
        supportsThinking: item.supportsThinking,
      }
      setModels((prev) => [...prev, added])
    },
    [connection, models, handleRemoveModel, nextKey, t],
  )

  const handleSave = useCallback(async () => {
    if (!connection || !window.electronAPI) return
    if (models.length === 0) {
      toast.error(t('settings.ai.modelsDialog.atLeastOneModel'))
      return
    }

    const cleanedModels = models.map((m) => {
      const trimmedId = m.id.trim()
      const trimmedName = m.name.trim() || getModelShortName(trimmedId)
      const trimmedShort = m.shortName.trim() || trimmedName
      return stripRowKey({
        ...m,
        id: trimmedId,
        name: trimmedName,
        shortName: trimmedShort,
      })
    })

    const ids = cleanedModels.map((m) => m.id)
    if (ids.some((id) => !id)) {
      toast.error(t('settings.ai.modelsDialog.modelIdRequired'))
      return
    }
    if (new Set(ids).size !== ids.length) {
      toast.error(t('settings.ai.modelsDialog.modelIdDuplicate'))
      return
    }

    setSaving(true)
    try {
      const trimmedDefault = defaultModel.trim()
      const resolvedDefault =
        trimmedDefault && cleanedModels.some((m) => m.id === trimmedDefault)
          ? trimmedDefault
          : cleanedModels[0]!.id

      const { isAuthenticated: _a, authError: _b, isDefault: _c, ...baseConnection } = connection
      const payload: LlmConnection = {
        ...baseConnection,
        models: cleanedModels,
        defaultModel: resolvedDefault,
        modelSelectionMode: 'custom',
      }

      const result = await window.electronAPI.saveLlmConnection(payload)
      if (!result.success) {
        toast.error(t('settings.ai.modelsDialog.saveFailed'), {
          description: result.error,
        })
        return
      }

      await onSaved()
      toast.success(t('settings.ai.modelsDialog.saved'))
      onOpenChange(false)
    } catch (error) {
      toast.error(t('settings.ai.modelsDialog.saveFailed'), {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setSaving(false)
    }
  }, [connection, models, defaultModel, onSaved, onOpenChange, t])

  const handleResetToProviderSync = useCallback(async () => {
    if (!connection || !window.electronAPI) return
    setResetting(true)
    try {
      const { isAuthenticated: _a, authError: _b, isDefault: _c, ...baseConnection } = connection
      const saveResult = await window.electronAPI.saveLlmConnection({
        ...baseConnection,
        modelSelectionMode: 'automaticallySyncedFromProvider',
      })
      if (!saveResult.success) {
        toast.error(t('settings.ai.modelsDialog.resetFailed'), {
          description: saveResult.error,
        })
        return
      }

      if (typeof window.electronAPI.refreshLlmConnectionModels === 'function') {
        await window.electronAPI.refreshLlmConnectionModels(connection.slug)
      }

      await onSaved()
      const refreshed = await window.electronAPI.getLlmConnection(connection.slug)
      if (refreshed) {
        const refreshedWithStatus: LlmConnectionWithStatus = {
          ...connection,
          ...refreshed,
        }
        const nextModels = toEditableModels(refreshedWithStatus, nextKey)
        const nextDefault =
          refreshedWithStatus.defaultModel &&
          nextModels.some((m) => m.id === refreshedWithStatus.defaultModel)
            ? refreshedWithStatus.defaultModel
            : (nextModels[0]?.id ?? '')
        setModels(nextModels)
        setDefaultModel(nextDefault)
        setInitialSnapshot(serializeModelsSnapshot(nextModels, nextDefault))
        setExpandedRowKey(null)
      }
      toast.success(t('settings.ai.modelsDialog.resetSuccess'))
    } catch (error) {
      toast.error(t('settings.ai.modelsDialog.resetFailed'), {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setResetting(false)
    }
  }, [connection, onSaved, nextKey, t])

  if (!connection) return null

  const isCustomMode = connection.modelSelectionMode === 'custom'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[85dvh] w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-[660px]"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader className="shrink-0 border-b border-subtle px-5 pt-5 pb-3.5 text-left">
          <div className="flex items-center gap-2 pr-8">
            <ConnectionIcon connection={connection} size={18} />
            <DialogTitle className="truncate">{connection.name}</DialogTitle>
            <span
              className={cn(
                'inline-flex h-5 shrink-0 items-center rounded-xs px-1.5 text-label-sm font-medium',
                isCustomMode
                  ? 'bg-accent/15 text-accent'
                  : 'bg-fill-hover text-secondary',
              )}
            >
              {isCustomMode
                ? t('settings.ai.modelsDialog.modeCustom')
                : t('settings.ai.modelsDialog.modeAutoSync')}
            </span>
          </div>
          <DialogDescription className="text-label text-secondary">
            {t('settings.ai.modelsDialog.subtitle', { count: models.length })}
          </DialogDescription>
        </DialogHeader>

        <div className="shrink-0 space-y-2.5 border-b border-subtle bg-surface/40 px-5 py-3">
          {canBrowseCatalog && (
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="inline-flex rounded-md bg-fill-hover p-0.5">
                <button
                  type="button"
                  onClick={() => setActiveTab('configured')}
                  className={cn(
                    'rounded-sm px-2.5 py-1 text-label-sm font-medium transition-colors',
                    activeTab === 'configured'
                      ? 'bg-background text-foreground shadow-xs'
                      : 'text-secondary hover:text-foreground',
                  )}
                >
                  {t('settings.ai.modelsDialog.tabConfigured', { count: models.length })}
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('catalog')}
                  className={cn(
                    'rounded-sm px-2.5 py-1 text-label-sm font-medium transition-colors',
                    activeTab === 'catalog'
                      ? 'bg-background text-foreground shadow-xs'
                      : 'text-secondary hover:text-foreground',
                  )}
                >
                  {t('settings.ai.modelsDialog.tabCatalog', { count: catalogModels.length })}
                </button>
              </div>

              <Button
                variant="ghost"
                size="sm"
                onClick={handleResetToProviderSync}
                disabled={resetting || saving}
                className="h-7 gap-1.5 px-2 text-label-sm text-secondary"
              >
                <RefreshCcw className={cn('size-3.5', resetting && 'animate-spin')} />
                <span>{t('settings.ai.modelsDialog.resetToProvider')}</span>
              </Button>
            </div>
          )}

          {activeTab === 'configured' ? (
            <div className="flex items-center gap-2">
              <div className="relative flex-1 min-w-0">
                <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-tertiary" />
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={t('settings.ai.modelsDialog.searchPlaceholder')}
                  className="h-8 pl-8 text-label"
                />
              </div>
              <Button
                variant={showAddForm ? 'secondary' : 'primary'}
                size="sm"
                onClick={() => {
                  setShowAddForm((prev) => !prev)
                  setAddError(null)
                }}
                className="h-8 shrink-0 gap-1"
              >
                <Plus className="size-3.5" />
                <span>{t('settings.ai.modelsDialog.addModel')}</span>
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2 flex-wrap">
              <div className="relative flex-1 min-w-[160px]">
                <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-tertiary" />
                <Input
                  value={catalogSearch}
                  onChange={(e) => setCatalogSearch(e.target.value)}
                  placeholder={t('settings.ai.modelsDialog.searchCatalogPlaceholder')}
                  className="h-8 pl-8 text-label"
                />
              </div>
              <Button
                variant={catalogOnlyMissing ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => setCatalogOnlyMissing((prev) => !prev)}
                className="h-8 shrink-0 text-label-sm"
              >
                {t('settings.ai.modelsDialog.onlyNotAdded')}
              </Button>
            </div>
          )}

          {activeTab === 'configured' && showAddForm && (
            <div className="rounded-lg border border-subtle bg-background p-3 space-y-2.5">
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                <div className="space-y-1">
                  <label className="text-label-sm font-medium text-secondary">
                    {t('settings.ai.modelsDialog.modelId')}
                  </label>
                  <Input
                    value={newModelId}
                    onChange={(e) => {
                      setNewModelId(e.target.value)
                      setAddError(null)
                    }}
                    placeholder={
                      connection.providerType === 'pi'
                        ? 'gpt-6.2-sol'
                        : connection.providerType === 'anthropic'
                          ? 'claude-opus-5-5'
                          : 'provider/model-id'
                    }
                    className="h-8 font-mono text-label-sm"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-label-sm font-medium text-secondary">
                    {t('settings.ai.modelsDialog.displayName')}
                  </label>
                  <Input
                    value={newModelName}
                    onChange={(e) => setNewModelName(e.target.value)}
                    placeholder={t('settings.ai.modelsDialog.displayNamePlaceholder')}
                    className="h-8 text-label"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-label-sm font-medium text-secondary">
                  {t('settings.ai.modelsDialog.contextWindow')}
                </label>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <Input
                    value={newContextWindow}
                    onChange={(e) => setNewContextWindow(e.target.value)}
                    className="h-7 w-28 font-mono text-label-sm"
                    inputMode="numeric"
                  />
                  {CONTEXT_PRESETS.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setNewContextWindow(String(preset))}
                      className={cn(
                        'rounded-sm border px-2 py-0.5 text-label-sm transition-colors',
                        Number(newContextWindow) === preset
                          ? 'border-accent bg-accent/15 text-accent'
                          : 'border-subtle text-secondary hover:bg-fill-hover hover:text-foreground',
                      )}
                    >
                      {formatContextWindow(preset)}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between gap-4 flex-wrap pt-0.5">
                <div className="flex items-center gap-4 flex-wrap">
                  <label className="flex items-center gap-2 text-label-sm text-foreground cursor-pointer">
                    <Switch checked={newSupportsThinking} onCheckedChange={setNewSupportsThinking} />
                    <span>{t('settings.ai.modelsDialog.supportsThinking')}</span>
                  </label>
                  <label className="flex items-center gap-2 text-label-sm text-foreground cursor-pointer">
                    <Switch checked={newSupportsImages} onCheckedChange={setNewSupportsImages} />
                    <span>{t('settings.ai.modelsDialog.supportsImages')}</span>
                  </label>
                </div>

                <div className="flex items-center gap-1.5">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setShowAddForm(false)
                      setAddError(null)
                    }}
                  >
                    {t('common.cancel')}
                  </Button>
                  <Button variant="primary" size="sm" onClick={handleAddCustomModel}>
                    {t('settings.ai.modelsDialog.confirmAdd')}
                  </Button>
                </div>
              </div>

              {addError && <p className="text-label-sm text-destructive">{addError}</p>}
            </div>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
          {activeTab === 'configured' ? (
            filteredModels.length === 0 ? (
              <div className="py-10 text-center text-label text-tertiary">
                {t('settings.ai.modelsDialog.noMatch')}
              </div>
            ) : (
              <div className="divide-y divide-subtle rounded-lg border border-subtle bg-background">
                {filteredModels.map((model) => {
                  const fullIndex = models.findIndex((m) => m._rowKey === model._rowKey)
                  const isDefaultModel = model.id === defaultModel
                  const isExpanded = expandedRowKey === model._rowKey
                  const canReorder = !searchQuery.trim() && models.length > 1

                  return (
                    <div key={model._rowKey} className="transition-colors">
                      <div className="flex items-center justify-between gap-2 px-3 py-2.5">
                        <button
                          type="button"
                          onClick={() => setExpandedRowKey(isExpanded ? null : model._rowKey)}
                          className="min-w-0 flex-1 text-left"
                        >
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="truncate text-label font-medium text-foreground">
                              {model.name || model.id}
                            </span>
                            {isDefaultModel && (
                              <span className="inline-flex h-4.5 items-center rounded-xs bg-accent/15 px-1.5 text-[11px] font-medium text-accent">
                                {t('common.default')}
                              </span>
                            )}
                          </div>
                          <div className="mt-0.5 flex items-center gap-2 flex-wrap text-label-sm text-tertiary">
                            <span className="truncate font-mono text-[11px]" title={model.id}>
                              {model.id}
                            </span>
                            <span>·</span>
                            <span className="tabular-nums">{formatContextWindow(model.contextWindow)}</span>
                            {model.supportsThinking !== false && (
                              <span className="inline-flex items-center gap-0.5 text-secondary">
                                <Sparkles className="size-3" />
                                {t('settings.ai.modelsDialog.badgeThinking')}
                              </span>
                            )}
                            {model.supportsImages === true && (
                              <span className="inline-flex items-center gap-0.5 text-secondary">
                                <ImageIcon className="size-3" />
                                {t('settings.ai.modelsDialog.badgeVision')}
                              </span>
                            )}
                            {model.supportsImages === false && (
                              <span className="text-tertiary">
                                {t('settings.ai.modelsDialog.badgeTextOnly')}
                              </span>
                            )}
                          </div>
                        </button>

                        <div className="flex shrink-0 items-center gap-0.5">
                          <IconButton
                            size="sm"
                            aria-label={t('settings.ai.modelsDialog.setAsDefault')}
                            tooltip
                            onClick={() => setDefaultModel(model.id)}
                            disabled={isDefaultModel}
                            icon={
                              <Star
                                className={cn(
                                  'size-3.5',
                                  isDefaultModel
                                    ? 'fill-accent text-accent'
                                    : 'text-secondary',
                                )}
                              />
                            }
                          />
                          {canReorder && (
                            <>
                              <IconButton
                                size="sm"
                                aria-label={t('settings.ai.modelsDialog.moveUp')}
                                onClick={() => handleMoveModel(fullIndex, -1)}
                                disabled={fullIndex <= 0}
                                icon={<ArrowUp className="size-3.5" />}
                              />
                              <IconButton
                                size="sm"
                                aria-label={t('settings.ai.modelsDialog.moveDown')}
                                onClick={() => handleMoveModel(fullIndex, 1)}
                                disabled={fullIndex >= models.length - 1}
                                icon={<ArrowDown className="size-3.5" />}
                              />
                            </>
                          )}
                          <IconButton
                            size="sm"
                            aria-label={t('settings.ai.modelsDialog.editModel')}
                            tooltip
                            onClick={() => setExpandedRowKey(isExpanded ? null : model._rowKey)}
                            icon={
                              isExpanded ? (
                                <ChevronUp className="size-3.5 text-foreground" />
                              ) : (
                                <SlidersHorizontal className="size-3.5" />
                              )
                            }
                          />
                          <IconButton
                            size="sm"
                            aria-label={t('common.delete')}
                            tooltip
                            onClick={() => handleRemoveModel(model._rowKey, model.id)}
                            disabled={models.length <= 1}
                            icon={<Trash2 className="size-3.5" />}
                          />
                        </div>
                      </div>

                      {isExpanded && (
                        <div className="border-t border-subtle bg-surface/50 px-3.5 py-3 space-y-3">
                          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                            <div className="space-y-1">
                              <label className="text-label-sm font-medium text-secondary">
                                {t('settings.ai.modelsDialog.displayName')}
                              </label>
                              <Input
                                value={model.name}
                                onChange={(e) =>
                                  handleUpdateModel(model._rowKey, model.id, { name: e.target.value })
                                }
                                className="h-8 text-label"
                              />
                            </div>
                            <div className="space-y-1">
                              <label className="text-label-sm font-medium text-secondary">
                                {t('settings.ai.modelsDialog.shortName')}
                              </label>
                              <Input
                                value={model.shortName}
                                onChange={(e) =>
                                  handleUpdateModel(model._rowKey, model.id, { shortName: e.target.value })
                                }
                                className="h-8 text-label"
                              />
                            </div>
                          </div>

                          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                            <div className="space-y-1">
                              <label className="text-label-sm font-medium text-secondary">
                                {t('settings.ai.modelsDialog.modelId')}
                              </label>
                              <Input
                                value={model.id}
                                onChange={(e) =>
                                  handleUpdateModel(model._rowKey, model.id, { id: e.target.value })
                                }
                                className="h-8 font-mono text-label-sm"
                              />
                            </div>
                            <div className="space-y-1">
                              <label className="text-label-sm font-medium text-secondary">
                                {t('settings.ai.modelsDialog.description')}
                              </label>
                              <Input
                                value={model.description}
                                onChange={(e) =>
                                  handleUpdateModel(model._rowKey, model.id, { description: e.target.value })
                                }
                                placeholder={t('settings.ai.modelsDialog.descriptionPlaceholder')}
                                className="h-8 text-label"
                              />
                            </div>
                          </div>

                          <div className="space-y-1">
                            <label className="text-label-sm font-medium text-secondary">
                              {t('settings.ai.modelsDialog.contextWindow')}
                            </label>
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <Input
                                value={String(model.contextWindow)}
                                onChange={(e) => {
                                  const raw = e.target.value.replace(/[^\d]/g, '')
                                  const parsed = Number(raw)
                                  if (Number.isFinite(parsed) && parsed > 0) {
                                    handleUpdateModel(model._rowKey, model.id, { contextWindow: parsed })
                                  }
                                }}
                                className="h-7 w-28 font-mono text-label-sm"
                                inputMode="numeric"
                              />
                              {CONTEXT_PRESETS.map((preset) => (
                                <button
                                  key={preset}
                                  type="button"
                                  onClick={() =>
                                    handleUpdateModel(model._rowKey, model.id, { contextWindow: preset })
                                  }
                                  className={cn(
                                    'rounded-sm border px-2 py-0.5 text-label-sm transition-colors',
                                    model.contextWindow === preset
                                      ? 'border-accent bg-accent/15 text-accent'
                                      : 'border-subtle text-secondary hover:bg-fill-hover hover:text-foreground',
                                  )}
                                >
                                  {formatContextWindow(preset)}
                                </button>
                              ))}
                            </div>
                          </div>

                          <div className="flex items-center gap-6 flex-wrap pt-0.5">
                            <label className="flex items-center gap-2 text-label-sm text-foreground cursor-pointer">
                              <Switch
                                checked={model.supportsThinking !== false}
                                onCheckedChange={(checked) =>
                                  handleUpdateModel(model._rowKey, model.id, { supportsThinking: checked })
                                }
                              />
                              <span>{t('settings.ai.modelsDialog.supportsThinking')}</span>
                            </label>
                            <label className="flex items-center gap-2 text-label-sm text-foreground cursor-pointer">
                              <Switch
                                checked={model.supportsImages !== false}
                                onCheckedChange={(checked) =>
                                  handleUpdateModel(model._rowKey, model.id, { supportsImages: checked })
                                }
                              />
                              <span>{t('settings.ai.modelsDialog.supportsImages')}</span>
                            </label>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )
          ) : catalogLoading ? (
            <div className="py-10 text-center text-label text-tertiary">
              {t('common.loading')}
            </div>
          ) : filteredCatalog.length === 0 ? (
            <div className="py-10 text-center text-label text-tertiary">
              {t('settings.ai.modelsDialog.noMatch')}
            </div>
          ) : (
            <div className="divide-y divide-subtle rounded-lg border border-subtle bg-background">
              {filteredCatalog.map((item) => {
                const isAdded = configuredIds.has(item.id)
                return (
                  <div
                    key={item.id}
                    className="flex items-center justify-between gap-3 px-3 py-2.5"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-label font-medium text-foreground">
                        {item.name}
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 flex-wrap text-label-sm text-tertiary">
                        <span className="truncate font-mono text-[11px]">{item.id}</span>
                        <span>·</span>
                        <span className="tabular-nums">
                          {formatContextWindow(item.contextWindow)}
                        </span>
                        {item.supportsThinking && (
                          <span className="inline-flex items-center gap-0.5 text-secondary">
                            <Sparkles className="size-3" />
                            {t('settings.ai.modelsDialog.badgeThinking')}
                          </span>
                        )}
                      </div>
                    </div>
                    <Button
                      variant={isAdded ? 'secondary' : 'primary'}
                      size="sm"
                      onClick={() => handleToggleCatalogModel(item)}
                      className="h-7 shrink-0 gap-1 px-2.5 text-label-sm"
                    >
                      {isAdded ? (
                        <>
                          <Check className="size-3.5" />
                          <span>{t('settings.ai.modelsDialog.added')}</span>
                        </>
                      ) : (
                        <>
                          <Plus className="size-3.5" />
                          <span>{t('settings.ai.modelsDialog.addToList')}</span>
                        </>
                      )}
                    </Button>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <DialogFooter className="shrink-0 items-center justify-between border-t border-subtle px-5 py-3.5 sm:justify-between">
          <span className="text-label-sm text-tertiary">
            {isDirty
              ? t('settings.ai.modelsDialog.customSaveHint')
              : t('settings.ai.modelsDialog.defaultModelSummary', {
                  model: defaultModel ? getModelShortName(defaultModel) : '—',
                })}
          </span>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="primary"
              onClick={handleSave}
              disabled={!isDirty || saving || models.length === 0}
            >
              {saving ? t('common.saving') : t('common.save')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
