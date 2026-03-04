export const GATEWAY_WS_URL = 'ws://127.0.0.1:18789'
export const GATEWAY_PORT = 18789

export const APP_NAME = 'Attacca'
export const APP_DESCRIPTION = 'AI Productivity Assistant'

export const GUMROAD_PRODUCT_ID = 'attacca'

export const LLM_PROVIDERS = {
  anthropic: {
    name: 'Anthropic Claude',
    models: ['claude-sonnet-4-5-20250514'],
    defaultModel: 'claude-sonnet-4-5-20250514',
    apiKeyUrl: 'https://console.anthropic.com/settings/keys'
  },
  openai: {
    name: 'OpenAI',
    models: ['gpt-4o'],
    defaultModel: 'gpt-4o',
    apiKeyUrl: 'https://platform.openai.com/api-keys'
  },
  google: {
    name: 'Google Gemini',
    models: ['gemini-2.0-flash'],
    defaultModel: 'gemini-2.0-flash',
    apiKeyUrl: 'https://aistudio.google.com/apikey'
  }
} as const

export type LLMProviderKey = keyof typeof LLM_PROVIDERS

export const TOOL_CATEGORIES = {
  calendar: { name: 'Calendar', tools: ['google-calendar', 'outlook-calendar'] },
  email: { name: 'Email', tools: ['gmail', 'outlook-email'] },
  pm: { name: 'Project Management', tools: ['clickup', 'asana', 'trello', 'notion', 'activecollab'] },
  storage: { name: 'File Storage', tools: ['google-drive', 'onedrive', 'dropbox'] },
  communication: { name: 'Communication', tools: ['slack', 'teams', 'telegram'] }
} as const
