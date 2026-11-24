import { describe, expect, it } from 'bun:test'
import { SHIORI_RELAY_WORKER_SOURCE } from '../worker-source'

interface MockWs {
  readyState: number
  sent: string[]
  closed: Array<{ code: number; reason: string }>
  throwOnSend?: boolean
  attachment: Record<string, unknown> | null
  serializeAttachment(att: Record<string, unknown>): void
  deserializeAttachment(): Record<string, unknown> | null
  send(data: string): void
  close(code?: number, reason?: string): void
}

function createMockWs(opts?: { readyState?: number; throwOnSend?: boolean }): MockWs {
  const ws: MockWs = {
    readyState: opts?.readyState ?? 1,
    sent: [],
    closed: [],
    throwOnSend: opts?.throwOnSend ?? false,
    attachment: null,
    serializeAttachment(att) {
      this.attachment = att
    },
    deserializeAttachment() {
      return this.attachment
    },
    send(data) {
      if (this.throwOnSend || this.readyState !== 1) {
        throw new Error('Cannot send on closed/broken WebSocket')
      }
      this.sent.push(data)
    },
    close(code = 1000, reason = '') {
      this.closed.push({ code, reason })
      this.readyState = 2
    },
  }
  return ws
}

function loadTunnelRoomClass() {
  const stripped = SHIORI_RELAY_WORKER_SOURCE
    .replace(/^import\s+\{[^}]+\}\s+from\s+'cloudflare:workers'\s*\n/, '')
    .replace('export default {', 'const defaultExport = {')
    .replace('export class TunnelRoom extends DurableObject', 'class TunnelRoom extends DurableObject')

  class MockDurableObject {
    ctx: unknown
    env: unknown
    constructor(ctx: unknown, env: unknown) {
      this.ctx = ctx
      this.env = env
    }
  }

  class MockPair {
    request: string
    response: string
    constructor(req: string, res: string) {
      this.request = req
      this.response = res
    }
  }

  class MockWebSocketPair {
    0: MockWs
    1: MockWs
    constructor() {
      this[0] = createMockWs()
      this[1] = createMockWs()
    }
  }

  const factory = new Function(
    'DurableObject',
    'WebSocketRequestResponsePair',
    'WebSocketPair',
    `${stripped}\nreturn { TunnelRoom, defaultExport }`,
  )
  return factory(MockDurableObject, MockPair, MockWebSocketPair) as {
    TunnelRoom: new (ctx: unknown, env: Record<string, string>) => {
      fetch(req: Request): Promise<Response>
      webSocketMessage(ws: MockWs, msg: string): void
      webSocketClose(ws: MockWs, code: number, reason: string): void
      getHostSocket(): MockWs | null
    }
  }
}

function createMockCtx() {
  const tagged: Array<{ ws: MockWs; tags: string[] }> = []
  return {
    tagged,
    setWebSocketAutoResponse: () => {},
    acceptWebSocket(ws: MockWs, tags: string[] = []) {
      tagged.push({ ws, tags })
    },
    getWebSockets(tag?: string) {
      if (!tag) return tagged.map((t) => t.ws)
      return tagged.filter((t) => t.tags.includes(tag)).map((t) => t.ws)
    },
  }
}

