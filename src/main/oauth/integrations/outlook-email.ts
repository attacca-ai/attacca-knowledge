import { registerProvider } from '../providers'

const MS_CLIENT_ID = process.env.MICROSOFT_CLIENT_ID || ''
const MS_CLIENT_SECRET = process.env.MICROSOFT_CLIENT_SECRET || ''

if (!MS_CLIENT_ID) {
  console.warn('[Outlook Email] MICROSOFT_CLIENT_ID not set — integration disabled')
}

registerProvider({
  provider: 'microsoft',
  tool: 'outlook-email',
  clientId: MS_CLIENT_ID,
  clientSecret: MS_CLIENT_SECRET,
  authorizationUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
  tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
  scopes: ['User.Read', 'Mail.ReadWrite', 'Mail.Send', 'offline_access'],
  extraAuthParams: {}
})
