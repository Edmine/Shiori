/**
 * Desktop Outbound Relay Tunnel Client for Shiori.
 *
 * Connects outbound over WSS to the user's self-hosted Cloudflare Workers Relay,
 * proxies HTTP requests in-process to `embeddedWebuiHandler.fetch()`, and bridges
 * authenticated WebSocket RPC streams to the local `WsRpcServer` with optional
 * (default-on) AES-256-GCM end-to-end encryption.
 */

import WebSocket from 'ws'
import { gzipSync } from 'node:zlib'
import type {
  RelayConfig,
  RelayConnectionState,
  RelayStatus,
} from '@craft-agent/shared/config/server-config'
import { DEFAULT_RELAY_CONFIG } from '@craft-agent/shared/config/server-config'
import { decryptE2eText, encryptE2eText, importE2eKey } from './e2e-crypto'

const PING_FRAME = '__shiori_ping__'
const PONG_FRAME = '__shiori_pong__'
const PING_INTERVAL_MS = 25_000
const MAX_MISSED_PONGS = 2
const RAW_CHUNK_BYTES = 384 * 1024 // ~512 KB base64, safely under Cloudflare 1 MiB WS frame limit
const GZIP_MIN_BYTES = 1024

export interface RelayTunnelClientDeps {
  /** Local WsRpcServer endpoint info */
  getLocalWsTarget: () => { url: string; tls: boolean }
  /** In-process WebUI HTTP handler (null if WebUI bundle is missing) */
  handleWebuiRequest: ((req: Request) => Promise<Response>) | null
  /** Validates the phone browser's craft_session cookie before bridging WS to local WsRpcServer */
  validateSessionCookie: (cookieHeader: string | null) => Promise<boolean>
  /** Current Shiori remote auth token (for building QR auto-login fragment) */
  getServerToken: () => string
  /** Logger */
  logger?: {
    info: (...args: unknown[]) => void
    warn: (...args: unknown[]) => void
    error: (...args: unknown[]) => void
  }
}

interface LocalClientBridge {
  id: string
  ws: WebSocket
  pendingToLocal: string[]
  inChain: Promise<void>
  outChain: Promise<void>
  closed: boolean
}

function isCompressibleContentType(contentType: string): boolean {
  const lower = contentType.toLowerCase()
  return (
    lower.startsWith('text/') ||
    lower.includes('javascript') ||
    lower.includes('json') ||
    lower.includes('svg+xml') ||
    lower.includes('xml')
  )
}

function normalizeRelayOrigin(rawUrl: string): string {
  const trimmed = rawUrl.trim().replace(/\/+$/, '')
  if (!trimmed) return ''
  const parsed = new URL(trimmed)
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('Relay URL must start with https:// (or http:// for local tests)')
  }
  return parsed.origin
}

function toHostWsUrl(origin: string): string {
  const parsed = new URL(origin)
  parsed.protocol = parsed.protocol === 'https:' ? 'wss:' : 'ws:'
  parsed.pathname = '/host'
  parsed.search = ''
  parsed.hash = ''
  return parsed.toString()
}

function collectResponseHeaders(headers: Headers): Array<[string, string]> {
  const pairs: Array<[string, string]> = []
  const maybeGetSetCookie = (headers as unknown as { getSetCookie?: () => string[] }).getSetCookie
  const setCookies = typeof maybeGetSetCookie === 'function' ? maybeGetSetCookie.call(headers) : null

  headers.forEach((value, key) => {
    if (key.toLowerCase() === 'set-cookie' && setCookies && setCookies.length > 0) {
      return
    }
    pairs.push([key, value])
  })

  if (setCookies && setCookies.length > 0) {
    for (const cookie of setCookies) {
      pairs.push(['set-cookie', cookie])
    }
  }
  return pairs
}

export class RelayTunnelClient {
  private readonly deps: RelayTunnelClientDeps
  private config: RelayConfig = { ...DEFAULT_RELAY_CONFIG }
  private e2eCryptoKey: CryptoKey | null = null

