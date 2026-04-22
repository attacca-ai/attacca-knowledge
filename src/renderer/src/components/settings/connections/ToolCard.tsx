import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/i18n'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger
} from '@/components/ui/alert-dialog'

interface ToolCardProps {
  toolId: string
  label: string
  description: string
  emoji: string
  isConnected: boolean
  isConnecting: boolean
  isDisconnecting: boolean
  onConnect: () => void
  onDisconnect: () => void
  onAddAccount?: () => void
}

export function ToolCard({
  toolId: _toolId,
  label,
  description,
  emoji,
  isConnected,
  isConnecting,
  isDisconnecting,
  onConnect,
  onDisconnect,
  onAddAccount
}: ToolCardProps): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div
      className={cn(
        'flex cursor-pointer items-center gap-[10px] rounded-lg border p-3 transition-all duration-[120ms]',
        isConnected
          ? 'border-att-green/25 bg-att-surface hover:bg-att-surface-hover'
          : 'border-att-divider bg-att-surface hover:border-att-divider hover:bg-att-surface-hover'
      )}
      onClick={() => {
        if (!isConnected && !isConnecting) onConnect()
      }}
    >
      {/* Logo */}
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-att-surface-hover text-sm">
        {emoji}
      </div>

      {/* Info */}
      <div className="min-w-0 flex-1">
        <div className="text-[12.5px] font-medium text-foreground">{label}</div>
        <div className="overflow-hidden text-ellipsis whitespace-nowrap text-[10.5px] text-muted-foreground/60">
          {description}
        </div>
      </div>

      {/* Status badge / action */}
      {isConnecting ? (
        <span className="flex shrink-0 items-center gap-1 rounded-[10px] bg-att-blue/12 px-[6px] py-[2px] font-mono text-[8px] text-att-blue">
          <Loader2 className="h-2.5 w-2.5 animate-spin" />
          {t('toolCard.connecting')}
        </span>
      ) : isConnected ? (
        <div className="flex shrink-0 items-center gap-1">
          {onAddAccount && (
            <button
              type="button"
              aria-label={t('toolCard.addAccountAriaLabel')}
              onClick={(e) => {
                e.stopPropagation()
                onAddAccount()
              }}
              className="cursor-pointer rounded-[10px] bg-att-blue/8 px-[5px] py-[2px] font-mono text-[8px] text-att-blue/70 transition-colors hover:bg-att-blue/15 hover:text-att-blue focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-att-blue"
            >
              {t('toolCard.addAccount')}
            </button>
          )}
          <AlertDialog>
          <AlertDialogTrigger asChild>
            <span
              onClick={(e) => e.stopPropagation()}
              className="shrink-0 cursor-pointer rounded-[10px] bg-att-green/10 px-[6px] py-[2px] font-mono text-[8px] text-att-green transition-colors hover:bg-att-red/10 hover:text-att-red"
            >
              {isDisconnecting ? (
                <span className="flex items-center gap-1">
                  <Loader2 className="h-2.5 w-2.5 animate-spin" /> {t('toolCard.disconnecting')}
                </span>
              ) : (
                t('toolCard.active')
              )}
            </span>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('toolCard.disconnect_title', { label })}</AlertDialogTitle>
              <AlertDialogDescription>{t('toolCard.disconnect_desc')}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('toolCard.cancel')}</AlertDialogCancel>
              <AlertDialogAction variant="destructive" onClick={onDisconnect}>
                {t('toolCard.disconnect')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        </div>
      ) : (
        <span className="shrink-0 rounded-[10px] bg-att-blue/12 px-[6px] py-[2px] font-mono text-[8px] text-att-blue">
          {t('toolCard.connect')}
        </span>
      )}
    </div>
  )
}
