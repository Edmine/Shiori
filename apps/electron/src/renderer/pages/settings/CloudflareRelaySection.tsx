/**
 * CloudflareRelaySection
 *
 * Visual 1-click Cloudflare Workers Relay setup & control panel.
 * Deploys a free-tier-safe, end-to-end encrypted relay to the user's own Cloudflare
 * account with hard daily request and client-count safeguards.
 */

import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Cloud,
  ShieldCheck,
  Copy,
  ExternalLink,
  RefreshCw,
  KeyRound,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  AlertTriangle,
  Trash2,
  Lock,
  Smartphone,
  ClipboardPaste,
  Circle,
} from 'lucide-react'
import { toast } from 'sonner'
import { QRCodeSVG } from 'qrcode.react'
import { Button, IconButton } from '@/components/ui/button'
import { Spinner } from '@craft-agent/ui'
import { cn } from '@/lib/utils'
import {
  DEFAULT_RELAY_CONFIG,
  type CloudflareAccountInfo,
  type RelayConfig,
  type RelayStatus,
} from '@craft-agent/shared/config/server-config'
import {
  SettingsSection,
  SettingsCard,
  SettingsToggle,
  SettingsRow,
  SettingsInputRow,
} from '@/components/settings'

// Official Cloudflare API Token template with least-privilege permissions
// (Workers Scripts: Edit + Account Settings: Read).
const CF_PREFILLED_TOKEN_URL =
  'https://dash.cloudflare.com/profile/api-tokens?' +
  `permissionGroupKeys=${encodeURIComponent(
    JSON.stringify([
      { key: 'workers_scripts', type: 'edit' },
      { key: 'account_settings', type: 'read' },
    ]),
  )}` +
  '&accountId=*' +
  '&zoneId=all' +
  `&name=${encodeURIComponent('Shiori Relay')}`

type DeployStage = 'idle' | 'verifying' | 'select-account' | 'deploying' | 'connecting' | 'done'

interface CloudflareRelaySectionProps {
  initialRelayConfig?: RelayConfig
  onRelayConfigUpdated?: (relay: RelayConfig) => void
}

function statusBadgeMeta(status: RelayStatus | null, isZh: boolean): {
  label: string
  dotClass: string
  textClass: string
} {
  if (!status || !status.enabled || status.state === 'disabled') {
    return {
      label: isZh ? '未开启' : 'Off',
      dotClass: 'bg-foreground/30',
      textClass: 'text-tertiary',
    }
  }
  if (status.state === 'connected') {
    const online = isZh ? '已在线' : 'Connected'
    return {
      label: status.latencyMs ? `${online} · ${status.latencyMs}ms` : online,
      dotClass: 'bg-emerald-500',
      textClass: 'text-emerald-600 dark:text-emerald-400',
    }
  }
  if (status.state === 'connecting' || status.state === 'reconnecting') {
    return {
      label: status.reconnectAttempt
        ? (isZh ? `重连中（第 ${status.reconnectAttempt} 次）` : `Reconnecting (#${status.reconnectAttempt})`)
        : (isZh ? '正在连接...' : 'Connecting...'),
      dotClass: 'bg-amber-500 animate-pulse',
      textClass: 'text-amber-600 dark:text-amber-400',
    }
  }
  return {
    label: isZh ? '连接异常' : 'Error',
    dotClass: 'bg-destructive',
    textClass: 'text-destructive',
  }
}

