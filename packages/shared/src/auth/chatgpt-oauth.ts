/**
 * OpenAI Sign in with ChatGPT (SIWC) OAuth 2.0 + OIDC + PKCE
 *
 * Implements OpenAI's official open-source dynamic client registration and
 * ChatGPT plan token-sharing flow (`chatgpt.tokens.use.direct` -> `https://api.openai.com/v1`),
 * aligned with openai/sign-in-with-chatgpt-devkit:
 *   - OIDC Discovery (`/.well-known/openid-configuration`) with trusted-origin enforcement
 *   - JWKS RS256 ID Token signature & claim verification (`iss`, `aud`, `azp`, `sub`, `exp`, `nonce`)
 *   - RFC 7009 token revocation against discovered `revocation_endpoint`
 *
 * Architecture: server-owned flow.
 *   - prepareChatGptOAuth()    — server discovers OIDC endpoints, persists ext_agent_host_id & builds SIWC auth URL
 *   - Client runs 127.0.0.1 ephemeral callback server + opens browser
 *   - exchangeChatGptTokens()  — exchanges code, verifies scope & RS256 id_token, persists issued client_id
 *   - refreshChatGptTokens()   — refreshes expired tokens using issued SIWC client_id only
 *   - revokeChatGptTokens()    — revokes refresh/access tokens remotely on logout/disconnect
 */
import {
  randomBytes,
  randomUUID,
  createHash,
  createPublicKey,
  timingSafeEqual,
  verify as cryptoVerify,
  type JsonWebKeyInput,
} from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONFIG_DIR } from '../config/paths.ts';
import { CHATGPT_OAUTH_CONFIG } from './chatgpt-oauth-config.ts';

// OAuth configuration from shared config
const OAUTH_SCOPES = CHATGPT_OAUTH_CONFIG.SCOPES;
const RESOURCE = CHATGPT_OAUTH_CONFIG.RESOURCE;
const CACHE_TTL_MS = 60 * 60 * 1000;
const CLOCK_SKEW_SECONDS = 60;

export interface OpenAiOidcDiscovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  revocation_endpoint?: string;
}

interface RsaJwk {
  kid?: string;
  kty?: string;
  use?: string;
  alg?: string;
  n?: string;
  e?: string;
  [key: string]: unknown;
}

export interface VerifiedOpenAiIdTokenClaims {
  iss: string;
  sub: string;
  aud: string | string[];
  exp: number;
  iat?: number;
  nbf?: number;
  nonce?: string;
  azp?: string;
  email?: string;
  name?: string;
}

let discoveryCache: { value: OpenAiOidcDiscovery; expiresAt: number } | null = null;
let jwksCache: { uri: string; keys: RsaJwk[]; expiresAt: number } | null = null;

export function clearOpenAiOidcCaches(): void {
  discoveryCache = null;
  jwksCache = null;
}

function assertTrustedOpenAiEndpoint(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`OpenAI OIDC discovery missing valid ${fieldName}`);
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`OpenAI OIDC discovery returned invalid URL for ${fieldName}`);
  }
  if (parsed.protocol !== 'https:' || parsed.origin !== CHATGPT_OAUTH_CONFIG.TRUSTED_AUTH_ORIGIN) {
    throw new Error(
      `OpenAI OIDC discovery returned untrusted origin for ${fieldName}: ${parsed.origin}`
    );
  }
  return parsed.toString();
}

/**
 * Fetch and validate OpenAI's OIDC Discovery document.
 * Results are cached in memory for 1 hour.
 */
