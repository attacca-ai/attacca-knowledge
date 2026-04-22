import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { useCaptureStore } from '../capture-store'
import { installMockApi, cleanupMockApi } from '../../../../../tests/helpers'

describe('capture-store', () => {
  beforeEach(() => {
    installMockApi()
    useCaptureStore.setState({ rawCaptures: [], rawCapturesCount: 0 })
  })

  afterEach(() => cleanupMockApi())

  it('addRawCapture prepends entry and counts unnoted captures', () => {
    useCaptureStore.getState().addRawCapture({ text: 'first', type: 'thought', agentNote: null })
    useCaptureStore.getState().addRawCapture({ text: 'second', type: 'action', agentNote: 'seen' })

    const s = useCaptureStore.getState()
    expect(s.rawCaptures).toHaveLength(2)
    expect(s.rawCaptures[0].text).toBe('second')
    // Only the agentNote=null capture increments the unread count
    expect(s.rawCapturesCount).toBe(1)
  })

  it('updateCaptureNote sets the note and decrements count', () => {
    useCaptureStore.getState().addRawCapture({ text: 'x', type: 'thought', agentNote: null })
    const id = useCaptureStore.getState().rawCaptures[0].id

    useCaptureStore.getState().updateCaptureNote(id, 'ack')
    const s = useCaptureStore.getState()
    expect(s.rawCaptures[0].agentNote).toBe('ack')
    expect(s.rawCapturesCount).toBe(0)
  })

  it('archiveCapture marks entry archived without deleting', () => {
    useCaptureStore.getState().addRawCapture({ text: 'y', type: 'thought', agentNote: 'n' })
    const id = useCaptureStore.getState().rawCaptures[0].id

    useCaptureStore.getState().archiveCapture(id)
    expect(useCaptureStore.getState().rawCaptures[0].archived).toBe(true)
  })

  it('deleteCapture removes entry', () => {
    useCaptureStore.getState().addRawCapture({ text: 'z', type: 'thought', agentNote: 'n' })
    const id = useCaptureStore.getState().rawCaptures[0].id

    useCaptureStore.getState().deleteCapture(id)
    expect(useCaptureStore.getState().rawCaptures).toHaveLength(0)
  })
})
