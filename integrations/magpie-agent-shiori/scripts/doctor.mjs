#!/usr/bin/env node
// Read-only check of the Magpie -> Shiori connection. Prints no secrets;
// only the public agent-scoped gateway key name (`magpie-shiori`).
import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { agent } from "../shiori.agent.js"

const EXPECTED_KEY = `magpie-${agent.id}`
const shioriDir = process.env.SHIORI_CONFIG_DIR?.trim() || join(homedir(), ".shiori")
const bridgePath = join(shioriDir, "magpie.json")

let failed = 0
const ok = (msg) => console.log(`ok    ${msg}`)
const info = (msg) => console.log(`info  ${msg}`)
const fail = (msg) => {
  failed++
  console.log(`FAIL  ${msg}`)
}

if (!existsSync(shioriDir)) {
  fail(`Shiori directory not found at ${shioriDir} (launch Shiori once so ~/.shiori is created)`)
} else {
  ok(`Shiori directory exists at ${shioriDir}`)
}

let bridge = null
try {
  bridge = JSON.parse(readFileSync(bridgePath, "utf8"))
} catch {}

if (!bridge?.baseUrl) {
  fail(`Magpie is not keeping ${bridgePath}: connect Shiori in Magpie Agents page or run: magpie ${agent.id} <model>`)
} else {
  const models = Array.isArray(bridge.models) ? bridge.models : []
  const keyLabel = bridge.apiKey === EXPECTED_KEY ? bridge.apiKey : bridge.apiKey ? "(custom key)" : "(none)"
  ok(
    `Magpie keeps ${bridgePath}: ${bridge.baseUrl}, key ${keyLabel}, ${models.length} models, default=${bridge.model || "(first model)"}`
  )

  try {
    const headers = bridge.apiKey ? { authorization: `Bearer ${bridge.apiKey}` } : {}
    const res = await fetch(`${bridge.baseUrl}/models`, {
      headers,
      signal: AbortSignal.timeout(8000),
    })
    const body = await res.json().catch(() => null)
    const list = Array.isArray(body?.data) ? body.data : Array.isArray(body?.models) ? body.models : []
    const served = new Set(list.map((m) => m?.id ?? m?.slug).filter((id) => typeof id === "string" && id))
    if (!res.ok) {
      fail(`gateway ${bridge.baseUrl}/models answered HTTP ${res.status}`)
    } else if (served.size === 0) {
      fail(`gateway lists no models for Shiori: check magpie visible ${agent.id}`)
    } else {
      const declared = new Set(models.map((m) => m.id))
      const added = [...served].filter((id) => !declared.has(id))
      const gone = [...declared].filter((id) => !served.has(id))
      if (added.length + gone.length === 0) {
        ok(`gateway serves the same ${served.size} models to Shiori`)
      } else {
        info(
          `gateway serves ${served.size} models (${added.length} pending add, ${gone.length} pending removal); Magpie syncs on change`
        )
      }
    }
  } catch (err) {
    fail(`gateway ${bridge.baseUrl} not reachable: ${err?.name || err}`)
  }
}

console.log(failed ? `\n${failed} problem(s)` : "\nall checks passed")
process.exitCode = failed ? 1 : 0