export async function discoverOpenAiOidc(forceRefresh = false): Promise<OpenAiOidcDiscovery> {
  if (!forceRefresh && discoveryCache && Date.now() < discoveryCache.expiresAt) {
    return discoveryCache.value;
  }

  const response = await fetch(CHATGPT_OAUTH_CONFIG.DISCOVERY_URL, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    redirect: 'error',
  });

  if (!response.ok) {
    throw new Error(`OpenAI OIDC discovery failed: HTTP ${response.status}`);
  }

  const raw = (await response.json()) as Record<string, unknown>;
  if (raw.issuer !== CHATGPT_OAUTH_CONFIG.ISSUER) {
    throw new Error(`OpenAI OIDC discovery returned unexpected issuer: ${String(raw.issuer)}`);
  }

  const discovery: OpenAiOidcDiscovery = {
    issuer: CHATGPT_OAUTH_CONFIG.ISSUER,
    authorization_endpoint: assertTrustedOpenAiEndpoint(raw.authorization_endpoint, 'authorization_endpoint'),
    token_endpoint: assertTrustedOpenAiEndpoint(raw.token_endpoint, 'token_endpoint'),
    jwks_uri: assertTrustedOpenAiEndpoint(raw.jwks_uri, 'jwks_uri'),
    revocation_endpoint:
      typeof raw.revocation_endpoint === 'string' && raw.revocation_endpoint.trim()
        ? assertTrustedOpenAiEndpoint(raw.revocation_endpoint, 'revocation_endpoint')
        : undefined,
  };

  discoveryCache = { value: discovery, expiresAt: Date.now() + CACHE_TTL_MS };
  return discovery;
}

