import { Env } from './index';

export class GitHubOAuthHandler {
  private env: Env;

  constructor(env: Env) {
    this.env = env;
  }

  async handleRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);

    switch (url.pathname) {
      case '/auth':
        return this.handleAuth(request);
      case '/authorize':
        return this.handleAuthorize(request);
      case '/callback':
        return this.handleCallback(request);
      case '/token':
        return this.handleToken(request);
      case '/register':
        return this.handleRegister(request);
      default:
        return new Response('Not Found', { status: 404 });
    }
  }

  private async handleAuth(request: Request): Promise<Response> {
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    try {
      // For MCP clients, we'll initiate the OAuth flow
      const requestUrl = new URL(request.url);
      
      // Generate a session ID for this auth request
      const sessionId = this.generateSessionId();
      
      // Store session data for MCP callback
      const sessionData = {
        mcpClientRequest: true,
        mcpRedirectUri: `${requestUrl.origin}/callback`,
        mcpState: sessionId,
        mcpClientId: 'mcp_client',
        timestamp: Date.now()
      };

      await this.env.FLODESK_KV.put(
        `session:${sessionId}`,
        JSON.stringify(sessionData),
        { expirationTtl: 3600 } // 1 hour
      );

      // Redirect directly to GitHub OAuth for MCP clients
      const githubAuthUrl = new URL('https://github.com/login/oauth/authorize');
      githubAuthUrl.searchParams.set('client_id', this.env.GITHUB_CLIENT_ID);
      githubAuthUrl.searchParams.set('redirect_uri', `${requestUrl.origin}/callback`);
      githubAuthUrl.searchParams.set('state', sessionId);
      githubAuthUrl.searchParams.set('scope', 'user:email');

      return new Response(null, {
        status: 302,
        headers: {
          'Location': githubAuthUrl.toString()
        }
      });
    } catch (error) {
      console.error('Auth initiation error:', error);
      return new Response(JSON.stringify({ 
        error: 'server_error',
        error_description: 'Failed to initiate authentication'
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }

  private async handleAuthorize(request: Request): Promise<Response> {
    console.log(`=== OAuth authorize request ===`);
    console.log(`Method: ${request.method}`);
    console.log(`URL: ${request.url}`);
    console.log('Headers:', Object.fromEntries(request.headers.entries()));
    
    let clientId: string | null;
    let redirectUri: string | null;
    let state: string | null;
    let responseType: string | null;
    let codeChallenge: string | null = null;
    let codeChallengeMethod: string | null = null;

    try {
      // Handle both GET and POST requests
      if (request.method === 'GET') {
        const url = new URL(request.url);
        clientId = url.searchParams.get('client_id');
        redirectUri = url.searchParams.get('redirect_uri');
        state = url.searchParams.get('state');
        responseType = url.searchParams.get('response_type');
        codeChallenge = url.searchParams.get('code_challenge');
        codeChallengeMethod = url.searchParams.get('code_challenge_method');
        console.log('GET params:', { clientId, redirectUri, state, responseType });
      } else if (request.method === 'POST') {
        const contentType = request.headers.get('content-type') || '';
        console.log('POST content-type:', contentType);
        
        // Clone the request to read the body
        const clonedRequest = request.clone();
        const bodyText = await clonedRequest.text();
        console.log('Raw body:', bodyText);
        
        if (contentType.includes('application/json')) {
          try {
            const body = JSON.parse(bodyText);
            console.log('Parsed JSON body:', body);
            clientId = body.client_id;
            redirectUri = body.redirect_uri;
            state = body.state;
            responseType = body.response_type;
            codeChallenge = body.code_challenge;
            codeChallengeMethod = body.code_challenge_method;
          } catch (e) {
            console.log('Failed to parse JSON, body was:', bodyText);
            clientId = null;
            redirectUri = null;
            state = null;
            responseType = null;
          }
        } else if (contentType.includes('application/x-www-form-urlencoded')) {
          const formData = new URLSearchParams(bodyText);
          clientId = formData.get('client_id');
          redirectUri = formData.get('redirect_uri');
          state = formData.get('state');
          responseType = formData.get('response_type');
          codeChallenge = formData.get('code_challenge');
          codeChallengeMethod = formData.get('code_challenge_method');
        } else {
          console.log('Unknown content type, treating as empty body');
          clientId = null;
          redirectUri = null;
          state = null;
          responseType = null;
        }
      } else {
        console.log('Unsupported method:', request.method);
        return new Response(JSON.stringify({
          error: 'method_not_allowed',
          error_description: `Method ${request.method} not allowed. Use GET or POST.`
        }), {
          status: 405,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      
      console.log('Parsed values:', { clientId, redirectUri, state, responseType });
    } catch (error) {
      console.error('Error parsing request:', error);
      return new Response('Bad request', { status: 400 });
    }

    // If this is a request missing state parameter (MCP Inspector pattern), generate one
    if (clientId && redirectUri && responseType === 'code' && !state) {
      console.log('MCP client request missing state, generating one');
      state = this.generateSessionId();
    }

    // If this is a POST request with no parameters, treat it as an MCP client auth request
    if (request.method === 'POST' && (!clientId || !redirectUri || !state)) {
      console.log('Handling MCP client POST request to /authorize');
      
      try {
        // For MCP clients posting to /authorize, start the GitHub OAuth flow directly
        const requestUrl = new URL(request.url);
        
        // Generate a session ID for this auth request
        const sessionId = this.generateSessionId();
        
        // Store session data for MCP callback
        const sessionData = {
          mcpClientRequest: true,
          mcpRedirectUri: `${requestUrl.origin}/callback`,
          mcpState: sessionId,
          mcpClientId: 'mcp_client',
          timestamp: Date.now()
        };

        await this.env.FLODESK_KV.put(
          `session:${sessionId}`,
          JSON.stringify(sessionData),
          { expirationTtl: 3600 } // 1 hour
        );

        // Redirect directly to GitHub OAuth for MCP clients
        const githubAuthUrl = new URL('https://github.com/login/oauth/authorize');
        githubAuthUrl.searchParams.set('client_id', this.env.GITHUB_CLIENT_ID);
        githubAuthUrl.searchParams.set('redirect_uri', `${requestUrl.origin}/callback`);
        githubAuthUrl.searchParams.set('state', sessionId);
        githubAuthUrl.searchParams.set('scope', 'user:email');

        return new Response(null, {
          status: 302,
          headers: {
            'Location': githubAuthUrl.toString()
          }
        });
      } catch (error) {
        console.error('MCP client auth error:', error);
        return new Response(JSON.stringify({ 
          error: 'server_error',
          error_description: 'Failed to initiate authentication'
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }

    if (!clientId || !redirectUri || responseType !== 'code') {
      return new Response(JSON.stringify({
        error: 'invalid_request',
        error_description: 'Missing required parameters: client_id, redirect_uri, response_type=code'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Ensure we have a state parameter (generate if missing)
    if (!state) {
      state = this.generateSessionId();
    }

    // Note: In a production environment, you'd want to validate the client_id
    // For now, we'll accept any client_id to work with the MCP Inspector

    // Store the MCP client's redirect URI and state for later use
    const sessionId = this.generateSessionId();
    const sessionData = {
      mcpRedirectUri: redirectUri,
      mcpState: state,
      mcpClientId: clientId,
      codeChallenge: codeChallenge,
      codeChallengeMethod: codeChallengeMethod,
      timestamp: Date.now()
    };

    // Store session data using KV instead of Durable Objects for simplicity
    await this.env.FLODESK_KV.put(
      `session:${sessionId}`,
      JSON.stringify(sessionData),
      { expirationTtl: 3600 } // 1 hour
    );

    // Redirect to GitHub OAuth (using our configured GitHub app)
    const requestUrl = new URL(request.url);
    const githubAuthUrl = new URL('https://github.com/login/oauth/authorize');
    githubAuthUrl.searchParams.set('client_id', this.env.GITHUB_CLIENT_ID);
    githubAuthUrl.searchParams.set('redirect_uri', `${requestUrl.origin}/callback`);
    githubAuthUrl.searchParams.set('state', sessionId);
    githubAuthUrl.searchParams.set('scope', 'user:email');

    return new Response(null, {
      status: 302,
      headers: {
        'Location': githubAuthUrl.toString()
      }
    });
  }

  private async handleCallback(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const code = url.searchParams.get('code');
    const sessionId = url.searchParams.get('state');
    const error = url.searchParams.get('error');

    if (error) {
      return new Response(`OAuth error: ${error}`, { status: 400 });
    }

    if (!code || !sessionId) {
      return new Response('Missing code or state', { status: 400 });
    }

    // Retrieve session data from KV
    const sessionDataStr = await this.env.FLODESK_KV.get(`session:${sessionId}`);
    if (!sessionDataStr) {
      return new Response('Invalid session', { status: 400 });
    }
    const sessionData = JSON.parse(sessionDataStr);

    if (!sessionData.mcpRedirectUri) {
      return new Response('Invalid session', { status: 400 });
    }

    try {
      // Exchange code for access token
      const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          client_id: this.env.GITHUB_CLIENT_ID,
          client_secret: this.env.GITHUB_CLIENT_SECRET,
          code: code,
        }),
      });

      console.log('GitHub token response status:', tokenResponse.status);
      
      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text();
        console.log('GitHub token error response:', errorText);
        throw new Error(`GitHub token exchange failed: ${tokenResponse.status} ${errorText}`);
      }

      const responseText = await tokenResponse.text();
      console.log('GitHub token response text:', responseText);
      
      let tokenData: any;
      try {
        tokenData = JSON.parse(responseText);
      } catch (e) {
        console.error('Failed to parse GitHub response as JSON:', responseText);
        throw new Error(`Invalid response from GitHub: ${responseText.substring(0, 100)}`);
      }

      if (tokenData.error) {
        throw new Error(`GitHub OAuth error: ${tokenData.error}`);
      }

      // Get user info
      const userResponse = await fetch('https://api.github.com/user', {
        headers: {
          'Authorization': `token ${tokenData.access_token}`,
          'Accept': 'application/json',
          'User-Agent': 'Flodesk-MCP-Server/1.0',
        },
      });

      console.log('GitHub user response status:', userResponse.status);
      
      if (!userResponse.ok) {
        const errorText = await userResponse.text();
        console.log('GitHub user error response:', errorText);
        throw new Error(`GitHub user info failed: ${userResponse.status} ${errorText}`);
      }

      const userData = await userResponse.json() as any;
      console.log('GitHub user data:', { id: userData.id, login: userData.login, email: userData.email });

      // Generate our own access token for the MCP client
      const mcpAccessToken = this.generateAccessToken();

      // Store the mapping of MCP token to GitHub user data
      await this.env.FLODESK_KV.put(
        `mcp_token:${mcpAccessToken}`,
        JSON.stringify({
          githubToken: tokenData.access_token,
          user: userData,
          createdAt: Date.now(),
        }),
        { expirationTtl: 3600 * 24 * 7 } // 7 days
      );

      // Check if this is an MCP Inspector session (no specific redirect URI pattern)
      if (sessionData.mcpClientRequest || sessionData.mcpRedirectUri.includes('localhost') || sessionData.mcpRedirectUri.includes('callback')) {
        // For MCP Inspector, show a success page with the token
        const successPage = `
<!DOCTYPE html>
<html>
<head>
    <title>OAuth Success</title>
    <style>
        body { font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; }
        .success { background: #d4edda; border: 1px solid #c3e6cb; padding: 20px; border-radius: 5px; }
        .token { background: #f8f9fa; border: 1px solid #dee2e6; padding: 10px; border-radius: 3px; font-family: monospace; word-break: break-all; }
        .instructions { margin-top: 20px; }
    </style>
</head>
<body>
    <div class="success">
        <h2>✅ OAuth Authentication Successful!</h2>
        <p>You have successfully authenticated with GitHub.</p>
        <div class="instructions">
            <p><strong>Your access token:</strong></p>
            <div class="token">${mcpAccessToken}</div>
            <p><small>You can now close this window and return to the MCP Inspector. The token will be automatically used for API requests.</small></p>
        </div>
    </div>
    <script>
        // Store token for MCP Inspector
        if (window.opener) {
            window.opener.postMessage({ 
                type: 'oauth_success', 
                token: '${mcpAccessToken}',
                user: ${JSON.stringify(userData)}
            }, '*');
            window.close();
        }
    </script>
</body>
</html>`;

        return new Response(successPage, {
          headers: { 'Content-Type': 'text/html' }
        });
      } else {
        // Redirect back to MCP client with authorization code
        const redirectUrl = new URL(sessionData.mcpRedirectUri);
        redirectUrl.searchParams.set('code', mcpAccessToken);
        redirectUrl.searchParams.set('state', sessionData.mcpState);

        return new Response(null, {
          status: 302,
          headers: {
            'Location': redirectUrl.toString()
          }
        });
      }
    } catch (error) {
      console.error('OAuth callback error:', error);
      return new Response(`OAuth error: ${error instanceof Error ? error.message : 'Unknown error'}`, { status: 500 });
    }
  }

  private async handleToken(request: Request): Promise<Response> {
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    const formData = await request.formData();
    const grantType = formData.get('grant_type');
    const code = formData.get('code');
    const clientId = formData.get('client_id');

    if (grantType !== 'authorization_code' || !code || !clientId) {
      return new Response(JSON.stringify({ error: 'invalid_request' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    try {
      // Verify the code exists in our KV store
      const tokenData = await this.env.FLODESK_KV.get(`mcp_token:${code}`);
      
      if (!tokenData) {
        return new Response(JSON.stringify({ error: 'invalid_grant' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Return the access token
      return new Response(JSON.stringify({
        access_token: code,
        token_type: 'Bearer',
        expires_in: 604800, // 7 days
      }), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      console.error('Token exchange error:', error);
      return new Response(JSON.stringify({ error: 'server_error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  private async handleRegister(request: Request): Promise<Response> {
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    try {
      const registrationData = await request.json();
      
      // For MCP Inspector, we'll auto-register any client
      // In production, you might want more validation
      const clientId = crypto.randomUUID();
      const clientSecret = crypto.randomUUID();

      const response = {
        client_id: clientId,
        client_secret: clientSecret,
        client_id_issued_at: Math.floor(Date.now() / 1000),
        client_secret_expires_at: 0, // Never expires
        redirect_uris: registrationData.redirect_uris || [],
        grant_types: ['authorization_code'],
        response_types: ['code'],
        token_endpoint_auth_method: 'client_secret_post'
      };

      // Store the client registration (optional, for tracking)
      await this.env.FLODESK_KV.put(
        `client:${clientId}`,
        JSON.stringify({
          ...response,
          created_at: Date.now()
        }),
        { expirationTtl: 86400 * 30 } // 30 days
      );

      return new Response(JSON.stringify(response), {
        status: 201,
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error) {
      console.error('Client registration error:', error);
      return new Response(JSON.stringify({ 
        error: 'invalid_request',
        error_description: 'Invalid registration request'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }

  async verifyToken(token: string): Promise<any> {
    try {
      console.log(`Verifying token: ${token.substring(0, 10)}...`);
      const tokenData = await this.env.FLODESK_KV.get(`mcp_token:${token}`);
      console.log(`Token data from KV:`, tokenData ? 'found' : 'not found');
      
      if (!tokenData) {
        return null;
      }

      const data = JSON.parse(tokenData);
      console.log(`Parsed token data:`, { user: data.user?.login, createdAt: data.createdAt });
      
      // Check if token is expired (7 days)
      if (Date.now() - data.createdAt > 7 * 24 * 60 * 60 * 1000) {
        console.log('Token expired, deleting');
        await this.env.FLODESK_KV.delete(`mcp_token:${token}`);
        return null;
      }

      return data;
    } catch (error) {
      console.error('Token verification error:', error);
      return null;
    }
  }

  private generateSessionId(): string {
    return crypto.randomUUID();
  }

  private generateAccessToken(): string {
    return 'mcp_' + crypto.randomUUID().replace(/-/g, '');
  }
}