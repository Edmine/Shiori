/**
 * AddSourceDialog — Structured modal for adding an MCP server, REST API, or Local Folder source.
 *
 * Replaces the ambiguous blank EditPopover chat drawer as the primary "+" flow while
 * keeping an explicit "Ask Shiori to set it up" fallback for conversational setup.
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { FolderOpen, Globe, Plug, Sparkles, Terminal, FileJson } from 'lucide-react'
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
import { cn } from '@/lib/utils'
import type { FolderSourceConfig, SourceType } from '@craft-agent/shared/sources'

export interface AddSourceDialogProps {
  open: boolean
  workspaceId: string
  /** Pre-selected source type (e.g., when user is viewing a filtered MCP/API/Local list) */
  initialType?: SourceType
  onOpenChange: (open: boolean) => void
  /** Called after a source is created so parent can refresh/select it */
  onCreated?: (source: FolderSourceConfig) => void
  /** Optional fallback to open the AI-guided EditPopover */
  onAskShiori?: (sourceType: SourceType) => void
}

type McpTransportMode = 'http' | 'sse' | 'stdio'
type McpAuthMode = 'none' | 'oauth' | 'bearer'
type ApiAuthMode = 'none' | 'bearer' | 'header' | 'query'

function parseArgsInput(raw: string): string[] {
  const trimmed = raw.trim()
  if (!trimmed) return []
  // Support quoted strings as well as newline/space separation
  const matches = trimmed.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || []
  return matches.map((token) => token.replace(/^(['"])(.*)\1$/, '$2'))
}

function parseEnvInput(raw: string): Record<string, string> | undefined {
  const env: Record<string, string> = {}
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx <= 0) continue
    const key = trimmed.slice(0, eqIdx).trim()
    const value = trimmed.slice(eqIdx + 1).trim().replace(/^(['"])(.*)\1$/, '$2')
    if (key) env[key] = value
  }
  return Object.keys(env).length > 0 ? env : undefined
}

function deriveProviderFromUrl(url: string): string {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '')
    const parts = hostname.split('.')
    return parts.length >= 2 ? parts[parts.length - 2] : hostname
  } catch {
    return 'custom'
  }
}

export function AddSourceDialog({
  open,
  workspaceId,
  initialType = 'mcp',
  onOpenChange,
  onCreated,
  onAskShiori,
}: AddSourceDialogProps) {
  const { t } = useTranslation()

  const [sourceType, setSourceType] = React.useState<SourceType>(initialType)
  const [name, setName] = React.useState('')

  // MCP state
  const [mcpTransport, setMcpTransport] = React.useState<McpTransportMode>('http')
  const [mcpUrl, setMcpUrl] = React.useState('')
  const [mcpAuth, setMcpAuth] = React.useState<McpAuthMode>('none')
  const [mcpToken, setMcpToken] = React.useState('')
  const [mcpCommand, setMcpCommand] = React.useState('')
  const [mcpArgs, setMcpArgs] = React.useState('')
  const [mcpEnv, setMcpEnv] = React.useState('')
  const [showJsonImport, setShowJsonImport] = React.useState(false)
  const [jsonInput, setJsonInput] = React.useState('')

  // REST API state
  const [apiBaseUrl, setApiBaseUrl] = React.useState('')
  const [apiAuth, setApiAuth] = React.useState<ApiAuthMode>('bearer')
  const [apiHeaderName, setApiHeaderName] = React.useState('X-API-Key')
  const [apiQueryParam, setApiQueryParam] = React.useState('api_key')
  const [apiCredential, setApiCredential] = React.useState('')

  // Local folder state
  const [localPath, setLocalPath] = React.useState('')

  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const handleClose = React.useCallback(() => {
    if (!isSubmitting) onOpenChange(false)
  }, [isSubmitting, onOpenChange])

  useRegisterModal(open, handleClose)

  // Reset form when dialog opens
  React.useEffect(() => {
    if (open) {
      setSourceType(initialType)
      setName('')
      setMcpTransport('http')
      setMcpUrl('')
      setMcpAuth('none')
      setMcpToken('')
      setMcpCommand('')
      setMcpArgs('')
      setMcpEnv('')
      setShowJsonImport(false)
      setJsonInput('')
      setApiBaseUrl('')
      setApiAuth('bearer')
      setApiHeaderName('X-API-Key')
      setApiQueryParam('api_key')
      setApiCredential('')
      setLocalPath('')
      setError(null)
    }
  }, [open, initialType])

  const handleApplyJson = () => {
    setError(null)
    try {
      const parsed = JSON.parse(jsonInput.trim())
      let serverName = ''
      let serverCfg = parsed

      // Support standard Claude/Cursor { "mcpServers": { "my-server": { ... } } }
      if (parsed && typeof parsed === 'object' && parsed.mcpServers && typeof parsed.mcpServers === 'object') {
        const entries = Object.entries(parsed.mcpServers)
        if (entries.length === 0) {
          throw new Error(t('addSourceDialog.jsonEmptyServers'))
        }
        const [firstKey, firstVal] = entries[0]
        serverName = firstKey
        serverCfg = firstVal
      } else if (
        parsed &&
        typeof parsed === 'object' &&
        !parsed.url &&
        !parsed.command &&
        Object.keys(parsed).length === 1
      ) {
        // Support { "my-server": { "command": ... } }
        const [firstKey, firstVal] = Object.entries(parsed)[0]
        if (firstVal && typeof firstVal === 'object') {
          serverName = firstKey
          serverCfg = firstVal
        }
      }

      if (!serverCfg || typeof serverCfg !== 'object') {
        throw new Error(t('addSourceDialog.jsonInvalid'))
      }

      if (serverName && !name.trim()) {
        setName(serverName)
      }

      if (typeof serverCfg.url === 'string' && serverCfg.url.trim()) {
        setMcpTransport(serverCfg.transport === 'sse' || serverCfg.type === 'sse' ? 'sse' : 'http')
        setMcpUrl(serverCfg.url.trim())
      } else if (typeof serverCfg.command === 'string' && serverCfg.command.trim()) {
        setMcpTransport('stdio')
        setMcpCommand(serverCfg.command.trim())
        if (Array.isArray(serverCfg.args)) {
          setMcpArgs(serverCfg.args.map((a: unknown) => (String(a).includes(' ') ? `"${a}"` : String(a))).join(' '))
        }
        if (serverCfg.env && typeof serverCfg.env === 'object') {
          setMcpEnv(
            Object.entries(serverCfg.env)
              .map(([k, v]) => `${k}=${v}`)
              .join('\n')
          )
        }
      } else {
        throw new Error(t('addSourceDialog.jsonMissingEndpoint'))
      }

      setShowJsonImport(false)
      setJsonInput('')
      toast.success(t('addSourceDialog.jsonApplied'))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('addSourceDialog.jsonInvalid'))
    }
  }

  const handleBrowseFolder = async () => {
    try {
      const selected = await window.electronAPI.openFolderDialog()
      if (selected) {
        setLocalPath(selected)
        if (!name.trim()) {
          const base = selected.split(/[\\/]/).filter(Boolean).pop()
          if (base) setName(base)
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const canSubmit = React.useMemo(() => {
    if (!name.trim()) return false
    if (sourceType === 'mcp') {
      if (mcpTransport === 'stdio') return mcpCommand.trim().length > 0
      return mcpUrl.trim().length > 0
    }
    if (sourceType === 'api') {
      return apiBaseUrl.trim().length > 0
    }
    return localPath.trim().length > 0
  }, [name, sourceType, mcpTransport, mcpCommand, mcpUrl, apiBaseUrl, localPath])

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!canSubmit || isSubmitting) return

    setError(null)
    setIsSubmitting(true)
    try {
      let config: Partial<FolderSourceConfig>
      let credentialToSave: string | null = null

      if (sourceType === 'mcp') {
        if (mcpTransport === 'stdio') {
          const args = parseArgsInput(mcpArgs)
          const env = parseEnvInput(mcpEnv)
          config = {
            name: name.trim(),
            type: 'mcp',
            provider: 'custom',
            enabled: true,
            mcp: {
              transport: 'stdio',
              command: mcpCommand.trim(),
              ...(args.length > 0 ? { args } : {}),
              ...(env ? { env } : {}),
            },
          }
        } else {
          const cleanUrl = mcpUrl.trim()
          config = {
            name: name.trim(),
            type: 'mcp',
            provider: deriveProviderFromUrl(cleanUrl),
            enabled: true,
            mcp: {
              transport: mcpTransport,
              url: cleanUrl,
              authType: mcpAuth,
            },
          }
          if (mcpAuth === 'bearer' && mcpToken.trim()) {
            credentialToSave = mcpToken.trim()
          }
        }
      } else if (sourceType === 'api') {
        const cleanUrl = apiBaseUrl.trim()
        config = {
          name: name.trim(),
          type: 'api',
          provider: deriveProviderFromUrl(cleanUrl),
          enabled: true,
          api: {
            baseUrl: cleanUrl,
            authType: apiAuth,
            ...(apiAuth === 'header' && apiHeaderName.trim() ? { headerName: apiHeaderName.trim() } : {}),
            ...(apiAuth === 'query' && apiQueryParam.trim() ? { queryParam: apiQueryParam.trim() } : {}),
          },
        }
        if (apiAuth !== 'none' && apiCredential.trim()) {
          credentialToSave = apiCredential.trim()
        }
      } else {
        config = {
          name: name.trim(),
          type: 'local',
          provider: 'filesystem',
          enabled: true,
          local: {
            path: localPath.trim(),
            format: 'filesystem',
          },
        }
      }

      const created = await window.electronAPI.createSource(workspaceId, config)

      if (credentialToSave && created.slug) {
        try {
          await window.electronAPI.saveSourceCredentials(workspaceId, created.slug, credentialToSave)
        } catch (credErr) {
          console.error('[AddSourceDialog] Failed to save credentials:', credErr)
        }
      }

      toast.success(t('addSourceDialog.createdToast', { name: created.name }))
      onCreated?.(created)
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsSubmitting(false)
    }
  }

  const typeTabs: Array<{ id: SourceType; label: string; icon: React.ReactNode }> = [
    { id: 'mcp', label: t('addSourceDialog.tabMcp'), icon: <Plug className="size-3.5" /> },
    { id: 'api', label: t('addSourceDialog.tabApi'), icon: <Globe className="size-3.5" /> },
    { id: 'local', label: t('addSourceDialog.tabLocal'), icon: <FolderOpen className="size-3.5" /> },
  ]

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && handleClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('addSourceDialog.title')}</DialogTitle>
          <DialogDescription>{t('addSourceDialog.subtitle')}</DialogDescription>
        </DialogHeader>

        {/* Source Type Segmented Control */}
        <div className="grid grid-cols-3 gap-1 rounded-lg bg-fill-hover/70 p-1">
          {typeTabs.map((tab) => {
            const active = sourceType === tab.id
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  setSourceType(tab.id)
                  setError(null)
                }}
                className={cn(
                  'flex items-center justify-center gap-1.5 rounded-md px-2.5 py-1.5 text-label font-medium transition-colors',
                  active
                    ? 'bg-raised text-foreground shadow-sm'
                    : 'text-secondary hover:text-foreground',
                )}
              >
                {tab.icon}
                <span>{tab.label}</span>
              </button>
            )
          })}
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Common Name Field */}
          <div className="space-y-1.5">
            <Label htmlFor="source-name">{t('addSourceDialog.nameLabel')}</Label>
            <Input
              id="source-name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={
                sourceType === 'mcp'
                  ? t('addSourceDialog.namePlaceholderMcp')
                  : sourceType === 'api'
                    ? t('addSourceDialog.namePlaceholderApi')
                    : t('addSourceDialog.namePlaceholderLocal')
              }
            />
          </div>

          {/* MCP Specific Fields */}
          {sourceType === 'mcp' && (
            <div className="space-y-3.5">
              <div className="flex items-center justify-between gap-2">
                <div className="inline-flex rounded-md border border-default p-0.5 text-label-sm">
                  <button
                    type="button"
                    onClick={() => setMcpTransport('http')}
                    className={cn(
                      'inline-flex items-center gap-1 rounded px-2.5 py-1 transition-colors',
                      mcpTransport !== 'stdio'
                        ? 'bg-fill-selected font-medium text-foreground'
                        : 'text-secondary hover:text-foreground',
                    )}
                  >
                    <Globe className="size-3" />
                    {t('addSourceDialog.mcpRemote')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setMcpTransport('stdio')}
                    className={cn(
                      'inline-flex items-center gap-1 rounded px-2.5 py-1 transition-colors',
                      mcpTransport === 'stdio'
                        ? 'bg-fill-selected font-medium text-foreground'
                        : 'text-secondary hover:text-foreground',
                    )}
                  >
                    <Terminal className="size-3" />
                    {t('addSourceDialog.mcpLocalStdio')}
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => setShowJsonImport((v) => !v)}
                  className="inline-flex items-center gap-1 text-label-sm text-secondary hover:text-foreground transition-colors"
                >
                  <FileJson className="size-3.5" />
                  {showJsonImport ? t('addSourceDialog.hideJson') : t('addSourceDialog.pasteJson')}
                </button>
              </div>

              {showJsonImport && (
                <div className="space-y-2 rounded-lg border border-default bg-fill-hover/40 p-3">
                  <Label htmlFor="mcp-json" className="text-label-sm text-secondary">
                    {t('addSourceDialog.jsonLabel')}
                  </Label>
                  <Textarea
                    id="mcp-json"
                    rows={4}
                    value={jsonInput}
                    onChange={(e) => setJsonInput(e.target.value)}
                    placeholder={'{\n  "mcpServers": {\n    "filesystem": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "."] }\n  }\n}'}
                    className="font-mono text-xs"
                  />
                  <div className="flex justify-end">
                    <Button type="button" size="sm" variant="secondary" onClick={handleApplyJson} disabled={!jsonInput.trim()}>
                      {t('addSourceDialog.parseJsonButton')}
                    </Button>
                  </div>
                </div>
              )}

              {mcpTransport !== 'stdio' ? (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="mcp-url">{t('addSourceDialog.mcpUrlLabel')}</Label>
                    <Input
                      id="mcp-url"
                      value={mcpUrl}
                      onChange={(e) => setMcpUrl(e.target.value)}
                      placeholder="https://mcp.example.com/sse"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label>{t('addSourceDialog.transportLabel')}</Label>
                      <div className="grid grid-cols-2 gap-1 rounded-md border border-default p-0.5 text-label-sm">
                        {(['http', 'sse'] as const).map((mode) => (
                          <button
                            key={mode}
                            type="button"
                            onClick={() => setMcpTransport(mode)}
                            className={cn(
                              'rounded py-1 uppercase transition-colors',
                              mcpTransport === mode
                                ? 'bg-fill-selected font-medium text-foreground'
                                : 'text-secondary hover:text-foreground',
                            )}
                          >
                            {mode}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <Label>{t('addSourceDialog.authLabel')}</Label>
                      <div className="grid grid-cols-3 gap-1 rounded-md border border-default p-0.5 text-label-sm">
                        {([
                          ['none', t('addSourceDialog.authNone')],
                          ['oauth', 'OAuth'],
                          ['bearer', 'Token'],
                        ] as const).map(([mode, label]) => (
                          <button
                            key={mode}
                            type="button"
                            onClick={() => setMcpAuth(mode)}
                            className={cn(
                              'rounded py-1 transition-colors',
                              mcpAuth === mode
                                ? 'bg-fill-selected font-medium text-foreground'
                                : 'text-secondary hover:text-foreground',
                            )}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {mcpAuth === 'bearer' && (
                    <div className="space-y-1.5">
                      <Label htmlFor="mcp-token">{t('addSourceDialog.tokenLabel')}</Label>
                      <Input
                        id="mcp-token"
                        type="password"
                        value={mcpToken}
                        onChange={(e) => setMcpToken(e.target.value)}
                        placeholder={t('addSourceDialog.tokenOptionalPlaceholder')}
                      />
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="mcp-command">{t('addSourceDialog.commandLabel')}</Label>
                    <Input
                      id="mcp-command"
                      value={mcpCommand}
                      onChange={(e) => setMcpCommand(e.target.value)}
                      placeholder="npx"
                      className="font-mono text-xs"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="mcp-args">{t('addSourceDialog.argsLabel')}</Label>
                    <Input
                      id="mcp-args"
                      value={mcpArgs}
                      onChange={(e) => setMcpArgs(e.target.value)}
                      placeholder="-y @modelcontextprotocol/server-memory"
                      className="font-mono text-xs"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="mcp-env">{t('addSourceDialog.envLabel')}</Label>
                    <Textarea
                      id="mcp-env"
                      rows={2}
                      value={mcpEnv}
                      onChange={(e) => setMcpEnv(e.target.value)}
                      placeholder="API_KEY=your_key"
                      className="font-mono text-xs"
                    />
                  </div>
                </>
              )}
            </div>
          )}

          {/* REST API Specific Fields */}
          {sourceType === 'api' && (
            <div className="space-y-3.5">
              <div className="space-y-1.5">
                <Label htmlFor="api-base-url">{t('addSourceDialog.apiBaseUrlLabel')}</Label>
                <Input
                  id="api-base-url"
                  value={apiBaseUrl}
                  onChange={(e) => setApiBaseUrl(e.target.value)}
                  placeholder="https://api.example.com/v1"
                />
              </div>

              <div className="space-y-1.5">
                <Label>{t('addSourceDialog.authLabel')}</Label>
                <div className="grid grid-cols-4 gap-1 rounded-md border border-default p-0.5 text-label-sm">
                  {([
                    ['none', t('addSourceDialog.authNone')],
                    ['bearer', 'Bearer'],
                    ['header', 'Header'],
                    ['query', 'Query'],
                  ] as const).map(([mode, label]) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setApiAuth(mode)}
                      className={cn(
                        'rounded py-1 transition-colors',
                        apiAuth === mode
                          ? 'bg-fill-selected font-medium text-foreground'
                          : 'text-secondary hover:text-foreground',
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {apiAuth === 'header' && (
                <div className="space-y-1.5">
                  <Label htmlFor="api-header-name">{t('addSourceDialog.headerNameLabel')}</Label>
                  <Input
                    id="api-header-name"
                    value={apiHeaderName}
                    onChange={(e) => setApiHeaderName(e.target.value)}
                    placeholder="X-API-Key"
                  />
                </div>
              )}

              {apiAuth === 'query' && (
                <div className="space-y-1.5">
                  <Label htmlFor="api-query-param">{t('addSourceDialog.queryParamLabel')}</Label>
                  <Input
                    id="api-query-param"
                    value={apiQueryParam}
                    onChange={(e) => setApiQueryParam(e.target.value)}
                    placeholder="api_key"
                  />
                </div>
              )}

              {apiAuth !== 'none' && (
                <div className="space-y-1.5">
                  <Label htmlFor="api-credential">{t('addSourceDialog.apiKeyLabel')}</Label>
                  <Input
                    id="api-credential"
                    type="password"
                    value={apiCredential}
                    onChange={(e) => setApiCredential(e.target.value)}
                    placeholder={t('addSourceDialog.tokenOptionalPlaceholder')}
                  />
                </div>
              )}
            </div>
          )}

          {/* Local Folder Specific Fields */}
          {sourceType === 'local' && (
            <div className="space-y-1.5">
              <Label htmlFor="local-path">{t('addSourceDialog.localPathLabel')}</Label>
              <div className="flex gap-2">
                <Input
                  id="local-path"
                  value={localPath}
                  onChange={(e) => setLocalPath(e.target.value)}
                  placeholder={t('addSourceDialog.localPathPlaceholder')}
                  className="flex-1 font-mono text-xs"
                />
                <Button type="button" variant="secondary" onClick={handleBrowseFolder}>
                  {t('addSourceDialog.browseFolder')}
                </Button>
              </div>
            </div>
          )}

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
                  onAskShiori(sourceType)
                }}
              >
                <Sparkles className="size-3.5" />
                {t('addSourceDialog.askShiori')}
              </Button>
            ) : (
              <div />
            )}

            <div className="flex items-center justify-end gap-2">
              <Button type="button" variant="ghost" onClick={handleClose} disabled={isSubmitting}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" variant="primary" disabled={!canSubmit || isSubmitting}>
                {isSubmitting ? t('common.saving') : t('addSourceDialog.submitButton')}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
