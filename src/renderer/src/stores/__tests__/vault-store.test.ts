import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { useVaultStore } from '../vault-store'
import { installMockApi, cleanupMockApi } from '../../../../../tests/helpers'

describe('vault-store', () => {
  beforeEach(() => {
    installMockApi()
    useVaultStore.setState({ entries: [] })
  })

  afterEach(() => cleanupMockApi())

  it('addEntry prepends a new vault node and stamps savedAt', () => {
    const id = useVaultStore.getState().addEntry({
      title: 't',
      sourceType: 'capture',
      summary: 's',
      tags: ['a']
    })
    const e = useVaultStore.getState().entries[0]
    expect(e.id).toBe(id)
    expect(e.title).toBe('t')
    expect(typeof e.savedAt).toBe('number')
  })

  it('deleteEntry removes by id', () => {
    const id = useVaultStore.getState().addEntry({
      title: 't',
      sourceType: 'capture',
      summary: 's',
      tags: []
    })
    useVaultStore.getState().deleteEntry(id)
    expect(useVaultStore.getState().entries).toHaveLength(0)
  })
})