describe('TunnelRoom host socket failover & lifecycle', () => {
  it('routes HTTP requests to the newest open host when an old closing host stays at index 0', async () => {
    const { TunnelRoom } = loadTunnelRoomClass()
    const ctx = createMockCtx()
    const room = new TunnelRoom(ctx, { MAX_CLIENTS: '4', DAILY_DO_REQUEST_CAP: '80000' })

    const oldHost = createMockWs({ readyState: 1 })
    ctx.acceptWebSocket(oldHost, ['host'])
    oldHost.serializeAttachment({ role: 'host', connectedAt: 1000, hostSeq: 1, replaced: false })

    const upgradeReq = new Request('https://relay.example.workers.dev/host', {
      headers: { upgrade: 'websocket' },
    })
    const upgradeRes = await room.fetch(upgradeReq)
    expect(upgradeRes.status).toBe(101)

    expect(ctx.getWebSockets('host').length).toBe(2)
    expect(ctx.getWebSockets('host')[0]).toBe(oldHost)
    expect(oldHost.readyState).toBe(2)

    const newHost = ctx.getWebSockets('host')[1]
    expect(room.getHostSocket()).toBe(newHost)

    const httpPromise = room.fetch(
      new Request('https://relay.example.workers.dev/', {
        headers: { accept: 'text/html' },
      }),
    )

    await Promise.resolve()
    expect(oldHost.sent.length).toBe(0)
    expect(newHost.sent.length).toBe(1)

    const forwarded = JSON.parse(newHost.sent[0]) as { t: string; id: string; path: string }
    expect(forwarded.t).toBe('http_req')
    expect(forwarded.path).toBe('/')

    const activeClient = createMockWs({ readyState: 1 })
    ctx.acceptWebSocket(activeClient, ['client', 'client-1'])
    activeClient.serializeAttachment({ role: 'client', connId: 'client-1' })

    room.webSocketClose(oldHost, 1000, 'Replaced by new host connection')
    expect(activeClient.closed.length).toBe(0)

    room.webSocketMessage(
      newHost,
      JSON.stringify({
        t: 'http_res',
        id: forwarded.id,
        status: 200,
        headers: [['content-type', 'text/html; charset=utf-8']],
        bodyB64: Buffer.from('<html>ok</html>').toString('base64'),
      }),
    )

    const res = await httpPromise
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('<html>ok</html>')
  })

  it('retires a half-dead host whose send() throws and falls back to the next open host', async () => {
    const { TunnelRoom } = loadTunnelRoomClass()
    const ctx = createMockCtx()
    const room = new TunnelRoom(ctx, { MAX_CLIENTS: '4', DAILY_DO_REQUEST_CAP: '80000' })

    const fallbackHost = createMockWs({ readyState: 1 })
    ctx.acceptWebSocket(fallbackHost, ['host'])
    fallbackHost.serializeAttachment({ role: 'host', connectedAt: 1000, hostSeq: 1, replaced: false })

    const brokenHost = createMockWs({ readyState: 1, throwOnSend: true })
    ctx.acceptWebSocket(brokenHost, ['host'])
    brokenHost.serializeAttachment({ role: 'host', connectedAt: 2000, hostSeq: 2, replaced: false })

    const httpPromise = room.fetch(new Request('https://relay.example.workers.dev/api/health'))
    await Promise.resolve()

    expect(brokenHost.closed.length).toBe(1)
    expect(fallbackHost.sent.length).toBe(1)

    const forwarded = JSON.parse(fallbackHost.sent[0]) as { id: string }
    room.webSocketMessage(
      fallbackHost,
      JSON.stringify({
        t: 'http_res',
        id: forwarded.id,
        status: 200,
        headers: [['content-type', 'application/json']],
        bodyB64: Buffer.from('{"ok":true}').toString('base64'),
      }),
    )

    const res = await httpPromise
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('{"ok":true}')
  })

  it('returns the friendly 503 offline HTML page when all host sockets fail on HTML navigation', async () => {
    const { TunnelRoom } = loadTunnelRoomClass()
    const ctx = createMockCtx()
    const room = new TunnelRoom(ctx, { MAX_CLIENTS: '4', DAILY_DO_REQUEST_CAP: '80000' })

    const brokenHost = createMockWs({ readyState: 1, throwOnSend: true })
    ctx.acceptWebSocket(brokenHost, ['host'])
    brokenHost.serializeAttachment({ role: 'host', connectedAt: 1000, hostSeq: 1, replaced: false })

    const res = await room.fetch(
      new Request('https://relay.example.workers.dev/', {
        headers: { accept: 'text/html' },
      }),
    )
    expect(res.status).toBe(503)
    expect(await res.text()).toContain('Shiori 桌面端当前离线')
  })
})