async function fetchOpenAiJwks(jwksUri: string, forceRefresh = false): Promise<RsaJwk[]> {
  if (
    !forceRefresh &&
    jwksCache &&
    jwksCache.uri === jwksUri &&
    Date.now() < jwksCache.expiresAt
  ) {
    return jwksCache.keys;
  }

  const response = await fetch(jwksUri, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    redirect: 'error',
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch OpenAI JWKS: HTTP ${response.status}`);
  }

  const data = (await response.json()) as { keys?: unknown };
  if (!Array.isArray(data.keys)) {
    throw new Error('OpenAI JWKS response did not contain a keys array');
  }

  const keys = data.keys.filter((entry): entry is RsaJwk => !!entry && typeof entry === 'object');
  jwksCache = { uri: jwksUri, keys, expiresAt: Date.now() + CACHE_TTL_MS };
  return keys;
}

function decodeJwtJsonSegment(segment: string, label: string): Record<string, unknown> {
  try {
    const text = Buffer.from(segment, 'base64url').toString('utf8');
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`Invalid JWT ${label}`);
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw new Error(`Failed to decode ID token ${label}`);
  }
}

function timingSafeStringEqual(left: string, right: string): boolean {
  const leftBuf = Buffer.from(left, 'utf8');
  const rightBuf = Buffer.from(right, 'utf8');
  if (leftBuf.length !== rightBuf.length) return false;
  return timingSafeEqual(leftBuf, rightBuf);
}

/**
 * Verify an OpenAI OIDC id_token (RS256 signature via JWKS + standard OIDC claims).
 */
export async function verifyOpenAiIdToken(
  idToken: string,
  options: {
    expectedClientId: string;
    expectedNonce?: string;
    discovery?: OpenAiOidcDiscovery;
    nowSeconds?: number;
  },
): Promise<VerifiedOpenAiIdTokenClaims> {
  const segments = idToken.split('.');
  if (segments.length !== 3 || segments.some((part) => !part)) {
    throw new Error('Invalid OpenAI id_token format');
  }
  const [headerSegment, payloadSegment, signatureSegment] = segments as [string, string, string];
  const header = decodeJwtJsonSegment(headerSegment, 'header');
  const payload = decodeJwtJsonSegment(payloadSegment, 'payload');

  if (header.alg !== 'RS256') {
    throw new Error(`Unsupported OpenAI id_token algorithm: ${String(header.alg)}`);
  }
  const kid = typeof header.kid === 'string' && header.kid.trim() ? header.kid.trim() : undefined;
  if (!kid) {
    throw new Error('OpenAI id_token header is missing kid');
  }

  const discovery = options.discovery ?? (await discoverOpenAiOidc());
  let keys = await fetchOpenAiJwks(discovery.jwks_uri, false);
  let matchingKey = keys.find((key) => key.kid === kid);
  if (!matchingKey) {
    keys = await fetchOpenAiJwks(discovery.jwks_uri, true);
    matchingKey = keys.find((key) => key.kid === kid);
  }
  if (!matchingKey) {
    throw new Error(`No matching OpenAI JWKS signing key found for kid=${kid}`);
  }
  if (matchingKey.kty !== 'RSA' || !matchingKey.n || !matchingKey.e) {
    throw new Error(`OpenAI JWKS key ${kid} is not a valid RSA key`);
  }
  if (matchingKey.use && matchingKey.use !== 'sig') {
    throw new Error(`OpenAI JWKS key ${kid} is not valid for signature verification`);
  }
  if (matchingKey.alg && matchingKey.alg !== 'RS256') {
    throw new Error(`OpenAI JWKS key ${kid} algorithm mismatch: ${matchingKey.alg}`);
  }

  const publicKey = createPublicKey({
    key: matchingKey as JsonWebKeyInput['key'],
    format: 'jwk',
  });
  const signingInput = Buffer.from(`${headerSegment}.${payloadSegment}`, 'utf8');
  const signatureBytes = Buffer.from(signatureSegment, 'base64url');
  const signatureValid = cryptoVerify('RSA-SHA256', signingInput, publicKey, signatureBytes);
  if (!signatureValid) {
    throw new Error('OpenAI id_token signature verification failed');
  }

  if (payload.iss !== discovery.issuer) {
    throw new Error(`OpenAI id_token issuer mismatch: ${String(payload.iss)}`);
  }

  const aud = payload.aud;
  const audMatches =
    (typeof aud === 'string' && aud === options.expectedClientId) ||
    (Array.isArray(aud) && aud.includes(options.expectedClientId));
  if (!audMatches) {
    throw new Error('OpenAI id_token audience does not match client_id');
  }
  if (payload.azp !== undefined && payload.azp !== options.expectedClientId) {
    throw new Error('OpenAI id_token azp does not match client_id');
  }
  if (Array.isArray(aud) && aud.length > 1 && payload.azp !== options.expectedClientId) {
    throw new Error('OpenAI id_token with multiple audiences requires matching azp');
  }

  if (typeof payload.sub !== 'string' || !payload.sub.trim()) {
    throw new Error('OpenAI id_token is missing subject (sub)');
  }

  const nowSec = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)) {
    throw new Error('OpenAI id_token is missing valid exp claim');
  }
  if (nowSec >= payload.exp + CLOCK_SKEW_SECONDS) {
    throw new Error('OpenAI id_token is expired');
  }
  if (payload.nbf !== undefined) {
    if (typeof payload.nbf !== 'number' || !Number.isFinite(payload.nbf)) {
      throw new Error('OpenAI id_token has invalid nbf claim');
    }
    if (nowSec + CLOCK_SKEW_SECONDS < payload.nbf) {
      throw new Error('OpenAI id_token is not yet valid (nbf)');
    }
  }
  if (payload.iat !== undefined) {
    if (typeof payload.iat !== 'number' || !Number.isFinite(payload.iat)) {
      throw new Error('OpenAI id_token has invalid iat claim');
    }
    if (payload.iat > nowSec + CLOCK_SKEW_SECONDS) {
      throw new Error('OpenAI id_token iat is in the future');
    }
  }

  if (options.expectedNonce) {
    if (typeof payload.nonce !== 'string' || !timingSafeStringEqual(payload.nonce, options.expectedNonce)) {
      throw new Error('OpenAI id_token nonce mismatch');
    }
  }

  return {
    iss: payload.iss,
    sub: payload.sub,
    aud: aud as string | string[],
    exp: payload.exp,
    iat: typeof payload.iat === 'number' ? payload.iat : undefined,
    nbf: typeof payload.nbf === 'number' ? payload.nbf : undefined,
    nonce: typeof payload.nonce === 'string' ? payload.nonce : undefined,
    azp: typeof payload.azp === 'string' ? payload.azp : undefined,
    email: typeof payload.email === 'string' ? payload.email : undefined,
    name: typeof payload.name === 'string' ? payload.name : undefined,
  };
}

function getSiwcClientStateFile(): string {
  const baseDir = process.env.SHIORI_CONFIG_DIR || CONFIG_DIR;
  return join(baseDir, 'chatgpt-siwc-client.json');
}

interface SiwcClientState {
  /** Persistent host identifier in `urn:uuid:<v4>` format */
  hostId: string;
  /** Dynamically issued OAuth client_id returned by OpenAI on first registration */
  clientId?: string;
}

function loadSiwcClientState(): SiwcClientState {
  const stateFile = getSiwcClientStateFile();
  try {
    if (existsSync(stateFile)) {
      const parsed = JSON.parse(readFileSync(stateFile, 'utf-8')) as Partial<SiwcClientState>;
      if (typeof parsed.hostId === 'string' && parsed.hostId.startsWith('urn:uuid:')) {
        return {
          hostId: parsed.hostId,
          clientId: typeof parsed.clientId === 'string' && parsed.clientId.trim() ? parsed.clientId.trim() : undefined,
        };
      }
    }
  } catch {
    // Fall through and generate fresh host state
  }
  const fresh: SiwcClientState = { hostId: `urn:uuid:${randomUUID()}` };
  saveSiwcClientState(fresh);
  return fresh;
}

function saveSiwcClientState(state: SiwcClientState): void {
  try {
    const baseDir = process.env.SHIORI_CONFIG_DIR || CONFIG_DIR;
    mkdirSync(baseDir, { recursive: true });
    writeFileSync(getSiwcClientStateFile(), JSON.stringify(state, null, 2), { encoding: 'utf-8', mode: 0o600 });
  } catch {
    // Best-effort persistence
  }
}

export function getSavedSiwcClientId(): string | undefined {
  return loadSiwcClientState().clientId;
}

export interface ChatGptTokens {
  /** JWT id_token containing user identity claims */
  idToken: string;
  /** Access token for API calls */
  accessToken: string;
  /** Refresh token for getting new tokens */
  refreshToken?: string;
  /** Token expiration timestamp (Unix ms) */
  expiresAt?: number;
  /** Granted OAuth scopes (space-delimited) */
  scope?: string;
  /** Issued SIWC client_id */
  clientId?: string;
}

/**
 * Generate a secure random state parameter
 */
function generateState(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Generate PKCE code verifier and challenge
 */
function generatePKCE(): { codeVerifier: string; codeChallenge: string } {
  // Use URL-safe base64 encoding for PKCE (43-128 characters)
  const codeVerifier = randomBytes(32).toString('base64url');
  const codeChallenge = createHash('sha256')
    .update(codeVerifier)
    .digest('base64url');
  return { codeVerifier, codeChallenge };
}

// ---------------------------------------------------------------------------
// Prepare / Exchange (server-owned flow)
// ---------------------------------------------------------------------------

export interface ChatGptPreparedFlow {
  authUrl: string;
  state: string;
  nonce: string;
  codeVerifier: string;
  redirectUri: string;
  clientId?: string;
}

/**
 * Prepare an OpenAI SIWC OAuth flow.
 * Resolves OIDC discovery and returns PKCE parameters and auth URL.
 */
export async function prepareChatGptOAuth(options?: {
  redirectUri?: string;
  prompt?: 'consent';
}): Promise<ChatGptPreparedFlow> {
  const discovery = await discoverOpenAiOidc();
  const state = generateState();
  const nonce = generateState();
  const { codeVerifier, codeChallenge } = generatePKCE();
  const clientState = loadSiwcClientState();
  const redirectUri = options?.redirectUri
    || `http://${CHATGPT_OAUTH_CONFIG.CALLBACK_HOST}:1455${CHATGPT_OAUTH_CONFIG.CALLBACK_PATH}`;
  const isDynamicRegistration = !clientState.clientId;

  const params = new URLSearchParams({
    client_id: clientState.clientId ?? CHATGPT_OAUTH_CONFIG.DYNAMIC_CLIENT_ID,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: OAUTH_SCOPES,
    resource: RESOURCE,
    ext_agent_host_id: clientState.hostId,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state,
    nonce,
  });

  if (isDynamicRegistration) {
    params.set('agent_name_hint', CHATGPT_OAUTH_CONFIG.AGENT_NAME_HINT);
  }
  if (options?.prompt) {
    params.set('prompt', options.prompt);
  }

  return {
    authUrl: `${discovery.authorization_endpoint}?${params.toString()}`,
    state,
    nonce,
    codeVerifier,
    redirectUri,
    clientId: clientState.clientId,
  };
}

/**
 * Exchange an authorization code for ChatGPT tokens (stateless).
 * Verifies the granted `chatgpt.tokens.use.direct` scope AND cryptographically validates
 * the returned OIDC `id_token` via OpenAI's discovered JWKS before persisting `client_id`.
 */
export async function exchangeChatGptTokens(
  code: string,
  codeVerifier: string,
  options?: { redirectUri?: string; clientId?: string; expectedNonce?: string },
): Promise<ChatGptTokens> {
  const clientState = loadSiwcClientState();
  const effectiveClientId = options?.clientId?.trim() || clientState.clientId;
  if (!effectiveClientId) {
    throw new Error('OpenAI did not return an issued client_id for Sign in with ChatGPT. Please try signing in again.');
  }

  const discovery = await discoverOpenAiOidc();
  const redirectUri = options?.redirectUri
    || `http://${CHATGPT_OAUTH_CONFIG.CALLBACK_HOST}:1455${CHATGPT_OAUTH_CONFIG.CALLBACK_PATH}`;

  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: effectiveClientId,
    code,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
    resource: RESOURCE,
  });

  const response = await fetch(discovery.token_endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    redirect: 'error',
    body: params.toString(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    let errorMessage: string;
    try {
      const errorJson = JSON.parse(errorText);
      errorMessage = errorJson.error_description || errorJson.error || errorText;
    } catch {
      errorMessage = errorText;
    }
    throw new Error(`Token exchange failed: ${response.status} - ${errorMessage}`);
  }

  const data = (await response.json()) as {
    id_token?: string;
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  };

  if (data.scope) {
    const grantedScopes = new Set(data.scope.split(/\s+/).filter(Boolean));
    if (!grantedScopes.has(CHATGPT_OAUTH_CONFIG.REQUIRED_TOKEN_SHARING_SCOPE)) {
      throw new Error(
        'ChatGPT plan token sharing was not granted (missing chatgpt.tokens.use.direct scope). ' +
        'Please re-authorize and enable ChatGPT subscription token sharing.'
      );
    }
  }

  if (!data.id_token) {
    throw new Error('OpenAI token response did not include an id_token.');
  }
  await verifyOpenAiIdToken(data.id_token, {
    expectedClientId: effectiveClientId,
    expectedNonce: options?.expectedNonce,
    discovery,
  });

  // Persist issued client_id for future logins and token refreshes
  if (effectiveClientId !== clientState.clientId) {
    saveSiwcClientState({ ...clientState, clientId: effectiveClientId });
  }

  return {
    idToken: data.id_token ?? '',
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
    scope: data.scope,
    clientId: effectiveClientId,
  };
}

