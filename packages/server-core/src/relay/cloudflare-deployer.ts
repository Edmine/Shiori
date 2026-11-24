/**
 * Visual 1-click Cloudflare Workers deployer for Shiori Relay.
 *
 * Uses the official Cloudflare REST API directly from Electron main process
 * so users never have to install Node/Wrangler or touch a terminal.
 *
 * Cost-safety guarantees built into every deployment:
 *  - SQLite Durable Object (`new_sqlite_classes: ["TunnelRoom"]`) — supported on Free Plan
 *  - `observability.enabled = false` — zero Workers Logs overage
 *  - `DAILY_DO_REQUEST_CAP` capped at <= 95,000 (default 80,000, below 100k Free Plan limit)
 *  - `MAX_CLIENTS` capped at <= 16 (default 4)
 *  - Ephemeral API Token is NEVER persisted to disk
 */

import type {
  CloudflareAccountInfo,
  CloudflareDeleteInput,
  CloudflareDeployInput,
  CloudflareDeployResult,
  CloudflareVerifyResult,
} from '@craft-agent/shared/config/server-config'
import { generateE2eKeyBase64Url, generateUrlSafeSecret } from './e2e-crypto'
import { SHIORI_RELAY_WORKER_SOURCE } from './worker-source'

const CF_API_BASE = 'https://api.cloudflare.com/client/v4'
const DEFAULT_SCRIPT_NAME = 'shiori-relay'
const COMPATIBILITY_DATE = '2025-04-01'

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

interface CfApiEnvelope<T> {
  success: boolean
  errors?: Array<{ code?: number; message?: string }>
  messages?: Array<{ code?: number; message?: string }>
  result?: T
}

function formatCfErrors(data: CfApiEnvelope<unknown> | null, fallbackStatus: number): string {
  const first = data?.errors?.[0]
  if (first?.message) {
    return first.code ? `${first.message} (code ${first.code})` : first.message
  }
  return `Cloudflare API request failed (HTTP ${fallbackStatus})`
}

function sanitizeScriptName(raw?: string): string {
  const cleaned = (raw || DEFAULT_SCRIPT_NAME)
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50)
  return cleaned || DEFAULT_SCRIPT_NAME
}

function sanitizeSubdomain(raw?: string): string {
  const cleaned = (raw || '')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48)
  if (cleaned.length >= 3) return cleaned
  const suffix = generateUrlSafeSecret(4).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 6) || 'relay'
  return `shiori-${suffix}`
}

async function cfFetchJson<T>(
  fetchImpl: FetchLike,
  apiToken: string,
  path: string,
  init?: RequestInit,
): Promise<{ ok: boolean; status: number; data: CfApiEnvelope<T> | null }> {
  const headers = new Headers(init?.headers)
  headers.set('Authorization', `Bearer ${apiToken.trim()}`)
  const res = await fetchImpl(`${CF_API_BASE}${path}`, {
    ...init,
    headers,
  })
  let data: CfApiEnvelope<T> | null = null
  try {
    data = await res.json() as CfApiEnvelope<T>
  } catch {
    data = null
  }
  return { ok: res.ok && !!data?.success, status: res.status, data }
}

async function inspectAccountMetadata(
  fetchImpl: FetchLike,
  apiToken: string,
  accountId: string,
  accountName: string,
  scriptName: string,
): Promise<CloudflareAccountInfo> {
  let subdomain: string | undefined
  let existingScript = false

  const subRes = await cfFetchJson<{ subdomain?: string }>(
    fetchImpl,
    apiToken,
    `/accounts/${encodeURIComponent(accountId)}/workers/subdomain`,
  )
  if (subRes.ok && subRes.data?.result?.subdomain) {
    subdomain = subRes.data.result.subdomain
  }

  const scriptRes = await cfFetchJson<unknown>(
    fetchImpl,
    apiToken,
    `/accounts/${encodeURIComponent(accountId)}/workers/scripts/${encodeURIComponent(scriptName)}/settings`,
  )
  if (scriptRes.ok) {
    existingScript = true
  }

  return {
    id: accountId,
    name: accountName,
    subdomain,
    existingScript,
  }
}

/**
 * Verify a Cloudflare API Token and discover accessible accounts, workers.dev subdomain,
 * and whether `shiori-relay` already exists.
 */
