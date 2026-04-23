import { useState, useEffect, useCallback } from 'react'
import { useVaultStore, type VaultNode as KBEntry } from '@/stores/vault-store'
import {
  FolderOpen,
  FileText,
  Trash2,
  Search,
  ArrowLeft,
  Loader2,
  BookOpen,
  Plus,
  ExternalLink,
  Import
} from 'lucide-react'
import { cn } from '@/lib/utils'

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  })
}

const SOURCE_BADGE: Record<KBEntry['sourceType'], { label: string; color: string }> = {
  capture: { label: 'capture', color: 'bg-att-blue/10 text-att-blue' },
  transcript: { label: 'transcript', color: 'bg-att-purple/10 text-att-purple' },
  manual: { label: 'manual', color: 'bg-att-green/10 text-att-green' },
  agent: { label: 'agent', color: 'bg-att-orange/10 text-att-orange' }
}

type ViewState = 'list' | 'detail'

export function KnowledgeBasePage(): React.JSX.Element {
  const kbEntries = useVaultStore((s) => s.entries)
  const deleteKBEntry = useVaultStore((s) => s.deleteEntry)
  const addKBEntry = useVaultStore((s) => s.addEntry)
  const [viewState, setViewState] = useState<ViewState>('list')
  const [selectedEntry, setSelectedEntry] = useState<KBEntry | null>(null)
  const [filter, setFilter] = useState('')
  const [kbContext, setKbContext] = useState<string | null>(null)
  const [loadingContext, setLoadingContext] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResult, setSearchResult] = useState<string | null>(null)
  const [searching, setSearching] = useState(false)
  const [kbPath, setKbPath] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)

  // Load KB context and path on mount
  useEffect(() => {
    setLoadingContext(true)
    window.api.kb
      .readContext()
      .then((ctx) => setKbContext(ctx))
      .catch(() => setKbContext(null))
      .finally(() => setLoadingContext(false))
    window.api.kb.getPath().then(setKbPath).catch(() => {})
  }, [])

  const handleImportFiles = useCallback(async (): Promise<void> => {
    const folderPath = await window.api.fs.selectFolder()
    if (!folderPath) return
    setImporting(true)
    try {
      // Read .md files from selected folder — use the import API
      const result = await window.api.kb.importFiles([folderPath])
      if (result.success && result.imported.length > 0) {
        for (const file of result.imported) {
          addKBEntry({
            title: file.title,
            sourceType: 'manual',
            summary: `Imported from ${file.fileName}`,
            tags: ['imported'],
            folder: 'Imported'
          })
        }
      }
    } catch {
      /* import failure non-fatal */
    }
    setImporting(false)
  }, [addKBEntry])

  // Derive folders from entries
  const folders = [...new Set(kbEntries.map((e) => e.folder ?? 'Uncategorized'))]

  // Filter entries
  const filteredEntries = kbEntries.filter((e) => {
    if (filter && (e.folder ?? 'Uncategorized') !== filter) return false
    return true
  })

  const handleAskAgent = useCallback(async (): Promise<void> => {
    if (!searchQuery.trim() || searching) return
    setSearching(true)
    setSearchResult(null)

    const sessionKey = `agent:main:kb-search-${crypto.randomUUID()}`
    const prompt =
      `The user is searching their knowledge base. Query: "${searchQuery.trim()}"\n\n` +
      `Here are the KB entries:\n${kbEntries.map((e) => `- [${e.sourceType}] "${e.title}": ${e.summary}`).join('\n')}\n\n` +
      `Respond with a concise answer based on the entries above. If nothing matches, say so.`

    let settled = false
    // Declare timer first so the listener below can reference it without a TDZ hazard.
    let timeoutId: ReturnType<typeof setTimeout> | undefined

    const unsub = window.api.agent.onFinal((data) => {
      if (data.sessionKey !== sessionKey) return
      if (settled) return
      settled = true
      if (timeoutId) clearTimeout(timeoutId)
      unsub()
      setSearchResult(data.message || 'No result.')
      setSearching(false)
    })

    timeoutId = setTimeout(() => {
      if (settled) return
      settled = true
      unsub()
      setSearchResult('Agent did not respond in time.')
      setSearching(false)
    }, 30_000)

    try {
      await window.api.agent.send(sessionKey, prompt, sessionKey)
    } catch {
      if (settled) return
      settled = true
      clearTimeout(timeoutId)
      unsub()
      setSearchResult('Failed to reach agent.')
      setSearching(false)
    }
  }, [searchQuery, searching, kbEntries])

  // Detail view
  if (viewState === 'detail' && selectedEntry) {
    return (
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="flex items-center gap-3 border-b border-border px-6 py-4">
          <button
            onClick={() => {
              setViewState('list')
              setSelectedEntry(null)
            }}
            className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="flex-1">
            <h2 className="text-[14px] font-medium text-foreground">{selectedEntry.title}</h2>
            <div className="mt-0.5 flex items-center gap-2">
              <span
                className={cn(
                  'rounded-[2px] px-[5px] py-[1px] font-mono text-[8px]',
                  SOURCE_BADGE[selectedEntry.sourceType].color
                )}
              >
                {SOURCE_BADGE[selectedEntry.sourceType].label}
              </span>
              <span className="font-mono text-[9px] text-muted-foreground/50">
                {formatDate(selectedEntry.savedAt)}
              </span>
              {selectedEntry.folder && (
                <span className="font-mono text-[9px] text-muted-foreground/50">
                  {selectedEntry.folder}
                </span>
              )}
            </div>
          </div>
          <button
            onClick={() => {
              deleteKBEntry(selectedEntry.id)
              setViewState('list')
              setSelectedEntry(null)
            }}
            className="rounded p-1.5 text-muted-foreground/40 transition-colors hover:bg-att-red/10 hover:text-att-red"
            title="Delete entry"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {/* Tags */}
          {selectedEntry.tags.length > 0 && (
            <div className="mb-4 flex flex-wrap gap-1.5">
              {selectedEntry.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-[3px] bg-att-surface-raised px-[6px] py-[2px] font-mono text-[9px] text-muted-foreground/60"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}

          {/* Summary */}
          <div className="rounded-lg border border-border bg-att-surface p-4">
            <p className="mb-2 font-mono text-[9px] uppercase tracking-widest text-muted-foreground/50">
              Summary
            </p>
            <p className="text-[13px] leading-relaxed text-foreground/90">
              {selectedEntry.summary}
            </p>
          </div>
        </div>
      </div>
    )
  }

  // List view
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div className="shrink-0 border-b border-border px-6 py-[18px]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-muted-foreground/60" />
            <h1 className="text-[15px] font-medium text-foreground">Knowledge Base</h1>
            <span className="font-mono text-[10px] text-muted-foreground/50">
              {kbEntries.length} entries
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => void window.api.kb.openFolder()}
              className="flex items-center gap-1.5 rounded-md border border-att-divider px-2.5 py-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-att-surface-hover hover:text-foreground"
              title={kbPath ? `Open ${kbPath}` : 'Open KB folder'}
            >
              <ExternalLink className="h-3 w-3" />
              Open folder
            </button>
            <button
              onClick={() => void handleImportFiles()}
              disabled={importing}
              className="flex items-center gap-1.5 rounded-md border border-att-divider px-2.5 py-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-att-surface-hover hover:text-foreground disabled:opacity-40"
              title="Import .md files from a folder"
            >
              <Import className="h-3 w-3" />
              {importing ? 'Importing...' : 'Import files'}
            </button>
            <button
              onClick={() => window.dispatchEvent(new CustomEvent('attacca:navigate', { detail: { view: 'inbox' } }))}
              className="flex items-center gap-1.5 rounded-md bg-att-blue/12 px-3 py-1.5 text-[12px] text-att-blue transition-colors hover:bg-att-blue/20"
            >
              <Plus className="h-3.5 w-3.5" />
              New Capture
            </button>
          </div>
        </div>
        {/* KB storage location */}
        {kbPath && (
          <button
            onClick={() => void window.api.kb.openFolder()}
            className="mt-2 flex items-center gap-1.5 rounded bg-att-surface px-2.5 py-1 text-left font-mono text-[9px] text-muted-foreground/40 transition-colors hover:text-muted-foreground"
          >
            <FolderOpen className="h-2.5 w-2.5 shrink-0" />
            <span className="truncate">{kbPath}</span>
          </button>
        )}

        {/* Search bar */}
        <div className="mt-3 flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/40" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleAskAgent()
              }}
              placeholder="Ask your knowledge base…"
              className="w-full rounded-md border border-border bg-att-surface py-2 pl-9 pr-3 text-[12.5px] text-foreground placeholder:text-muted-foreground/40 outline-none focus:border-att-blue/50"
            />
          </div>
          <button
            onClick={() => void handleAskAgent()}
            disabled={!searchQuery.trim() || searching}
            className="flex items-center gap-1.5 rounded-md bg-att-blue px-3 py-2 text-[12px] text-white transition-opacity disabled:opacity-40"
          >
            {searching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Ask Agent'}
          </button>
        </div>

        {/* Search result */}
        {searchResult && (
          <div className="mt-3 rounded-lg border border-att-blue/20 bg-att-blue/6 p-3">
            <p className="mb-1 font-mono text-[9px] uppercase tracking-widest text-att-blue/60">
              Agent answer
            </p>
            <p className="text-[12.5px] leading-relaxed text-foreground/90">{searchResult}</p>
          </div>
        )}
      </div>

      {/* Folder filter chips */}
      {folders.length > 1 && (
        <div className="flex gap-1.5 border-b border-border px-6 py-2.5">
          <button
            onClick={() => setFilter('')}
            className={cn(
              'rounded-full border px-2.5 py-[2px] font-mono text-[9px] transition-colors',
              !filter
                ? 'border-att-blue/50 bg-att-blue/10 text-att-blue'
                : 'border-border text-muted-foreground/60 hover:text-muted-foreground'
            )}
          >
            All
          </button>
          {folders.map((folder) => (
            <button
              key={folder}
              onClick={() => setFilter(folder === filter ? '' : folder)}
              className={cn(
                'rounded-full border px-2.5 py-[2px] font-mono text-[9px] transition-colors',
                filter === folder
                  ? 'border-att-blue/50 bg-att-blue/10 text-att-blue'
                  : 'border-border text-muted-foreground/60 hover:text-muted-foreground'
              )}
            >
              <FolderOpen className="mr-1 inline h-2.5 w-2.5" />
              {folder}
            </button>
          ))}
        </div>
      )}

      {/* Entry list */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {loadingContext && (
          <div className="flex items-center gap-2 px-6 py-3 text-[11px] text-muted-foreground/50">
            <Loader2 className="h-3 w-3 animate-spin" />
            Loading knowledge base context…
          </div>
        )}

        {filteredEntries.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 px-6 py-16">
            <BookOpen className="h-8 w-8 text-muted-foreground/20" />
            <p className="text-sm text-muted-foreground/50">
              {kbEntries.length === 0
                ? 'Your knowledge base is empty. Capture content and save it here.'
                : 'No entries match this filter.'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border/40">
            {filteredEntries.map((entry) => (
              <div
                role="button"
                tabIndex={0}
                key={entry.id}
                onClick={() => {
                  setSelectedEntry(entry)
                  setViewState('detail')
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    setSelectedEntry(entry)
                    setViewState('detail')
                  }
                }}
                className="group flex w-full cursor-pointer items-start gap-3 px-6 py-3 text-left transition-colors hover:bg-muted/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-att-blue/40"
              >
                <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/30" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[13px] font-medium text-foreground">
                      {entry.title}
                    </span>
                    <span
                      className={cn(
                        'shrink-0 rounded-[2px] px-[5px] py-[1px] font-mono text-[8px]',
                        SOURCE_BADGE[entry.sourceType].color
                      )}
                    >
                      {SOURCE_BADGE[entry.sourceType].label}
                    </span>
                  </div>
                  <p className="mt-0.5 line-clamp-1 text-[11.5px] text-muted-foreground/70">
                    {entry.summary}
                  </p>
                  <div className="mt-1 flex items-center gap-2">
                    <span className="font-mono text-[9px] text-muted-foreground/40">
                      {formatDate(entry.savedAt)}
                    </span>
                    {entry.folder && (
                      <span className="font-mono text-[9px] text-muted-foreground/40">
                        {entry.folder}
                      </span>
                    )}
                    {entry.tags.slice(0, 3).map((tag) => (
                      <span
                        key={tag}
                        className="rounded-[2px] bg-att-surface-raised px-[4px] py-[1px] font-mono text-[8px] text-muted-foreground/50"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    deleteKBEntry(entry.id)
                  }}
                  className="shrink-0 rounded p-1 text-muted-foreground/30 opacity-0 transition-all hover:bg-att-red/10 hover:text-att-red group-hover:opacity-100"
                  title="Delete"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* KB file context (from main process) */}
        {kbContext && !loadingContext && (
          <div className="border-t border-border px-6 py-4">
            <p className="mb-2 font-mono text-[9px] uppercase tracking-widest text-muted-foreground/40">
              Knowledge base file context
            </p>
            <pre className="max-h-[200px] overflow-y-auto rounded-lg border border-border bg-att-surface p-3 font-mono text-[11px] leading-relaxed text-muted-foreground/70">
              {kbContext}
            </pre>
          </div>
        )}
      </div>
    </div>
  )
}
