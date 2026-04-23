import { useCallback, useEffect, useState } from 'react'
import { FolderOpen, Lock, Unlock, RefreshCw } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'

interface ExternalWritesState {
  isExternal: boolean
  writes: Record<string, boolean>
  folders: string[]
}

/**
 * Vault settings — vault path, open in Finder, and external-folder
 * write toggles (spec §6.5 resolved Q4). In managed mode only the
 * path + reveal button are shown; write toggles are inert.
 */
export function VaultSettings(): React.JSX.Element {
  const [state, setState] = useState<ExternalWritesState>({
    isExternal: false,
    writes: {},
    folders: []
  })
  const [vaultPath, setVaultPath] = useState('')
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setErr(null)
    try {
      const [ext, p] = await Promise.all([
        window.api.vault.getExternalWrites(),
        window.api.vault.getPath()
      ])
      if (!ext.success) setErr(ext.error ?? 'Failed to load vault settings')
      setState({
        isExternal: ext.isExternal,
        writes: ext.writes ?? {},
        folders: ext.folders ?? []
      })
      setVaultPath(p)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function toggleFolder(folder: string, writable: boolean): Promise<void> {
    const res = await window.api.vault.setExternalWrite(folder, writable)
    if (!res.success) {
      setErr(res.error ?? 'Failed to update write permission')
      return
    }
    setState((s) => ({ ...s, writes: { ...s.writes, [folder]: writable } }))
  }

  return (
    <div
      className="rounded-[10px] overflow-hidden"
      style={{ background: 'var(--att-surface)', border: '1px solid var(--att-divider)' }}
    >
      <div className="flex items-start gap-3 p-4">
        <div className="flex-1">
          <div className="text-[13px] text-foreground mb-1">Vault location</div>
          <div className="text-[11.5px] text-muted-foreground/60 leading-[1.4]">
            {state.isExternal ? 'External' : 'Managed'} · {vaultPath || '(unknown)'}
          </div>
        </div>
        <Button size="sm" variant="ghost" onClick={() => void window.api.vault.openFolder()}>
          <FolderOpen className="mr-1 h-3.5 w-3.5" />
          Reveal
        </Button>
        <Button size="sm" variant="ghost" onClick={() => void load()} disabled={loading}>
          <RefreshCw className="mr-1 h-3.5 w-3.5" />
          {loading ? 'Loading' : 'Refresh'}
        </Button>
      </div>

      <div
        className="px-4 py-3"
        style={{ borderTop: '1px solid var(--att-divider)' }}
      >
        <div className="text-[13px] text-foreground mb-1">External folder writes</div>
        <div className="text-[11.5px] text-muted-foreground/60 leading-[1.4] mb-3">
          In external vault mode, Attacca only writes to its managed folders
          (00-Inbox, 01-Projects, 02-Areas, 03-Resources, 04-Archive,
          05-Decisions, 06-Lessons, 07-Reviews, 08-Patterns, daily, memory).
          Toggle any other top-level folder on to let the agent write there.
        </div>

        {err && <div className="text-[12px] text-att-red mb-2">{err}</div>}

        {!state.isExternal && (
          <div className="text-[11.5px] text-muted-foreground/70">
            You're on a managed vault — these toggles only apply in external mode.
          </div>
        )}

        {state.isExternal && state.folders.length === 0 && (
          <div className="text-[11.5px] text-muted-foreground/70">
            No non-managed top-level folders detected in your vault.
          </div>
        )}

        {state.isExternal && state.folders.length > 0 && (
          <ul className="flex flex-col gap-2">
            {state.folders.map((f) => {
              const writable = Boolean(state.writes[f])
              return (
                <li
                  key={f}
                  className="flex items-center justify-between rounded-md border border-att-divider bg-background px-3 py-2"
                >
                  <div className="flex items-center gap-2">
                    {writable ? (
                      <Unlock className="h-3.5 w-3.5 text-att-green" />
                    ) : (
                      <Lock className="h-3.5 w-3.5 text-muted-foreground" />
                    )}
                    <span className="font-mono text-[12px] text-foreground">{f}/</span>
                    {!writable && (
                      <span className="text-[10.5px] text-muted-foreground/70">
                        read-only
                      </span>
                    )}
                  </div>
                  <Switch
                    checked={writable}
                    onCheckedChange={(v) => void toggleFolder(f, Boolean(v))}
                  />
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