export async function verifyCloudflareToken(
  apiToken: string,
  options?: { manualAccountId?: string; scriptName?: string; fetchImpl?: FetchLike },
): Promise<CloudflareVerifyResult> {
  const token = apiToken.trim()
  if (!token) {
    return { ok: false, accounts: [], error: '请先输入 Cloudflare API Token' }
  }

  const fetchImpl = options?.fetchImpl ?? globalThis.fetch
  const scriptName = sanitizeScriptName(options?.scriptName)

  // If user explicitly provided an Account ID, validate against that account directly
  const manualId = options?.manualAccountId?.trim()
  if (manualId) {
    const accountCheck = await cfFetchJson<{ id?: string; name?: string }>(
      fetchImpl,
      token,
      `/accounts/${encodeURIComponent(manualId)}`,
    )
    const info = await inspectAccountMetadata(
      fetchImpl,
      token,
      manualId,
      accountCheck.data?.result?.name || manualId,
      scriptName,
    )
    return { ok: true, accounts: [info] }
  }

  const accountsRes = await cfFetchJson<Array<{ id: string; name: string }>>(
    fetchImpl,
    token,
    '/accounts?per_page=50',
  )

  if (!accountsRes.ok) {
    if (accountsRes.status === 401) {
      return {
        ok: false,
        accounts: [],
        error: 'Cloudflare API Token 无效或已过期，请重新生成（建议使用 Edit Cloudflare Workers 模板）。',
      }
    }
    if (accountsRes.status === 403) {
      return {
        ok: false,
        accounts: [],
        needsManualAccountId: true,
        error: '当前 Token 缺少读取账号列表权限，请手动填写 Account ID 或使用官方「Edit Cloudflare Workers」模板重新创建 Token。',
      }
    }
    return {
      ok: false,
      accounts: [],
      error: formatCfErrors(accountsRes.data, accountsRes.status),
    }
  }

  const rawAccounts = accountsRes.data?.result ?? []
  if (rawAccounts.length === 0) {
    return {
      ok: false,
      accounts: [],
      needsManualAccountId: true,
      error: '未能自动读取 Cloudflare 账号，请手动填写 Account ID。',
    }
  }

  const enriched = await Promise.all(
    rawAccounts.map((acc) => inspectAccountMetadata(fetchImpl, token, acc.id, acc.name, scriptName)),
  )
  return { ok: true, accounts: enriched }
}

/**
 * One-click deploy Shiori Relay Worker (with SQLite Durable Object + Free-tier safety caps)
 * to the user's Cloudflare account.
 */
