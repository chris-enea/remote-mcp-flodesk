import type { AuthRequest, OAuthHelpers, ClientInfo } from '@cloudflare/workers-oauth-provider'
import { Hono, Context } from 'hono'
import { fetchUpstreamAuthToken, getUpstreamAuthorizeUrl } from './utils'
import { Props } from './types'
import { clientIdAlreadyApproved, parseRedirectApproval, renderApprovalDialog } from './workers-oauth-utils'

interface Env {
  GOOGLE_CLIENT_ID: string
  GOOGLE_CLIENT_SECRET: string
  HOSTED_DOMAIN?: string
  FLODESK_API_KEY: string
  COOKIE_ENCRYPTION_KEY: string
  OAUTH_PROVIDER: OAuthHelpers
}

const app = new Hono<{ Bindings: Env }>()

app.get('/authorize', async (c) => {
  console.log('GET /authorize: Received request')
  console.log('Query params:', c.req.query())
  
  const oauthReqInfo = await c.env.OAUTH_PROVIDER.parseAuthRequest(c.req.raw)
  const { clientId } = oauthReqInfo
  if (!clientId) {
    return c.text('Invalid request', 400)
  }

  if (await clientIdAlreadyApproved(c.req.raw, oauthReqInfo.clientId, c.env.COOKIE_ENCRYPTION_KEY)) {
    return redirectToGoogle(c, oauthReqInfo)
  }

  return renderApprovalDialog(
    c.req.raw,
    {
      client: await c.env.OAUTH_PROVIDER.lookupClient(clientId),
      server: {
        name: 'Google OAuth Demo',
        description: 'This MCP Server is a demo for Google OAuth.',
      },
      state: { oauthReqInfo },
    },
  )
})

app.post('/authorize', async (c) => {
  console.log('POST /authorize: Received request')
  try {
    const { state, headers } = await parseRedirectApproval(c.req.raw, c.env.COOKIE_ENCRYPTION_KEY)
    const { oauthReqInfo } = state
    if (!oauthReqInfo) {
      return c.text('Invalid request: Missing oauthReqInfo in state', 400)
    }

    return redirectToGoogle(c, oauthReqInfo, headers)
  } catch (error) {
    console.error('Error in POST /authorize:', error)
    return c.text(`Internal Server Error: ${error instanceof Error ? error.message : String(error)}`, 500)
  }
})

async function redirectToGoogle(c: Context<{ Bindings: Env }>, oauthReqInfo: AuthRequest, headers: Record<string, string> = {}) {
  return new Response(null, {
    status: 302,
    headers: {
      ...headers,
      location: getUpstreamAuthorizeUrl({
        upstreamUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
        scope: 'openid email profile',
        clientId: c.env.GOOGLE_CLIENT_ID,
        redirectUri: new URL('/callback', c.req.raw.url).href,
        state: btoa(JSON.stringify(oauthReqInfo)),
        // hostedDomain: c.env.HOSTED_DOMAIN,
      }),
    },
  })
}

/**
 * OAuth Callback Endpoint
 *
 * This route handles the callback from Google after user authentication.
 * It exchanges the temporary code for an access token, then stores some
 * user metadata & the auth token as part of the 'props' on the token passed
 * down to the client. It ends by redirecting the client back to _its_ callback URL
 */
app.get('/callback', async (c) => {
  console.log('GET /callback: Received request')
  console.log('Query params:', c.req.query())

  // Get the oathReqInfo out of state
  const oauthReqInfo = JSON.parse(atob(c.req.query('state') as string)) as AuthRequest
  if (!oauthReqInfo.clientId) {
    console.error('Callback Error: Invalid state, clientId missing.')
    return c.text('Invalid state', 400)
  }

  // Exchange the code for an access token
  const code = c.req.query('code')
  if (!code) {
    console.error('Callback Error: Missing code in query params.')
    return c.text('Missing code', 400)
  }

  const [accessToken, googleErrResponse] = await fetchUpstreamAuthToken({
    upstreamUrl: 'https://oauth2.googleapis.com/token',
    clientId: c.env.GOOGLE_CLIENT_ID,
    clientSecret: c.env.GOOGLE_CLIENT_SECRET,
    code,
    redirectUri: new URL('/callback', c.req.url).href,
    grantType: 'authorization_code',
  })
  if (googleErrResponse) {
    const errorResponseForLogging = googleErrResponse.clone()
    console.error(
      `Callback Error: Upstream token exchange failed. Status: ${errorResponseForLogging.status} ${errorResponseForLogging.statusText}`,
      await errorResponseForLogging.text(),
    )
    return googleErrResponse
  }

  // Fetch the user info from Google
  const userResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  })
  if (!userResponse.ok) {
    const errorResponseForLogging = userResponse.clone()
    console.error(
      `Callback Error: Failed to fetch user info. Status: ${errorResponseForLogging.status} ${errorResponseForLogging.statusText}`,
      await errorResponseForLogging.text(),
    )
    return c.text(`Failed to fetch user info`, 500)
  }

  const { id, name, email } = (await userResponse.json()) as {
    id: string
    name: string
    email: string
  }

  // Use the scope returned by Google, as it's the source of truth for what was granted.
  const grantedScopes = c.req.query('scope')?.split(' ') ?? ['openid', 'email', 'profile']

  // Return back to the MCP client a new token
  const { redirectTo } = await c.env.OAUTH_PROVIDER.completeAuthorization({
    request: oauthReqInfo,
    userId: id,
    metadata: {
      label: name,
    },
    scope: grantedScopes,
    props: {
      id,
      name,
      email,
      accessToken,
    } as Props,
  })

  console.log(`Callback Success: Completing authorization and redirecting to: ${redirectTo}`)
  return Response.redirect(redirectTo)
})

export { app as GoogleHandler }