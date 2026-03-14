export const IPC = {
  // License
  LICENSE_VALIDATE: 'license:validate',
  LICENSE_CHECK_EXISTING: 'license:check-existing',
  LICENSE_GET_STATUS: 'license:get-status',

  // Gateway
  GATEWAY_START: 'gateway:start',
  GATEWAY_STOP: 'gateway:stop',
  GATEWAY_RESTART: 'gateway:restart',
  GATEWAY_STATUS: 'gateway:status',
  GATEWAY_HEALTH: 'gateway:health',
  GATEWAY_GET_TOKEN: 'gateway:get-token',

  // Onboarding
  ONBOARDING_GET_STATE: 'onboarding:get-state',
  ONBOARDING_SAVE_STATE: 'onboarding:save-state',
  ONBOARDING_COMPLETE: 'onboarding:complete',

  // OAuth
  OAUTH_START: 'oauth:start',
  OAUTH_STATUS: 'oauth:status',
  OAUTH_DISCONNECT: 'oauth:disconnect',
  OAUTH_GET_CONNECTED: 'oauth:get-connected',

  // LLM Provider
  LLM_TEST_CONNECTION: 'llm:test-connection',
  LLM_SAVE_CONFIG: 'llm:save-config',
  LLM_GET_CONFIG: 'llm:get-config',

  // App
  APP_QUIT: 'app:quit',
  APP_MINIMIZE_TO_TRAY: 'app:minimize-to-tray',
  APP_SHOW_WINDOW: 'app:show-window',
  APP_GET_VERSION: 'app:get-version',
  APP_OPEN_EXTERNAL: 'app:open-external',

  // Settings
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',

  // File system
  FS_READ_FILE: 'fs:read-file',
  FS_WRITE_FILE: 'fs:write-file',
  FS_SELECT_FOLDER: 'fs:select-folder',

  // Relay
  RELAY_OAUTH_INITIATE: 'relay:oauth-initiate',
  RELAY_OAUTH_STATUS: 'relay:oauth-status',
  RELAY_OAUTH_DISCONNECT: 'relay:oauth-disconnect',
  RELAY_GET_USAGE: 'relay:get-usage',
  RELAY_GET_CONNECTED: 'relay:get-connected',
  RELAY_CALL_TOOL: 'relay:call-tool',
  RELAY_LLM_COMPLETION: 'relay:llm-completion',
  RELAY_LIST_APPS: 'relay:list-apps',
  RELAY_EXTRACT_URL: 'relay:extract-url',

  // Agent state persistence
  AGENT_GET_STATE: 'agent:get-state',
  AGENT_SET_STATE: 'agent:set-state',

  // Telemetry
  TELEMETRY_SET_OPT_IN: 'telemetry:set-opt-in',
  TELEMETRY_GET_OPT_IN: 'telemetry:get-opt-in',
  TELEMETRY_DELETE_DATA: 'telemetry:delete-data',
  TELEMETRY_EMIT: 'telemetry:emit',

  // Knowledge Base
  KB_SAVE_CAPTURE: 'kb:save-capture',
  KB_READ_CONTEXT: 'kb:read-context',
  KB_APPEND_DAILY_LOG: 'kb:append-daily-log',

  // Events (main → renderer)
  EVENT_GATEWAY_STATE_CHANGED: 'event:gateway-state-changed',
  EVENT_LICENSE_STATE_CHANGED: 'event:license-state-changed',
  EVENT_OAUTH_CALLBACK: 'event:oauth-callback'
} as const

export type IPCChannel = (typeof IPC)[keyof typeof IPC]