export async function deployCloudflareRelay(
  input: CloudflareDeployInput,
  options?: { fetchImpl?: FetchLike; healthRetryDelayMs?: number },
): Promise<CloudflareDeployResult> {
  const fetchImpl = options?.fetchImpl ?? globalThis.fetch
  const healthRetryDelayMs = options?.healthRetryDelayMs ?? 900
  const apiToken = input.apiToken.trim()
  const accountId = input.accountId.trim()
  if (!apiToken) throw new Error('Cloudflare API Token 不能为空')
  if (!accountId) throw new Error('Cloudflare Account ID 不能为空')

  const scriptName = sanitizeScriptName(input.scriptName)
  const maxClients = Math.min(Math.max(Math.floor(input.maxClients ?? 4), 1), 16)
  const dailyRequestCap = Math.min(Math.max(Math.floor(input.dailyRequestCap ?? 80_000), 1_000), 95_000)

  // 1. Resolve or claim workers.dev subdomain
  let subdomain = ''
  const subRes = await cfFetchJson<{ subdomain?: string }>(
    fetchImpl,
    apiToken,
    `/accounts/${encodeURIComponent(accountId)}/workers/subdomain`,
  )
  if (subRes.ok && subRes.data?.result?.subdomain) {
    subdomain = subRes.data.result.subdomain
  } else {
    const desired = sanitizeSubdomain(input.desiredSubdomain)
    const createSubRes = await cfFetchJson<{ subdomain?: string }>(
      fetchImpl,
      apiToken,
      `/accounts/${encodeURIComponent(accountId)}/workers/subdomain`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subdomain: desired }),
      },
    )
    if (!createSubRes.ok) {
      throw new Error(
        `开通 workers.dev 子域名失败（${desired}）：${formatCfErrors(createSubRes.data, createSubRes.status)}。可换一个子域名前缀重试。`,
      )
    }
    subdomain = createSubRes.data?.result?.subdomain || desired
  }

  // 2. Inspect existing script settings to avoid re-applying DO migration tag v1
  const settingsRes = await cfFetchJson<{
    bindings?: Array<{ type?: string; name?: string; class_name?: string }>
  }>(
    fetchImpl,
    apiToken,
    `/accounts/${encodeURIComponent(accountId)}/workers/scripts/${encodeURIComponent(scriptName)}/settings`,
  )
  const hasExistingTunnelDo = !!(
    settingsRes.ok &&
    settingsRes.data?.result?.bindings?.some(
      (binding) => binding.type === 'durable_object_namespace' && binding.class_name === 'TunnelRoom',
    )
  )

  // 3. Generate fresh high-entropy secrets & E2EE key
  const relaySecret = generateUrlSafeSecret(32)
  const gateKey = generateUrlSafeSecret(20)
  const e2eKey = generateE2eKeyBase64Url()

  const uploadWorker = async (includeMigration: boolean) => {
    const metadata: Record<string, unknown> = {
      main_module: 'worker.mjs',
      compatibility_date: COMPATIBILITY_DATE,
      bindings: [
        { type: 'durable_object_namespace', name: 'TUNNEL_ROOM', class_name: 'TunnelRoom' },
        { type: 'secret_text', name: 'RELAY_SECRET', text: relaySecret },
        { type: 'secret_text', name: 'GATE_KEY', text: gateKey },
        { type: 'plain_text', name: 'MAX_CLIENTS', text: String(maxClients) },
        { type: 'plain_text', name: 'DAILY_DO_REQUEST_CAP', text: String(dailyRequestCap) },
      ],
      observability: { enabled: false },
    }
    if (includeMigration) {
      metadata.migrations = {
        new_tag: 'v1',
        new_sqlite_classes: ['TunnelRoom'],
      }
    }

    const form = new FormData()
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }))
    form.append(
      'worker.mjs',
      new Blob([SHIORI_RELAY_WORKER_SOURCE], { type: 'application/javascript+module' }),
      'worker.mjs',
    )

    return cfFetchJson<unknown>(
      fetchImpl,
      apiToken,
      `/accounts/${encodeURIComponent(accountId)}/workers/scripts/${encodeURIComponent(scriptName)}`,
      {
        method: 'PUT',
        body: form,
      },
    )
  }

  let uploadRes = await uploadWorker(!hasExistingTunnelDo)
  if (!uploadRes.ok && !hasExistingTunnelDo) {
    const errMsg = formatCfErrors(uploadRes.data, uploadRes.status).toLowerCase()
    if (errMsg.includes('migration') || errMsg.includes('already') || errMsg.includes('tag')) {
      uploadRes = await uploadWorker(false)
    }
  }
  if (!uploadRes.ok) {
    throw new Error(`上传中继 Worker 失败：${formatCfErrors(uploadRes.data, uploadRes.status)}`)
  }

  // 4. Enable workers.dev subdomain route for this Worker
  const enableSubRes = await cfFetchJson<unknown>(
    fetchImpl,
    apiToken,
    `/accounts/${encodeURIComponent(accountId)}/workers/scripts/${encodeURIComponent(scriptName)}/subdomain`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    },
  )
  if (!enableSubRes.ok) {
    throw new Error(`启用 workers.dev 路由失败：${formatCfErrors(enableSubRes.data, enableSubRes.status)}`)
  }

  const relayUrl = `https://${scriptName}.${subdomain}.workers.dev`

  // 5. Verify /health endpoint (short retries for global edge propagation)
  let healthOk = false
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetchImpl(`${relayUrl}/health`, { method: 'GET' })
      if (res.ok) {
        const body = await res.json().catch(() => null) as { ok?: boolean; service?: string } | null
        if (body?.ok && body?.service === 'shiori-relay') {
          healthOk = true
          break
        }
      }
    } catch {
      // Wait and retry
    }
    if (attempt < 3 && healthRetryDelayMs > 0) {
      await new Promise((r) => setTimeout(r, healthRetryDelayMs))
    }
  }

  return {
    relayUrl,
    relaySecret,
    gateKey,
    e2eKey,
    accountId,
    accountName: input.accountName,
    scriptName,
    subdomain,
    deployedAt: Date.now(),
    healthOk,
  }
}

/**
 * Delete the deployed Shiori Relay Worker from Cloudflare in one click.
 */
export async function deleteCloudflareRelay(
  input: CloudflareDeleteInput,
  options?: { fetchImpl?: FetchLike },
): Promise<void> {
  const fetchImpl = options?.fetchImpl ?? globalThis.fetch
  const apiToken = input.apiToken.trim()
  const accountId = input.accountId.trim()
  const scriptName = sanitizeScriptName(input.scriptName)
  if (!apiToken) throw new Error('Cloudflare API Token 不能为空')
  if (!accountId) throw new Error('Cloudflare Account ID 不能为空')

  const res = await cfFetchJson<unknown>(
    fetchImpl,
    apiToken,
    `/accounts/${encodeURIComponent(accountId)}/workers/scripts/${encodeURIComponent(scriptName)}?force=true`,
    { method: 'DELETE' },
  )
  if (!res.ok && res.status !== 404) {
    throw new Error(`删除云端 Worker 失败：${formatCfErrors(res.data, res.status)}`)
  }
}
