export interface OAuthProviderConfig {
  clientId: string
  authUrl: string
  tokenUrl: string
  scopes: string[]
  redirectUri?: string
}

// Provider configs — client IDs should be set via environment or settings
// These are the standard OAuth endpoints
export const OAUTH_PROVIDERS: Record<string, OAuthProviderConfig> = {
  'google-calendar': {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scopes: ['https://www.googleapis.com/auth/calendar']
  },
  gmail: {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scopes: ['https://www.googleapis.com/auth/gmail.modify']
  },
  'google-drive': {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scopes: ['https://www.googleapis.com/auth/drive']
  },
  'outlook-calendar': {
    clientId: process.env.MICROSOFT_CLIENT_ID || '',
    authUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    scopes: ['Calendars.ReadWrite', 'offline_access']
  },
  'outlook-email': {
    clientId: process.env.MICROSOFT_CLIENT_ID || '',
    authUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    scopes: ['Mail.ReadWrite', 'Mail.Send', 'offline_access']
  },
  slack: {
    clientId: process.env.SLACK_CLIENT_ID || '',
    authUrl: 'https://slack.com/oauth/v2/authorize',
    tokenUrl: 'https://slack.com/api/oauth.v2.access',
    scopes: ['chat:write', 'channels:read', 'channels:history']
  },
  clickup: {
    clientId: process.env.CLICKUP_CLIENT_ID || '',
    authUrl: 'https://app.clickup.com/api',
    tokenUrl: 'https://api.clickup.com/api/v2/oauth/token',
    scopes: []
  },
  asana: {
    clientId: process.env.ASANA_CLIENT_ID || '',
    authUrl: 'https://app.asana.com/-/oauth_authorize',
    tokenUrl: 'https://app.asana.com/-/oauth_token',
    scopes: ['default']
  }
}

// Tools that share Google OAuth
export const GOOGLE_TOOLS = ['google-calendar', 'gmail', 'google-drive']
// Tools that share Microsoft OAuth
export const MICROSOFT_TOOLS = ['outlook-calendar', 'outlook-email']
