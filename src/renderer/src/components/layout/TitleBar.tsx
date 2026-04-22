import { Globe } from 'lucide-react'
import { useTranslation } from '@/i18n'
import { Badge } from '@/components/ui/badge'

export function TitleBar(): React.JSX.Element {
  const { t, locale, setLocale } = useTranslation()

  return (
    <div
      className="flex h-9 shrink-0 items-center justify-between border-b border-border bg-background pl-4 pr-[140px]"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      <span className="text-sm font-medium text-foreground">Attacca</span>
      <div
        className="flex items-center gap-2"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <button
          onClick={() => setLocale(locale === 'en' ? 'es' : 'en')}
          className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] border border-att-divider text-muted-foreground transition-colors hover:border-att-blue hover:text-att-blue cursor-pointer"
        >
          <Globe className="w-2.5 h-2.5" />
          {locale === 'en' ? 'ES' : 'EN'}
        </button>
        <div className="h-2 w-2 rounded-full bg-att-green" title="Agent: ready" />
        <Badge variant="outline" className="text-[10px] px-1.5 py-0">
          {t('titlebar.connected')}
        </Badge>
      </div>
    </div>
  )
}
