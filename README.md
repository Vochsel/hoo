# Hoo

A web browser, but each tab is a node.

Useful for automating computer use tasks reliably, repetitively, and really cool-ly... 


## Run

```bash
bun install
bun run dev
```

`bun run dev` now runs an Electron-native rebuild of `better-sqlite3` first to avoid Node ABI mismatch errors.
## Env fallback

Optional `.env` keys:

```bash
OPENAI_API_KEY=...
ANTHROPIC_API_KEY=...
BROWSER_AI_MODEL=claude-sonnet-4-6
```
