import { registerTask } from './index'

/**
 * Registers all background tasks at app startup.
 */
export function registerAllTasks(): void {
  registerTask({
    id: 'daily-synthesis',
    name: 'Daily Memory Synthesis',
    description: 'Analyzes recent captures to identify patterns and update identity traits',
    cronExpression: '0 2 * * *', // 2:00 AM daily
    enabled: true,
    requiresIdle: true,
    handler: async () => {
      const { runDailySynthesis } = await import('../memory/synthesizer')
      await runDailySynthesis()
    }
  })

  registerTask({
    id: 'weekly-synthesis',
    name: 'Weekly Deep Synthesis',
    description:
      'Deep analysis of the week — promotes patterns to identity traits, compacts old memories',
    cronExpression: '0 3 * * 0', // 3:00 AM Sunday
    enabled: true,
    requiresIdle: true,
    handler: async () => {
      const { runWeeklySynthesis } = await import('../memory/synthesizer')
      await runWeeklySynthesis()
    }
  })

  registerTask({
    id: 'importance-decay',
    name: 'Memory Importance Decay',
    description: 'Reduces importance of memories not accessed in 30+ days',
    cronExpression: '0 4 * * 0', // 4:00 AM Sunday (after weekly synthesis)
    enabled: true,
    requiresIdle: false,
    handler: async () => {
      const { runImportanceDecay } = await import('../memory/synthesizer')
      await runImportanceDecay()
    }
  })

  registerTask({
    id: 'embedding-backfill',
    name: 'Embedding Backfill',
    description: 'Generates embeddings for memories that were saved without them',
    cronExpression: '*/30 * * * *', // Every 30 minutes
    enabled: true,
    requiresIdle: true,
    handler: async () => {
      const { backfillEmbeddings } = await import('../memory/migrate-embeddings')
      await backfillEmbeddings()
    }
  })

  // Life OS Phase 1 — decision revisit scan.
  // Runs daily at 8am local. Output is consumed by DecisionsView /
  // Today view via `decision:scan-due`; this task exists so the queue
  // is warm when the user opens the app and so we can emit telemetry.
  registerTask({
    id: 'decision-revisit-scan',
    name: 'Decision Revisit Scan',
    description: 'Surfaces decisions whose revisit date has arrived',
    cronExpression: '0 8 * * *', // 8:00 AM daily
    enabled: true,
    requiresIdle: false,
    handler: async () => {
      const { scanDueDecisions } = await import('../decisions/manager')
      const due = scanDueDecisions()
      if (due.length > 0) {
        console.log(`[scheduler] ${due.length} decision(s) due for revisit`)
      }
    }
  })

  // Life OS Phase 1 — weekly review (Friday 4pm local).
  registerTask({
    id: 'review-weekly',
    name: 'Weekly Review',
    description: 'Auto-generates a weekly review of the past 7 days',
    cronExpression: '0 16 * * 5', // 4:00 PM Friday
    enabled: true,
    requiresIdle: false,
    handler: async () => {
      const { generateAndSaveReview } = await import('../reviews/manager')
      try {
        const r = await generateAndSaveReview('week')
        console.log(`[scheduler] Weekly review generated: ${r.id}`)
      } catch (err) {
        console.warn('[scheduler] Weekly review failed:', err)
      }
    }
  })

  // Life OS Phase 1 — monthly review (last day of month 5pm local).
  // node-cron doesn't support "last day"; approximate with 28-31 guard
  // that skips non-terminal days. We register every day at 5pm and
  // early-return from the handler.
  registerTask({
    id: 'review-monthly',
    name: 'Monthly Review',
    description: 'Auto-generates a monthly review on the last day of the month',
    cronExpression: '0 17 28-31 * *', // 5:00 PM on days 28-31
    enabled: true,
    requiresIdle: false,
    handler: async () => {
      const today = new Date()
      const tomorrow = new Date(today)
      tomorrow.setDate(today.getDate() + 1)
      if (tomorrow.getMonth() === today.getMonth()) {
        // Not the last day of the month.
        return
      }
      const { generateAndSaveReview } = await import('../reviews/manager')
      try {
        const r = await generateAndSaveReview('month')
        console.log(`[scheduler] Monthly review generated: ${r.id}`)
      } catch (err) {
        console.warn('[scheduler] Monthly review failed:', err)
      }
    }
  })

  console.log('[scheduler] Registered 7 tasks')
}
