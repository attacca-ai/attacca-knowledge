import { useCallback, useEffect, useMemo, useState } from 'react'
import { FolderOpen, Pencil, RefreshCw, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { VaultTree, type VaultTreeNode } from './vault/VaultTree'
import { NotePreview } from './vault/NotePreview'
import { NoteEditor } from './vault/NoteEditor'

interface OpenNote {
  path: string
  body: string
  frontmatter: Record<string, unknown>
  rawFrontmatter?: string
}

const TABS: Array<{ key: string; label: string; prefix: string | null }> = [
  { key: 'all', label: 'All', prefix: null },
  { key: 'inbox', label: 'Inbox', prefix: '00-Inbox' },
  { key: 'projects', label: 'Projects', prefix: '01-Projects' },
  { key: 'areas', label: 'Areas', prefix: '02-Areas' },
  { key: 'resources', label: 'Resources', prefix: '03-Resources' },
  { key: 'decisions', label: 'Decisions', prefix: '05-Decisions' },
  { key: 'reviews', label: 'Reviews', prefix: '07-Reviews' }
]

export function VaultView(): React.JSX.Element {
  const [tree, setTree] = useState<VaultTreeNode[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<string>('all')
  const [open, setOpen] = useState<OpenNote | null>(null)
  const [editing, setEditing] = useState(false)

  const loadTree = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await window.api.vault.listTree({ maxDepth: 4 })
      if (!res.success) setError(res.error ?? 'Failed to load vault')
      setTree(res.tree as VaultTreeNode[])
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadTree()
  }, [loadTree])

  // Refresh on external vault events.
  useEffect(() => {
    const off = window.api.vault.onChanged(() => {
      void loadTree()
    })
    return off
  }, [loadTree])

  const activePrefix = useMemo(() => TABS.find((t) => t.key === tab)?.prefix ?? null, [tab])

  async function openFile(node: VaultTreeNode): Promise<void> {
    setEditing(false)
    try {
      const res = await window.api.vault.readNote(node.path)
      if (res.success && res.body !== undefined) {
        setOpen({
          path: node.path,
          body: res.body,
          frontmatter: res.frontmatter ?? {},
          rawFrontmatter: res.rawFrontmatter
        })
      } else {
        setError(res.error ?? 'Failed to read note')
      }
    } catch (err) {
      setError((err as Error).message)
    }
  }

  async function saveOpen(body: string, frontmatter: Record<string, unknown>): Promise<void> {
    if (!open) return
    const res = await window.api.vault.writeNote(open.path, body, frontmatter, {
      preserveRaw: open.rawFrontmatter
    })
    if (!res.success) {
      throw new Error(res.error ?? 'Write failed')
    }
    // Re-read to pick up canonical state.
    const readRes = await window.api.vault.readNote(open.path)
    if (readRes.success && readRes.body !== undefined) {
      setOpen({
        path: open.path,
        body: readRes.body,
        frontmatter: readRes.frontmatter ?? {},
        rawFrontmatter: readRes.rawFrontmatter
      })
    }
    setEditing(false)
  }

  async function archiveOpen(): Promise<void> {
    if (!open) return
    if (!confirm('Move this note to 04-Archive/? It will not be deleted.')) return
    const res = await window.api.vault.deleteNote(open.path)
    if (res.success) {
      setOpen(null)
      void loadTree()
    } else {
      setError(res.error ?? 'Archive failed')
    }
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex items-center justify-between border-b border-att-divider px-6 py-4">
        <div>
          <h1 className="text-[18px] font-light text-foreground">Vault</h1>
          <p className="text-[11.5px] text-muted-foreground/70">
            All notes on disk. In external mode, edits outside Attacca's managed folders are
            read-only by default.
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={() => void loadTree()} disabled={loading}>
            <RefreshCw className="mr-1 h-3.5 w-3.5" />
            {loading ? 'Loading…' : 'Refresh'}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void window.api.vault.openFolder()}>
            <FolderOpen className="mr-1 h-3.5 w-3.5" />
            Reveal folder
          </Button>
        </div>
      </header>

      <div className="flex items-center gap-1 border-b border-att-divider px-6 py-2 text-[12px]">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-full px-3 py-1 ${
              tab === t.key
                ? 'bg-att-blue/15 text-att-blue'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && <div className="border-b border-att-red/30 bg-att-red/10 px-6 py-2 text-[12px] text-att-red">{error}</div>}

      <div className="flex flex-1 overflow-hidden">
        <aside className="w-[280px] shrink-0 overflow-auto border-r border-att-divider p-2">
          {loading && tree.length === 0 && (
            <div className="p-2 text-[12px] text-muted-foreground">Loading…</div>
          )}
          {tree.length > 0 && (
            <VaultTree
              nodes={tree[0]?.children ? tree : tree}
              selectedPath={open?.path ?? null}
              onSelect={(n) => void openFile(n)}
              tabFilter={activePrefix ?? undefined}
            />
          )}
        </aside>

        <section className="flex-1 overflow-auto p-6">
          {!open ? (
            <div className="flex h-full items-center justify-center">
              <div className="max-w-[320px] text-center text-[12px] text-muted-foreground">
                Select a note on the left to read or edit it. Use the tabs above to filter by PARA
                folder.
              </div>
            </div>
          ) : editing ? (
            <NoteEditor
              initialBody={open.body}
              initialFrontmatter={open.frontmatter}
              onSave={saveOpen}
              onCancel={() => setEditing(false)}
            />
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[13.5px] font-medium text-foreground">{open.path}</div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
                    <Pencil className="mr-1 h-3.5 w-3.5" />
                    Edit
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void archiveOpen()}>
                    <Trash2 className="mr-1 h-3.5 w-3.5" />
                    Archive
                  </Button>
                </div>
              </div>
              <NotePreview frontmatter={open.frontmatter} body={open.body} />
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