export function CloudflareRelaySection({
  initialRelayConfig,
  onRelayConfigUpdated,
}: CloudflareRelaySectionProps) {
  const { i18n } = useTranslation()
  const isZh = (i18n.language || '').toLowerCase().startsWith('zh')
  const tr = useCallback((en: string, zh: string) => (isZh ? zh : en), [isZh])

  const [relayConfig, setRelayConfig] = useState<RelayConfig>({
    ...DEFAULT_RELAY_CONFIG,
    ...(initialRelayConfig ?? {}),
  })
  const [status, setStatus] = useState<RelayStatus | null>(null)
  const [isToggling, setIsToggling] = useState(false)
  const [isRotating, setIsRotating] = useState(false)
  const [embedTokenInQr, setEmbedTokenInQr] = useState(true)

  // Visual 1-click deploy wizard state (API token is ephemeral — never persisted)
  const [showWizard, setShowWizard] = useState(!initialRelayConfig?.relayUrl)
  const [apiToken, setApiToken] = useState('')
  const [manualAccountId, setManualAccountId] = useState('')
  const [needsManualAccountId, setNeedsManualAccountId] = useState(false)
  const [accounts, setAccounts] = useState<CloudflareAccountInfo[]>([])
  const [selectedAccountId, setSelectedAccountId] = useState('')
  const [scriptName, setScriptName] = useState(initialRelayConfig?.cloudflare?.scriptName || 'shiori-relay')
  const [desiredSubdomain, setDesiredSubdomain] = useState('')
  const [dailyCapInput, setDailyCapInput] = useState(String(initialRelayConfig?.dailyRequestCap ?? 80_000))
  const [maxClientsInput, setMaxClientsInput] = useState(String(initialRelayConfig?.maxClients ?? 4))
  const [deployStage, setDeployStage] = useState<DeployStage>('idle')
  const [wizardError, setWizardError] = useState<string | null>(null)

  // Advanced manual form + 1-click delete state
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [showDeletePanel, setShowDeletePanel] = useState(false)
  const [deleteToken, setDeleteToken] = useState('')
  const [isDeleting, setIsDeleting] = useState(false)
  const [isSavingAdvanced, setIsSavingAdvanced] = useState(false)
  const [manualUrl, setManualUrl] = useState(initialRelayConfig?.relayUrl || '')
  const [manualSecret, setManualSecret] = useState(initialRelayConfig?.relaySecret || '')
  const [manualGateKey, setManualGateKey] = useState(initialRelayConfig?.gateKey || '')

  useEffect(() => {
    if (!initialRelayConfig) return
    const merged = { ...DEFAULT_RELAY_CONFIG, ...initialRelayConfig }
    setRelayConfig(merged)
    setManualUrl(merged.relayUrl || '')
    setManualSecret(merged.relaySecret || '')
    setManualGateKey(merged.gateKey || '')
    setDailyCapInput(String(merged.dailyRequestCap ?? 80_000))
    setMaxClientsInput(String(merged.maxClients ?? 4))
    if (merged.cloudflare?.scriptName) setScriptName(merged.cloudflare.scriptName)
    if (merged.relayUrl) setShowWizard(false)
  }, [initialRelayConfig])

  const refreshStatus = useCallback(async () => {
    if (typeof window.electronAPI.getRelayStatus !== 'function') return
    try {
      const next = await window.electronAPI.getRelayStatus()
      setStatus(next)
    } catch {
      // Non-fatal in client-only / webui contexts
    }
  }, [])

  useEffect(() => {
    void refreshStatus()
  }, [refreshStatus])

  // Poll live status while relay is enabled so latency, online state, and daily requests stay fresh
  useEffect(() => {
    if (!relayConfig.enabled && status?.state !== 'connecting' && status?.state !== 'reconnecting') {
      return
    }
    const timer = setInterval(() => {
      void refreshStatus()
    }, 3_000)
    return () => clearInterval(timer)
  }, [relayConfig.enabled, status?.state, refreshStatus])

  const handleCopy = (text: string, label: string) => {
    navigator.clipboard.writeText(text)
    toast.success(isZh ? `已复制${label}` : `Copied ${label}`)
  }

  const handleToggleEnabled = async (enabled: boolean) => {
    if (enabled && (!relayConfig.relayUrl || !relayConfig.relaySecret)) {
      setShowWizard(true)
      toast.info(tr('Deploy a Cloudflare Worker or configure a relay URL first.', '请先部署 Cloudflare Worker 或在高级设置中填写中继地址'))
      return
    }
    setIsToggling(true)
    try {
      const updated: RelayConfig = { ...relayConfig, enabled }
      const nextStatus = await window.electronAPI.setRelayConfig(updated)
      setRelayConfig(updated)
      setStatus(nextStatus)
      onRelayConfigUpdated?.(updated)
      toast.success(
        enabled
          ? tr('Cloudflare Relay enabled', '远程中继已开启')
          : tr('Cloudflare Relay disconnected', '远程中继已断开'),
      )
    } catch (err) {
      toast.error(
        `${tr('Failed to update relay: ', '切换中继失败：')}${err instanceof Error ? err.message : String(err)}`,
      )
    } finally {
      setIsToggling(false)
    }
  }

  const isBusy = deployStage === 'verifying' || deployStage === 'deploying' || deployStage === 'connecting'

  const executeDeployForAccount = async (
    token: string,
    account: CloudflareAccountInfo,
    explicitSubdomain?: string,
  ) => {
    const cap = Math.min(Math.max(parseInt(dailyCapInput, 10) || 80_000, 1_000), 95_000)
    const maxClients = Math.min(Math.max(parseInt(maxClientsInput, 10) || 4, 1), 16)
    const autoSubdomain = account.subdomain
      ? undefined
      : (explicitSubdomain?.trim() || desiredSubdomain.trim() || `shiori-${account.id.slice(0, 6).toLowerCase()}`)

    setDeployStage('deploying')
    try {
      const { deploy, status: nextStatus } = await window.electronAPI.cfDeployRelay({
        apiToken: token,
        accountId: account.id,
        accountName: account.name,
        scriptName: scriptName.trim() || 'shiori-relay',
        desiredSubdomain: autoSubdomain,
        dailyRequestCap: cap,
        maxClients,
      })

      setDeployStage('connecting')
      const nextConfig: RelayConfig = {
        enabled: true,
        relayUrl: deploy.relayUrl,
        relaySecret: deploy.relaySecret,
        gateKey: deploy.gateKey,
        e2eEnabled: true,
        e2eKey: deploy.e2eKey,
        maxClients,
        dailyRequestCap: cap,
        cloudflare: {
          accountId: deploy.accountId,
          accountName: deploy.accountName,
          scriptName: deploy.scriptName,
          subdomain: deploy.subdomain,
          deployedAt: deploy.deployedAt,
        },
      }
      setRelayConfig(nextConfig)
      setManualUrl(deploy.relayUrl)
      setManualSecret(deploy.relaySecret)
      setManualGateKey(deploy.gateKey)
      setStatus(nextStatus)
      onRelayConfigUpdated?.(nextConfig)
      // Wipe ephemeral API Token from memory immediately after deployment
      setApiToken('')
      setAccounts([])
      setSelectedAccountId('')
      setDeployStage('done')
      setShowWizard(false)
      toast.success(
        deploy.healthOk
          ? tr('Cloudflare Relay deployed and connected.', 'Cloudflare 中继部署成功，隧道已在线')
          : tr('Relay deployed. Waiting for edge propagation...', '中继已部署，正在等待边缘节点生效...'),
      )
    } catch (err) {
      setWizardError(err instanceof Error ? err.message : String(err))
      setDeployStage(accounts.length > 1 ? 'select-account' : 'idle')
    }
  }

  const runSmartAutoDeploy = async (rawToken: string) => {
    const token = rawToken.trim()
    setWizardError(null)
    if (!token) {
      setWizardError(tr('Paste a Cloudflare API token first.', '请先粘贴 Cloudflare API Token'))
      return
    }

    setDeployStage('verifying')
    try {
      const res = await window.electronAPI.cfVerifyToken({
        apiToken: token,
        manualAccountId: manualAccountId.trim() || undefined,
        scriptName: scriptName.trim() || 'shiori-relay',
      })
      if (!res.ok) {
        setNeedsManualAccountId(Boolean(res.needsManualAccountId))
        setAccounts([])
        setSelectedAccountId('')
        setDeployStage('idle')
        setWizardError(res.error || tr('Token verification failed. Check the token permissions and try again.', 'Token 验证失败，请检查权限后重试'))
        return
      }

      setNeedsManualAccountId(false)
      setAccounts(res.accounts)

      if (res.accounts.length === 1) {
        const onlyAccount = res.accounts[0]!
        setSelectedAccountId(onlyAccount.id)
        await executeDeployForAccount(token, onlyAccount)
        return
      }

      const first = res.accounts[0]!
      setSelectedAccountId(first.id)
      if (!first.subdomain && !desiredSubdomain) {
        setDesiredSubdomain(`shiori-${first.id.slice(0, 6).toLowerCase()}`)
      }
      setDeployStage('select-account')
    } catch (err) {
      setWizardError(err instanceof Error ? err.message : String(err))
      setDeployStage('idle')
    }
  }

  const handlePasteAndDeploy = async () => {
    setWizardError(null)
    try {
      const clip = (await navigator.clipboard.readText()).trim()
      if (!clip) {
        setWizardError(tr('Clipboard is empty.', '剪贴板为空'))
        return
      }
      setApiToken(clip)
      await runSmartAutoDeploy(clip)
    } catch {
      setWizardError(tr('Could not read clipboard. Paste the token into the input field instead.', '无法读取剪贴板，请直接粘贴到输入框'))
    }
  }

  const selectedAccount = accounts.find((a) => a.id === selectedAccountId)

  const handleConfirmSelectedAccountDeploy = async () => {
    if (!selectedAccount) return
    await executeDeployForAccount(apiToken.trim(), selectedAccount)
  }

  const handleRotateE2eKey = async () => {
    setIsRotating(true)
    try {
      const nextStatus = await window.electronAPI.rotateRelayKeys()
      setStatus(nextStatus)
      toast.success(tr('Encryption key rotated. Re-scan QR on paired devices.', '加密密钥已重置，已配对设备需重新扫码'))
    } catch (err) {
      toast.error(
        `${tr('Failed to rotate key: ', '重置密钥失败：')}${err instanceof Error ? err.message : String(err)}`,
      )
    } finally {
      setIsRotating(false)
    }
  }

  const handleSaveAdvanced = async () => {
    setIsSavingAdvanced(true)
    try {
      const cap = Math.min(Math.max(parseInt(dailyCapInput, 10) || 80_000, 1_000), 95_000)
      const maxClients = Math.min(Math.max(parseInt(maxClientsInput, 10) || 4, 1), 16)
      const updated: RelayConfig = {
        ...relayConfig,
        relayUrl: manualUrl.trim().replace(/\/+$/, ''),
        relaySecret: manualSecret.trim(),
        gateKey: manualGateKey.trim(),
        dailyRequestCap: cap,
        maxClients,
      }
      const nextStatus = await window.electronAPI.setRelayConfig(updated)
      setRelayConfig(updated)
      setStatus(nextStatus)
      onRelayConfigUpdated?.(updated)
      toast.success(tr('Relay settings applied.', '中继配置已生效'))
    } catch (err) {
      toast.error(`${tr('Save failed: ', '保存失败：')}${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setIsSavingAdvanced(false)
    }
  }

  const handleDeleteWorker = async () => {
    const accountId = relayConfig.cloudflare?.accountId
    const targetScript = relayConfig.cloudflare?.scriptName || 'shiori-relay'
    if (!accountId) {
      toast.error(tr('Account ID not found. Remove the Worker in Cloudflare Dashboard.', '缺少 Account ID，请前往 Cloudflare 控制台删除 Worker'))
      return
    }
    if (!deleteToken.trim()) {
      toast.error(tr('Enter a Cloudflare API token to confirm deletion.', '请输入 Cloudflare API Token 以确认卸载'))
      return
    }
    setIsDeleting(true)
    try {
      const nextStatus = await window.electronAPI.cfDeleteRelay({
        apiToken: deleteToken.trim(),
        accountId,
        scriptName: targetScript,
      })
      const cleared: RelayConfig = {
        ...DEFAULT_RELAY_CONFIG,
      }
      setRelayConfig(cleared)
      setManualUrl('')
      setManualSecret('')
      setManualGateKey('')
      setStatus(nextStatus)
      setDeleteToken('')
      setShowDeletePanel(false)
      setShowWizard(true)
      onRelayConfigUpdated?.(cleared)
      toast.success(
        isZh
          ? `已卸载云端 Worker (${targetScript}) 并清空本地配置`
          : `Removed Worker (${targetScript}) and cleared local relay config`,
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setIsDeleting(false)
    }
  }

  const isConfigured = Boolean(relayConfig.relayUrl && relayConfig.relaySecret)
  const badge = statusBadgeMeta(status, isZh)
  const qrValue = embedTokenInQr
    ? (status?.qrAutoLoginUrl || status?.publicUrl || '')
    : (status?.qrManualLoginUrl || status?.publicUrl || '')
  const usagePct = status
    ? Math.min(100, Math.round((status.requestsToday / Math.max(status.dailyRequestCap, 1)) * 100))
    : 0

  return (
    <SettingsSection
      title={tr('Cloudflare Relay', 'Cloudflare 远程中继')}
      description={tr(
        'Connect to this desktop workspace from any browser or mobile device over an end-to-end encrypted Cloudflare Workers tunnel.',
        '通过自托管的 Cloudflare Workers 端到端加密隧道，在任意浏览器或移动设备上安全访问本机工作区。',
      )}
    >
      {/* Enable toggle + live status */}
      <SettingsCard>
        <SettingsToggle
          label={tr('Enable Cloudflare Relay', '启用远程中继')}
          description={
            isConfigured
              ? relayConfig.relayUrl
              : tr('Deploy a Worker below or configure an existing endpoint', '完成下方部署或在高级设置中填写已有节点')
          }
          checked={relayConfig.enabled}
          disabled={isToggling}
          onCheckedChange={(checked) => void handleToggleEnabled(checked)}
        />

        <SettingsRow label={tr('Status', '连接状态')}>
          <div className="flex items-center gap-2">
            <span className={cn('size-2 rounded-full', badge.dotClass)} />
            <span className={cn('text-label-sm font-medium', badge.textClass)}>
              {badge.label}
            </span>
            {isConfigured && (
              <IconButton
                size="sm"
                aria-label={tr('Refresh status', '刷新状态')}
                icon={<RefreshCw className="size-3.5" />}
                onClick={() => void refreshStatus()}
              />
            )}
          </div>
        </SettingsRow>

        {isConfigured && status && (
          <SettingsRow
            label={tr('Free-tier quota', '免费额度护栏')}
            description={tr('Hard daily cap and client limit enforced on the Worker', '云端 Worker 强制执行单日请求上限与并发连接数限制')}
          >
            <div className="flex items-center gap-3 text-caption text-secondary tabular-nums">
              <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                <ShieldCheck className="size-3.5" />
                {status.requestsToday.toLocaleString()} / {status.dailyRequestCap.toLocaleString()} ({usagePct}%)
              </span>
              <span>
                {status.activeClients} / {status.maxClients} {tr('clients', '设备')}
              </span>
            </div>
          </SettingsRow>
        )}

        {status?.lastError && relayConfig.enabled && (
          <div className="mx-4 mb-3 flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-caption text-destructive">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            <span>{status.lastError}</span>
          </div>
        )}
      </SettingsCard>

      {/* Public QR Pairing Card when configured & enabled */}
      {isConfigured && relayConfig.enabled && qrValue && (
        <SettingsCard>
          <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center">
            <div className="flex shrink-0 flex-col items-center gap-2">
              <div className="rounded-xl bg-white p-3 shadow-xs ring-1 ring-black/10">
                <QRCodeSVG value={qrValue} size={152} level="M" />
              </div>
              <span className="flex items-center gap-1 text-caption text-emerald-600 dark:text-emerald-400">
                <Lock className="size-3" />
                {relayConfig.e2eEnabled ? 'AES-256-GCM E2E' : 'TLS'}
              </span>
            </div>

            <div className="flex min-w-0 flex-1 flex-col gap-3">
              <div className="flex items-center gap-1.5 text-label font-medium text-foreground">
                <Smartphone className="size-4 text-accent" />
                <span>{tr('Remote Pairing', '远程设备配对')}</span>
              </div>

              <div className="space-y-1">
                <div className="text-label-sm font-medium text-secondary">
                  {tr('Relay Endpoint', '中继入口')}
                </div>
                <div className="flex items-center gap-1.5">
                  <code className="min-w-0 flex-1 truncate rounded-md bg-fill-hover px-2.5 py-1.5 font-mono text-mono-ui text-foreground">
                    {status?.publicUrl || relayConfig.relayUrl}
                  </code>
                  <IconButton
                    size="sm"
                    aria-label={tr('Copy pairing link', '复制配对链接')}
                    icon={<Copy className="size-3.5" />}
                    onClick={() => handleCopy(qrValue, tr('pairing link', '配对链接'))}
                  />
                  <IconButton
                    size="sm"
                    aria-label={tr('Open in browser', '在浏览器打开')}
                    icon={<ExternalLink className="size-3.5" />}
                    onClick={() => window.electronAPI.openUrl(qrValue)}
                  />
                </div>
              </div>

              <label className="flex cursor-pointer items-center gap-2 text-label-sm text-secondary select-none">
                <input
                  type="checkbox"
                  checked={embedTokenInQr}
                  onChange={(e) => setEmbedTokenInQr(e.target.checked)}
                  className="size-3.5 rounded accent-[var(--accent)]"
                />
                <span>
                  {tr(
                    'Embed key in URL fragment (#) for one-scan sign-in',
                    '在链接 # 锚点中内嵌密钥以支持扫码免密登录（不经过 Cloudflare 服务器）',
                  )}
                </span>
              </label>

              <div className="flex flex-wrap items-center gap-2 pt-0.5">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={isRotating}
                  onClick={() => void handleRotateE2eKey()}
                >
                  {isRotating ? <Spinner /> : <KeyRound className="size-3.5" />}
                  {tr('Rotate Key', '重置密钥')}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowWizard((v) => !v)}
                >
                  <Cloud className="size-3.5" />
                  {showWizard ? tr('Hide Setup', '收起部署') : tr('Redeploy', '重新部署')}
                </Button>
                {relayConfig.cloudflare?.accountId && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => setShowDeletePanel((v) => !v)}
                  >
                    <Trash2 className="size-3.5" />
                    {tr('Remove Worker', '卸载 Worker')}
                  </Button>
                )}
              </div>
            </div>
          </div>
        </SettingsCard>
      )}

      {/* Visual 1-Click Cloudflare Deploy Wizard */}
      {(showWizard || !isConfigured) && (
        <SettingsCard>
          <div className="space-y-4 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-label font-semibold text-foreground">
                  {tr('Deploy to Cloudflare Workers', '部署到 Cloudflare Workers')}
                </div>
                <p className="mt-0.5 text-caption text-tertiary">
                  {tr(
                    'Uses a scoped API token (Workers Scripts: Edit, Account Settings: Read) held only in memory during deployment.',
                    '仅使用最小权限的临时 API Token（Workers 脚本编辑与账号只读），仅在部署期间驻留内存、不写入本地磁盘。',
                  )}
                </p>
              </div>
              {isConfigured && (
                <Button variant="ghost" size="sm" onClick={() => setShowWizard(false)}>
                  {tr('Close', '收起')}
                </Button>
              )}
            </div>

            {/* Step 1 */}
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-fill-hover/55 p-3.5 inset-ring inset-ring-border/60">
              <div className="flex items-center gap-2.5">
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-accent text-[11px] font-semibold text-white">
                  1
                </span>
                <div>
                  <div className="text-label-sm font-medium text-foreground">
                    {tr('Create a scoped Cloudflare API token', '创建最小权限的 Cloudflare API Token')}
                  </div>
                  <div className="text-caption text-tertiary">
                    {tr('Permissions are pre-filled on the Cloudflare token page.', '官方授权页已自动预填所需权限。')}
                  </div>
                </div>
              </div>
              <Button
                variant="primary"
                size="sm"
                disabled={isBusy}
                onClick={() => window.electronAPI.openUrl(CF_PREFILLED_TOKEN_URL)}
              >
                <ExternalLink className="size-3.5" />
                {tr('Open Cloudflare', '前往 Cloudflare')}
              </Button>
            </div>

            {/* Step 2 */}
            <div className="space-y-3 rounded-xl bg-fill-hover/55 p-3.5 inset-ring inset-ring-border/60">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-accent text-[11px] font-semibold text-white">
                    2
                  </span>
                  <div className="text-label-sm font-medium text-foreground">
                    {tr('Paste token to deploy & connect', '粘贴 Token 自动部署并连接')}
                  </div>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={isBusy}
                  onClick={() => void handlePasteAndDeploy()}
                >
                  {isBusy ? <Spinner /> : <ClipboardPaste className="size-3.5" />}
                  {tr('Paste & Deploy', '粘贴并部署')}
                </Button>
              </div>

              <div className="flex gap-2 pl-7">
                <input
                  type="password"
                  value={apiToken}
                  onChange={(e) => setApiToken(e.target.value)}
                  onPaste={(e) => {
                    const pasted = e.clipboardData.getData('text').trim()
                    if (pasted.length >= 20 && !isBusy) {
                      e.preventDefault()
                      setApiToken(pasted)
                      void runSmartAutoDeploy(pasted)
                    }
                  }}
                  placeholder={tr('Cloudflare API Token', '粘贴 Cloudflare API Token')}
                  className="min-w-0 flex-1 rounded-lg bg-background px-3 py-2 text-label-sm text-foreground inset-ring inset-ring-border focus:outline-none focus:ring-2 focus:ring-accent/40"
                />
                <Button
                  variant="primary"
                  size="md"
                  disabled={isBusy || !apiToken.trim()}
                  onClick={() => void runSmartAutoDeploy(apiToken)}
                >
                  {isBusy ? <Spinner /> : <Cloud className="size-4" />}
                  {tr('Deploy', '部署')}
                </Button>
              </div>

              {needsManualAccountId && (
                <div className="flex gap-2 pl-7">
                  <input
                    type="text"
                    value={manualAccountId}
                    onChange={(e) => setManualAccountId(e.target.value)}
                    placeholder={tr('Cloudflare Account ID', '输入 Cloudflare Account ID')}
                    className="min-w-0 flex-1 rounded-lg bg-background px-3 py-2 font-mono text-mono-ui text-foreground inset-ring inset-ring-border focus:outline-none focus:ring-2 focus:ring-accent/40"
                  />
                </div>
              )}
            </div>

            {/* Live progress checklist while deploying */}
            {isBusy && (
              <div className="rounded-xl bg-background/80 p-3.5 space-y-2 inset-ring inset-ring-border/70">
                {[
                  {
                    key: 'verify',
                    label: tr('Verifying token and account access', '验证 Token 与账号权限'),
                    state: deployStage === 'verifying' ? 'active' : 'done',
                  },
                  {
                    key: 'deploy',
                    label: tr('Deploying Worker script and free-tier guardrails', '部署 Worker 脚本与免费额度护栏'),
                    state: deployStage === 'verifying' ? 'pending' : deployStage === 'deploying' ? 'active' : 'done',
                  },
                  {
                    key: 'connect',
                    label: tr('Establishing AES-256-GCM encrypted tunnel', '建立 AES-256-GCM 端到端加密隧道'),
                    state: deployStage === 'connecting' ? 'active' : 'pending',
                  },
                ].map((step) => (
                  <div key={step.key} className="flex items-center gap-2.5 text-caption">
                    {step.state === 'done' ? (
                      <CheckCircle2 className="size-4 shrink-0 text-emerald-500" />
                    ) : step.state === 'active' ? (
                      <Spinner className="size-4 shrink-0 text-accent" />
                    ) : (
                      <Circle className="size-4 shrink-0 text-tertiary/50" />
                    )}
                    <span className={cn(
                      step.state === 'active' ? 'font-medium text-foreground' : 'text-secondary',
                    )}>
                      {step.label}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Multi-account picker */}
            {deployStage === 'select-account' && accounts.length > 1 && (
              <div className="space-y-3 rounded-xl bg-background/80 p-3.5 inset-ring inset-ring-border/70">
                <div className="text-label-sm font-medium text-foreground">
                  {tr('Select Cloudflare account', '选择部署账号')}
                </div>
                <select
                  value={selectedAccountId}
                  onChange={(e) => setSelectedAccountId(e.target.value)}
                  className="w-full rounded-lg bg-background px-3 py-2 text-label-sm text-foreground inset-ring inset-ring-border focus:outline-none"
                >
                  {accounts.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.name} ({acc.subdomain ? `${acc.subdomain}.workers.dev` : 'workers.dev'})
                    </option>
                  ))}
                </select>
                <div className="flex justify-end">
                  <Button
                    variant="primary"
                    size="md"
                    onClick={() => void handleConfirmSelectedAccountDeploy()}
                  >
                    <Cloud className="size-4" />
                    {tr('Deploy to Selected Account', '部署到此账号')}
                  </Button>
                </div>
              </div>
            )}

            {wizardError && (
              <div className="flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-caption text-destructive">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                <span>{wizardError}</span>
              </div>
            )}
          </div>
        </SettingsCard>
      )}

      {/* One-Click Uninstall Cloud Worker */}
      {showDeletePanel && relayConfig.cloudflare?.accountId && (
        <SettingsCard>
          <div className="space-y-3 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-label-sm font-medium text-destructive">
                {tr('Remove Cloud Worker', '卸载云端 Worker')} ({relayConfig.cloudflare.scriptName || 'shiori-relay'})
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => window.electronAPI.openUrl(CF_PREFILLED_TOKEN_URL)}
              >
                <ExternalLink className="size-3.5" />
                {tr('Get Token', '获取 Token')}
              </Button>
            </div>
            <p className="text-caption text-secondary">
              {tr(
                'Deletes the Worker script and Durable Object from your Cloudflare account and resets local relay settings.',
                '将从 Cloudflare 账号删除该 Worker 脚本与 Durable Object，并清空本地中继配置。',
              )}
            </p>
            <div className="flex gap-2">
              <input
                type="password"
                value={deleteToken}
                onChange={(e) => setDeleteToken(e.target.value)}
                placeholder={tr('Cloudflare API Token', '输入 Cloudflare API Token')}
                className="min-w-0 flex-1 rounded-lg bg-background px-3 py-2 text-label-sm text-foreground inset-ring inset-ring-border focus:outline-none"
              />
              <Button
                variant="destructive"
                size="md"
                disabled={isDeleting || !deleteToken.trim()}
                onClick={() => void handleDeleteWorker()}
              >
                {isDeleting ? <Spinner /> : <Trash2 className="size-3.5" />}
                {tr('Confirm Remove', '确认卸载')}
              </Button>
            </div>
          </div>
        </SettingsCard>
      )}

      {/* Collapsible Advanced / Manual Config */}
      <div className="pt-1">
        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          className="flex items-center gap-1.5 text-caption font-medium text-tertiary hover:text-foreground transition-colors"
        >
          {showAdvanced ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
          <span>{tr('Advanced Configuration', '高级配置')}</span>
        </button>

        {showAdvanced && (
          <div className="mt-2.5">
            <SettingsCard>
              <SettingsInputRow
                label={tr('Relay URL', '中继地址')}
                value={manualUrl}
                onChange={setManualUrl}
                placeholder="https://shiori-relay.yourname.workers.dev"
              />
              <SettingsInputRow
                label="RELAY_SECRET"
                value={manualSecret}
                onChange={setManualSecret}
                placeholder={tr('Shared Worker secret', '与 Worker 环境变量一致')}
              />
              <SettingsInputRow
                label="GATE_KEY"
                value={manualGateKey}
                onChange={setManualGateKey}
                placeholder={tr('Edge gate key', '用于 /connect/<gateKey> 门禁鉴权')}
              />
              <SettingsInputRow
                label={tr('Daily Request Cap', '单日请求上限')}
                value={dailyCapInput}
                onChange={setDailyCapInput}
                placeholder="80000"
              />
              <SettingsInputRow
                label={tr('Max Concurrent Clients', '最大并发设备数')}
                value={maxClientsInput}
                onChange={setMaxClientsInput}
                placeholder="4"
              />
              <SettingsToggle
                label={tr('End-to-End Encryption (AES-256-GCM)', '端到端加密（AES-256-GCM）')}
                description={tr(
                  'Encrypt messages and tool output locally before forwarding through Cloudflare.',
                  '内容在离开本机前加密，Cloudflare 仅转发密文。',
                )}
                checked={relayConfig.e2eEnabled}
                onCheckedChange={(e2eEnabled) => setRelayConfig((prev) => ({ ...prev, e2eEnabled }))}
              />
              <div className="flex justify-end px-4 py-3 border-t border-border/50">
                <Button
                  variant="primary"
                  size="sm"
                  disabled={isSavingAdvanced}
                  onClick={() => void handleSaveAdvanced()}
                >
                  {isSavingAdvanced ? <Spinner /> : null}
                  {tr('Save & Apply', '保存并应用')}
                </Button>
              </div>
            </SettingsCard>
          </div>
        )}
      </div>
    </SettingsSection>
  )
}