  private hostWs: WebSocket | null = null
  private state: RelayConnectionState = 'disabled'
  private lastError: string | undefined
  private connectedAt: number | undefined
  private latencyMs: number | undefined
  private reconnectAttempt = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private pingTimer: ReturnType<typeof setInterval> | null = null
  private lastPingSentAt = 0
  private missedPongs = 0
  private disposed = false
  private generation = 0

  private clients = new Map<string, LocalClientBridge>()
  private openingClients = new Map<string, Array<Record<string, unknown>>>()
  private dayKey = ''
  private requestsToday = 0

  constructor(deps: RelayTunnelClientDeps) {
    this.deps = deps
  }

  getConfig(): RelayConfig {
    return { ...this.config }
  }

  getActiveE2eKey(): string | undefined {
    return this.config.enabled && this.config.e2eEnabled ? this.config.e2eKey : undefined
  }

  async configure(nextConfig: RelayConfig): Promise<void> {
    this.config = { ...DEFAULT_RELAY_CONFIG, ...nextConfig }
    this.e2eCryptoKey = null

    if (this.config.e2eEnabled && this.config.e2eKey) {
      this.e2eCryptoKey = await importE2eKey(this.config.e2eKey)
    }

    this.disconnectInternal()

    if (!this.config.enabled) {
      this.state = 'disabled'
      this.lastError = undefined
      this.reconnectAttempt = 0
      return
    }

    if (!this.config.relayUrl.trim() || !this.config.relaySecret.trim()) {
      this.state = 'error'
      this.lastError = '缺少中继 URL 或中继密钥'
      return
    }

    try {
      normalizeRelayOrigin(this.config.relayUrl)
    } catch (err) {
      this.state = 'error'
      this.lastError = err instanceof Error ? err.message : String(err)
      return
    }

    this.reconnectAttempt = 0
    this.connect()
  }

  /**
   * Immediately attempt reconnection (e.g. after system sleep/resume or network restore).
   */
  triggerReconnectNow(): void {
    if (this.disposed || !this.config.enabled) return
    if (this.state === 'connected' || this.state === 'connecting') {
      // Probe immediately with a ping
      if (this.hostWs && this.hostWs.readyState === WebSocket.OPEN) {
        this.lastPingSentAt = Date.now()
        try { this.hostWs.send(PING_FRAME) } catch {}
      }
      return
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.reconnectAttempt = 0
    this.connect()
  }

  stop(): void {
    this.disposed = true
    this.disconnectInternal()
    this.state = 'disabled'
  }

  getStatus(): RelayStatus {
    const today = new Date().toISOString().slice(0, 10)
    if (this.dayKey !== today) {
      this.dayKey = today
      this.requestsToday = 0
    }

    let origin = ''
    try {
      origin = this.config.relayUrl ? normalizeRelayOrigin(this.config.relayUrl) : ''
    } catch {
      origin = ''
    }

    const gateKey = this.config.gateKey?.trim()
    const publicUrl = origin && gateKey
      ? `${origin}/connect/${encodeURIComponent(gateKey)}`
      : (origin || undefined)

    const serverToken = this.deps.getServerToken()
    const e2ePart = this.config.e2eEnabled && this.config.e2eKey
      ? `e2e=${encodeURIComponent(this.config.e2eKey)}`
      : ''

    let qrAutoLoginUrl: string | undefined
    let qrManualLoginUrl: string | undefined
    if (publicUrl) {
      const autoParams = [
        serverToken ? `token=${encodeURIComponent(serverToken)}` : '',
        e2ePart,
      ].filter(Boolean).join('&')
      qrAutoLoginUrl = autoParams ? `${publicUrl}#${autoParams}` : publicUrl
      qrManualLoginUrl = e2ePart ? `${publicUrl}#${e2ePart}` : publicUrl
    }

    return {
      enabled: this.config.enabled,
      state: this.state,
      relayUrl: origin,
      publicUrl,
      qrAutoLoginUrl,
      qrManualLoginUrl,
      e2eEnabled: this.config.e2eEnabled,
      activeClients: this.clients.size,
      maxClients: this.config.maxClients ?? DEFAULT_RELAY_CONFIG.maxClients ?? 4,
      requestsToday: this.requestsToday,
      dailyRequestCap: this.config.dailyRequestCap ?? DEFAULT_RELAY_CONFIG.dailyRequestCap ?? 80_000,
      connectedAt: this.connectedAt,
      latencyMs: this.latencyMs,
      reconnectAttempt: this.reconnectAttempt > 0 ? this.reconnectAttempt : undefined,
      lastError: this.lastError,
      webuiAvailable: this.deps.handleWebuiRequest !== null,
    }
  }

  private disconnectInternal(): void {
    this.generation += 1
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.pingTimer) {
      clearInterval(this.pingTimer)
      this.pingTimer = null
    }
    for (const bridge of this.clients.values()) {
      bridge.closed = true
      try { bridge.ws.close(1000, 'Relay stopped') } catch {}
    }
    this.clients.clear()
    this.openingClients.clear()

    if (this.hostWs) {
      const old = this.hostWs
      this.hostWs = null
      old.removeAllListeners()
      try { old.close(1000, 'Client disconnect') } catch {}
    }
    this.connectedAt = undefined
    this.latencyMs = undefined
  }

