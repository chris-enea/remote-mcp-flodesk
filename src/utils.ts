import { Props } from "./types"

export type StackFrame = {
  file: string
  method: string
  line: number
  column: number
}

export function getUpstreamAuthorizeUrl(args: {
  upstreamUrl: string
  clientId: string
  redirectUri: string
  scope: string
  state: string
  hostedDomain?: string
}): string {
  const params = new URLSearchParams()
  params.set('response_type', 'code')
  params.set('client_id', args.clientId)
  params.set('redirect_uri', args.redirectUri)
  params.set('scope', args.scope)
  params.set('state', args.state)
  if (args.hostedDomain) {
    params.set('hd', args.hostedDomain)
  }
  return `${args.upstreamUrl}?${params.toString()}`
}

export async function fetchUpstreamAuthToken(args: {
  upstreamUrl: string
  clientId: string
  clientSecret: string
  code: string
  grantType: 'authorization_code' | 'refresh_token'
  redirectUri: string
}): Promise<[string, Response | null]> {
  const body = new URLSearchParams()
  body.set('client_id', args.clientId)
  body.set('client_secret', args.clientSecret)
  body.set('code', args.code)
  body.set('grant_type', args.grantType)
  body.set('redirect_uri', args.redirectUri)

  const response = await fetch(args.upstreamUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  })
  if (!response.ok) {
    return ['', response]
  }
  const tokenData = (await response.json()) as { access_token: string }
  return [tokenData.access_token, null]
}

// Ensure the Props type is exported if it's used across modules.
export type { Props }