import { ChildProcess, spawn } from 'child_process'
import path from 'path'
import { app } from 'electron'
import { ensureConfig, ensureControlUiConfig, ensureRelayProviderConfig, ensureComposioSkill, clearSessionSkillsSnapshot } from './config'
import { loadLicense } from '../license/store'
import { getMainWindow } from '../window/main-window'
import { IPC } from '../ipc/channels'

export type GatewayState = 'stopped' | 'starting' | 'running' | 'stopping' | 'error'

interface GatewayInfo {
  state: GatewayState
  pid: number | null
  restartCount: number
  lastError: string | null
  startedAt: number | null
}

let gatewayProcess: ChildProcess | null = null
let state: GatewayState = 'stopped'
let restartCount = 0
let lastError: string | null = null
let startedAt: number | null = null

const MAX_RESTARTS = 5
const RESTART_WINDOW_MS = 60_000
let restartTimestamps: number[] = []

function setState(newState: GatewayState): void {
  state = newState
  const mainWindow = getMainWindow()
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IPC.EVENT_GATEWAY_STATE_CHANGED, getGatewayState())
  }
}

export function getGatewayState(): GatewayInfo {
  return {
    state,
    pid: gatewayProcess?.pid ?? null,
    restartCount,
    lastError,
    startedAt
  }
}

function resolveOpenClawMjs(): string {
  if (app.isPackaged) {
    // Production: bundled in extraResources
    return path.join(process.resourcesPath, 'openclaw', 'openclaw.mjs')
  }
  // Development: resolve from node_modules
  return path.join(app.getAppPath(), 'node_modules', 'openclaw', 'openclaw.mjs')
}

export function startGateway(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (state === 'running' || state === 'starting') {
      resolve()
      return
    }

    // Check restart rate limiting
    const now = Date.now()
    restartTimestamps = restartTimestamps.filter((t) => now - t < RESTART_WINDOW_MS)
    if (restartTimestamps.length >= MAX_RESTARTS) {
      const err = `Gateway restart limit reached (${MAX_RESTARTS} restarts in ${RESTART_WINDOW_MS / 1000}s)`
      lastError = err
      setState('error')
      reject(new Error(err))
      return
    }

    setState('starting')
    ensureControlUiConfig()
    const config = ensureConfig()

    // Load license now — needed both for the relay base URL and the Composio skill.
    const license = loadLicense()

    // Configure OpenClaw to route LLM calls through the relay proxy by default.
    // Pass the license key so the relay can track per-user usage and enforce the ceiling.
    // If the user has set a BYOK key, switch to the built-in provider instead.
    ensureRelayProviderConfig(
      config.llm ? { provider: config.llm.provider, model: config.llm.model } : null,
      license?.key ?? null
    )

    // Write the Composio workspace skill so the agent can call Gmail, Calendar, etc.
    if (license?.key) {
      try {
        ensureComposioSkill(license.key)
      } catch (err) {
        console.warn('[gateway] Could not write Composio skill:', err)
      }
    }

    // Clear stale skills snapshot so the gateway rebuilds it with the current skill set.
    clearSessionSkillsSnapshot()

    // Inject LLM API key into gateway env so OpenClaw can find it
    const gatewayEnv: NodeJS.ProcessEnv = { ...process.env }
    if (config.llm?.apiKey) {
      const provider = config.llm.provider
      if (provider === 'anthropic') gatewayEnv.ANTHROPIC_API_KEY = config.llm.apiKey
      else if (provider === 'openai') gatewayEnv.OPENAI_API_KEY = config.llm.apiKey
      else if (provider === 'google') gatewayEnv.GOOGLE_API_KEY = config.llm.apiKey
    }

    try {
      const openclawMjs = resolveOpenClawMjs()
      gatewayProcess = spawn('node', [openclawMjs, 'gateway', '--port', String(config.gateway.port)], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: gatewayEnv,
        windowsHide: true
      })

      gatewayProcess.stdout?.on('data', (data: Buffer) => {
        const msg = data.toString().trim()
        console.log(`[gateway] ${msg}`)

        // Detect when gateway is ready
        if (msg.includes('listening') || msg.includes('started') || msg.includes('ready')) {
          startedAt = Date.now()
          setState('running')
          resolve()
        }
      })

      gatewayProcess.stderr?.on('data', (data: Buffer) => {
        console.error(`[gateway:err] ${data.toString().trim()}`)
      })

      gatewayProcess.on('error', (err) => {
        console.error('[gateway] Process error:', err.message)
        lastError = err.message
        setState('error')
        gatewayProcess = null
        reject(err)
      })

      gatewayProcess.on('exit', (code, signal) => {
        console.log(`[gateway] Process exited (code=${code}, signal=${signal})`)
        gatewayProcess = null

        if (state === 'stopping') {
          setState('stopped')
          return
        }

        // Unexpected exit — attempt restart
        lastError = `Process exited with code ${code}`
        setState('error')
        restartTimestamps.push(Date.now())
        restartCount++

        // Auto-restart with backoff
        const backoff = Math.min(1000 * Math.pow(2, restartCount - 1), 30_000)
        console.log(`[gateway] Restarting in ${backoff}ms (attempt ${restartCount})...`)
        setTimeout(() => {
          startGateway().catch((e) => console.error('[gateway] Restart failed:', e))
        }, backoff)
      })

      // If we don't get a ready signal within 10s, resolve anyway
      setTimeout(() => {
        if (state === 'starting') {
          startedAt = Date.now()
          setState('running')
          resolve()
        }
      }, 10_000)
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
      setState('error')
      reject(err)
    }
  })
}

export async function stopGateway(): Promise<void> {
  if (!gatewayProcess || state === 'stopped' || state === 'stopping') {
    return
  }

  setState('stopping')

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      // Force kill if graceful shutdown takes too long
      if (gatewayProcess) {
        console.log('[gateway] Force killing process')
        gatewayProcess.kill('SIGKILL')
      }
      gatewayProcess = null
      setState('stopped')
      resolve()
    }, 5000)

    if (gatewayProcess) {
      gatewayProcess.once('exit', () => {
        clearTimeout(timeout)
        gatewayProcess = null
        setState('stopped')
        resolve()
      })

      // Graceful shutdown
      gatewayProcess.kill('SIGTERM')
    } else {
      clearTimeout(timeout)
      setState('stopped')
      resolve()
    }
  })
}

export async function restartGateway(): Promise<void> {
  await stopGateway()
  await startGateway()
}
