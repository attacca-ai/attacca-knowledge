import { useEffect } from 'react'
import { gatewayClient } from '@/lib/gateway-client'
import { useGatewayStore } from '@/stores/gateway-store'

export function useGateway(): void {
  const setConnectionState = useGatewayStore((s) => s.setConnectionState)
  const setProcessState = useGatewayStore((s) => s.setProcessState)

  useEffect(() => {
    // Listen for WebSocket connection state changes
    const unsub = gatewayClient.onStateChange((state) => {
      setConnectionState(state)
    })

    // Listen for process state changes from main process
    const unsubProcess = window.api.gateway.onStateChanged((state) => {
      setProcessState(state)
      // Auto-connect when gateway is running
      if (state.state === 'running' && gatewayClient.getState() === 'disconnected') {
        gatewayClient.connect()
      }
    })

    // Initial connection attempt
    window.api.gateway.status().then((status) => {
      setProcessState(status)
      if (status.state === 'running') {
        gatewayClient.connect()
      }
    })

    return () => {
      unsub()
      unsubProcess()
      gatewayClient.disconnect()
    }
  }, [setConnectionState, setProcessState])
}
