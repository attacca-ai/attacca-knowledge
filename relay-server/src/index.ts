import dotenv from 'dotenv'
dotenv.config()

import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import { authMiddleware } from './middleware/auth.js'
import { usageCeilingMiddleware } from './middleware/usage.js'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import llmRoutes from './routes/llm.js'
import composioRoutes from './routes/composio.js'
import usageRoutes from './routes/usage.js'
import telemetryRoutes from './routes/telemetry.js'
import dashboardRoutes from './routes/dashboard.js'
import { closePool } from './db/client.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

const app = express()
const PORT = parseInt(process.env.PORT || '3100', 10)

// Global middleware
app.use(helmet())
app.use(cors())
app.use(express.json({ limit: '1mb' }))

// Health check (no auth)
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// All API routes require license auth
app.use('/llm', authMiddleware, usageCeilingMiddleware, llmRoutes)
app.use('/composio', authMiddleware, composioRoutes)
app.use('/usage', authMiddleware, usageRoutes)

// Telemetry (auth required for write, separate from relay data)
app.use('/telemetry', authMiddleware, telemetryRoutes)

// Internal research dashboard (no license auth, uses dashboard secret)
app.use('/dashboard', dashboardRoutes)
app.use('/dashboard-ui', express.static(join(__dirname, '..', 'public')))

// Start server
const server = app.listen(PORT, () => {
  console.log(`[relay] Attacca relay server running on port ${PORT}`)
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
