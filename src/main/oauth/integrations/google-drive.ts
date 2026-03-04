import { registerProvider } from '../providers'

const GOOGLE_CLIENT_ID =
  process.env.GOOGLE_CLIENT_ID || 'REDACTED_GOOGLE_CLIENT_ID'
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || 'REDACTED_GOOGLE_CLIENT_SECRET'

registerProvider({
  provider: 'google',
  tool: 'google-drive',
  clientId: GOOGLE_CLIENT_ID,
  clientSecret: GOOGLE_CLIENT_SECRET,
  authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenUrl: 'https://oauth2.googleapis.com/token',
  scopes: [
    'https://www.googleapis.com/auth/drive',
    'https://www.googleapis.com/auth/drive.file'
  ],
  extraAuthParams: { access_type: 'offline', prompt: 'consent' }
})
