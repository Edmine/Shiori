import { DurableObject } from 'cloudflare:workers'

const PING_FRAME = '__shiori_ping__'
const PONG_FRAME = '__shiori_pong__'
const GATE_COOKIE_NAME = 'shiori_relay_gate'
const MAX_HTTP_BODY_BYTES = 4 * 1024 * 1024
const MAX_WS_FRAME_BYTES = 2 * 1024 * 1024
const HTTP_TUNNEL_TIMEOUT_MS = 25_000
const DEFAULT_MAX_CLIENTS = 4
const DEFAULT_DAILY_CAP = 80_000
const HARD_MAX_DAILY_CAP = 95_000

const textEncoder = new TextEncoder()

function constantTimeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  const bytesA = textEncoder.encode(a)
  const bytesB = textEncoder.encode(b)
  if (bytesA.length !== bytesB.length) return false
  let diff = 0
  for (let idx = 0; idx < bytesA.length; idx++) {
    diff |= bytesA[idx] ^ bytesB[idx]
  }
  return diff === 0
}

function bytesToBase64(bytes) {
  let binary = ''
  const chunkSize = 0x8000
  for (let idx = 0; idx < bytes.length; idx += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(idx, idx + chunkSize))
  }
  return btoa(binary)
}

function bytesToBase64Url(bytes) {
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function base64ToBytes(b64) {
  const binary = atob(b64)
  const out = new Uint8Array(binary.length)
  for (let idx = 0; idx < binary.length; idx++) {
    out[idx] = binary.charCodeAt(idx)
  }
  return out
}

async function computeGateCookieValue(relaySecret, gateKey) {
  const key = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(relaySecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign(
    'HMAC',
    key,
    textEncoder.encode(`shiori-relay-gate:v1:${gateKey}`),
  )
  return `v1.${bytesToBase64Url(new Uint8Array(sig))}`
}

function getCookieValue(cookieHeader, name) {
  if (!cookieHeader) return null
  const prefix = `${name}=`
  for (const part of cookieHeader.split(';')) {
    const trimmed = part.trim()
    if (trimmed.startsWith(prefix)) {
      return trimmed.slice(prefix.length)
    }
  }
  return null
}

async function verifyGateCookie(request, env) {
  if (!env.RELAY_SECRET || !env.GATE_KEY) return false
  const actual = getCookieValue(request.headers.get('cookie'), GATE_COOKIE_NAME)
  if (!actual) return false
  const expected = await computeGateCookieValue(env.RELAY_SECRET, env.GATE_KEY)
  return constantTimeEqual(actual, expected)
}

function extractHostSecret(request, url) {
  const auth = request.headers.get('authorization') || ''
  if (auth.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim()
  }
  return url.searchParams.get('secret') || ''
}

function buildConnectRedirectHtml() {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>正在连接 Shiori...</title>
  <style>
    body { margin: 0; font-family: system-ui, -apple-system, sans-serif; display: grid; place-items: center; min-height: 100vh; background: #141417; color: #e8e6e1; }
    p { font-size: 14px; opacity: 0.85; }
    a { color: #7dd3fc; }
  </style>
</head>
<body>
  <p>正在建立加密连接...</p>
  <script>
    window.location.replace('/login' + (window.location.hash || ''));
  </script>
  <noscript><p><a href="/login">点击继续登录 Shiori</a></p></noscript>
</body>
</html>`
}

function buildOfflineHtml() {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Shiori 桌面端离线</title>
  <style>
    body { margin: 0; font-family: system-ui, -apple-system, sans-serif; display: grid; place-items: center; min-height: 100vh; padding: 24px; background: #f6f5f2; color: #1c1b18; }
    @media (prefers-color-scheme: dark) { body { background: #141417; color: #eceae4; } .card { background: #1e1e23; border-color: rgba(255,255,255,0.08); } }
    .card { max-width: 380px; width: 100%; background: #fff; border: 1px solid rgba(0,0,0,0.08); border-radius: 16px; padding: 28px 24px; text-align: center; box-shadow: 0 8px 30px rgba(0,0,0,0.06); }
    h1 { margin: 0 0 8px; font-size: 18px; font-weight: 600; }
    p { margin: 0 0 20px; font-size: 13.5px; line-height: 1.6; opacity: 0.72; }
    button { appearance: none; border: 0; border-radius: 10px; padding: 10px 18px; font-size: 14px; font-weight: 500; background: #2c6e78; color: #fff; cursor: pointer; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Shiori 桌面端当前离线</h1>
    <p>请确认电脑上的 Shiori 处于运行状态，并已在「设置 → 远程访问」中开启公网中继。</p>
    <button onclick="location.reload()">重新检测</button>
  </div>
</body>
</html>`
}

function buildQuotaHtml(cap) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Shiori 免费额度保护已触发</title>
  <style>
    body { margin: 0; font-family: system-ui, -apple-system, sans-serif; display: grid; place-items: center; min-height: 100vh; padding: 24px; background: #141417; color: #eceae4; }
    .card { max-width: 400px; background: #1e1e23; border: 1px solid rgba(255,255,255,0.08); border-radius: 16px; padding: 28px 24px; text-align: center; }
    h1 { margin: 0 0 8px; font-size: 18px; }
    p { margin: 0; font-size: 13.5px; line-height: 1.6; opacity: 0.75; }
  </style>
</head>
<body>
  <div class="card">
    <h1>今日免费额度保护已触发</h1>
    <p>已达到设定的单日请求上限（${cap} 次），中继已自动熔断以防止产生任何额外费用。UTC 00:00 后会自动恢复。</p>
  </div>
</body>
</html>`
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    const path = url.pathname

    // 1. Zero-DO-cost health check
    if (path === '/health') {
      return Response.json({
        ok: true,
        service: 'shiori-relay',
        version: '1.0.1',
        freeTierGuard: true,
      })
    }

    if (!env.RELAY_SECRET || !env.GATE_KEY) {
      return new Response('Relay secrets not configured', { status: 500 })
    }

    // 2. Desktop host outbound WebSocket registration (edge-authenticated before DO)
    if (path === '/host') {
      if ((request.headers.get('upgrade') || '').toLowerCase() !== 'websocket') {
        return new Response('Expected WebSocket upgrade', { status: 426 })
      }
      const secret = extractHostSecret(request, url)
      if (!constantTimeEqual(secret, env.RELAY_SECRET)) {
        return new Response('Unauthorized', { status: 401 })
      }
      const roomId = env.TUNNEL_ROOM.idFromName('default')
      return env.TUNNEL_ROOM.get(roomId).fetch(request)
    }

    // 3. One-tap QR / browser pairing gate (edge-authenticated, 0 DO cost)
    if (path.startsWith('/connect/')) {
      const providedKey = decodeURIComponent(path.slice('/connect/'.length).replace(/\/+$/, ''))
      if (!constantTimeEqual(providedKey, env.GATE_KEY)) {
        return new Response('Not Found', { status: 404 })
      }
      const cookieVal = await computeGateCookieValue(env.RELAY_SECRET, env.GATE_KEY)
      return new Response(buildConnectRedirectHtml(), {
        status: 200,
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
          'set-cookie': `${GATE_COOKIE_NAME}=${cookieVal}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000`,
        },
      })
    }

    // 4. Edge gate cookie verification — blocks all scanners/bots with 0 DO wakes
    const authorized = await verifyGateCookie(request, env)
    if (!authorized) {
      return new Response('Not Found', { status: 404 })
    }

    // 5. Authorized browser HTTP & WebSocket traffic routed to the single hibernatable DO
    const roomId = env.TUNNEL_ROOM.idFromName('default')
    return env.TUNNEL_ROOM.get(roomId).fetch(request)
  },
}

export class TunnelRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env)
    this.env = env
    this.pendingHttp = new Map()
    this.dayKey = ''
    this.dayRequests = 0
    this.hostSeq = 0

    // Heartbeats are answered by Cloudflare edge without waking the Durable Object (0 GB-s duration)
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(PING_FRAME, PONG_FRAME))
  }

  getDailyCap() {
    const parsed = parseInt(this.env.DAILY_DO_REQUEST_CAP || String(DEFAULT_DAILY_CAP), 10)
    if (!Number.isFinite(parsed) || parsed < 1000) return DEFAULT_DAILY_CAP
    return Math.min(parsed, HARD_MAX_DAILY_CAP)
  }

  getMaxClients() {
    const parsed = parseInt(this.env.MAX_CLIENTS || String(DEFAULT_MAX_CLIENTS), 10)
    if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_MAX_CLIENTS
    return Math.min(parsed, 16)
  }

  consumeDailyBudget() {
    const today = new Date().toISOString().slice(0, 10)
    if (this.dayKey !== today) {
      this.dayKey = today
      this.dayRequests = 0
    }
    const cap = this.getDailyCap()
    if (this.dayRequests >= cap) {
      return { allowed: false, cap }
    }
    this.dayRequests += 1
    return { allowed: true, cap }
  }

  getHostSockets() {
    const hosts = this.ctx.getWebSockets('host')
    const active = []
    for (let index = 0; index < hosts.length; index++) {
      const ws = hosts[index]
      if (ws.readyState !== undefined && ws.readyState !== 1) continue
      let att = null
      try {
        att = ws.deserializeAttachment()
      } catch {}
      if (att?.replaced) continue
      active.push({
        ws,
        connectedAt: Number(att?.connectedAt || 0),
        hostSeq: Number(att?.hostSeq || 0),
        index,
      })
    }
    active.sort((a, b) => b.connectedAt - a.connectedAt || b.hostSeq - a.hostSeq || b.index - a.index)
    return active.map((item) => item.ws)
  }

  getHostSocket() {
    const hosts = this.getHostSockets()
    return hosts.length > 0 ? hosts[0] : null
  }

  retireHostSocket(ws, code = 1000, reason = 'Replaced by new host connection') {
    try {
      const att = ws.deserializeAttachment() || {}
      ws.serializeAttachment({ ...att, role: 'host', replaced: true })
    } catch {}
    try {
      ws.close(code, reason)
    } catch {}
  }

  sendToHost(payload) {
    const hosts = this.getHostSockets()
    for (const host of hosts) {
      try {
        host.send(payload)
        return host
      } catch {
        this.retireHostSocket(host, 1011, 'Stale host socket')
      }
    }
    return null
  }

  async fetch(request) {
    const url = new URL(request.url)
    const isUpgrade = (request.headers.get('upgrade') || '').toLowerCase() === 'websocket'

    // Desktop host registration
    if (url.pathname === '/host' && isUpgrade) {
      const pair = new WebSocketPair()
      const [client, server] = Object.values(pair)
      this.ctx.acceptWebSocket(server, ['host'])
      server.serializeAttachment({
        role: 'host',
        hostId: crypto.randomUUID(),
        connectedAt: Date.now(),
        hostSeq: ++this.hostSeq,
        replaced: false,
      })
      for (const existing of this.ctx.getWebSockets('host')) {
        if (existing === server) continue
        this.retireHostSocket(existing, 1000, 'Replaced by new host connection')
      }
      return new Response(null, { status: 101, webSocket: client })
    }

    // Enforce daily request circuit breaker for all client traffic
    const budget = this.consumeDailyBudget()
    if (!budget.allowed) {
      const accept = request.headers.get('accept') || ''
      if (accept.includes('text/html')) {
        return new Response(buildQuotaHtml(budget.cap), {
          status: 429,
          headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
        })
      }
      return Response.json(
        { error: `Daily free-tier safety cap (${budget.cap}) reached` },
        { status: 429 },
      )
    }

    const host = this.getHostSocket()
    if (!host) {
      const accept = request.headers.get('accept') || ''
      if (!isUpgrade && (accept.includes('text/html') || url.pathname === '/' || url.pathname === '/login')) {
        return new Response(buildOfflineHtml(), {
          status: 503,
          headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
        })
      }
      return Response.json({ error: 'Shiori desktop host is offline' }, { status: 503 })
    }

    // Mobile browser WebSocket RPC upgrade
    if (isUpgrade) {
      const activeClients = this.ctx.getWebSockets('client')
      const maxClients = this.getMaxClients()
      if (activeClients.length >= maxClients) {
        return Response.json(
          { error: `Maximum concurrent clients (${maxClients}) reached` },
          { status: 429 },
        )
      }

      const connId = crypto.randomUUID()
      const openPayload = JSON.stringify({
        t: 'ws_open',
        id: connId,
        path: url.pathname + url.search,
        cookie: request.headers.get('cookie') || '',
      })
      if (!this.sendToHost(openPayload)) {
        return Response.json({ error: 'Shiori desktop host is offline' }, { status: 503 })
      }

      const pair = new WebSocketPair()
      const [client, server] = Object.values(pair)
      this.ctx.acceptWebSocket(server, ['client', connId])
      server.serializeAttachment({ role: 'client', connId })

      return new Response(null, { status: 101, webSocket: client })
    }

    // Mobile browser HTTP request tunneled to desktop embeddedWebuiHandler
    return this.proxyHttpRequest(request, url)
  }

  async proxyHttpRequest(request, url) {
    const contentLength = parseInt(request.headers.get('content-length') || '0', 10)
    if (Number.isFinite(contentLength) && contentLength > MAX_HTTP_BODY_BYTES) {
      return new Response('Payload Too Large', { status: 413 })
    }

    let bodyB64 = ''
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      const buf = new Uint8Array(await request.arrayBuffer())
      if (buf.byteLength > MAX_HTTP_BODY_BYTES) {
        return new Response('Payload Too Large', { status: 413 })
      }
      if (buf.byteLength > 0) {
        bodyB64 = bytesToBase64(buf)
      }
    }

    const forwardHeaders = {}
    const allowedHeaders = [
      'accept',
      'accept-language',
      'content-type',
      'cookie',
      'if-none-match',
      'if-modified-since',
      'origin',
      'referer',
      'user-agent',
    ]
    for (const name of allowedHeaders) {
      const val = request.headers.get(name)
      if (val) forwardHeaders[name] = val
    }
    forwardHeaders['x-shiori-relay'] = '1'
    forwardHeaders['x-forwarded-proto'] = 'https'
    forwardHeaders['x-forwarded-host'] = url.host

    const reqId = crypto.randomUUID()
    return new Promise((resolve) => {
      const entry = {
        resolve,
        settled: false,
        streamController: null,
        timer: null,
      }

      const armTimeout = () => {
        if (entry.timer) clearTimeout(entry.timer)
        entry.timer = setTimeout(() => {
          this.pendingHttp.delete(reqId)
          if (!entry.settled) {
            entry.settled = true
            resolve(new Response('Gateway Timeout', { status: 504 }))
          } else if (entry.streamController) {
            try {
              entry.streamController.error(new Error('Relay stream timeout'))
            } catch {}
          }
        }, HTTP_TUNNEL_TIMEOUT_MS)
      }

      entry.armTimeout = armTimeout
      armTimeout()
      this.pendingHttp.set(reqId, entry)

      const sentHost = this.sendToHost(JSON.stringify({
        t: 'http_req',
        id: reqId,
        method: request.method,
        path: url.pathname + url.search,
        headers: forwardHeaders,
        bodyB64: bodyB64 || undefined,
      }))
      if (!sentHost) {
        clearTimeout(entry.timer)
        this.pendingHttp.delete(reqId)
        entry.settled = true
        const accept = request.headers.get('accept') || ''
        if (accept.includes('text/html') || url.pathname === '/' || url.pathname === '/login') {
          resolve(new Response(buildOfflineHtml(), {
            status: 503,
            headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
          }))
        } else {
          resolve(new Response('Desktop host unreachable', { status: 502 }))
        }
      }
    })
  }

  buildResponseHeaders(rawHeaders) {
    const headers = new Headers()
    if (Array.isArray(rawHeaders)) {
      for (const pair of rawHeaders) {
        if (!Array.isArray(pair) || pair.length < 2) continue
        const key = String(pair[0]).toLowerCase()
        if (key === 'content-length' || key === 'content-encoding' || key === 'transfer-encoding') {
          continue
        }
        headers.append(pair[0], String(pair[1]))
      }
    }
    return headers
  }

  webSocketMessage(ws, message) {
    const att = ws.deserializeAttachment()
    if (!att) return

    if (att.role === 'host') {
      if (att.replaced) return
      if (typeof message !== 'string') return
      let msg
      try {
        msg = JSON.parse(message)
      } catch {
        return
      }
      this.handleHostMessage(msg)
      return
    }

    if (att.role === 'client') {
      const byteLen = typeof message === 'string'
        ? textEncoder.encode(message).byteLength
        : message.byteLength
      if (byteLen > MAX_WS_FRAME_BYTES) {
        try { ws.close(1009, 'Message too large') } catch {}
        return
      }

      const sentHost = this.sendToHost(JSON.stringify({
        t: 'ws_msg',
        id: att.connId,
        data: typeof message === 'string' ? message : bytesToBase64(new Uint8Array(message)),
        binary: typeof message !== 'string' ? true : undefined,
      }))
      if (!sentHost) {
        try { ws.close(1011, 'Desktop host offline') } catch {}
      }
    }
  }

  handleHostMessage(msg) {
    if (!msg || typeof msg.t !== 'string') return

    if (msg.t === 'http_res') {
      const entry = this.pendingHttp.get(msg.id)
      if (!entry) return
      clearTimeout(entry.timer)
      this.pendingHttp.delete(msg.id)
      if (entry.settled) return
      entry.settled = true

      const headers = this.buildResponseHeaders(msg.headers)
      const rawBytes = msg.bodyB64 ? base64ToBytes(msg.bodyB64) : new Uint8Array(0)
      let body = rawBytes.byteLength > 0 ? rawBytes : null
      if (body && msg.compressed === 'gzip') {
        const source = new ReadableStream({
          start(controller) {
            controller.enqueue(rawBytes)
            controller.close()
          },
        })
        body = source.pipeThrough(new DecompressionStream('gzip'))
      }
      entry.resolve(new Response(body, { status: msg.status || 200, headers }))
      return
    }

    if (msg.t === 'http_res_start') {
      const entry = this.pendingHttp.get(msg.id)
      if (!entry || entry.settled) return
      entry.settled = true
      entry.armTimeout()

      const headers = this.buildResponseHeaders(msg.headers)
      const rawStream = new ReadableStream({
        start(controller) {
          entry.streamController = controller
        },
        cancel: () => {
          clearTimeout(entry.timer)
          this.pendingHttp.delete(msg.id)
        },
      })
      const bodyStream = msg.compressed === 'gzip'
        ? rawStream.pipeThrough(new DecompressionStream('gzip'))
        : rawStream
      entry.resolve(new Response(bodyStream, { status: msg.status || 200, headers }))
      return
    }

    if (msg.t === 'http_res_chunk') {
      const entry = this.pendingHttp.get(msg.id)
      if (!entry || !entry.streamController) return
      entry.armTimeout()
      if (msg.chunkB64) {
        try {
          entry.streamController.enqueue(base64ToBytes(msg.chunkB64))
        } catch {}
      }
      return
    }

    if (msg.t === 'http_res_end') {
      const entry = this.pendingHttp.get(msg.id)
      if (!entry) return
      clearTimeout(entry.timer)
      this.pendingHttp.delete(msg.id)
      if (entry.streamController) {
        try {
          entry.streamController.close()
        } catch {}
      }
      return
    }

    if (msg.t === 'http_err') {
      const entry = this.pendingHttp.get(msg.id)
      if (!entry) return
      clearTimeout(entry.timer)
      this.pendingHttp.delete(msg.id)
      if (!entry.settled) {
        entry.settled = true
        entry.resolve(new Response(msg.message || 'Bad Gateway', { status: msg.status || 502 }))
      } else if (entry.streamController) {
        try {
          entry.streamController.error(new Error(msg.message || 'Relay stream error'))
        } catch {}
      }
      return
    }

    if (msg.t === 'ws_msg') {
      const clients = this.ctx.getWebSockets(msg.id)
      if (clients.length === 0) return
      try {
        const payload = msg.binary ? base64ToBytes(msg.data) : msg.data
        clients[0].send(payload)
      } catch {}
      return
    }

    if (msg.t === 'ws_close') {
      const clients = this.ctx.getWebSockets(msg.id)
      if (clients.length === 0) return
      try {
        const safeCode = typeof msg.code === 'number' && (msg.code === 1000 || (msg.code >= 3000 && msg.code <= 4999))
          ? msg.code
          : 1000
        clients[0].close(safeCode, msg.reason || '')
      } catch {}
    }
  }

  webSocketClose(ws, code, reason) {
    const att = ws.deserializeAttachment()
    if (!att) return

    if (att.role === 'host') {
      if (att.replaced) return
      if (this.getHostSockets().some((candidate) => candidate !== ws)) {
        return
      }
      for (const [reqId, entry] of this.pendingHttp.entries()) {
        clearTimeout(entry.timer)
        this.pendingHttp.delete(reqId)
        if (!entry.settled) {
          entry.settled = true
          entry.resolve(new Response('Desktop host disconnected', { status: 503 }))
        } else if (entry.streamController) {
          try { entry.streamController.error(new Error('Desktop host disconnected')) } catch {}
        }
      }
      for (const clientWs of this.ctx.getWebSockets('client')) {
        try { clientWs.close(1012, 'Desktop host disconnected') } catch {}
      }
      return
    }

    if (att.role === 'client') {
      this.sendToHost(JSON.stringify({
        t: 'ws_close',
        id: att.connId,
        code: code || 1000,
        reason: reason || '',
      }))
    }
  }

  webSocketError(ws) {
    this.webSocketClose(ws, 1011, 'WebSocket error')
  }
}
