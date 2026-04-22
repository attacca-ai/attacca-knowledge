/**
 * React hook for connecting to the Attacca agent runtime.
 * Replaces useGateway.ts for components using the new IPC-based runtime.
 */

import { useEffect } from 'react'
import { initAgentClient, destroyAgentClient } from '../lib/agent-client'

/**
 * Initialize the agent client IPC listeners on mount, cleanup on unmount.
 * Should be called once at the app root level (e.g., AppShell).
 */
export function useAgent(): void {
  useEffect(() => {
    initAgentClient()
    return () => {
      destroyAgentClient()
    }
  }, [])
}
