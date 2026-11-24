# Shiori Cloudflare Workers Relay

Self-hosted outbound WebSocket relay for Shiori remote access (inspired by Alma Relay), designed to stay strictly within Cloudflare Workers **Free Plan ($0/month)** limits.

## Recommended: 1-Click Visual Deploy inside Shiori

Open **Shiori → 设置 → 远程访问 → 公网中继（Cloudflare Workers）**, paste an ephemeral Cloudflare API Token (from the built-in **Edit Cloudflare Workers** template), and click **一键部署**. No Node.js, Wrangler, or terminal commands required.

## Optional: Manual CLI Deploy (`wrangler`)

```bash
cd apps/relay
npx wrangler secret put RELAY_SECRET
npx wrangler secret put GATE_KEY
npx wrangler deploy
```

## Zero-Extra-Cost Guardrails

- **SQLite Durable Object (`new_sqlite_classes`)** — supported on Cloudflare Workers Free Plan (hard-caps on quota exhaustion, never bills).
- **WebSocket Hibernation API + Auto-Response Ping** — idle tunnels hibernate with 0 GB-s duration billing and 0 SQLite reads/writes.
- **Edge Gate Cookie** — unauthorized public requests/bots receive `404` at the Worker edge without ever waking the Durable Object.
- **Circuit Breakers** — `MAX_CLIENTS=4`, `DAILY_DO_REQUEST_CAP=80000`, `observability.enabled=false`, 25s HTTP timeout.
- **End-to-End Encryption (AES-256-GCM)** — key is carried only in the QR URL `#fragment`, so the relay never sees plaintext messages or tokens.
