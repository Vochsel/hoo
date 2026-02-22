# Hoo

A web browser, but each tab is a node.

Useful for automating computer use tasks reliably, repetitively, and really cool-ly... 


## Run

```bash
bun install
bun run dev
```

`bun run dev` now runs an Electron-native rebuild of `better-sqlite3` first to avoid Node ABI mismatch errors.

## `hoo-server` wrapper

Run a command with a per-server assigned port:

```bash
hoo-server -- claude
```

The wrapper picks (and persists) a unique port per server name in `~/.hoo-server/ports.json` and injects:

- `PORT`
- `SERVER_PORT`
- `HOO_SERVER_PORT`
- `HOO_SERVER_NAME`

Port range defaults to `43100-44099` and can be overridden via:

```bash
HOO_SERVER_BASE_PORT=45000 HOO_SERVER_MAX_PORT=45999 hoo-server -- claude
```

## Env fallback

Optional `.env` keys:

```bash
OPENAI_API_KEY=...
ANTHROPIC_API_KEY=...
BROWSER_AI_MODEL=claude-sonnet-4-6
```
