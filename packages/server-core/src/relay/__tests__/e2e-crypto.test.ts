import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  createE2eFrameCodec,
  decryptE2eText,
  encryptE2eText,
  generateE2eKeyBase64Url,
  importE2eKey,
  isE2eEnvelope,
} from '../e2e-crypto'
import { SHIORI_RELAY_WORKER_SOURCE } from '../worker-source'

describe('relay e2e-crypto (AES-256-GCM)', () => {
  it('round-trips UTF-8 and Chinese payloads with unique IVs', async () => {
    const keyB64 = generateE2eKeyBase64Url()
    const codec = await createE2eFrameCodec(keyB64)
    const payload = JSON.stringify({ type: 'request', channel: 'chat:send', text: '你好 Shiori 🔖' })

    const enc1 = await codec.encode(payload)
    const enc2 = await codec.encode(payload)
    expect(enc1).not.toBe(enc2)
    expect(enc1).not.toContain('你好')
    expect(isE2eEnvelope(JSON.parse(enc1))).toBe(true)

    const dec1 = await codec.decode(enc1)
    const dec2 = await codec.decode(enc2)
    expect(dec1).toBe(payload)
    expect(dec2).toBe(payload)
  })

  it('rejects wrong keys, tampered ciphertexts, and unencrypted frames', async () => {
    const keyA = await importE2eKey(generateE2eKeyBase64Url())
    const keyB = await importE2eKey(generateE2eKeyBase64Url())
    const wire = await encryptE2eText(keyA, 'secret-token-value')

    await expect(decryptE2eText(keyB, wire)).rejects.toThrow()

    const tampered = JSON.parse(wire) as { __shiori_e2e__: 1; iv: string; ct: string }
    tampered.ct = tampered.ct.slice(0, -2) + (tampered.ct.endsWith('AA') ? 'BB' : 'AA')
    await expect(decryptE2eText(keyA, JSON.stringify(tampered))).rejects.toThrow()

    await expect(decryptE2eText(keyA, JSON.stringify({ type: 'handshake' }))).rejects.toThrow(
      /E2E required/,
    )
  })

  it('keeps bundled SHIORI_RELAY_WORKER_SOURCE strictly identical to apps/relay/worker.mjs', () => {
    const diskPath = resolve(import.meta.dir, '../../../../../apps/relay/worker.mjs')
    const diskSource = readFileSync(diskPath, 'utf8')
    expect(SHIORI_RELAY_WORKER_SOURCE.replace(/\r\n/g, '\n').trim()).toBe(
      diskSource.replace(/\r\n/g, '\n').trim(),
    )
    expect(SHIORI_RELAY_WORKER_SOURCE).toContain('setWebSocketAutoResponse')
    expect(SHIORI_RELAY_WORKER_SOURCE).toContain('DAILY_DO_REQUEST_CAP')
    expect(SHIORI_RELAY_WORKER_SOURCE).toContain('shiori_relay_gate')
  })
})
