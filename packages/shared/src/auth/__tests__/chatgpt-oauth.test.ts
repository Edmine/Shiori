import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { generateKeyPairSync, sign as cryptoSign } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const TEST_DISCOVERY_DOC = {
  issuer: 'https://auth.openai.com',
  authorization_endpoint: 'https://auth.openai.com/api/accounts/authorize',
  token_endpoint: 'https://auth.openai.com/api/accounts/oauth/token',
  jwks_uri: 'https://auth.openai.com/.well-known/jwks.json',
  revocation_endpoint: 'https://auth.openai.com/api/accounts/oauth/revoke',
};

const { publicKey: testPubKey, privateKey: testPrivKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
});
const testJwk = {
  ...(testPubKey.export({ format: 'jwk' }) as Record<string, unknown>),
  kid: 'test-key-1',
  use: 'sig',
  alg: 'RS256',
};

function signTestIdToken(
  payload: Record<string, unknown>,
  headerOverrides?: Record<string, unknown>,
): string {
  const header = { alg: 'RS256', typ: 'JWT', kid: 'test-key-1', ...headerOverrides };
  const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = cryptoSign('RSA-SHA256', Buffer.from(signingInput, 'utf8'), testPrivKey).toString('base64url');
  return `${signingInput}.${signature}`;
}

function makeValidIdToken(options: { clientId: string; nonce?: string; expOffsetSec?: number }): string {
  const nowSec = Math.floor(Date.now() / 1000);
  return signTestIdToken({
    iss: 'https://auth.openai.com',
    sub: 'user-siwc-123',
    aud: options.clientId,
    iat: nowSec - 5,
    exp: nowSec + (options.expOffsetSec ?? 3600),
    ...(options.nonce ? { nonce: options.nonce } : {}),
    email: 'test@example.com',
  });
}

