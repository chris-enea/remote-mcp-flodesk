import { Hono } from 'hono';
import { Octokit } from 'octokit';
import { z } from 'zod';
import { 
  clientIdAlreadyApproved, 
  renderApprovalDialog, 
  parseRedirectApproval,
  encodeState,
  decodeState,
  generateCryptoKey
} from './workers-oauth-utils';

export interface GitHubUserProps {
  userLogin: string;
  userName: string;
  userEmail: string;
  accessToken: string;
}

export interface Env {
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  FLODESK_API_KEY: string;
  FLODESK_KV: KVNamespace;
}

export class GitHubHandler {
  private app: Hono;

  constructor() {
    this.app = new Hono();
    this.setupRoutes();
  }

  private setupRoutes() {
    // OAuth authorization endpoint
    this.app.get('/authorize', async (c) => {
      const env = c.env as Env;
      
      console.log('GitHub Client ID exists:', !!env.GITHUB_CLIENT_ID);
      console.log('GitHub Client ID length:', env.GITHUB_CLIENT_ID ? env.GITHUB_CLIENT_ID.length : 0);

      const clientId = c.req.query('client_id');
      const redirectUri = c.req.query('redirect_uri');
      const state = c.req.query('state');
      const responseType = c.req.query('response_type');
      const scope = c.req.query('scope') || 'read:user user:email';

      if (!clientId || !redirectUri || responseType !== 'code') {
        return c.json({
          error: 'invalid_request',
          error_description: 'Missing required parameters: client_id, redirect_uri, response_type=code'
        }, 400);
      }

      // Redirect directly to GitHub OAuth
      return this.redirectToGitHub(env, clientId, redirectUri, state || '', scope);
    });


    // OAuth callback endpoint
    this.app.get('/callback', async (c) => {
      const env = c.env as Env;
      const code = c.req.query('code');
      const state = c.req.query('state');
      const error = c.req.query('error');

      if (error) {
        return c.json({ error: `GitHub OAuth error: ${error}` }, 400);
      }

      if (!code || !state) {
        return c.json({ error: 'Missing code or state parameter' }, 400);
      }

      try {
        // Decode state to get original request info
        const stateData = decodeState(state);
        console.log('Decoded state data:', stateData);
        if (!stateData || !stateData.redirectUri) {
          return c.json({ error: 'Invalid state parameter' }, 400);
        }

        // Exchange code for GitHub access token
        const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
          method: 'POST',
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            client_id: env.GITHUB_CLIENT_ID,
            client_secret: env.GITHUB_CLIENT_SECRET,
            code,
          }),
        });

        if (!tokenResponse.ok) {
          throw new Error(`GitHub token exchange failed: ${tokenResponse.status}`);
        }

        const tokenData = await tokenResponse.json() as any;
        if (tokenData.error) {
          throw new Error(`GitHub OAuth error: ${tokenData.error}`);
        }

        // Get user info from GitHub
        const octokit = new Octokit({ auth: tokenData.access_token });
        const { data: user } = await octokit.rest.users.getAuthenticated();
        
        // Get user email if not public
        let email = user.email;
        if (!email) {
          const { data: emails } = await octokit.rest.users.listEmailsForAuthenticatedUser();
          const primaryEmail = emails.find(e => e.primary);
          email = primaryEmail?.email || '';
        }

        const userProps: GitHubUserProps = {
          userLogin: user.login,
          userName: user.name || user.login,
          userEmail: email || '',
          accessToken: tokenData.access_token,
        };

        // Generate MCP access token
        const mcpToken = this.generateMCPToken();
        
        // Store user props with the MCP token
        await env.FLODESK_KV.put(
          `mcp_token:${mcpToken}`,
          JSON.stringify(userProps),
          { expirationTtl: 3600 * 24 * 7 } // 7 days
        );

