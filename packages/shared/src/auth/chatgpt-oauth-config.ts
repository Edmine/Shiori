/**
 * Shared OAuth configuration for OpenAI Sign in with ChatGPT (SIWC)
 *
 * Implements OpenAI's official open-source / local app dynamic client registration
 * and ChatGPT plan token-sharing OAuth 2.0 + OIDC + PKCE flow
 * (aligned with openai/sign-in-with-chatgpt-devkit):
 * - OIDC Discovery: https://auth.openai.com/.well-known/openid-configuration
 * - Dynamic client registration: client_id=dynamic_agent_client + agent_name_hint=Shiori
 * - Per-install persistent host ID: ext_agent_host_id=urn:uuid:<v4>
 * - Loopback callback on 127.0.0.1 with ephemeral port
 * - RS256 ID Token verification against discovered jwks_uri
 * - RFC 7009 token revocation against discovered revocation_endpoint
 * - Target API resource: https://api.openai.com/v1 (standard Responses API)
 */

export const CHATGPT_OAUTH_CONFIG = {
  /**
   * Initial sentinel client_id for OpenAI SIWC dynamic registration
   */
  DYNAMIC_CLIENT_ID: 'dynamic_agent_client',

  /**
   * Stable public app name sent on initial SIWC registration
   */
  AGENT_NAME_HINT: 'Shiori',

  /**
   * OpenID Connect issuer
   */
  ISSUER: 'https://auth.openai.com',

  /**
   * OpenID Connect Discovery document URL
   */
  DISCOVERY_URL: 'https://auth.openai.com/.well-known/openid-configuration',

  /**
   * Expected HTTPS origin for all discovered OAuth/OIDC endpoints
   */
  TRUSTED_AUTH_ORIGIN: 'https://auth.openai.com',

  /**
   * Official SIWC Authorization URL (reference; runtime resolves via OIDC discovery)
   */
  AUTH_URL: 'https://auth.openai.com/api/accounts/authorize',

  /**
   * Official SIWC Token URL (reference; runtime resolves via OIDC discovery)
   */
  TOKEN_URL: 'https://auth.openai.com/api/accounts/oauth/token',

  /**
   * Loopback host required by OpenAI SIWC (must be 127.0.0.1, not localhost)
   */
  CALLBACK_HOST: '127.0.0.1',

  /**
   * Loopback callback path
   */
  CALLBACK_PATH: '/auth/callback',

  /**
   * Ephemeral loopback port (0 = OS-assigned)
   */
  CALLBACK_PORT: 0,

  /**
   * Official SIWC scopes for direct ChatGPT plan token usage
   */
  SCOPES: 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct',

  /**
   * Required granted scope confirming ChatGPT plan token sharing was approved
   */
  REQUIRED_TOKEN_SHARING_SCOPE: 'chatgpt.tokens.use.direct',

  /**
   * Target OpenAI API resource (RFC 8707)
   */
  RESOURCE: 'https://api.openai.com/v1',

  /**
   * Alias for API audience / resource
   */
  AUDIENCE: 'https://api.openai.com/v1',
} as const;

export type ChatGptOAuthConfig = typeof CHATGPT_OAUTH_CONFIG;