describe('OpenAI SIWC ChatGPT OAuth', () => {
  let originalFetch: typeof globalThis.fetch;
  let originalConfigDir: string | undefined;
  let tempDir: string;

  beforeEach(async () => {
    originalFetch = globalThis.fetch;
    originalConfigDir = process.env.SHIORI_CONFIG_DIR;
    tempDir = mkdtempSync(join(tmpdir(), 'shiori-siwc-test-'));
    process.env.SHIORI_CONFIG_DIR = tempDir;
    const { clearOpenAiOidcCaches } = await import('../chatgpt-oauth.ts');
    clearOpenAiOidcCaches();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalConfigDir === undefined) delete process.env.SHIORI_CONFIG_DIR;
    else process.env.SHIORI_CONFIG_DIR = originalConfigDir;
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('discovers OIDC endpoints and builds a spec-compliant SIWC authorization URL', async () => {
    const { prepareChatGptOAuth } = await import('../chatgpt-oauth.ts');

    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url === 'https://auth.openai.com/.well-known/openid-configuration') {
        return new Response(JSON.stringify(TEST_DISCOVERY_DOC), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    const redirectUri = 'http://127.0.0.1:43210/auth/callback';
    const flow = await prepareChatGptOAuth({ redirectUri, prompt: 'consent' });
    const url = new URL(flow.authUrl);

    expect(url.origin + url.pathname).toBe(TEST_DISCOVERY_DOC.authorization_endpoint);
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('redirect_uri')).toBe(redirectUri);
    expect(url.searchParams.get('resource')).toBe('https://api.openai.com/v1');
    expect(url.searchParams.get('scope')).toContain('chatgpt.tokens.use.direct');
    expect(url.searchParams.get('scope')).toContain('resource.invoke');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toBeTruthy();
    expect(url.searchParams.get('state')).toBe(flow.state);
    expect(url.searchParams.get('nonce')).toBe(flow.nonce);
    expect(url.searchParams.get('ext_agent_host_id')).toMatch(/^urn:uuid:/);
    expect(url.searchParams.get('prompt')).toBe('consent');
    expect(url.searchParams.get('client_id')).toBe('dynamic_agent_client');
    expect(url.searchParams.get('agent_name_hint')).toBe('Shiori');
  });

  it('rejects OIDC discovery documents pointing to untrusted origins', async () => {
    const { discoverOpenAiOidc } = await import('../chatgpt-oauth.ts');

    globalThis.fetch = (async () =>
      new Response(JSON.stringify({
        ...TEST_DISCOVERY_DOC,
        token_endpoint: 'https://evil.example.com/oauth/token',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    ) as unknown as typeof fetch;

    await expect(discoverOpenAiOidc(true)).rejects.toThrow('untrusted origin');
  });

  it('rejects token exchange when chatgpt.tokens.use.direct scope was not granted', async () => {
    const { exchangeChatGptTokens } = await import('../chatgpt-oauth.ts');

    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/.well-known/openid-configuration')) {
        return new Response(JSON.stringify(TEST_DISCOVERY_DOC), { status: 200 });
      }
      if (url === TEST_DISCOVERY_DOC.token_endpoint) {
        return new Response(JSON.stringify({
          access_token: 'test-access',
          id_token: makeValidIdToken({ clientId: 'client_issued_abc' }),
          refresh_token: 'test-refresh',
          expires_in: 3600,
          scope: 'openid profile email offline_access',
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    await expect(
      exchangeChatGptTokens('code-123', 'verifier-123', {
        redirectUri: 'http://127.0.0.1:43210/auth/callback',
        clientId: 'client_issued_abc',
      }),
    ).rejects.toThrow('chatgpt.tokens.use.direct');
  });

  it('exchanges tokens, verifies RS256 id_token via JWKS & nonce, and persists issued client_id', async () => {
    const { exchangeChatGptTokens, getSavedSiwcClientId } = await import('../chatgpt-oauth.ts');
    const expectedNonce = 'nonce-xyz-999';
    let capturedTokenUrl = '';
    let capturedTokenBody = '';

    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/.well-known/openid-configuration')) {
        return new Response(JSON.stringify(TEST_DISCOVERY_DOC), { status: 200 });
      }
      if (url === TEST_DISCOVERY_DOC.jwks_uri) {
        return new Response(JSON.stringify({ keys: [testJwk] }), { status: 200 });
      }
      if (url === TEST_DISCOVERY_DOC.token_endpoint) {
        capturedTokenUrl = url;
        capturedTokenBody = String(init?.body ?? '');
        return new Response(JSON.stringify({
          access_token: 'siwc-access-token',
          id_token: makeValidIdToken({ clientId: 'client_issued_xyz', nonce: expectedNonce }),
          refresh_token: 'siwc-refresh-token',
          expires_in: 3600,
          scope: 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct',
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    const result = await exchangeChatGptTokens('code-ok', 'verifier-ok', {
      redirectUri: 'http://127.0.0.1:43210/auth/callback',
      clientId: 'client_issued_xyz',
      expectedNonce,
    });

    expect(capturedTokenUrl).toBe(TEST_DISCOVERY_DOC.token_endpoint);
    const bodyParams = new URLSearchParams(capturedTokenBody);
    expect(bodyParams.get('grant_type')).toBe('authorization_code');
    expect(bodyParams.get('client_id')).toBe('client_issued_xyz');
    expect(bodyParams.get('resource')).toBe('https://api.openai.com/v1');
    expect(bodyParams.get('redirect_uri')).toBe('http://127.0.0.1:43210/auth/callback');
    expect(result.accessToken).toBe('siwc-access-token');
    expect(result.clientId).toBe('client_issued_xyz');
    expect(getSavedSiwcClientId()).toBe('client_issued_xyz');
  });

  it('rejects tampered id_token signatures and refuses to persist client_id', async () => {
    const { exchangeChatGptTokens, getSavedSiwcClientId } = await import('../chatgpt-oauth.ts');

    const validToken = makeValidIdToken({ clientId: 'client_tamper', nonce: 'expected-nonce' });
    const parts = validToken.split('.');
    const tamperedPayload = Buffer.from(
      JSON.stringify({
        iss: 'https://auth.openai.com',
        sub: 'attacker',
        aud: 'client_tamper',
        exp: Math.floor(Date.now() / 1000) + 3600,
        nonce: 'expected-nonce',
      }),
    ).toString('base64url');
    const tamperedToken = `${parts[0]}.${tamperedPayload}.${parts[2]}`;

    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/.well-known/openid-configuration')) {
        return new Response(JSON.stringify(TEST_DISCOVERY_DOC), { status: 200 });
      }
      if (url === TEST_DISCOVERY_DOC.jwks_uri) {
        return new Response(JSON.stringify({ keys: [testJwk] }), { status: 200 });
      }
      if (url === TEST_DISCOVERY_DOC.token_endpoint) {
        return new Response(JSON.stringify({
          access_token: 'bad-access',
          id_token: tamperedToken,
          refresh_token: 'bad-refresh',
          expires_in: 3600,
          scope: 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct',
        }), { status: 200 });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    await expect(
      exchangeChatGptTokens('code-bad', 'verifier-bad', {
        redirectUri: 'http://127.0.0.1:43210/auth/callback',
        clientId: 'client_tamper',
        expectedNonce: 'expected-nonce',
      }),
    ).rejects.toThrow('signature verification failed');
    expect(getSavedSiwcClientId()).toBeUndefined();
  });

  it('refuses refresh when no SIWC client_id exists (no legacy Codex CLI fallback)', async () => {
    const { refreshChatGptTokens } = await import('../chatgpt-oauth.ts');

    await expect(refreshChatGptTokens('legacy-refresh-token')).rejects.toThrow(
      'No Sign in with ChatGPT client registration found',
    );
  });

  it('revokes refresh and access tokens remotely via discovered revocation_endpoint', async () => {
    const { revokeChatGptTokens } = await import('../chatgpt-oauth.ts');
    const calls: Array<{ url: string; body: string }> = [];

    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/.well-known/openid-configuration')) {
        return new Response(JSON.stringify(TEST_DISCOVERY_DOC), { status: 200 });
      }
      if (url === TEST_DISCOVERY_DOC.revocation_endpoint) {
        calls.push({ url, body: String(init?.body ?? '') });
        return new Response('', { status: 200 });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    const outcome = await revokeChatGptTokens(
      { refreshToken: 'rt-1', accessToken: 'at-1' },
      { clientId: 'client_issued_xyz' },
    );

    expect(outcome).toEqual({ revoked: true });
    expect(calls).toHaveLength(2);
    const firstParams = new URLSearchParams(calls[0]!.body);
    expect(firstParams.get('token')).toBe('rt-1');
    expect(firstParams.get('token_type_hint')).toBe('refresh_token');
    expect(firstParams.get('client_id')).toBe('client_issued_xyz');
    const secondParams = new URLSearchParams(calls[1]!.body);
    expect(secondParams.get('token')).toBe('at-1');
    expect(secondParams.get('token_type_hint')).toBe('access_token');
    expect(secondParams.get('client_id')).toBe('client_issued_xyz');
  });
});