/**
 * Refresh ChatGPT tokens using a refresh token and the persisted SIWC client_id.
 * Legacy Codex CLI refresh fallback has been removed; pre-SIWC sessions must sign in again.
 *
 * @param refreshToken - The refresh token from a previous authentication
 * @param onStatus - Optional callback for status messages
 * @returns New ChatGptTokens
 */
export async function refreshChatGptTokens(
  refreshToken: string,
  onStatus?: (message: string) => void
): Promise<ChatGptTokens> {
  onStatus?.('Refreshing tokens...');

  const savedClientId = getSavedSiwcClientId();
  if (!savedClientId) {
    throw new Error(
      'No Sign in with ChatGPT client registration found. Please sign in again with ChatGPT.'
    );
  }

  const discovery = await discoverOpenAiOidc();
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: savedClientId,
    refresh_token: refreshToken,
    resource: RESOURCE,
  });

  try {
    const response = await fetch(discovery.token_endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      redirect: 'error',
      body: params.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage: string;
      try {
        const errorJson = JSON.parse(errorText);
        errorMessage = errorJson.error_description || errorJson.error || errorText;
      } catch {
        errorMessage = errorText;
      }
      throw new Error(`Token refresh failed: ${response.status} - ${errorMessage}`);
    }

    const data = (await response.json()) as {
      id_token?: string;
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
    };

    if (data.id_token) {
      await verifyOpenAiIdToken(data.id_token, {
        expectedClientId: savedClientId,
        discovery,
      });
    }

    onStatus?.('Tokens refreshed successfully!');

    return {
      idToken: data.id_token ?? '',
      accessToken: data.access_token,
      // Use new refresh token if provided, otherwise keep the old one
      refreshToken: data.refresh_token || refreshToken,
      expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
      scope: data.scope,
      clientId: savedClientId,
    };
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error(`Token refresh failed: ${String(error)}`);
  }
}

