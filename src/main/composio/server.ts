/**
 * Lightweight HTTP server for agent tool execution via Composio.
 * Replaces relay's POST /agent/tools endpoint.
 * Listens on port 3102 so the OpenClaw call-tool.cjs script can reach it.
 */

import { createServer, type Server } from 'http'
import { proxyToolAction, executeActionDirect } from './service'
import { readBody, sendJson } from '../lib/http-helpers'

let server: Server | null = null
let actualPort = 3102

export function startComposioServer(): Promise<number> {
  return new Promise((resolve, reject) => {
    if (server) {
      resolve(actualPort)
      return
    }

    server = createServer(async (req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*')
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

      if (req.method === 'OPTIONS') {
        res.writeHead(204)
        res.end()
        return
      }

      if (req.method !== 'POST' || req.url !== '/execute') {
        sendJson(res, 404, { success: false, error: 'Not found' })
        return
      }

      try {
        const body = JSON.parse(await readBody(req)) as {
          actionName: string
          entityId: string
          params: Record<string, unknown>
        }

        const { actionName, entityId, params } = body
        if (!actionName || !entityId) {
          sendJson(res, 400, { success: false, error: 'Missing actionName or entityId' })
          return
        }

        // Try SDK execution first, fall back to direct REST API
        let result: unknown
        try {
          result = await proxyToolAction(entityId, actionName, params || {})
        } catch (sdkErr) {
          console.warn(`[composio-server] SDK failed for ${actionName}, trying REST:`, (sdkErr as Error).message)
          result = await executeActionDirect(entityId, actionName, params || {})
        }

        sendJson(res, 200, { success: true, result })
      } catch (err) {
        console.error('[composio-server] Error:', err)
        sendJson(res, 500, { success: false, error: (err as Error).message })
      }
    })

    const tryPort: number = 3102
    server.listen(tryPort, '127.0.0.1', () => {
      const addr = server!.address()
      actualPort = typeof addr === 'object' && addr ? addr.port : tryPort
      console.log(`[composio] Server listening on http://127.0.0.1:${actualPort}`)
      resolve(actualPort)
    })

    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE' && tryPort !== 0) {
        console.warn(`[composio] Port ${tryPort} in use, using random port`)
        server!.listen(0, '127.0.0.1')
      } else {
        console.error('[composio] Server error:', err)
        reject(err)
      }
    })
  })
}

export function stopComposioServer(): void {
  if (server) {
    server.close()
    server = null
  }
}