  private connect(): void {
    if (this.disposed || !this.config.enabled) return

    const gen = ++this.generation
    const origin = normalizeRelayOrigin(this.config.relayUrl)
    const hostWsUrl = toHostWsUrl(origin)

    this.state = this.reconnectAttempt > 0 ? 'reconnecting' : 'connecting'
    const connectStartedAt = Date.now()

    const ws = new WebSocket(hostWsUrl, {
      headers: {
        Authorization: `Bearer ${this.config.relaySecret.trim()}`,
      },
      handshakeTimeout: 15_000,
    })
    this.hostWs = ws

    ws.on('open', () => {
      if (gen !== this.generation || this.hostWs !== ws) return
      this.state = 'connected'
      this.lastError = undefined
      this.connectedAt = Date.now()
      this.latencyMs = Math.max(1, this.connectedAt - connectStartedAt)
      this.reconnectAttempt = 0
      this.missedPongs = 0
      this.deps.logger?.info(`[relay] Connected to ${origin} (${this.latencyMs}ms)`)

      this.startHeartbeat(ws, gen)
    })

    ws.on('message', (data) => {
      if (gen !== this.generation || this.hostWs !== ws) return
      const text = typeof data === 'string' ? data : data.toString('utf8')
      if (text === PONG_FRAME) {
        this.missedPongs = 0
        if (this.lastPingSentAt > 0) {
          this.latencyMs = Math.max(1, Date.now() - this.lastPingSentAt)
        }
        return
      }
      this.handleRelayControlMessage(ws, gen, text)
    })

    ws.on('unexpected-response', (_req, res) => {
      if (gen !== this.generation || this.hostWs !== ws) return
      const status = res.statusCode ?? 0
      if (status === 401 || status === 403) {
        this.lastError = `中继鉴权失败（HTTP ${status}），请检查 Relay Secret 或重新一键部署。`
      } else {
        this.lastError = `中继握手失败（HTTP ${status}）`
      }
      this.deps.logger?.warn(`[relay] Unexpected response ${status} from ${origin}`)
    })

    ws.on('error', (err) => {
      if (gen !== this.generation || this.hostWs !== ws) return
      if (!this.lastError) {
        this.lastError = err.message || '中继连接异常'
      }
      this.deps.logger?.warn(`[relay] Socket error: ${err.message}`)
    })

    ws.on('close', (code, reasonBuf) => {
      if (gen !== this.generation) return
      if (this.pingTimer) {
        clearInterval(this.pingTimer)
        this.pingTimer = null
      }
      if (this.hostWs === ws) {
        this.hostWs = null
      }
      for (const bridge of this.clients.values()) {
        bridge.closed = true
        try { bridge.ws.close(1012, 'Relay disconnected') } catch {}
      }
      this.clients.clear()
      this.openingClients.clear()
      this.connectedAt = undefined

      if (!this.config.enabled || this.disposed) {
        this.state = 'disabled'
        return
      }

      const reason = reasonBuf.toString('utf8')
      if (!this.lastError && reason) {
        this.lastError = `${reason} (code ${code})`
      }
      this.scheduleReconnect(gen)
    })
  }

