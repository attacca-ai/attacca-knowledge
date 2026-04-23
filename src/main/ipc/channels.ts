export const IPC = {
  // Onboarding
  ONBOARDING_GET_STATE: 'onboarding:get-state',
  ONBOARDING_SAVE_STATE: 'onboarding:save-state',
  ONBOARDING_COMPLETE: 'onboarding:complete',

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

  // Direct integrations
  CLICKUP_CONNECT: 'clickup:connect',
  CLICKUP_DISCONNECT: 'clickup:disconnect',
  CLICKUP_STATUS: 'clickup:status',
  CLICKUP_CALL_ACTION: 'clickup:call-action',

  // Relay (remaining — moved to local in Phase 3)
  RELAY_GET_USAGE: 'relay:get-usage',
  RELAY_LLM_COMPLETION: 'relay:llm-completion',
  RELAY_EXTRACT_URL: 'relay:extract-url',

  // Agent state persistence
  AGENT_GET_STATE: 'agent:get-state',
  AGENT_SET_STATE: 'agent:set-state',

  // Telemetry
  TELEMETRY_SET_OPT_IN: 'telemetry:set-opt-in',
  TELEMETRY_GET_OPT_IN: 'telemetry:get-opt-in',
  TELEMETRY_DELETE_DATA: 'telemetry:delete-data',
  TELEMETRY_EMIT: 'telemetry:emit',
  TELEMETRY_GET_QUEUE: 'telemetry:get-queue',
  TELEMETRY_GET_STATUS: 'telemetry:get-status',

  // Knowledge Base (legacy alias — routes through vault manager)
  KB_SAVE_CAPTURE: 'kb:save-capture',
  KB_READ_CONTEXT: 'kb:read-context',
  KB_APPEND_DAILY_LOG: 'kb:append-daily-log',
  KB_GET_PATH: 'kb:get-path',
  KB_OPEN_FOLDER: 'kb:open-folder',
  KB_IMPORT_FILES: 'kb:import-files',

  // Vault (Life OS v0.3)
  VAULT_GET_MODE: 'vault:get-mode',
  VAULT_SET_MODE: 'vault:set-mode',
  VAULT_SCAN_FOLDERS: 'vault:scan-folders',
  VAULT_LIST_TREE: 'vault:list-tree',
  VAULT_READ_NOTE: 'vault:read-note',
  VAULT_WRITE_NOTE: 'vault:write-note',
  VAULT_DELETE_NOTE: 'vault:delete-note',
  VAULT_GET_PATH: 'vault:get-path',
  VAULT_OPEN_FOLDER: 'vault:open-folder',

  // Areas (Life OS v0.3 Phase 1)
  AREA_LIST: 'area:list',
  AREA_CREATE: 'area:create',
  AREA_UPDATE: 'area:update',
  AREA_ARCHIVE: 'area:archive',
  AREA_GET_HEALTH: 'area:get-health',

  // Memory
  MEMORY_SEARCH: 'memory:search',
  MEMORY_SAVE: 'memory:save',
  MEMORY_GET_STATS: 'memory:get-stats',
  MEMORY_GET_IDENTITY: 'memory:get-identity',

  // Scheduler
  SCHEDULER_GET_TASKS: 'scheduler:get-tasks',
  SCHEDULER_SET_ENABLED: 'scheduler:set-enabled',
  SCHEDULER_RUN_NOW: 'scheduler:run-now',

  // Agent Runtime (new — replaces gateway for chat)
  AGENT_CHAT_SEND: 'agent:chat:send',
  AGENT_CHAT_STOP: 'agent:chat:stop',
  AGENT_SESSION_LIST: 'agent:session:list',
  AGENT_SESSION_CLEAR: 'agent:session:clear',

  // Events (main → renderer)
  EVENT_AGENT_STREAM: 'event:agent:stream',
  EVENT_AGENT_TOOL_CALL: 'event:agent:tool-call',
  EVENT_AGENT_TOOL_RESULT: 'event:agent:tool-result',
  EVENT_AGENT_FINAL: 'event:agent:final',
  EVENT_AGENT_ERROR: 'event:agent:error',
  EVENT_VAULT_CHANGED: 'event:vault:changed'
} as const

export type IPCChannel = (typeof IPC)[keyof typeof IPC]
