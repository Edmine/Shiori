/**
 * ServerSettingsPage
 *
 * Configure the Electron app to act as a remote server,
 * accessible from other machines on the network.
 */

import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Copy, Eye, EyeOff, AlertTriangle, RotateCw, Smartphone, ExternalLink } from 'lucide-react'
import { toast } from 'sonner'
import { QRCodeSVG } from 'qrcode.react'
import { Button, IconButton } from '@/components/ui/button'
import { Spinner } from '@craft-agent/ui'
import { cn } from '@/lib/utils'
import type { DetailsPageMeta } from '@/lib/navigation-registry'
import type { RelayConfig, ServerConfig, ServerStatus } from '@craft-agent/shared/config/server-config'
import { CloudflareRelaySection } from './CloudflareRelaySection'

import {
  SettingsPage,
  SettingsSection,
  SettingsCard,
  SettingsCardFooter,
  SettingsRow,
  SettingsToggle,
  SettingsInputRow,
} from '@/components/settings'

export const meta: DetailsPageMeta = {
  navigator: 'settings',
  slug: 'server',
}

interface ServerFormState {
  enabled: boolean
  port: string
  tlsCertPath: string
  tlsKeyPath: string
  token: string
}

function configToForm(config: ServerConfig): ServerFormState {
  return {
    enabled: config.enabled,
    port: String(config.port),
    tlsCertPath: config.tlsCertPath ?? '',
    tlsKeyPath: config.tlsKeyPath ?? '',
    token: config.token ?? '',
  }
}

function formToConfig(form: ServerFormState): ServerConfig {
  return {
    enabled: form.enabled,
    port: parseInt(form.port, 10) || 9100,
    tlsCertPath: form.tlsCertPath.trim() || undefined,
    tlsKeyPath: form.tlsKeyPath.trim() || undefined,
    token: form.token || undefined,
  }
}

