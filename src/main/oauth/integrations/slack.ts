import { registerProvider } from '../providers'

const SLACK_CLIENT_ID =
  process.env.SLACK_CLIENT_ID || 'REDACTED_SLACK_CLIENT_ID'
const SLACK_CLIENT_SECRET =
  process.env.SLACK_CLIENT_SECRET || 'REDACTED_SLACK_CLIENT_SECRET'

// Slack OAuth v2 uses user_scope (NOT scope) for user token flows.
// We pass scopes via extraAuthParams.user_scope and leave scopes empty
// so the standard OAuth flow doesn't set a bot 'scope' param.
registerProvider({
  provider: 'slack',
  tool: 'slack',
  clientId: SLACK_CLIENT_ID,
  clientSecret: SLACK_CLIENT_SECRET,
  authorizationUrl: 'https://slack.com/oauth/v2/authorize',
  tokenUrl: 'https://slack.com/api/oauth.v2.access',
  scopes: [],
  extraAuthParams: {
    user_scope: [
      'channels:read',
      'channels:history',
      'groups:read',
      'groups:history',
      'im:read',
      'im:history',
      'mpim:read',
      'mpim:history',
      'chat:write',
      'users:read',
      'users.profile:read',
      'users.profile:write',
      'reactions:read',
      'reactions:write',
      'search:read'
    ].join(',')
  }
})
