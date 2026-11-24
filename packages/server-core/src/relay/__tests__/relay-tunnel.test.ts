import { afterEach, describe, expect, it } from 'bun:test'
import { WebSocketServer, type WebSocket } from 'ws'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { gunzipSync } from 'node:zlib'
import { createWebuiHandler, validateSession } from '../../webui'
import { RelayTunnelClient } from '../relay-client'
import { createE2eFrameCodec, generateE2eKeyBase64Url } from '../e2e-crypto'

const cleanupTasks: Array<() => Promise<void> | void> = []

afterEach(async () => {
  while (cleanupTasks.length > 0) {
    const fn = cleanupTasks.pop()!
    await fn()
  }
})

async function startWsServer(): Promise<{ wss: WebSocketServer; port: number }> {
  const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 })
  await new Promise<void>((resolve) => wss.once('listening', () => resolve()))
  const addr = wss.address() as { port: number }
  cleanupTasks.push(() => new Promise<void>((resolve) => wss.close(() => resolve())))
  return { wss, port: addr.port }
}

describe('RelayTunnelClient end-to-end', () => {
  it('tunnels E2EE auth, gzip+chunked large assets, /api/config wsUrl, and E2EE WebSocket RPC while blocking unauthenticated WS', async () => {
    // 1. Create temp WebUI static dir with a large compressible asset (> 500 KB)
    const webuiDir = mkdtempSync(join(tmpdir(), 'shiori-relay-test-'))
    cleanupTasks.push(() => rmSync(webuiDir, { recursive: true, force: true }))
    mkdirSync(join(webuiDir, 'assets'), { recursive: true })
    writeFileSync(join(webuiDir, 'index.html'), '<!doctype html><html><body>Shiori</body></html>')
    writeFileSync(join(webuiDir, 'login.html'), '<!doctype html><html><body>Login</body></html>')
    // High-entropy-ish repeated JS so even gzipped/raw exercises streaming cleanly
    const largeAsset = Array.from({ length: 20_000 }, (_, i) => `const item_${i} = "val_${i}_shiori";`).join('\n')
    writeFileSync(join(webuiDir, 'assets', 'bundle-abc123.js'), largeAsset)

    const serverToken = 'test-server-secret-token'
    const relaySecret = 'test-relay-secret-xyz'
    const e2eKey = generateE2eKeyBase64Url()
    const phoneCodec = await createE2eFrameCodec(e2eKey)

    // 2. Local echo WS representing local WsRpcServer
    const { wss: localRpcWss, port: localRpcPort } = await startWsServer()
    const localReceived: string[] = []
    localRpcWss.on('connection', (sock) => {
      sock.on('message', (data) => {
        const text = data.toString('utf8')
        localReceived.push(text)
        sock.send(JSON.stringify({ echoed: JSON.parse(text) }))
      })
    })

    // 3. Mock Cloudflare Relay server (/host)
    const { wss: mockRelayWss, port: relayPort } = await startWsServer()
    let hostSocket: WebSocket | null = null
    let hostAuthHeader = ''
    const hostConnected = new Promise<WebSocket>((resolve) => {
      mockRelayWss.on('connection', (sock, req) => {
        hostAuthHeader = String(req.headers.authorization || '')
        hostSocket = sock
        resolve(sock)
      })
    })

    // 4. Embedded WebUI handler + RelayTunnelClient
    let tunnelClient!: RelayTunnelClient
    const webuiHandler = createWebuiHandler({
      webuiDir,
      secret: serverToken,
      wsProtocol: 'ws',
      wsPort: localRpcPort,
      getHealthCheck: () => ({ status: 'ok' }),
      logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
      getRelayE2eKey: () => tunnelClient.getActiveE2eKey(),
    })
    cleanupTasks.push(() => webuiHandler.dispose())

    tunnelClient = new RelayTunnelClient({
      getLocalWsTarget: () => ({ url: `ws://127.0.0.1:${localRpcPort}`, tls: false }),
      handleWebuiRequest: webuiHandler.fetch,
      validateSessionCookie: async (cookie) => (await validateSession(cookie, serverToken)) !== null,
      getServerToken: () => serverToken,
    })
    cleanupTasks.push(() => tunnelClient.stop())

    await tunnelClient.configure({
      enabled: true,
      relayUrl: `http://127.0.0.1:${relayPort}`,
      relaySecret,
      gateKey: 'gate-123',
      e2eEnabled: true,
      e2eKey,
      maxClients: 4,
      dailyRequestCap: 80_000,
    })

    const ws = await hostConnected
    expect(hostAuthHeader).toBe(`Bearer ${relaySecret}`)

    // Helper to send a tunnel HTTP request and collect single or chunked response
    const sendHttpThroughRelay = (req: Record<string, unknown>) =>
      new Promise<{ status: number; headers: Array<[string, string]>; body: Buffer }>((resolve, reject) => {
        const chunks: Buffer[] = []
        let status = 200
        let headers: Array<[string, string]> = []
        let compressed: string | undefined
        const onMsg = (raw: WebSocket.RawData) => {
          const msg = JSON.parse(raw.toString('utf8')) as Record<string, unknown>
          if (msg.id !== req.id) return
          if (msg.t === 'http_res') {
            ws.off('message', onMsg)
            const buf = msg.bodyB64 ? Buffer.from(String(msg.bodyB64), 'base64') : Buffer.alloc(0)
            const finalBuf = msg.compressed === 'gzip' ? gunzipSync(buf) : buf
            resolve({ status: Number(msg.status), headers: msg.headers as Array<[string, string]>, body: finalBuf })
          } else if (msg.t === 'http_res_start') {
            status = Number(msg.status)
            headers = msg.headers as Array<[string, string]>
            compressed = typeof msg.compressed === 'string' ? msg.compressed : undefined
          } else if (msg.t === 'http_res_chunk') {
            chunks.push(Buffer.from(String(msg.chunkB64), 'base64'))
          } else if (msg.t === 'http_res_end') {
            ws.off('message', onMsg)
            const joined = Buffer.concat(chunks)
            resolve({ status, headers, body: compressed === 'gzip' ? gunzipSync(joined) : joined })
          } else if (msg.t === 'http_err') {
            ws.off('message', onMsg)
            reject(new Error(String(msg.message)))
          }
        }
        ws.on('message', onMsg)
        ws.send(JSON.stringify({ t: 'http_req', ...req }))
      })

    // A. Encrypted /api/auth login (token never in plaintext over relay!)
    const encryptedLoginBody = await phoneCodec.encode(JSON.stringify({ password: serverToken }))
    const authRes = await sendHttpThroughRelay({
      id: 'req-auth',
      method: 'POST',
      path: '/api/auth',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'shiori-relay.alice.workers.dev',
      },
      bodyB64: Buffer.from(encryptedLoginBody, 'utf8').toString('base64'),
    })
    expect(authRes.status).toBe(200)
    const setCookiePair = authRes.headers.find(([k]) => k.toLowerCase() === 'set-cookie')
    expect(setCookiePair).toBeDefined()
    const sessionCookie = setCookiePair![1].split(';')[0]!

    // B. /api/config resolves relay wss://.../ws (no :9100!) and e2eRequired: true
    const configRes = await sendHttpThroughRelay({
      id: 'req-config',
      method: 'GET',
      path: '/api/config',
      headers: {
        cookie: sessionCookie,
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'shiori-relay.alice.workers.dev',
      },
    })
    expect(configRes.status).toBe(200)
    const cfgJson = JSON.parse(configRes.body.toString('utf8')) as { wsUrl: string; e2eRequired: boolean }
    expect(cfgJson).toEqual({
      wsUrl: 'wss://shiori-relay.alice.workers.dev/ws',
      e2eRequired: true,
    })

    // C. Large asset receives immutable Cache-Control and decompresses identically
    const assetRes = await sendHttpThroughRelay({
      id: 'req-asset',
      method: 'GET',
      path: '/assets/bundle-abc123.js',
      headers: {
        cookie: sessionCookie,
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'shiori-relay.alice.workers.dev',
      },
    })
    expect(assetRes.status).toBe(200)
    expect(assetRes.headers.find(([k]) => k.toLowerCase() === 'cache-control')?.[1]).toContain('immutable')
    expect(assetRes.body.toString('utf8')).toBe(largeAsset)

    // D. Unauthenticated ws_open is rejected with 4401
    const unauthClose = new Promise<Record<string, unknown>>((resolve) => {
      const onMsg = (raw: WebSocket.RawData) => {
        const msg = JSON.parse(raw.toString('utf8')) as Record<string, unknown>
        if (msg.t === 'ws_close' && msg.id === 'conn-unauth') {
          ws.off('message', onMsg)
          resolve(msg)
        }
      }
      ws.on('message', onMsg)
    })
    ws.send(JSON.stringify({ t: 'ws_open', id: 'conn-unauth', path: '/ws', cookie: '' }))
    expect((await unauthClose).code).toBe(4401)

    // E. Authenticated WS with AES-256-GCM E2EE round-trip
    const encryptedEchoReply = new Promise<string>((resolve) => {
      const onMsg = (raw: WebSocket.RawData) => {
        const msg = JSON.parse(raw.toString('utf8')) as Record<string, unknown>
        if (msg.t === 'ws_msg' && msg.id === 'conn-ok') {
          ws.off('message', onMsg)
          resolve(String(msg.data))
        }
      }
      ws.on('message', onMsg)
    })
    ws.send(JSON.stringify({ t: 'ws_open', id: 'conn-ok', path: '/ws', cookie: sessionCookie }))
    const phoneMsg = JSON.stringify({ hello: 'from-mobile-4g' })
    const phoneCipher = await phoneCodec.encode(phoneMsg)
    ws.send(JSON.stringify({ t: 'ws_msg', id: 'conn-ok', data: phoneCipher }))

    const relayWireReply = await encryptedEchoReply
    // Relay never saw plaintext!
    expect(relayWireReply).not.toContain('from-mobile-4g')
    expect(localReceived).toEqual([phoneMsg])
    const decryptedReply = await phoneCodec.decode(relayWireReply)
    expect(JSON.parse(decryptedReply)).toEqual({ echoed: { hello: 'from-mobile-4g' } })

    // F. Plaintext injection on an E2EE connection is rejected with 4403
    const e2eRejectClose = new Promise<Record<string, unknown>>((resolve) => {
      const onMsg = (raw: WebSocket.RawData) => {
        const msg = JSON.parse(raw.toString('utf8')) as Record<string, unknown>
        if (msg.t === 'ws_close' && msg.id === 'conn-ok') {
          ws.off('message', onMsg)
          resolve(msg)
        }
      }
      ws.on('message', onMsg)
    })
    ws.send(JSON.stringify({ t: 'ws_msg', id: 'conn-ok', data: '{"plaintext":"attack"}' }))
    expect((await e2eRejectClose).code).toBe(4403)
  })
})