export default function ServerSettingsPage() {
  const { t } = useTranslation()

  const [form, setForm] = useState<ServerFormState>({
    enabled: false,
    port: '9100',
    tlsCertPath: '',
    tlsKeyPath: '',
    token: '',
  })
  const [savedForm, setSavedForm] = useState<ServerFormState>(form)
  const [relayConfig, setRelayConfig] = useState<RelayConfig | undefined>(undefined)
  const [status, setStatus] = useState<ServerStatus | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [tokenVisible, setTokenVisible] = useState(false)
  const [selectedAddressIdx, setSelectedAddressIdx] = useState(0)
  const [embedTokenInQr, setEmbedTokenInQr] = useState(true)
  const [error, setError] = useState<string>()

  const isDirty = JSON.stringify(form) !== JSON.stringify(savedForm)

  const loadSettings = useCallback(async () => {
    try {
      const [config, serverStatus] = await Promise.all([
        window.electronAPI.getServerConfig(),
        window.electronAPI.getServerStatus(),
      ])
      const formState = configToForm(config)
      setForm(formState)
      setSavedForm(formState)
      setRelayConfig(config.relay)
      setStatus(serverStatus)
    } catch (err) {
      console.error('Failed to load server settings:', err)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    loadSettings()
  }, [loadSettings])

  const handleSave = async () => {
    setError(undefined)
    const port = parseInt(form.port, 10)
    if (isNaN(port) || port < 1024 || port > 65535) {
      setError(t('settings.server.portValidation'))
      return
    }
    if (form.tlsCertPath && !form.tlsKeyPath) {
      setError(t('settings.server.privateKeyRequired'))
      return
    }
    if (form.tlsKeyPath && !form.tlsCertPath) {
      setError(t('settings.server.certificateRequired'))
      return
    }

    setIsSaving(true)
    try {
      await window.electronAPI.setServerConfig(formToConfig(form))
      setSavedForm(form)
      const newStatus = await window.electronAPI.getServerStatus()
      setStatus(newStatus)
      toast.success(t('settings.server.saved'))
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
      toast.error(t('settings.server.failedToSave', { message: msg }))
    } finally {
      setIsSaving(false)
    }
  }

  const handleReset = () => {
    setForm(savedForm)
    setError(undefined)
  }

  const handleCopy = (text: string, label: string) => {
    navigator.clipboard.writeText(text)
    toast.success(t('settings.server.copiedToClipboard', { label }))
  }

  const handleBrowseCert = async () => {
    const paths = await window.electronAPI.openFileDialog()
    if (paths.length > 0) {
      setForm(f => ({ ...f, tlsCertPath: paths[0]! }))
    }
  }

  const handleBrowseKey = async () => {
    const paths = await window.electronAPI.openFileDialog()
    if (paths.length > 0) {
      setForm(f => ({ ...f, tlsKeyPath: paths[0]! }))
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Spinner className="text-tertiary" />
      </div>
    )
  }

  const hasTls = !!(form.tlsCertPath && form.tlsKeyPath)
  const needsRestart = status?.needsRestart ?? false
  const showServerDetails = form.enabled || savedForm.enabled
  const lanAddresses = status?.lanAddresses ?? []
  const activeEndpoint = lanAddresses[selectedAddressIdx] ?? lanAddresses[0]
  const activeWebUrl = activeEndpoint?.webUrl ?? status?.webUrl ?? (status ? status.url.replace(/^ws/, 'http') : '')
  const activeWsUrl = activeEndpoint?.wsUrl ?? status?.url ?? ''
  const qrTargetUrl = activeWebUrl
    ? (embedTokenInQr && status?.token
        ? `${activeWebUrl}/login#token=${encodeURIComponent(status.token)}`
        : activeWebUrl)
    : ''
  const isServerActive = !!(status && savedForm.enabled && !needsRestart)

  return (
    <SettingsPage title={t("settings.server.title")} description={t("settings.server.description")}>

      {/* Cloudflare Workers Public Relay (Alma-style outbound tunnel + 1-click deploy) */}
      <CloudflareRelaySection
        initialRelayConfig={relayConfig}
        onRelayConfigUpdated={(nextRelay) => setRelayConfig(nextRelay)}
      />

      {/* Enable toggle + restart banner */}
      <SettingsSection title={t("settings.server.remoteAccess")}>
        <SettingsCard>
          <SettingsToggle
            label={t("settings.server.enableServerMode")}
            description={t("settings.server.allowRemoteConnections")}
            checked={form.enabled}
            onCheckedChange={(enabled) => setForm(f => ({ ...f, enabled }))}
          />
        </SettingsCard>

        {needsRestart && (
          <div className="flex items-center gap-2.5 rounded-lg bg-info-tint px-3.5 py-2.5 inset-ring inset-ring-[var(--info-border)]">
            <RotateCw className="size-4 shrink-0 text-info" aria-hidden />
            <span className="flex-1 text-label text-foreground">{t("settings.server.restartRequired")}</span>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => window.electronAPI.relaunchApp()}
            >
              {t("settings.server.restartNow")}
            </Button>
          </div>
        )}
      </SettingsSection>

      {/* Mobile QR Pairing — visible when server mode is actively running */}
      {isServerActive && activeWebUrl && (
        <SettingsSection
          title={t("settings.server.mobileAccess", "手机远程访问")}
          description={t("settings.server.mobileAccessDesc", "手机与电脑处于同一 Wi-Fi（或已加入同一 Tailscale 网络）时，扫码即可直接在手机浏览器中使用本机 Shiori。")}
        >
          <SettingsCard>
            <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center">
              <div className="flex shrink-0 flex-col items-center gap-2">
                <div className="rounded-xl bg-white p-3 shadow-xs ring-1 ring-black/10">
                  <QRCodeSVG value={qrTargetUrl} size={156} level="M" />
                </div>
                <span className="flex items-center gap-1 text-caption text-tertiary">
                  <Smartphone className="size-3" />
                  {embedTokenInQr
                    ? t("settings.server.qrAutoLoginHint", "扫码自动登录")
                    : t("settings.server.qrManualLoginHint", "扫码后手动输入密钥")}
                </span>
              </div>

              <div className="flex min-w-0 flex-1 flex-col gap-3">
                {lanAddresses.length > 1 && (
                  <div className="flex flex-wrap gap-1.5">
                    {lanAddresses.map((addr, idx) => (
                      <button
                        key={`${addr.label}-${addr.ip}`}
                        type="button"
                        onClick={() => setSelectedAddressIdx(idx)}
                        className={cn(
                          "rounded-full px-2.5 py-1 text-caption font-medium transition-colors",
                          idx === selectedAddressIdx
                            ? "bg-accent-tint text-accent ring-1 ring-inset ring-accent/30"
                            : "bg-fill-hover text-secondary hover:text-foreground",
                        )}
                      >
                        {addr.label} · {addr.ip}
                      </button>
                    ))}
                  </div>
                )}

                <div className="space-y-1">
                  <div className="text-label-sm font-medium text-secondary">
                    {t("settings.server.mobileUrl", "手机访问地址")}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <code className="min-w-0 flex-1 truncate rounded-md bg-fill-hover px-2.5 py-1.5 font-mono text-mono-ui text-foreground">
                      {activeWebUrl}
                    </code>
                    <IconButton
                      size="sm"
                      aria-label={t("common.copy")}
                      icon={<Copy className="size-3.5" />}
                      onClick={() => handleCopy(activeWebUrl, t("settings.server.mobileUrl", "手机访问地址"))}
                    />
                    <IconButton
                      size="sm"
                      aria-label={t("common.openInBrowser", "在浏览器中打开")}
                      icon={<ExternalLink className="size-3.5" />}
                      onClick={() => window.electronAPI.openUrl(activeWebUrl)}
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
                  <span>{t("settings.server.embedTokenInQr", "二维码内嵌访问密钥（扫码免输入，仅限信任环境）")}</span>
                </label>

                <p className="text-caption leading-relaxed text-tertiary">
                  {status?.webuiAvailable === false
                    ? t("settings.server.webuiMissingHint", "未检测到 WebUI 静态资源，请先构建 WebUI。")
                    : t("settings.server.firewallHint", "如手机无法打开，请在 Windows 防火墙允许 Shiori 访问专用网络，或使用 Tailscale 跨网直连。")}
                </p>
              </div>
            </div>
          </SettingsCard>
        </SettingsSection>
      )}

      {/* Connection + TLS — only visible when server mode is relevant */}
      {showServerDetails && (
        <SettingsSection title={t("settings.server.connectionSection")}>
          <SettingsCard>
            <SettingsInputRow
              label={t("settings.server.port")}
              value={form.port}
              onChange={(port) => setForm(f => ({ ...f, port }))}
              placeholder="9100"
            />

            {status && form.enabled && (
              <>
                <SettingsRow label={t("common.url")}>
                  <div className="flex items-center gap-1">
                    <code className="rounded-xs bg-fill-hover px-1.5 py-0.5 font-mono text-mono-ui text-secondary">
                      {activeWsUrl || status.url}
                    </code>
                    <IconButton
                      size="sm"
                      aria-label={t("common.copy")}
                      icon={<Copy className="size-3.5" />}
                      onClick={() => handleCopy(activeWsUrl || status.url, 'URL')}
                    />
                  </div>
                </SettingsRow>

                <SettingsRow label={t("settings.server.token")}>
                  <div className="flex items-center gap-1">
                    <code className="max-w-[180px] truncate rounded-xs bg-fill-hover px-1.5 py-0.5 font-mono text-mono-ui text-secondary">
                      {tokenVisible ? status.token : '••••••••••••••••'}
                    </code>
                    <IconButton
                      size="sm"
                      aria-label={tokenVisible ? t("common.hide") : t("common.show")}
                      aria-pressed={tokenVisible}
                      icon={tokenVisible ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                      onClick={() => setTokenVisible(v => !v)}
                    />
                    <IconButton
                      size="sm"
                      aria-label={t("common.copy")}
                      icon={<Copy className="size-3.5" />}
                      onClick={() => handleCopy(status.token, 'Token')}
                    />
                  </div>
                </SettingsRow>
              </>
            )}

            <SettingsRow label={t("settings.server.certificate")}>
              <div className="flex items-center gap-2">
                <span className="max-w-[200px] truncate text-label-sm text-tertiary">
                  {form.tlsCertPath || t("settings.server.notConfigured", "未配置")}
                </span>
                <Button variant="secondary" size="sm" onClick={handleBrowseCert}>
                  {t("common.browse")}
                </Button>
              </div>
            </SettingsRow>

            <SettingsRow label={t("settings.server.privateKey")}>
              <div className="flex items-center gap-2">
                <span className="max-w-[200px] truncate text-label-sm text-tertiary">
                  {form.tlsKeyPath || t("settings.server.notConfigured", "未配置")}
                </span>
                <Button variant="secondary" size="sm" onClick={handleBrowseKey}>
                  {t("common.browse")}
                </Button>
              </div>
            </SettingsRow>
          </SettingsCard>

          {form.enabled && !hasTls && (
            <div className="flex items-start gap-2.5 rounded-lg bg-info-tint px-3.5 py-2.5 inset-ring inset-ring-[var(--info-border)]">
              <AlertTriangle className="mt-px size-4 shrink-0 text-info" aria-hidden />
              <span className="text-label text-foreground">
                {status?.insecureWarning
                  ? t("settings.server.insecureWarning")
                  : t("settings.server.noTlsWarning")}
              </span>
            </div>
          )}
        </SettingsSection>
      )}

      {/* Save/Reset */}
      {error && (
        <p className="text-label-sm text-destructive">{error}</p>
      )}
      {(isDirty || error) && (
        <SettingsCardFooter className="px-0">
          <Button variant="ghost" size="md" onClick={handleReset} disabled={isSaving}>
            {t("common.reset")}
          </Button>
          <Button variant="primary" size="md" onClick={handleSave} disabled={isSaving}>
            {isSaving ? <Spinner /> : null}
            {t("common.save")}
          </Button>
        </SettingsCardFooter>
      )}
    </SettingsPage>
  )
}
