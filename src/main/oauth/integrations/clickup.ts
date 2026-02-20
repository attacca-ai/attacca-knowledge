import { registerProvider } from '../providers'

const CLICKUP_CLIENT_ID = process.env.CLICKUP_CLIENT_ID || ''
const CLICKUP_CLIENT_SECRET = process.env.CLICKUP_CLIENT_SECRET || ''

if (!CLICKUP_CLIENT_ID) {
  console.warn('[ClickUp] CLICKUP_CLIENT_ID not set — integration disabled')
}

registerProvider({
  provider: 'clickup',
  tool: 'clickup',
  clientId: CLICKUP_CLIENT_ID,
  clientSecret: CLICKUP_CLIENT_SECRET,
  authorizationUrl: 'https://app.clickup.com/api',
  tokenUrl: 'https://api.clickup.com/api/v2/oauth/token',
  scopes: [],
  extraAuthParams: {},
  tokenExchangeMethod: 'query'
})
