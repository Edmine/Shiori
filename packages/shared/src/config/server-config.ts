/**
 * Server mode configuration — controls whether the Electron app
 * accepts remote connections from other machines.
 *
 * When enabled, the app binds to 0.0.0.0 on a fixed port instead of
 * localhost on a random port, allowing thin clients to connect.
 */

export interface ServerConfig {
  /** Whether remote server mode is active (bind 0.0.0.0 vs 127.0.0.1) */
  enabled: boolean
  /** Fixed port to listen on (default 9100) */
  port: number
  /** Path to PEM certificate file (enables TLS / wss://) */
  tlsCertPath?: string
  /** Path to PEM private key file (required when cert is set) */
  tlsKeyPath?: string
  /** Stable auth token for remote clients (auto-generated on first enable) */
  token?: string
  /** Optional Cloudflare Workers outbound relay configuration (Alma-style remote access) */
  relay?: RelayConfig
}

export interface RelayConfig {
  /** Whether the outbound relay tunnel is active (hot-toggled without app restart) */
  enabled: boolean
  /** Deployed relay base URL, e.g. https://shiori-relay.username.workers.dev */
  relayUrl: string
  /** Shared secret authenticating the desktop host against the relay Worker */
  relaySecret: string
  /** Edge gate key embedded in the QR /connect/<gateKey> URL (blocks bots before Durable Objects) */
  gateKey: string
  /** Enable AES-256-GCM end-to-end encryption over the relay (default true) */
  e2eEnabled: boolean
  /** Base64url-encoded 256-bit AES-GCM key shared only via URL #fragment */
  e2eKey?: string
  /** Maximum concurrent phone/browser connections (default 4, protects free quota) */
  maxClients?: number
  /** Soft daily request cap enforced on Worker & desktop (default 80000, below 100k CF free limit) */
  dailyRequestCap?: number
  /** Cloudflare deployment metadata (never stores the user's CF API Token) */
  cloudflare?: {
    accountId?: string
    accountName?: string
    scriptName?: string
    subdomain?: string
    deployedAt?: number
  }
}

export const DEFAULT_RELAY_CONFIG: RelayConfig = {
  enabled: false,
  relayUrl: '',
  relaySecret: '',
  gateKey: '',
  e2eEnabled: true,
  maxClients: 4,
  dailyRequestCap: 80_000,
}

export type RelayConnectionState =
  | 'disabled'
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'error'

export interface RelayStatus {
  /** Whether relay mode is configured and enabled */
  enabled: boolean
  /** Current outbound tunnel connection state */
  state: RelayConnectionState
  /** Deployed relay origin (https://...) */
  relayUrl: string
  /** Public entry URL for browsers (https://.../connect/<gateKey>) */
  publicUrl?: string
  /** One-tap QR URL with #token=...&e2e=... fragment (never transmitted to Cloudflare) */
  qrAutoLoginUrl?: string
  /** Manual-login QR URL with #e2e=... fragment only */
  qrManualLoginUrl?: string
  /** Whether AES-256-GCM E2EE is active */
  e2eEnabled: boolean
  /** Number of active relayed WebSocket clients right now */
  activeClients: number
  /** Configured max concurrent clients */
  maxClients: number
  /** Local count of relayed requests today (UTC) */
  requestsToday: number
  /** Configured daily request safety cap */
  dailyRequestCap: number
  /** Timestamp of last successful connection */
  connectedAt?: number
  /** Last measured heartbeat/connect latency in ms */
  latencyMs?: number
  /** Reconnect attempt count if currently reconnecting */
  reconnectAttempt?: number
  /** Human-readable error message when state === 'error' or last failure */
  lastError?: string
  /** Whether the embedded WebUI bundle is available to serve over the relay */
  webuiAvailable: boolean
}

export interface CloudflareAccountInfo {
  id: string
  name: string
  subdomain?: string
  existingScript?: boolean
}

export interface CloudflareVerifyResult {
  ok: boolean
  accounts: CloudflareAccountInfo[]
  needsManualAccountId?: boolean
  error?: string
}

export interface CloudflareDeployInput {
  /** Ephemeral Cloudflare API Token — used only for this request, never saved to disk */
  apiToken: string
  /** Target Cloudflare Account ID */
  accountId: string
  /** Optional account display name for UI display */
  accountName?: string
  /** Worker script name (default 'shiori-relay') */
  scriptName?: string
  /** Desired workers.dev subdomain (required only if account doesn't have one yet) */
  desiredSubdomain?: string
  /** Daily DO request safety cap (default 80000, max 95000 for free tier safety) */
  dailyRequestCap?: number
  /** Max concurrent mobile clients (default 4) */
  maxClients?: number
}

export interface CloudflareDeployResult {
  relayUrl: string
  relaySecret: string
  gateKey: string
  e2eKey: string
  accountId: string
  accountName?: string
  scriptName: string
  subdomain: string
  deployedAt: number
  healthOk: boolean
}

export interface CloudflareDeleteInput {
  apiToken: string
  accountId: string
  scriptName: string
}

export interface ServerStatus {
  /** Whether the server is currently running */
  running: boolean
  /** Current bind address */
  host: string
  /** Current port */
  port: number
  /** Whether TLS is active */
  tls: boolean
  /** Full connection URL (ws:// or wss://) */
  url: string
  /** Browser / mobile WebUI URL (http:// or https://) on the same port */
  webUrl?: string
  /** All detected LAN / Tailscale IPv4 endpoints for quick switching */
  lanAddresses?: Array<{
    label: string
    ip: string
    webUrl: string
    wsUrl: string
  }>
  /** Whether the embedded mobile WebUI bundle was found and mounted */
  webuiAvailable?: boolean
  /** Current auth token */
  token: string
  /** Whether saved config differs from running config (restart needed) */
  needsRestart: boolean
  /** True when server is bound to a network address without TLS */
  insecureWarning: boolean
}

export const DEFAULT_SERVER_CONFIG: ServerConfig = {
  enabled: false,
  port: 9100,
}
