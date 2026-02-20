import { useEffect } from 'react'
import { gatewayClient } from '@/lib/gateway-client'
import { useAgentStore } from '@/stores/agent-store'
import { useGatewayStore } from '@/stores/gateway-store'
import { MorningBriefing } from './MorningBriefing'
import { NotificationBox } from './NotificationBox'
import { ActivityFeed } from './ActivityFeed'
import { TaskQueue } from './TaskQueue'
import { EmergencyStop } from './EmergencyStop'
import { ApprovalDialog } from '@/components/permissions/ApprovalDialog'
import type { JsonRpcEvent } from '@/types/gateway'

export function Dashboard(): React.JSX.Element {
  const connectionState = useGatewayStore((s) => s.connectionState)
  const addActivity = useAgentStore((s) => s.addActivity)

  // Subscribe to gateway events
  useEffect(() => {
    if (connectionState !== 'connected') return

    const handler = (event: JsonRpcEvent): void => {
      const data = event.params ?? {}

      switch (event.method) {
        case 'agent.turn.start':
          addActivity({ type: 'info', description: 'Agent started processing...' })
          break
        case 'agent.tool.call':
          addActivity({
            type: 'tool_call',
            description: `Calling tool: ${data.tool as string || 'unknown'}`,
            details: JSON.stringify(data.params, null, 2)
          })
          break
        case 'agent.tool.result':
          addActivity({
            type: 'tool_result',
            description: `Tool result received`,
            details: typeof data.result === 'string' ? data.result : JSON.stringify(data.result)
          })
          break
        case 'agent.message':
          addActivity({
            type: 'message',
            description: (data.content as string) || 'Agent message'
          })
          break
        case 'agent.turn.end':
          addActivity({ type: 'info', description: 'Agent finished processing' })
          break
        case 'agent.error':
          addActivity({
            type: 'error',
            description: (data.message as string) || 'An error occurred'
          })
          break
      }
    }

    gatewayClient.on('*', handler)
    return () => gatewayClient.off('*', handler)
  }, [connectionState, addActivity])

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* 4-quadrant grid */}
      <div className="grid flex-1 grid-cols-2 grid-rows-2 gap-px overflow-hidden bg-border">
        {/* Top-left: Morning Briefing */}
        <div className="overflow-auto bg-background p-4">
          <MorningBriefing />
        </div>

        {/* Top-right: Notification Box */}
        <div className="overflow-auto bg-background p-4">
          <NotificationBox />
        </div>

        {/* Bottom-left: Activity Feed */}
        <div className="overflow-auto bg-background p-4">
          <ActivityFeed />
        </div>

        {/* Bottom-right: Task Queue */}
        <div className="overflow-auto bg-background p-4">
          <TaskQueue />
        </div>
      </div>

      {/* Emergency Stop — always visible */}
      <EmergencyStop />

      {/* Approval dialog for pending HIGH-risk actions */}
      <ApprovalDialog />
    </div>
  )
}