  private startHeartbeat(ws: WebSocket, gen: number): void {
    if (this.pingTimer) clearInterval(this.pingTimer)
    this.pingTimer = setInterval(() => {
      if (gen !== this.generation || this.hostWs !== ws || ws.readyState !== WebSocket.OPEN) {
        return
      }
      if (this.missedPongs >= MAX_MISSED_PONGS) {
        this.deps.logger?.warn('[relay] Heartbeat timeout — reconnecting')
        this.lastError = '中继心跳超时，正在重连'
        try { ws.terminate() } catch {}
        return
      }
      this.missedPongs += 1
      this.lastPingSentAt = Date.now()
      try { ws.send(PING_FRAME) } catch {}
    }, PING_INTERVAL_MS)
  }

  private scheduleReconnect(gen: number): void {
    if (this.disposed || !this.config.enabled || gen !== this.generation) return
    this.reconnectAttempt += 1
    this.state = 'reconnecting'
    const delayMs = Math.min(1000 * Math.pow(2, Math.min(this.reconnectAttempt - 1, 5)), 30_000)
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (gen === this.generation && this.config.enabled && !this.disposed) {
        this.connect()
      }
    }, delayMs)
  }

  private consumeLocalBudget(): boolean {
    const today = new Date().toISOString().slice(0, 10)
    if (this.dayKey !== today) {
      this.dayKey = today
      this.requestsToday = 0
    }
    const cap = Math.min(Math.max(this.config.dailyRequestCap ?? 80_000, 1_000), 95_000)
    if (this.requestsToday >= cap) return false
    this.requestsToday += 1
    return true
  }

  private sendHostJson(ws: WebSocket, payload: Record<string, unknown>): void {
    if (ws.readyState !== WebSocket.OPEN) return
    try {
      ws.send(JSON.stringify(payload))
    } catch {}
  }

  private handleRelayControlMessage(ws: WebSocket, gen: number, text: string): void {
    let msg: Record<string, unknown>
    try {
      msg = JSON.parse(text) as Record<string, unknown>
    } catch {
      return
    }

    const type = msg.t
    if (type === 'http_req') {
      void this.handleHttpRequest(ws, gen, msg)
      return
    }
    if (type === 'ws_open') {
      void this.handleClientWsOpen(ws, gen, msg)
      return
    }
    if (type === 'ws_msg') {
      this.handleClientWsMessage(ws, msg)
      return
    }
    if (type === 'ws_close') {
      this.handleClientWsClose(msg)
    }
  }

  private async handleHttpRequest(ws: WebSocket, gen: number, msg: Record<string, unknown>): Promise<void> {
    const reqId = String(msg.id ?? '')
    if (!reqId) return

    if (!this.consumeLocalBudget()) {
      this.sendHostJson(ws, {
        t: 'http_err',
        id: reqId,
        status: 429,
        message: 'Daily free-tier safety cap reached on desktop',
      })
      return
    }

    const handler = this.deps.handleWebuiRequest
    if (!handler) {
      this.sendHostJson(ws, {
        t: 'http_err',
        id: reqId,
        status: 503,
        message: 'Shiori WebUI bundle is not available on desktop',
      })
      return
    }

    try {
      const method = String(msg.method || 'GET').toUpperCase()
      const path = String(msg.path || '/')
      const rawHeaders = (msg.headers && typeof msg.headers === 'object')
        ? (msg.headers as Record<string, string>)
        : {}
      const forwardedHost = rawHeaders['x-forwarded-host'] || 'shiori-relay.local'
      const reqUrl = `https://${forwardedHost}${path.startsWith('/') ? path : `/${path}`}`

      const headers = new Headers()
      for (const [key, value] of Object.entries(rawHeaders)) {
        if (typeof value === 'string') headers.set(key, value)
      }
      headers.set('x-shiori-relay', '1')

      let body: Uint8Array | undefined
      if (method !== 'GET' && method !== 'HEAD' && typeof msg.bodyB64 === 'string' && msg.bodyB64.length > 0) {
        body = new Uint8Array(Buffer.from(msg.bodyB64, 'base64'))
      }

      const request = new Request(reqUrl, {
        method,
        headers,
        body: body ? (body.buffer as ArrayBuffer) : undefined,
      })

      const response = await handler(request)
      if (gen !== this.generation || this.hostWs !== ws || ws.readyState !== WebSocket.OPEN) {
        return
      }

      const responseHeaders = collectResponseHeaders(response.headers)
      const rawBuf = Buffer.from(await response.arrayBuffer())
      const contentType = response.headers.get('content-type') || ''

      let payloadBuf = rawBuf
      let compressed: 'gzip' | undefined
      if (rawBuf.byteLength >= GZIP_MIN_BYTES && isCompressibleContentType(contentType)) {
        const gz = gzipSync(rawBuf, { level: 6 })
        if (gz.byteLength < rawBuf.byteLength) {
          payloadBuf = gz
          compressed = 'gzip'
        }
      }

      if (payloadBuf.byteLength <= RAW_CHUNK_BYTES) {
        this.sendHostJson(ws, {
          t: 'http_res',
          id: reqId,
          status: response.status,
          headers: responseHeaders,
          compressed,
          bodyB64: payloadBuf.byteLength > 0 ? payloadBuf.toString('base64') : undefined,
        })
        return
      }

      // Stream large payloads in <= 384 KB raw chunks (~512 KB base64) to stay under CF 1 MiB WS limit
      this.sendHostJson(ws, {
        t: 'http_res_start',
        id: reqId,
        status: response.status,
        headers: responseHeaders,
        compressed,
      })
      for (let offset = 0; offset < payloadBuf.byteLength; offset += RAW_CHUNK_BYTES) {
        if (gen !== this.generation || this.hostWs !== ws || ws.readyState !== WebSocket.OPEN) {
          return
        }
        const slice = payloadBuf.subarray(offset, Math.min(offset + RAW_CHUNK_BYTES, payloadBuf.byteLength))
        this.sendHostJson(ws, {
          t: 'http_res_chunk',
          id: reqId,
          chunkB64: slice.toString('base64'),
        })
      }
      this.sendHostJson(ws, { t: 'http_res_end', id: reqId })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.deps.logger?.error(`[relay] HTTP proxy error: ${message}`)
      this.sendHostJson(ws, { t: 'http_err', id: reqId, status: 502, message: 'Internal proxy error' })
    }
  }

  private async handleClientWsOpen(ws: WebSocket, gen: number, msg: Record<string, unknown>): Promise<void> {
    const connId = String(msg.id ?? '')
    if (!connId) return

    if (!this.consumeLocalBudget()) {
      this.sendHostJson(ws, { t: 'ws_close', id: connId, code: 4429, reason: 'Daily quota guard reached' })
      return
    }

    const maxClients = Math.min(Math.max(this.config.maxClients ?? 4, 1), 16)
    if (this.clients.size + this.openingClients.size >= maxClients) {
      this.sendHostJson(ws, { t: 'ws_close', id: connId, code: 4429, reason: 'Too many concurrent clients' })
      return
    }

    // Register synchronously before awaiting cookie verification so immediate handshake frames are never dropped
    this.openingClients.set(connId, [])

    const cookieHeader = typeof msg.cookie === 'string' ? msg.cookie : null
    const isAuthed = await this.deps.validateSessionCookie(cookieHeader)
    const earlyMessages = this.openingClients.get(connId)
    this.openingClients.delete(connId)

    if (!earlyMessages) return // closed while opening
    if (gen !== this.generation || this.hostWs !== ws) return
    if (!isAuthed) {
      this.sendHostJson(ws, { t: 'ws_close', id: connId, code: 4401, reason: 'Unauthorized session' })
      return
    }

    const target = this.deps.getLocalWsTarget()
    const localWs = new WebSocket(target.url, {
      headers: cookieHeader ? { cookie: cookieHeader } : undefined,
      rejectUnauthorized: target.tls ? false : undefined,
    })

    const bridge: LocalClientBridge = {
      id: connId,
      ws: localWs,
      pendingToLocal: [],
      inChain: Promise.resolve(),
      outChain: Promise.resolve(),
      closed: false,
    }
    this.clients.set(connId, bridge)

    // Replay any frames that arrived while cookie auth was in flight
    for (const earlyMsg of earlyMessages) {
      this.handleClientWsMessage(ws, earlyMsg)
    }

    localWs.on('open', () => {
      if (bridge.closed) return
      for (const queued of bridge.pendingToLocal) {
        try { localWs.send(queued) } catch {}
      }
      bridge.pendingToLocal = []
    })

    localWs.on('message', (data) => {
      if (bridge.closed || gen !== this.generation || this.hostWs !== ws) return
      const plaintext = typeof data === 'string' ? data : data.toString('utf8')
      const key = this.config.e2eEnabled ? this.e2eCryptoKey : null

      bridge.outChain = bridge.outChain
        .then(async () => {
          if (bridge.closed || gen !== this.generation || this.hostWs !== ws) return
          const wire = key ? await encryptE2eText(key, plaintext) : plaintext
          this.sendHostJson(ws, { t: 'ws_msg', id: connId, data: wire })
        })
        .catch((err) => {
          this.deps.logger?.error(`[relay] Outgoing E2EE encrypt error: ${err instanceof Error ? err.message : String(err)}`)
        })
    })

    localWs.on('close', (code, reasonBuf) => {
      if (bridge.closed) return
      bridge.closed = true
      this.clients.delete(connId)
      if (gen === this.generation && this.hostWs === ws) {
        this.sendHostJson(ws, {
          t: 'ws_close',
          id: connId,
          code: code || 1000,
          reason: reasonBuf.toString('utf8'),
        })
      }
    })

    localWs.on('error', (err) => {
      this.deps.logger?.warn(`[relay] Local WS bridge error (${connId}): ${err.message}`)
      if (!bridge.closed) {
        bridge.closed = true
        this.clients.delete(connId)
        try { localWs.close() } catch {}
        if (gen === this.generation && this.hostWs === ws) {
          this.sendHostJson(ws, { t: 'ws_close', id: connId, code: 1011, reason: 'Local RPC error' })
        }
      }
    })
  }

  private handleClientWsMessage(ws: WebSocket, msg: Record<string, unknown>): void {
    const connId = String(msg.id ?? '')
    const openingQueue = this.openingClients.get(connId)
    if (openingQueue) {
      openingQueue.push(msg)
      return
    }
    const bridge = this.clients.get(connId)
    if (!bridge || bridge.closed) return

    const rawText = msg.binary && typeof msg.data === 'string'
      ? Buffer.from(msg.data, 'base64').toString('utf8')
      : String(msg.data ?? '')

    const key = this.config.e2eEnabled ? this.e2eCryptoKey : null

    bridge.inChain = bridge.inChain
      .then(async () => {
        if (bridge.closed) return
        let plaintext = rawText
        if (key) {
          try {
            plaintext = await decryptE2eText(key, rawText)
          } catch (err) {
            this.deps.logger?.warn(`[relay] Rejected client ${connId}: ${err instanceof Error ? err.message : String(err)}`)
            bridge.closed = true
            this.clients.delete(connId)
            try { bridge.ws.close(4403, 'E2EE decryption failed') } catch {}
            this.sendHostJson(ws, { t: 'ws_close', id: connId, code: 4403, reason: 'E2EE decryption failed' })
            return
          }
        }
        if (bridge.ws.readyState === WebSocket.OPEN) {
          bridge.ws.send(plaintext)
        } else if (bridge.ws.readyState === WebSocket.CONNECTING) {
          bridge.pendingToLocal.push(plaintext)
        }
      })
      .catch(() => {})
  }

  private handleClientWsClose(msg: Record<string, unknown>): void {
    const connId = String(msg.id ?? '')
    if (this.openingClients.delete(connId)) {
      return
    }
    const bridge = this.clients.get(connId)
    if (!bridge) return
    bridge.closed = true
    this.clients.delete(connId)
    try {
      const code = typeof msg.code === 'number' && (msg.code === 1000 || (msg.code >= 3000 && msg.code <= 4999))
        ? msg.code
        : 1000
      bridge.ws.close(code, typeof msg.reason === 'string' ? msg.reason : '')
    } catch {}
  }
}
