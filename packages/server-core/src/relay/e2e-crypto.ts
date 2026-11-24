/**
 * End-to-End Encryption (AES-256-GCM) for Shiori Cloudflare Workers Relay.
 *
 * Uses standard WebCrypto (`globalThis.crypto.subtle`) so the exact same
 * module works in Electron main (Node.js), Bun, and mobile browsers.
 *
 * Wire format:
 *   { "__shiori_e2e__": 1, "iv": "<12-byte base64url>", "ct": "<ciphertext+tag base64url>" }
 */

export const E2E_WIRE_VERSION = 1 as const
export const E2E_STORAGE_KEY = 'shiori_relay_e2e_key'

export interface E2eEnvelope {
  __shiori_e2e__: 1
  iv: string
  ct: string
}

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

export function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let idx = 0; idx < bytes.length; idx += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(idx, idx + chunkSize))
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

export function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((value.length + 3) % 4)
  const binary = atob(padded)
  const out = new Uint8Array(binary.length)
  for (let idx = 0; idx < binary.length; idx++) {
    out[idx] = binary.charCodeAt(idx)
  }
  return out
}

/**
 * Generate a random 256-bit AES-GCM key encoded as base64url (43 chars).
 */
export function generateE2eKeyBase64Url(): string {
  const raw = new Uint8Array(32)
  globalThis.crypto.getRandomValues(raw)
  return bytesToBase64Url(raw)
}

/**
 * Generate a high-entropy URL-safe secret (default 24 bytes = 192 bits).
 */
export function generateUrlSafeSecret(numBytes = 24): string {
  const raw = new Uint8Array(numBytes)
  globalThis.crypto.getRandomValues(raw)
  return bytesToBase64Url(raw)
}

export async function importE2eKey(keyBase64Url: string): Promise<CryptoKey> {
  const raw = base64UrlToBytes(keyBase64Url)
  if (raw.byteLength !== 32) {
    throw new Error(`Invalid E2E key length: expected 32 bytes, got ${raw.byteLength}`)
  }
  return globalThis.crypto.subtle.importKey(
    'raw',
    raw.buffer as ArrayBuffer,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt'],
  )
}

export function isE2eEnvelope(value: unknown): value is E2eEnvelope {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return (
    record.__shiori_e2e__ === E2E_WIRE_VERSION &&
    typeof record.iv === 'string' &&
    typeof record.ct === 'string'
  )
}

export async function encryptE2eText(key: CryptoKey, plaintext: string): Promise<string> {
  const iv = new Uint8Array(12)
  globalThis.crypto.getRandomValues(iv)
  const cipherBuf = await globalThis.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    textEncoder.encode(plaintext),
  )
  const envelope: E2eEnvelope = {
    __shiori_e2e__: E2E_WIRE_VERSION,
    iv: bytesToBase64Url(iv),
    ct: bytesToBase64Url(new Uint8Array(cipherBuf)),
  }
  return JSON.stringify(envelope)
}

export async function decryptE2eText(key: CryptoKey, wireText: string): Promise<string> {
  let parsed: unknown
  try {
    parsed = JSON.parse(wireText)
  } catch {
    throw new Error('E2E frame is not valid JSON')
  }
  if (!isE2eEnvelope(parsed)) {
    throw new Error('Unencrypted or malformed frame rejected (E2E required)')
  }
  const iv = base64UrlToBytes(parsed.iv)
  if (iv.byteLength !== 12) {
    throw new Error('Invalid AES-GCM IV length')
  }
  const ciphertext = base64UrlToBytes(parsed.ct)
  const plainBuf = await globalThis.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv.buffer as ArrayBuffer },
    key,
    ciphertext.buffer as ArrayBuffer,
  )
  return textDecoder.decode(plainBuf)
}

export async function decryptE2eEnvelopeObject(key: CryptoKey, envelope: E2eEnvelope): Promise<string> {
  const iv = base64UrlToBytes(envelope.iv)
  if (iv.byteLength !== 12) {
    throw new Error('Invalid AES-GCM IV length')
  }
  const ciphertext = base64UrlToBytes(envelope.ct)
  const plainBuf = await globalThis.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv.buffer as ArrayBuffer },
    key,
    ciphertext.buffer as ArrayBuffer,
  )
  return textDecoder.decode(plainBuf)
}

export interface E2eFrameCodec {
  encode(raw: string): Promise<string>
  decode(raw: string): Promise<string>
}

export async function createE2eFrameCodec(keyBase64Url: string): Promise<E2eFrameCodec> {
  const cryptoKey = await importE2eKey(keyBase64Url)
  return {
    encode: (raw: string) => encryptE2eText(cryptoKey, raw),
    decode: (raw: string) => decryptE2eText(cryptoKey, raw),
  }
}