        // Redirect back to MCP client
        const redirectUrl = new URL(stateData.redirectUri);
        redirectUrl.searchParams.set('code', mcpToken);
        redirectUrl.searchParams.set('state', stateData.originalState || '');

        console.log('Redirecting back to MCP client:', redirectUrl.toString());
        return c.redirect(redirectUrl.toString());

      } catch (error) {
        console.error('OAuth callback error:', error);
        return c.json({ 
          error: 'oauth_error',
          error_description: error instanceof Error ? error.message : 'Unknown error'
        }, 500);
      }
    });

    // Token exchange endpoint
    this.app.post('/token', async (c) => {
      const env = c.env as Env;
      const body = await c.req.formData();
      
      const grantType = body.get('grant_type');
      const code = body.get('code');
      const clientId = body.get('client_id');

      console.log('Token exchange request:', { grantType, code, clientId });

      if (grantType !== 'authorization_code' || !code || !clientId) {
        console.log('Invalid token request parameters');
        return c.json({ error: 'invalid_request' }, 400);
      }

      try {
        // Verify the MCP token exists
        const userProps = await env.FLODESK_KV.get(`mcp_token:${code}`);
        
        if (!userProps) {
          console.log('MCP token not found in KV:', code);
          return c.json({ error: 'invalid_grant' }, 400);
        }

        console.log('Token exchange successful, returning access token');
        // Return the access token
        return c.json({
          access_token: code as string,
          token_type: 'Bearer',
          expires_in: 604800, // 7 days
        });
      } catch (error) {
        console.error('Token exchange error:', error);
        return c.json({ error: 'server_error' }, 500);
      }
    });

    // Client registration endpoint
    this.app.post('/register', async (c) => {
      try {
        const registrationData = await c.req.json();
        
        const clientId = crypto.randomUUID();
        const clientSecret = crypto.randomUUID();

        const response = {
          client_id: clientId,
          client_secret: clientSecret,
          client_id_issued_at: Math.floor(Date.now() / 1000),
          client_secret_expires_at: 0,
          redirect_uris: registrationData.redirect_uris || [],
          grant_types: ['authorization_code'],
          response_types: ['code'],
          token_endpoint_auth_method: 'client_secret_post'
        };

        return c.json(response, 201);
      } catch (error) {
        return c.json({ 
          error: 'invalid_request',
          error_description: 'Invalid registration request'
        }, 400);
      }
    });
  }

  private redirectToGitHub(env: Env, clientId: string, redirectUri: string, state: string, scope: string): Response {
    // Encode state with redirect info - store the original MCP client redirect URI
    const stateData = {
      redirectUri,
      originalState: state,
      clientId,
      timestamp: Date.now()
    };

    const githubAuthUrl = new URL('https://github.com/login/oauth/authorize');
    githubAuthUrl.searchParams.set('client_id', env.GITHUB_CLIENT_ID);
    // Always use our production callback URL for GitHub OAuth
    githubAuthUrl.searchParams.set('redirect_uri', 'https://flodesk-remote-mcp.chris-1bd.workers.dev/callback');
    githubAuthUrl.searchParams.set('scope', scope);
    githubAuthUrl.searchParams.set('state', encodeState(stateData));

    return new Response(null, {
      status: 302,
      headers: {
        'Location': githubAuthUrl.toString()
      }
    });
  }


  private generateMCPToken(): string {
    return 'mcp_' + crypto.randomUUID().replace(/-/g, '');
  }

  async verifyToken(token: string, env: Env): Promise<GitHubUserProps | null> {
    try {
      const userPropsStr = await env.FLODESK_KV.get(`mcp_token:${token}`);
      if (!userPropsStr) {
        return null;
      }

      const userProps = JSON.parse(userPropsStr) as GitHubUserProps;
      return userProps;
    } catch (error) {
      console.error('Token verification error:', error);
      return null;
    }
  }

  fetch(request: Request, env: Env): Promise<Response> {
    // Pass environment in the context
    return this.app.fetch(request, env);
  }
}