import { MCPServer } from './mcp-server';
import { GitHubOAuthHandler } from './github-handler';
import { FlodeskAPI } from './flodesk-api';

export interface Env {
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  FLODESK_API_KEY: string;
  SESSIONS: DurableObjectNamespace;
  FLODESK_KV: KVNamespace;
}

export class SessionStorage {
  private state: DurableObjectState;
  private env: Env;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    
    if (request.method === 'PUT') {
      const sessionData = await request.json();
      await this.state.storage.put('session', sessionData);
      return new Response('OK');
    }
    
    if (request.method === 'GET') {
      const session = await this.state.storage.get('session');
      return new Response(JSON.stringify(session || {}), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    if (request.method === 'DELETE') {
      await this.state.storage.delete('session');
      return new Response('OK');
    }
    
    return new Response('Method not allowed', { status: 405 });
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    try {
      // OAuth discovery endpoint
      if (url.pathname === '/.well-known/oauth-authorization-server') {
        return new Response(JSON.stringify({
          issuer: url.origin,
          authorization_endpoint: `${url.origin}/authorize`,
          token_endpoint: `${url.origin}/token`,
          registration_endpoint: `${url.origin}/register`,
          response_types_supported: ["code"],
          grant_types_supported: ["authorization_code"],
          code_challenge_methods_supported: ["S256"]
        }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }

      // OAuth protected resource metadata endpoint (MCP 2025-DRAFT-v2)
      if (url.pathname === '/.well-known/oauth-protected-resource') {
        return new Response(JSON.stringify({
          resource: url.origin,
          authorization_servers: [url.origin],
          scopes_supported: ["flodesk:read", "flodesk:write"],
          bearer_methods_supported: ["header"],
          resource_documentation: `${url.origin}`,
          resource_registration_endpoint: `${url.origin}/register`
        }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }

      // OAuth endpoints
      if (url.pathname === '/authorize' || url.pathname === '/callback' || url.pathname === '/token' || url.pathname === '/register' || url.pathname === '/auth' || url.pathname === '/validate-token') {
        console.log(`=== ROUTING TO OAUTH HANDLER ===`);
        console.log(`Path: ${url.pathname}, Method: ${request.method}`);
        const oauthHandler = new GitHubOAuthHandler(env);
        const response = await oauthHandler.handleRequest(request);
        
        // Only add CORS headers if they don't already exist (avoid immutable headers error)
        Object.entries(corsHeaders).forEach(([key, value]) => {
          if (!response.headers.has(key)) {
            response.headers.set(key, value);
          }
        });
        
        return response;
      }

      // MCP Server endpoint (both SSE and HTTP)
      if (url.pathname === '/sse' || url.pathname === '/mcp') {
        console.log('=== Environment Check ===');
        console.log('FLODESK_API_KEY exists:', !!env.FLODESK_API_KEY);
        console.log('FLODESK_API_KEY length:', env.FLODESK_API_KEY ? env.FLODESK_API_KEY.length : 0);
        console.log('FLODESK_API_KEY prefix:', env.FLODESK_API_KEY ? env.FLODESK_API_KEY.substring(0, 20) + '...' : 'undefined');
        
        const flodeskAPI = new FlodeskAPI(env.FLODESK_API_KEY);
        const mcpServer = new MCPServer(flodeskAPI, env);
        const response = await mcpServer.handleRequest(request);
        
        // Add CORS headers to MCP responses
        Object.entries(corsHeaders).forEach(([key, value]) => {
          if (!response.headers.has(key)) {
            response.headers.set(key, value);
          }
        });
        
        return response;
      }

      // Health check
      if (url.pathname === '/health') {
        return new Response(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      // Default response with server info
      return new Response(
        JSON.stringify({
          name: 'Flodesk Remote MCP Server',
          version: '1.0.0',
          endpoints: {
            mcp: '/sse',
            auth: '/authorize',
            callback: '/callback',
            token: '/token',
            health: '/health'
          }
        }),
        {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        }
      );
    } catch (error) {
      console.error('Request error:', error);
      return new Response(
        JSON.stringify({ 
          error: 'Internal Server Error',
          message: error instanceof Error ? error.message : 'Unknown error'
        }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        }
      );
    }
  },
};