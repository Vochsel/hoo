#!/usr/bin/env node
'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')
const net = require('net')
const { spawn } = require('child_process')

const DEFAULT_BASE_PORT = 43100
const DEFAULT_MAX_PORT = 44099
const STATE_DIR = path.join(os.homedir(), '.hoo-server')
const STATE_FILE = path.join(STATE_DIR, 'ports.json')

function printUsage() {
  process.stderr.write(
    [
      'Usage:',
      '  hoo-server -- <command> [args...]',
      '',
      'Examples:',
      '  hoo-server -- claude',
      '  hoo-server -- uv run my_server.py',
      '',
      'Env:',
      '  HOO_SERVER_BASE_PORT (default: 43100)',
      '  HOO_SERVER_MAX_PORT  (default: 44099)'
    ].join('\n') + '\n'
  )
}

function parseArgs(argv) {
  const sepIndex = argv.indexOf('--')
  if (sepIndex >= 0) return argv.slice(sepIndex + 1)
  return argv.slice(2)
}

function normalizeServerName(command) {
  return path.basename(command).replace(/\.[^./\\]+$/, '').toLowerCase()
}

function ensureStateDir() {
  fs.mkdirSync(STATE_DIR, { recursive: true })
}

function readState() {
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf8')
    const data = JSON.parse(raw)
    if (!data || typeof data !== 'object') return { ports: {} }
    if (!data.ports || typeof data.ports !== 'object') return { ports: {} }
    return { ports: data.ports }
  } catch {
    return { ports: {} }
  }
}

function writeState(state) {
  ensureStateDir()
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))
}

function isPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once('error', () => resolve(false))
    server.once('listening', () => {
      server.close(() => resolve(true))
    })
    server.listen(port, '127.0.0.1')
  })
}

async function findAvailablePort(basePort, maxPort, usedPorts) {
  for (let p = basePort; p <= maxPort; p += 1) {
    if (usedPorts.has(p)) continue
    if (await isPortFree(p)) return p
  }
  throw new Error(`No available ports in range ${basePort}-${maxPort}`)
}

async function resolvePortForServer(serverName, basePort, maxPort) {
  const state = readState()
  const entries = Object.values(state.ports)
    .map((v) => Number(v))
    .filter((n) => Number.isInteger(n) && n > 0)
  const usedPorts = new Set(entries)

  const existing = Number(state.ports[serverName])
  if (Number.isInteger(existing) && existing >= basePort && existing <= maxPort) {
    if (await isPortFree(existing)) return { port: existing, state, reused: true }
  }

  const port = await findAvailablePort(basePort, maxPort, usedPorts)
  state.ports[serverName] = port
  writeState(state)
  return { port, state, reused: false }
}

async function main() {
  const commandArgs = parseArgs(process.argv)
  if (commandArgs.length === 0) {
    printUsage()
    process.exitCode = 1
    return
  }

  const command = commandArgs[0]
  const args = commandArgs.slice(1)
  const serverName = normalizeServerName(command)

  const basePort = Number(process.env.HOO_SERVER_BASE_PORT || DEFAULT_BASE_PORT)
  const maxPort = Number(process.env.HOO_SERVER_MAX_PORT || DEFAULT_MAX_PORT)

  if (!Number.isInteger(basePort) || !Number.isInteger(maxPort) || basePort <= 0 || maxPort <= 0 || basePort > maxPort) {
    throw new Error(`Invalid port range: base=${process.env.HOO_SERVER_BASE_PORT || DEFAULT_BASE_PORT}, max=${process.env.HOO_SERVER_MAX_PORT || DEFAULT_MAX_PORT}`)
  }

  const { port, reused } = await resolvePortForServer(serverName, basePort, maxPort)
  process.stdout.write(
    `[hoo-server] server=${serverName} port=${port} assigned=${reused ? 'existing' : 'new'} command="${[command, ...args].join(' ')}"\n`
  )

  const child = spawn(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: {
      ...process.env,
      PORT: String(port),
      SERVER_PORT: String(port),
      HOO_SERVER_PORT: String(port),
      HOO_SERVER_NAME: serverName
    }
  })

  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal)
      return
    }
    process.exit(code ?? 0)
  })

  child.on('error', (err) => {
    process.stderr.write(`[hoo-server] failed to start command: ${String(err)}\n`)
    process.exit(1)
  })
}

main().catch((err) => {
  process.stderr.write(`[hoo-server] ${err instanceof Error ? err.message : String(err)}\n`)
  process.exit(1)
})
