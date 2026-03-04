import { createHash } from 'crypto'
import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { loadLicense } from '../license/store'
import { loadQueue, saveQueue, clearQueue } from './store'
import type { TelemetryEvent } from './types'

const FLUSH_INTERVAL_MS = 60 * 1000 // 1 minute (relay is local)
const RELAY_TELEMETRY_URL = 'http://127.0.0.1:3100/telemetry/events'

class TelemetryCollector {
  private queue: TelemetryEvent[] = []
  private optIn = false
  private anonymousId = ''
  private flushTimer: ReturnType<typeof setInterval> | null = null
  private optInPath: string

  constructor() {
    this.optInPath = join(app.getPath('userData'), 'telemetry-opt-in.json')
    this.loadOptIn()
    this.queue = loadQueue()
    this.anonymousId = this.computeAnonymousId()

    // Start periodic flush
    this.flushTimer = setInterval(() => this.flush(), FLUSH_INTERVAL_MS)
  }

  private loadOptIn(): void {
    try {
      if (existsSync(this.optInPath)) {
        const data = JSON.parse(readFileSync(this.optInPath, 'utf-8'))
        this.optIn = data.optIn === true
      }
    } catch {
      this.optIn = false
    }
  }

  private saveOptIn(): void {
    writeFileSync(this.optInPath, JSON.stringify({ optIn: this.optIn }), 'utf-8')
  }

  private computeAnonymousId(): string {
    const stored = loadLicense()
    if (!stored?.key) return 'unknown'
    return createHash('sha256').update(stored.key).digest('hex')
  }

  setOptIn(optIn: boolean): void {
    this.optIn = optIn
    this.saveOptIn()

    if (!optIn) {
      // Clear local queue when opting out
      this.queue = []
      clearQueue()
    } else {
      // Flush any queued events immediately on opt-in
      this.flush().catch(() => {})
    }
  }

  getOptIn(): boolean {
    return this.optIn
  }

  emit(eventType: string, payload: Record<string, unknown>): void {
    if (!this.optIn) return

    const event: TelemetryEvent = {
      eventType,
      payload,
      timestamp: new Date().toISOString(),
      anonymousId: this.anonymousId
    }

    this.queue.push(event)
    saveQueue(this.queue)
    // Flush immediately — relay is local so latency is negligible
    this.flush().catch(() => {})
  }

  async flush(): Promise<void> {
    if (!this.optIn || this.queue.length === 0) return

    const batch = [...this.queue]
    this.queue = []
    saveQueue(this.queue)

    try {
      const stored = loadLicense()
      const response = await fetch(RELAY_TELEMETRY_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(stored?.key ? { Authorization: `Bearer ${stored.key}` } : {})
        },
        body: JSON.stringify({ events: batch })
      })

      if (!response.ok) {
        // Put events back in queue for retry
        this.queue = [...batch, ...this.queue]
        saveQueue(this.queue)
        console.error('[telemetry] Flush failed:', response.status)
      }
    } catch (err) {
      // Network error — put events back
      this.queue = [...batch, ...this.queue]
      saveQueue(this.queue)
      console.error('[telemetry] Flush error:', err)
    }
  }

  async deleteData(): Promise<void> {
    // Clear local data
    this.queue = []
    clearQueue()

    // Request server-side deletion
    try {
      const stored = loadLicense()
      if (stored?.key) {
        await fetch('http://127.0.0.1:3100/telemetry/delete', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${stored.key}`
          },
          body: JSON.stringify({ anonymousId: this.anonymousId })
        })
      }
    } catch {
      // Best effort
    }
  }

  destroy(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer)
      this.flushTimer = null
    }
  }
}

let collectorInstance: TelemetryCollector | null = null

export function initTelemetryCollector(): TelemetryCollector {
  if (!collectorInstance) {
    collectorInstance = new TelemetryCollector()
  }
  return collectorInstance
}

export function getTelemetryCollector(): TelemetryCollector {
  if (!collectorInstance) {
    return initTelemetryCollector()
  }
  return collectorInstance
}