/**
 * Revoke ChatGPT OAuth tokens remotely via OpenAI's discovered RFC 7009 revocation_endpoint.
 */
export async function revokeChatGptTokens(
  tokens: { refreshToken?: string; accessToken?: string },
  options?: { clientId?: string },
): Promise<{ revoked: boolean; reason?: 'no_client_id' | 'no_tokens' | 'unsupported' }> {
  const clientId = options?.clientId?.trim() || getSavedSiwcClientId();
  if (!clientId) {
    return { revoked: false, reason: 'no_client_id' };
  }

  const candidates: Array<{ token: string; hint: 'refresh_token' | 'access_token' }> = [];
  if (tokens.refreshToken?.trim()) {
    candidates.push({ token: tokens.refreshToken.trim(), hint: 'refresh_token' });
  }
  if (tokens.accessToken?.trim()) {
    candidates.push({ token: tokens.accessToken.trim(), hint: 'access_token' });
  }
  if (candidates.length === 0) {
    return { revoked: false, reason: 'no_tokens' };
  }

  const discovery = await discoverOpenAiOidc();
  if (!discovery.revocation_endpoint) {
    return { revoked: false, reason: 'unsupported' };
  }

  for (const candidate of candidates) {
    const params = new URLSearchParams({
      token: candidate.token,
      token_type_hint: candidate.hint,
      client_id: clientId,
    });

    const response = await fetch(discovery.revocation_endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      redirect: 'error',
      body: params.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(
        `Token revocation failed (${candidate.hint}): HTTP ${response.status}${errorText ? ` - ${errorText}` : ''}`
      );
    }
  }

  return { revoked: true };
}

