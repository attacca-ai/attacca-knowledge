import { vi } from 'vitest'

// ─── Mock window.api ────────────────────────────────────────────────────────

export function installMockApi(): void {
  const api = {
    license: {
      validate: vi.fn().mockResolvedValue({ success: true, plan: 'monthly' }),
      checkExisting: vi.fn().mockResolvedValue({ exists: false, valid: false }),
      getStatus: vi.fn().mockResolvedValue({ status: 'unchecked' })
    },
    gateway: {
      start: vi.fn().mockResolvedValue({ success: true }),
      stop: vi.fn().mockResolvedValue({ success: true }),
      restart: vi.fn().mockResolvedValue({ success: true }),
      status: vi.fn().mockResolvedValue({
        state: 'stopped',
        pid: null,
        restartCount: 0,
        lastError: null,
        startedAt: null
      }),
      health: vi.fn().mockResolvedValue({
        ok: true,
        latency: 10,
        error: null,
        checkedAt: Date.now()
      }),
      onStateChanged: vi.fn().mockReturnValue(vi.fn())
    },
    onboarding: {
      getState: vi.fn().mockResolvedValue(null),
      saveState: vi.fn().mockResolvedValue(undefined),
      complete: vi.fn().mockResolvedValue(undefined)
    },
    oauth: {
      start: vi.fn().mockResolvedValue({ success: true }),
      getStatus: vi.fn().mockResolvedValue({ connected: false }),
      disconnect: vi.fn().mockResolvedValue({ success: true }),
      getConnected: vi.fn().mockResolvedValue([]),
      onCallback: vi.fn().mockReturnValue(vi.fn())
    },
    llm: {
      testConnection: vi.fn().mockResolvedValue({ success: true }),
      saveConfig: vi.fn().mockResolvedValue({ success: true })
    },
    app: {
      quit: vi.fn().mockResolvedValue(undefined),
      minimizeToTray: vi.fn().mockResolvedValue(undefined),
      showWindow: vi.fn().mockResolvedValue(undefined),
      getVersion: vi.fn().mockResolvedValue('1.0.0'),
      openExternal: vi.fn().mockResolvedValue(undefined)
    },
    settings: {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined)
    },
    fs: {
      selectFolder: vi.fn().mockResolvedValue(null)
    },
    activecollab: {
      connectCloud: vi.fn().mockResolvedValue({ success: true }),
      connectSelfHosted: vi.fn().mockResolvedValue({ success: true }),
      status: vi.fn().mockResolvedValue({ connected: false, config: null }),
      disconnect: vi.fn().mockResolvedValue({ success: true })
    }
  }

  Object.defineProperty(window, 'api', {
    value: api,
    writable: true,
    configurable: true
  })
}

export function cleanupMockApi(): void {
  // @ts-expect-error Cleaning up test mock
  delete window.api
}

// ─── MockWebSocket ──────────────────────────────────────────────────────────

export class MockWebSocket {
  static instances: MockWebSocket[] = []

  url: string
  readyState: number = 0 // CONNECTING
  onopen: ((ev: Event) => void) | null = null
  onclose: ((ev: CloseEvent) => void) | null = null
  onmessage: ((ev: MessageEvent) => void) | null = null
  onerror: ((ev: Event) => void) | null = null

  sent: string[] = []

  constructor(url: string) {
    this.url = url
    MockWebSocket.instances.push(this)
  }

  send(data: string): void {
    this.sent.push(data)
  }

  close(): void {
    this.readyState = 3 // CLOSED
    if (this.onclose) {
      this.onclose(new CloseEvent('close'))
    }
  }

  simulateOpen(): void {
    this.readyState = 1 // OPEN
    if (this.onopen) {
      this.onopen(new Event('open'))
    }
  }

  simulateClose(): void {
    this.readyState = 3 // CLOSED
    if (this.onclose) {
      this.onclose(new CloseEvent('close'))
    }
  }

  simulateMessage(data: string): void {
    if (this.onmessage) {
      this.onmessage(new MessageEvent('message', { data }))
    }
  }

  simulateError(): void {
    if (this.onerror) {
      this.onerror(new Event('error'))
    }
  }

  static reset(): void {
    MockWebSocket.instances = []
  }
}

// ─── Notification API mock ──────────────────────────────────────────────────

export function createMockNotification(): typeof Notification {
  const MockNotif = vi.fn() as unknown as typeof Notification
  Object.defineProperty(MockNotif, 'permission', {
    value: 'granted',
    writable: true,
    configurable: true
  })
  MockNotif.requestPermission = vi.fn().mockResolvedValue('granted')
  return MockNotif
}
