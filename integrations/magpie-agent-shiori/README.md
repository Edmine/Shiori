# Shiori for Magpie (`magpie-agent-shiori`)

Connects **Shiori** to **Magpie** as a dedicated agent (`shiori`) with its own Agents row, icon, gateway key (`magpie-shiori`), usage attribution, and model visibility rules — completely decoupled from Craft Agents' `~/.craft-agent/config.json`.

## How it works

- Magpie writes `~/.shiori/magpie.json` whenever Shiori is connected, models change, visibility changes, or you pick a default model in Magpie (`magpie shiori <model>`).
- Shiori auto-creates `~/.shiori` on startup, watches `~/.shiori/magpie.json` live (no restart needed), merges the Magpie connection as `slug: "magpie"`, and sends `Authorization: Bearer magpie-shiori` to Magpie's gateway so all usage and routing rules belong to **Shiori**.
- Disconnecting Shiori in Magpie empties `~/.shiori/magpie.json`, and Shiori immediately drops the Magpie-managed connection without touching any other connections in `config.json`.

## Setup

```powershell
# 1. Add the local plugin to Magpie
magpie plugin add D:\ClaudeWork\Shiori\integrations\magpie-agent-shiori

# 2. Connect Shiori and choose a default model (or connect in Magpie Agents UI)
magpie shiori codex/gpt-6.2-sol

# 3. Optional: control which models Shiori can see
magpie visible shiori all

# 4. Verify end-to-end health
node D:\ClaudeWork\Shiori\integrations\magpie-agent-shiori\scripts\doctor.mjs
```

## Optional: Disconnect legacy Craft Agents row

If you previously connected Craft Agents in Magpie and no longer use it:

```powershell
magpie craft-agents default
```