/**
 * Exchange an idToken for an OpenAI API key using the token-exchange grant.
 *
 * This implements RFC 8693 Token Exchange to convert a ChatGPT OAuth idToken
 * into a first-class OpenAI API key that can be used with the standard OpenAI SDK.
 *
 * @param idToken - The JWT id_token from ChatGPT OAuth
 * @returns An OpenAI API key string
 */
export async function exchangeIdTokenForApiKey(idToken: string): Promise<string> {
  const savedClientId = getSavedSiwcClientId();
  if (!savedClientId) {
    throw new Error(
      'No Sign in with ChatGPT client registration found. Please sign in again with ChatGPT.'
    );
  }

  const discovery = await discoverOpenAiOidc();
  const params = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
    client_id: savedClientId,
    subject_token: idToken,
    subject_token_type: 'urn:ietf:params:oauth:token-type:id_token',
    requested_token: 'openai-api-key',
  });

  const response = await fetch(discovery.token_endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    redirect: 'error',
    body: params.toString(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    let errorMessage: string;
    try {
      const errorJson = JSON.parse(errorText);
      // Handle both string and object error formats
      const errorDesc = errorJson.error_description;
      const errorCode = typeof errorJson.error === 'string' ? errorJson.error : JSON.stringify(errorJson.error);
      errorMessage = errorDesc || errorCode || errorText;
    } catch {
      errorMessage = errorText;
    }
    throw new Error(`Token exchange failed: ${response.status} - ${errorMessage}`);
  }

  const data = (await response.json()) as {
    access_token?: string;
    token_type?: string;
  };

  if (!data.access_token) {
    throw new Error('Token exchange succeeded but no access_token returned');
  }

  return data.access_token;
}
