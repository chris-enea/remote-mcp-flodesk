import { Hono } from 'hono';
import { Octokit } from 'octokit';
import { z } from 'zod';
import { MCPServer } from './mcp-server';
import { FlodeskAPI } from './flodesk-api';
import { GitHubHandler, GitHubUserProps } from './github-handler-official';

export interface Env {
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  FLODESK_API_KEY: string;
  SESSIONS: DurableObjectNamespace;
  FLODESK_KV: KVNamespace;
}

// Allowed users - add your GitHub username here
const ALLOWED_USERNAMES = new Set(['your-github-username']);

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
    const app = new Hono();

    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 200,
        headers: corsHeaders
      });
    }

    try {
      // OAuth discovery endpoints
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

      // OAuth endpoints - delegate to GitHub handler
      if (url.pathname.startsWith('/authorize') || 
          url.pathname.startsWith('/callback') || 
          url.pathname.startsWith('/token') || 
          url.pathname.startsWith('/register')) {
        const githubHandler = new GitHubHandler();
        const response = await githubHandler.fetch(request, env);
        
        // Add CORS headers
        Object.entries(corsHeaders).forEach(([key, value]) => {
          if (!response.headers.has(key)) {
            response.headers.set(key, value);
          }
        });
        
        return response;
      }

      // MCP Server endpoint
      if (url.pathname === '/sse' || url.pathname === '/mcp') {
        // Check authentication
        let userProps: GitHubUserProps | null = null;
        const authHeader = request.headers.get('Authorization');
        
        if (authHeader && authHeader.startsWith('Bearer ')) {
          const token = authHeader.substring(7);
          const githubHandler = new GitHubHandler();
          userProps = await githubHandler.verifyToken(token, env);
        }

        // For GET requests (SSE), redirect to OAuth if not authenticated
        if (request.method === 'GET' && !userProps) {
          return new Response(null, {
            status: 302,
            headers: {
              'Location': `${url.origin}/authorize?client_id=mcp-client&redirect_uri=${encodeURIComponent(`${url.origin}/callback`)}&response_type=code&scope=read:user%20user:email`,
              ...corsHeaders
            }
          });
        }

        // For POST requests, require authentication
        if (request.method === 'POST' && !userProps) {
          // Check if this is an initialize request (allowed without auth)
          try {
            const body = await request.clone().text();
            const mcpRequest = JSON.parse(body);
            if (mcpRequest.method !== 'initialize') {
              return new Response(JSON.stringify({
                jsonrpc: '2.0',
                id: mcpRequest.id || null,
                error: { code: -32001, message: 'Authentication required' }
              }), {
                status: 401,
                headers: { 'Content-Type': 'application/json', ...corsHeaders }
              });
            }
          } catch {
            return new Response(JSON.stringify({
              jsonrpc: '2.0',
              id: null,
              error: { code: -32700, message: 'Parse error' }
            }), {
              status: 400,
              headers: { 'Content-Type': 'application/json', ...corsHeaders }
            });
          }
        }

        // Check if user is authorized (if authenticated)
        if (userProps && !ALLOWED_USERNAMES.has(userProps.userLogin)) {
          return new Response('Access denied - user not authorized', { 
            status: 403,
            headers: corsHeaders
          });
        }

        // Validate Flodesk API key exists
        if (!env.FLODESK_API_KEY) {
          console.error('FLODESK_API_KEY environment variable is not set');
          return new Response(JSON.stringify({
            error: 'Server configuration error',
            message: 'Flodesk API key not configured'
          }), {
            status: 500,
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        }

        // Create MCP server and handle request
        const flodeskAPI = new FlodeskAPI(env.FLODESK_API_KEY);
        const mcpServer = new MCPServer(flodeskAPI, env, userProps);
        const response = await mcpServer.handleRequest(request);
        
        // Add CORS headers
        Object.entries(corsHeaders).forEach(([key, value]) => {
          if (!response.headers.has(key)) {
            response.headers.set(key, value);
          }
        });
        
        return response;
      }

      // Health check
      if (url.pathname === '/health') {
        return new Response(JSON.stringify({ 
          status: 'ok', 
          timestamp: new Date().toISOString() 
        }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }

      // Default response
      return new Response(JSON.stringify({
        name: 'Flodesk Remote MCP Server (Official OAuth)',
        version: '1.0.0',
        endpoints: {
          mcp: '/sse',
          authorize: '/authorize',
          callback: '/callback',
          token: '/token',
          health: '/health'
        }
      }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });

    } catch (error) {
      console.error('Request error:', error);
      return new Response(JSON.stringify({ 
        error: 'Internal Server Error',
        message: error instanceof Error ? error.message : 'Unknown error'
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }
  },
};