import OAuthProvider, { OAuthHelpers } from '@cloudflare/workers-oauth-provider'
import { McpAgent } from 'agents/mcp'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { GoogleHandler } from './google-handler'
import { FlodeskAPI } from './flodesk-api'
import { Props } from './types'
import type { ExecutionContext } from '@cloudflare/workers-types'

// Environment variables defined in wrangler.toml and Cloudflare dashboard
interface Env {
  FLODESK_API_KEY: string
  GOOGLE_CLIENT_ID: string
  GOOGLE_CLIENT_SECRET: string
  HOSTED_DOMAIN?: string
  COOKIE_ENCRYPTION_KEY: string
  FLODESK_KV: KVNamespace
  OAUTH_KV: KVNamespace
  OAUTH_PROVIDER: OAuthHelpers
}

// Allowed users - add your Google email here
const ALLOWED_EMAILS = new Set(['chris@honeycombcreates.com'])

export class MyMCP extends McpAgent<Env, {}, Props> {
  server = new McpServer({
    name: 'Flodesk MCP Server (Google OAuth)',
    version: '1.0.0',
  })

  private flodeskAPI: FlodeskAPI | null = null

  async init() {
    // Initialize Flodesk API if available
    if (this.env.FLODESK_API_KEY) {
      this.flodeskAPI = new FlodeskAPI(this.env.FLODESK_API_KEY)
    }

    // Basic tool available to all authenticated users
    this.server.tool('add', { a: z.number(), b: z.number() }, async ({ a, b }) => ({
      content: [{ type: 'text', text: `${a} + ${b} = ${a + b}` }],
    }))

    // User info tool
    this.server.tool('user_info', {}, async () => {
      if (!this.props) {
        throw new Error('User not authenticated')
      }
      return {
        content: [
          {
            type: 'text',
            text: `User: ${this.props.name}\nEmail: ${this.props.email}`,
          },
        ],
      }
    })

    // Flodesk tools for authorized users only
    if (this.props && ALLOWED_EMAILS.has(this.props.email)) {
      this.server.tool('list_segments', {}, async () => {
        if (!this.flodeskAPI) {
          throw new Error('Flodesk API not configured')
        }

        const segments = await this.flodeskAPI.listSegments()
        return {
          content: [
            {
              type: 'text',
              text: `✅ **Flodesk Segments**\n\n${segments
                .map((s) => `• **${s.name}** (${s.subscriber_count} subscribers)\n  ID: ${s.id}\n  Color: ${s.color || 'default'}`)
                .join('\n\n')}`,
            },
          ],
        }
      })

      this.server.tool(
        'add_subscriber',
        {
          email: z.string().email(),
          first_name: z.string().optional(),
          last_name: z.string().optional(),
          segment_ids: z.array(z.string()).optional(),
        },
        async ({ email, first_name, last_name, segment_ids }) => {
          if (!this.flodeskAPI) {
            throw new Error('Flodesk API not configured')
          }

          const subscriber = await this.flodeskAPI.addSubscriber(email, first_name, last_name, segment_ids)

          return {
            content: [
              {
                type: 'text',
                text: `✅ **Subscriber Added Successfully!**\n\n📧 Email: ${subscriber.email}\n👤 Name: ${subscriber.first_name || ''} ${
                  subscriber.last_name || ''
                }\n📅 Created: ${subscriber.created_at}\n🏷️ Segments: ${subscriber.segments?.length || 0}`,
              },
            ],
          }
        },
      )

      this.server.tool(
        'get_subscriber',
        {
          email: z.string().email(),
        },
        async ({ email }) => {
          if (!this.flodeskAPI) {
            throw new Error('Flodesk API not configured')
          }

          const subscriber = await this.flodeskAPI.getSubscriber(email)
          return {
            content: [
              {
                type: 'text',
                text: `✅ **Subscriber Found**\n\n📧 Email: ${subscriber.email}\n👤 Name: ${subscriber.first_name || ''} ${
                  subscriber.last_name || ''
                }\n📊 Status: ${subscriber.status}\n📅 Created: ${subscriber.created_at}\n🏷️ Segments: ${
                  subscriber.segments?.map((s) => s.name).join(', ') || 'None'
                }`,
              },
            ],
          }
        },
      )
    }
  }
}

const provider = new OAuthProvider({
  apiRoute: '/sse',
  apiHandler: MyMCP.mount('/sse') as any,
  defaultHandler: GoogleHandler as any,
  authorizeEndpoint: '/authorize',
  tokenEndpoint: '/token',
  clientRegistrationEndpoint: '/register',
})

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)

    // The @cloudflare/workers-oauth-provider doesn't automatically handle the /callback
    // route, so we intercept it here and forward it to our GoogleHandler.
    if (url.pathname === '/callback') {
      return GoogleHandler.fetch(request, env, ctx)
    }

    // For all other routes, we let the OAuthProvider handle them as usual.
    return provider.fetch(request, env, ctx)
  },
}