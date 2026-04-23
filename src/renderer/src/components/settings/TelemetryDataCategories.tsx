import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { BarChart3 } from 'lucide-react'

const DATA_CATEGORIES = [
  {
    title: 'App Lifecycle',
    items: [
      'When the app starts (platform, version, packaged flag)',
      'When you complete onboarding (LLM provider, tools connected count)',
      'When you complete an onboarding step (step number and name)'
    ]
  },
  {
    title: 'Trust & Autonomy Events',
    items: [
      'When you change your trust profile (Cautious/Balanced/Autonomous)',
      'When you use the Emergency Stop button',
      'When you resume after Emergency Stop (pause duration)'
    ]
  },
  {
    title: 'Agent Performance Events',
    items: [
      'When a task is completed (duration only, no content)',
      'When a task fails (error category only, no details)',
      'When a fallback task is created',
      'When you send a message from the dashboard or capture panel (source only)'
    ]
  },
  {
    title: 'Capture & Navigation',
    items: [
      'When you start a capture (source type only — text/url/file/transcript)',
      'When you save or discard a capture (counts only, no content)',
      'When you switch between feature views (view name only)'
    ]
  }
]

export function TelemetryDataCategories(): React.JSX.Element {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <BarChart3 className="mr-1 h-3 w-3" />
          View Collected Data Categories
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Collected Data Categories</DialogTitle>
          <DialogDescription>
            When telemetry is enabled, we collect the following anonymous events. No personal
            information, content, or identifiers are ever collected.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          {DATA_CATEGORIES.map((category) => (
            <div key={category.title}>
              <h4 className="mb-1.5 text-sm font-medium text-foreground">{category.title}</h4>
              <ul className="space-y-1 text-sm text-muted-foreground">
                {category.items.map((item, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-muted-foreground/50" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
