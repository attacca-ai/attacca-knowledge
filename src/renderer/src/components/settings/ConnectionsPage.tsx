import { Badge } from '@/components/ui/badge'
import { useOnboardingStore } from '@/stores/onboarding-store'

const TOOL_NAMES: Record<string, string> = {
  'google-calendar': 'Google Calendar',
  'outlook-calendar': 'Outlook Calendar',
  gmail: 'Gmail',
  'outlook-email': 'Outlook',
  clickup: 'ClickUp',
  asana: 'Asana',
  trello: 'Trello',
  notion: 'Notion',
  'google-drive': 'Google Drive',
  onedrive: 'OneDrive',
  dropbox: 'Dropbox',
  slack: 'Slack',
  teams: 'Microsoft Teams',
  telegram: 'Telegram'
}

export function ConnectionsPage(): React.JSX.Element {
  const connectedTools = useOnboardingStore((s) => s.connectedTools)

  return (
    <div className="flex flex-1 flex-col p-6">
      <h2 className="mb-4 text-xl font-semibold text-foreground">Connections</h2>
      <div className="flex flex-col gap-2">
        {connectedTools.length === 0 ? (
          <p className="text-muted-foreground">No tools connected yet.</p>
        ) : (
          connectedTools.map((tool) => (
            <div key={tool} className="flex items-center justify-between rounded-md border border-border p-3">
              <span className="text-sm text-foreground">{TOOL_NAMES[tool] || tool}</span>
              <Badge variant="outline" className="text-green-600 dark:text-green-400">Connected</Badge>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
