import dotenv from 'dotenv'
dotenv.config()

import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import { readFileSync } from 'fs'
import { authMiddleware } from './middleware/auth.js'
import { usageCeilingMiddleware } from './middleware/usage.js'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { getPool } from './db/client.js'
import llmRoutes from './routes/llm.js'
import composioRoutes from './routes/composio.js'
import usageRoutes from './routes/usage.js'
import telemetryRoutes from './routes/telemetry.js'
import dashboardRoutes from './routes/dashboard.js'
import anthropicRoutes from './routes/anthropic.js'
import agentRoutes from './routes/agent.js'
import captureRoutes from './routes/capture.js'
import { closePool } from './db/client.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

const app = express()
const PORT = parseInt(process.env.PORT || '3100', 10)

// Global middleware — strict CSP for API routes
app.use(helmet())
app.use(cors())
app.use(express.json({ limit: '10mb' }))

// Relaxed CSP for the internal dashboard HTML (allows inline styles + Google Fonts)
app.use('/dashboard-ui', helmet({
  contentSecurityPolicy: {
    directives: {
      'default-src': ["'self'"],
      'script-src': ["'self'"],
      'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      'style-src-attr': ["'unsafe-inline'"],
      'font-src': ["'self'", 'https://fonts.gstatic.com'],
      'img-src': ["'self'", 'data:']
    }
  }
}))

// Health check (no auth)
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// Anthropic-compatible proxy for the local OpenClaw gateway (service-token auth, no license check)
app.use('/anthropic', anthropicRoutes)

// Agent tool execution via Composio (service-token auth, no license check)
app.use('/agent', agentRoutes)

// URL / YouTube content extraction (no auth — stateless, no user data)
app.use('/capture', captureRoutes)

// All API routes require license auth
app.use('/llm', authMiddleware, usageCeilingMiddleware, llmRoutes)
app.use('/composio', authMiddleware, composioRoutes)
app.use('/usage', authMiddleware, usageRoutes)

// Telemetry (auth required for write, separate from relay data)
app.use('/telemetry', authMiddleware, telemetryRoutes)

// Internal research dashboard (no license auth, uses dashboard secret)
app.use('/dashboard', dashboardRoutes)
app.use('/dashboard-ui', express.static(join(__dirname, '..', 'public')))

// Auto-migrate schema on startup (idempotent — uses CREATE TABLE IF NOT EXISTS)
async function autoMigrate(): Promise<void> {
  try {
    const schemaPath = join(__dirname, 'db', 'schema.sql')
    const sql = readFileSync(schemaPath, 'utf-8')
    await getPool().query(sql)
    console.log('[relay] Schema migration OK')
  } catch (err) {
    console.error('[relay] Schema migration failed (non-fatal):', err)
  }
}

// Start server
let server: ReturnType<typeof app.listen>
autoMigrate().then(() => {
  server = app.listen(PORT, '127.0.0.1', () => {
    console.log(`[relay] Listening on http://127.0.0.1:${PORT}`)
  })
}).catch(() => {
  server = app.listen(PORT, '127.0.0.1', () => {
    console.log(`[relay] Listening on http://127.0.0.1:${PORT}`)
  })
})

// Graceful shutdown
async function shutdown(): Promise<void> {
  console.log('[relay] Shutting down...')
  server.close()
  await closePool()
  process.exit(0)
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

export default app
