// Telemetry event type definitions.
// Only events actually emitted by the app are listed here. Permission/Composio/
// workflow/parity events from the v0.2 productivity-OS era were stripped in
// the Phase 0 Life OS pivot.

export interface TelemetryEvent {
  eventType: string
  payload: Record<string, unknown>
  timestamp: string // ISO 8601
  anonymousId: string
}

export interface BaseEvent {
  eventType: string
  payload: Record<string, unknown>
}

// ── Trust events ──

export interface TrustProfileChanged extends BaseEvent {
  eventType: 'trust.profile_changed'
  payload: {
    from: string
    to: string
  }
}

export interface TrustKillSwitchActivated extends BaseEvent {
  eventType: 'trust.kill_switch.activated'
  payload: Record<string, never>
}

export interface TrustKillSwitchResumed extends BaseEvent {
  eventType: 'trust.kill_switch.resumed'
  payload: {
    pauseDurationMs: number
  }
}

// ── Agent events ──

export interface AgentTaskCompleted extends BaseEvent {
  eventType: 'agent.task.completed'
  payload: {
    durationMs: number
    hadFallback: boolean
  }
}

export interface AgentTaskFailed extends BaseEvent {
  eventType: 'agent.task.failed'
  payload: {
    durationMs: number
    errorCategory: string
  }
}

export interface AgentTaskFallbackCreated extends BaseEvent {
  eventType: 'agent.task.fallback_created'
  payload: {
    originalTaskType: string
  }
}

export interface AgentChatSent extends BaseEvent {
  eventType: 'agent.chat.sent'
  payload: {
    source: string
  }
}

// ── App lifecycle events ──

export interface AppSessionStarted extends BaseEvent {
  eventType: 'app.session_started'
  payload: {
    platform: string
    appVersion: string
    isPackaged: boolean
  }
}

// ── Onboarding events ──

export interface OnboardingCompleted extends BaseEvent {
  eventType: 'onboarding.completed'
  payload: {
    llmProvider: string
    connectedTools: number
    telemetryOptIn: boolean
  }
}

export interface OnboardingStepCompleted extends BaseEvent {
  eventType: 'onboarding.step_completed'
  payload: {
    step: number
    stepName: string
  }
}

// ── Feature usage events ──

export interface FeatureViewed extends BaseEvent {
  eventType: 'feature.viewed'
  payload: {
    view: string
    previousView: string
  }
}

// ── Capture events ──

export interface CaptureStarted extends BaseEvent {
  eventType: 'capture.started'
  payload: {
    sourceType: string
  }
}

export interface CaptureSaved extends BaseEvent {
  eventType: 'capture.saved'
  payload: {
    sourceType: string
    hasActionItems: boolean
    actionItemCount: number
  }
}

export interface CaptureDiscarded extends BaseEvent {
  eventType: 'capture.discarded'
  payload: {
    sourceType: string
  }
}

// Union of all telemetry event types
export type TelemetryEventType =
  | AppSessionStarted
  | OnboardingCompleted
  | OnboardingStepCompleted
  | FeatureViewed
  | CaptureStarted
  | CaptureSaved
  | CaptureDiscarded
  | AgentChatSent
  | TrustProfileChanged
  | TrustKillSwitchActivated
  | TrustKillSwitchResumed
  | AgentTaskCompleted
  | AgentTaskFailed
  | AgentTaskFallbackCreated
