import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { useActivityStore } from '../activity-store'
import { installMockApi, cleanupMockApi } from '../../../../../tests/helpers'

describe('activity-store', () => {
  beforeEach(() => {
    installMockApi()
    useActivityStore.setState({ activityFeed: [] })
  })

  afterEach(() => cleanupMockApi())

  it('addActivity appends and auto-stamps fields', () => {
    useActivityStore
      .getState()
      .addActivity({ type: 'info', description: 'hello' })
    const feed = useActivityStore.getState().activityFeed
    expect(feed).toHaveLength(1)
    expect(feed[0].description).toBe('hello')
    expect(feed[0].type).toBe('info')
    expect(feed[0].id).toMatch(/^act_/)
    expect(typeof feed[0].timestamp).toBe('number')
  })

  it('clearActivity empties the feed', () => {
    useActivityStore
      .getState()
      .addActivity({ type: 'info', description: 'hello' })
    useActivityStore.getState().clearActivity()
    expect(useActivityStore.getState().activityFeed).toHaveLength(0)
  })
})
