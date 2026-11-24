import { describe, expect, it } from 'bun:test'
import {
  deleteCloudflareRelay,
  deployCloudflareRelay,
  verifyCloudflareToken,
  type FetchLike,
} from '../cloudflare-deployer'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('cloudflare-deployer', () => {
  it('verifies token and discovers account, subdomain, and existing script', async () => {
    const mockFetch: FetchLike = async (input) => {
      const url = String(input)
      if (url.endsWith('/accounts?per_page=50')) {
        return jsonResponse({ success: true, result: [{ id: 'acc-123', name: 'My Free CF' }] })
      }
      if (url.endsWith('/accounts/acc-123/workers/subdomain')) {
        return jsonResponse({ success: true, result: { subdomain: 'alice-cf' } })
      }
      if (url.endsWith('/accounts/acc-123/workers/scripts/shiori-relay/settings')) {
        return jsonResponse({ success: true, result: { bindings: [] } })
      }
      return jsonResponse({ success: false }, 404)
    }

    const res = await verifyCloudflareToken('cf-token-abc', { fetchImpl: mockFetch })
    expect(res.ok).toBe(true)
    expect(res.accounts).toEqual([
      { id: 'acc-123', name: 'My Free CF', subdomain: 'alice-cf', existingScript: true },
    ])
  })

  it('prompts for manual Account ID when token lacks /accounts read scope (403)', async () => {
    const mockFetch: FetchLike = async () => jsonResponse({ success: false, errors: [{ message: 'Forbidden' }] }, 403)
    const res = await verifyCloudflareToken('cf-narrow-token', { fetchImpl: mockFetch })
    expect(res.ok).toBe(false)
    expect(res.needsManualAccountId).toBe(true)
  })

  it('deploys brand-new free-tier worker: claims subdomain, attaches SQLite DO migration & cost caps, enables route, checks health', async () => {
    const calls: Array<{ method: string; url: string }> = []
    let uploadedMetadata: Record<string, unknown> | null = null
    let subdomainPutBody: Record<string, unknown> | null = null

    const mockFetch: FetchLike = async (input, init) => {
      const url = String(input)
      const method = init?.method || 'GET'
      calls.push({ method, url })

      if (url.endsWith('/accounts/acc-new/workers/subdomain') && method === 'GET') {
        return jsonResponse({ success: false, errors: [{ code: 10007, message: 'Not found' }] }, 404)
      }
      if (url.endsWith('/accounts/acc-new/workers/subdomain') && method === 'PUT') {
        subdomainPutBody = JSON.parse(String(init?.body)) as Record<string, unknown>
        return jsonResponse({ success: true, result: { subdomain: subdomainPutBody.subdomain } })
      }
      if (url.endsWith('/accounts/acc-new/workers/scripts/shiori-relay/settings')) {
        return jsonResponse({ success: false }, 404)
      }
      if (url.endsWith('/accounts/acc-new/workers/scripts/shiori-relay') && method === 'PUT') {
        const form = init?.body as FormData
        const metaBlob = form.get('metadata') as Blob
        uploadedMetadata = JSON.parse(await metaBlob.text()) as Record<string, unknown>
        return jsonResponse({ success: true, result: { id: 'shiori-relay' } })
      }
      if (url.endsWith('/accounts/acc-new/workers/scripts/shiori-relay/subdomain') && method === 'POST') {
        return jsonResponse({ success: true, result: { enabled: true } })
      }
      if (url === 'https://shiori-relay.my-shiori.workers.dev/health') {
        return jsonResponse({ ok: true, service: 'shiori-relay' })
      }
      return jsonResponse({ success: false }, 404)
    }

    const result = await deployCloudflareRelay(
      {
        apiToken: 'cf-token-xyz',
        accountId: 'acc-new',
        desiredSubdomain: 'my-shiori',
        dailyRequestCap: 999_999, // Must be clamped to <= 95,000 free-tier safety ceiling
        maxClients: 4,
      },
      { fetchImpl: mockFetch, healthRetryDelayMs: 0 },
    )

    expect(result.relayUrl).toBe('https://shiori-relay.my-shiori.workers.dev')
    expect(result.healthOk).toBe(true)
    expect(result.relaySecret.length).toBeGreaterThanOrEqual(32)
    expect(result.gateKey.length).toBeGreaterThanOrEqual(20)
    expect(result.e2eKey.length).toBeGreaterThanOrEqual(40)

    expect(uploadedMetadata).not.toBeNull()
    expect(uploadedMetadata!.observability).toEqual({ enabled: false })
    expect(uploadedMetadata!.migrations).toEqual({
      new_tag: 'v1',
      new_sqlite_classes: ['TunnelRoom'],
    })
    const bindings = uploadedMetadata!.bindings as Array<{ name: string; text?: string }>
    expect(bindings.find((b) => b.name === 'DAILY_DO_REQUEST_CAP')?.text).toBe('95000')
    expect(bindings.find((b) => b.name === 'MAX_CLIENTS')?.text).toBe('4')
    expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/subdomain'))).toBe(true)
  })

  it('skips DO migration when re-deploying over an existing TunnelRoom worker and supports 1-click delete', async () => {
    let uploadedMetadata: Record<string, unknown> | null = null
    let deletedUrl = ''

    const mockFetch: FetchLike = async (input, init) => {
      const url = String(input)
      const method = init?.method || 'GET'
      if (url.endsWith('/workers/subdomain') && method === 'GET') {
        return jsonResponse({ success: true, result: { subdomain: 'existing-sub' } })
      }
      if (url.endsWith('/settings')) {
        return jsonResponse({
          success: true,
          result: {
            bindings: [{ type: 'durable_object_namespace', name: 'TUNNEL_ROOM', class_name: 'TunnelRoom' }],
          },
        })
      }
      if (url.endsWith('/scripts/shiori-relay') && method === 'PUT') {
        const form = init?.body as FormData
        uploadedMetadata = JSON.parse(await (form.get('metadata') as Blob).text()) as Record<string, unknown>
        return jsonResponse({ success: true, result: {} })
      }
      if (url.endsWith('/scripts/shiori-relay/subdomain') && method === 'POST') {
        return jsonResponse({ success: true, result: { enabled: true } })
      }
      if (url.endsWith('/health')) {
        return jsonResponse({ ok: true, service: 'shiori-relay' })
      }
      if (method === 'DELETE') {
        deletedUrl = url
        return jsonResponse({ success: true, result: {} })
      }
      return jsonResponse({ success: false }, 404)
    }

    const deployed = await deployCloudflareRelay(
      { apiToken: 'tok', accountId: 'acc-1' },
      { fetchImpl: mockFetch, healthRetryDelayMs: 0 },
    )
    expect(deployed.relayUrl).toBe('https://shiori-relay.existing-sub.workers.dev')
    expect(uploadedMetadata!.migrations).toBeUndefined()

    await deleteCloudflareRelay(
      { apiToken: 'tok', accountId: 'acc-1', scriptName: 'shiori-relay' },
      { fetchImpl: mockFetch },
    )
    expect(deletedUrl).toContain('/accounts/acc-1/workers/scripts/shiori-relay?force=true')
  })
})
