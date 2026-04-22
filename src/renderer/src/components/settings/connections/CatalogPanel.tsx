import { useState, useEffect } from 'react'
import { Search } from 'lucide-react'
import { useTranslation } from '@/i18n'

interface CatalogApp {
  slug: string
  name: string
  categories: string[]
  description: string
}

interface CatalogPanelProps {
  connectedTools: string[]
  onConnectTool: (slug: string) => void
  onNavigateToCustomTools: (toolName: string) => void
}

export function CatalogPanel({
  connectedTools,
  onConnectTool,
  onNavigateToCustomTools
}: CatalogPanelProps): React.JSX.Element {
  const { t } = useTranslation()
  const [apps, setApps] = useState<CatalogApp[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')

  useEffect(() => {
    window.api.composio
      .listApps()
      .then((list) => {
        setApps(list as CatalogApp[])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  const filtered = query.trim()
    ? apps.filter(
        (a) =>
          a.name.toLowerCase().includes(query.toLowerCase()) ||
          a.slug.toLowerCase().includes(query.toLowerCase()) ||
          a.categories.some((c) => c.toLowerCase().includes(query.toLowerCase()))
      )
    : apps

  return (
    <div
      className="flex w-[260px] shrink-0 flex-col overflow-y-auto border-l border-att-divider bg-background"
      style={{ scrollbarWidth: 'thin', scrollbarColor: '#2a2b2f transparent' }}
    >
      <div className="sticky top-0 bg-background p-5 pb-0">
        <div className="mb-[8px] font-mono text-[9px] uppercase tracking-[.1em] text-muted-foreground/60">
          {t('catalog.title')}
        </div>

        {/* Search */}
        <div className="relative mb-[10px]">
          <Search className="absolute left-[9px] top-1/2 h-[11px] w-[11px] -translate-y-1/2 text-muted-foreground/60" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('catalog.search')}
            className="w-full rounded-[6px] border border-att-divider bg-att-surface py-2 pl-7 pr-3 font-sans text-[12px] text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-att-blue"
          />
        </div>
      </div>

      <div className="flex-1 px-5 pb-5">
        {loading ? (
          <div className="flex flex-col gap-2 py-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex items-center gap-2 rounded-[5px] px-2 py-[6px]">
                <div className="h-[22px] w-[22px] animate-pulse rounded-[4px] bg-att-surface-raised" />
                <div className="h-3 flex-1 animate-pulse rounded bg-att-surface-hover" />
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-4 text-center">
            <div className="mb-1 text-[12px] text-muted-foreground/60">{t('catalog.no_results')}</div>
            <button
              onClick={() => onNavigateToCustomTools(query.trim())}
              className="text-[11px] text-att-blue hover:underline"
            >
              {t('catalog.custom_link')}
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-0">
            {filtered.map((app) => {
              const isConnected = connectedTools.includes(app.slug)
              return (
                <div
                  key={app.slug}
                  onClick={() => {
                    if (!isConnected) onConnectTool(app.slug)
                  }}
                  className="flex cursor-pointer items-center gap-2 rounded-[5px] px-2 py-[6px] transition-colors hover:bg-att-surface-hover"
                >
                  <div className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[4px] bg-att-surface-raised text-[11px]">
                    {app.name.charAt(0)}
                  </div>
                  <span className="flex-1 truncate text-[12px] text-muted-foreground hover:text-foreground">
                    {app.name}
                  </span>
                  {isConnected && (
                    <span className="shrink-0 rounded-[2px] bg-att-green/10 px-[4px] py-[1px] font-mono text-[8px] text-att-green">
                      ✓
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
