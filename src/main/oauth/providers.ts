export interface OAuthProviderConfig {
  clientId: string
  clientSecret?: string
  authUrl: string
  tokenUrl: string
  scopes: string[]
  redirectUri?: string
  provider?: string
  extraAuthParams?: Record<string, string>
  tokenExchangeMethod?: 'form' | 'query'
}

// Provider configs — client IDs should be set via environment or settings
// These are the standard OAuth endpoints
export const OAUTH_PROVIDERS: Record<string, OAuthProviderConfig> = {
  'google-calendar': {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scopes: ['https://www.googleapis.com/auth/calendar'],
    provider: 'google',
    extraAuthParams: { access_type: 'offline', prompt: 'consent' }
  },
  gmail: {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scopes: [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.modify',
      'https://www.googleapis.com/auth/gmail.send'
    ],
    provider: 'google',
    extraAuthParams: { access_type: 'offline', prompt: 'consent' }
  },
  'google-drive': {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scopes: [
      'https://www.googleapis.com/auth/drive',
      'https://www.googleapis.com/auth/drive.file'
    ],
    provider: 'google',
    extraAuthParams: { access_type: 'offline', prompt: 'consent' }
  },
  'outlook-calendar': {
    clientId: process.env.MICROSOFT_CLIENT_ID || '',
    clientSecret: process.env.MICROSOFT_CLIENT_SECRET || '',
    authUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    scopes: ['Calendars.ReadWrite', 'offline_access'],
    provider: 'microsoft'
  },
  'outlook-email': {
    clientId: process.env.MICROSOFT_CLIENT_ID || '',
    clientSecret: process.env.MICROSOFT_CLIENT_SECRET || '',
    authUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    scopes: ['Mail.ReadWrite', 'Mail.Send', 'offline_access'],
    provider: 'microsoft'
  },
  slack: {
    clientId: process.env.SLACK_CLIENT_ID || '',
    clientSecret: process.env.SLACK_CLIENT_SECRET || '',
    authUrl: 'https://slack.com/oauth/v2/authorize',
    tokenUrl: 'https://slack.com/api/oauth.v2.access',
    scopes: ['chat:write', 'channels:read', 'channels:history'],
    provider: 'slack'
  },
  clickup: {
    clientId: process.env.CLICKUP_CLIENT_ID || '',
    clientSecret: process.env.CLICKUP_CLIENT_SECRET || '',
    authUrl: 'https://app.clickup.com/api',
    tokenUrl: 'https://api.clickup.com/api/v2/oauth/token',
    scopes: [],
    provider: 'clickup',
    tokenExchangeMethod: 'query'
  },
  asana: {
    clientId: process.env.ASANA_CLIENT_ID || '',
    clientSecret: process.env.ASANA_CLIENT_SECRET || '',
    authUrl: 'https://app.asana.com/-/oauth_authorize',
    tokenUrl: 'https://app.asana.com/-/oauth_token',
    scopes: ['default'],
    provider: 'asana'
  }
}

// Tools that share Google OAuth
export const GOOGLE_TOOLS = ['google-calendar', 'gmail', 'google-drive']
// Tools that share Microsoft OAuth
export const MICROSOFT_TOOLS = ['outlook-calendar', 'outlook-email']

export interface RegisterProviderOptions {
  provider: string
  tool: string
  clientId: string
  clientSecret: string
  authorizationUrl: string
  tokenUrl: string
  scopes: string[]
  usePKCE?: boolean
  extraAuthParams?: Record<string, string>
  tokenExchangeMethod?: 'form' | 'query'
}

export function registerProvider(opts: RegisterProviderOptions): void {
  OAUTH_PROVIDERS[opts.tool] = {
    clientId: opts.clientId,
    clientSecret: opts.clientSecret,
    authUrl: opts.authorizationUrl,
    tokenUrl: opts.tokenUrl,
    scopes: opts.scopes,
    provider: opts.provider,
    extraAuthParams: opts.extraAuthParams,
    tokenExchangeMethod: opts.tokenExchangeMethod
  }
}
