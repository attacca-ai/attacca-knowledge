import { spawn, ChildProcess } from 'child_process'
import path from 'path'
import { app } from 'electron'

let relayProcess: ChildProcess | null = null

/**
 * Starts the local relay server as a child process (development only).
 * In production the relay is a hosted service — this function is a no-op
 * when app.isPackaged is true.
 *
 * Uses tsx to run relay-server/src/index.ts directly, which picks up
 * relay-server/.env via dotenv (cwd is set to relay-server/).
 */
export function startRelayServer(): void {
  if (relayProcess) return

  // In production the relay is a cloud service — don't spawn locally
  if (app.isPackaged) return

  const relayDir = path.join(app.getAppPath(), 'relay-server')
  const tsxCli = path.join(relayDir, 'node_modules', 'tsx', 'dist', 'cli.mjs')
  const indexFile = path.join(relayDir, 'src', 'index.ts')

  console.log('[relay] Starting local relay server...')

  try {
    relayProcess = spawn('node', [tsxCli, indexFile], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
      cwd: relayDir, // dotenv.config() in index.ts reads relay-server/.env from here
      windowsHide: true
    })

    relayProcess.stdout?.on('data', (data: Buffer) => {
      const msg = data.toString().trim()
      if (msg) console.log(`[relay] ${msg}`)
    })

    relayProcess.stderr?.on('data', (data: Buffer) => {
      const msg = data.toString().trim()
      if (msg) console.error(`[relay:err] ${msg}`)
    })

    relayProcess.on('error', (err) => {
      console.error('[relay] Process error:', err.message)
      relayProcess = null
    })

    relayProcess.on('exit', (code, signal) => {
      console.log(`[relay] Process exited (code=${code}, signal=${signal})`)
      relayProcess = null
    })
  } catch (err) {
    console.error('[relay] Failed to spawn relay server:', err)
  }
}

export function stopRelayServer(): void {
  if (!relayProcess) return
  console.log('[relay] Stopping relay server...')
  relayProcess.kill('SIGTERM')
  relayProcess = null
}
