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

  // Events (main → renderer)
  EVENT_GATEWAY_STATE_CHANGED: 'event:gateway-state-changed',
  EVENT_LICENSE_STATE_CHANGED: 'event:license-state-changed',
  EVENT_OAUTH_CALLBACK: 'event:oauth-callback'
} as const

export type IPCChannel = (typeof IPC)[keyof typeof IPC]
