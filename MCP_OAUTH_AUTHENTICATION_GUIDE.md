# MCP Remote Server OAuth Authentication Guide

This guide shows you how to add OAuth authentication to any remote MCP server using GitHub as the OAuth provider. This setup enables secure, user-authenticated access to your MCP tools.

## 🎯 What This Guide Covers

- Setting up OAuth 2.0 authentication for MCP servers
- GitHub OAuth integration (adaptable to other providers)
- MCP 2024 and 2025-DRAFT-v2 specification compliance
- Dynamic client registration support
- Common authentication issues and solutions

## 📋 Prerequisites

- Existing MCP server (or new project)
- [GitHub account](https://github.com) for OAuth provider
- [Cloudflare Workers](https://workers.cloudflare.com) (or similar serverless platform)
- Basic understanding of OAuth 2.0 flow

## 🏗️ OAuth Architecture Overview

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   MCP Client    │    │   Your MCP      │    │   GitHub OAuth  │
│   (Inspector,   │    │   Server        │    │   Provider      │
│   Claude, etc.) │    │                 │    │                 │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         │ 1. Connect to MCP     │                       │
         ├──────────────────────►│                       │
         │                       │                       │
         │ 2. OAuth Discovery    │                       │
         │◄──────────────────────┤                       │
         │                       │                       │
         │ 3. Start Auth Flow    │                       │
         ├──────────────────────►│                       │
         │                       │ 4. Redirect to GitHub │
         │                       ├──────────────────────►│
         │ 5. User Authorization │                       │
         │◄─────────────────────────────────────────────┤
         │                       │ 6. Callback with Code│
         │                       │◄──────────────────────┤
         │                       │ 7. Exchange for Token│
         │                       ├──────────────────────►│
         │ 8. Return Access Token│                       │
         │◄──────────────────────┤                       │
         │                       │                       │
         │ 9. Authenticated Calls│                       │
         ├──────────────────────►│                       │
```

## 🛠️ Implementation Steps

### Step 1: OAuth Discovery Endpoints

Your MCP server must expose OAuth metadata endpoints for client discovery:

#### Authorization Server Metadata (MCP 2024)
```typescript
// /.well-known/oauth-authorization-server
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
    headers: { 'Content-Type': 'application/json' }
  });
}
```

#### Protected Resource Metadata (MCP 2025-DRAFT-v2)
```typescript
// /.well-known/oauth-protected-resource
if (url.pathname === '/.well-known/oauth-protected-resource') {
  return new Response(JSON.stringify({
    resource: url.origin,
    authorization_servers: [url.origin],
    scopes_supported: ["api:read", "api:write"], // Customize for your API
    bearer_methods_supported: ["header"],
    resource_documentation: `${url.origin}`,
    resource_registration_endpoint: `${url.origin}/register`
  }), {
    headers: { 'Content-Type': 'application/json' }
  });
}
```

### Step 2: MCP Server Initialization

Update your MCP server's initialize response to advertise OAuth:

```typescript
private async handleInitialize(mcpRequest: MCPRequest, request?: Request): Promise<Response> {
  const origin = request ? new URL(request.url).origin : 'http://localhost:8787';
  
  const result = {
    protocolVersion: '2024-11-05',
    capabilities: {
      tools: {},
      oauth: {
        authUrl: `${origin}/auth` // For MCP 2025-DRAFT-v2
      }
    },
    serverInfo: {
      name: 'Your MCP Server',
      version: '1.0.0'
    }
  };

  return this.createSuccessResponse(result, mcpRequest.id);
}
```

### Step 3: GitHub OAuth App Setup

Create **two** GitHub OAuth applications:

#### Development App
- **Name**: `Your MCP Server (local)`
- **Homepage URL**: `http://localhost:8787`
- **Callback URL**: `http://localhost:8787/callback`

#### Production App  
- **Name**: `Your MCP Server (production)`
- **Homepage URL**: `https://your-worker.workers.dev`
- **Callback URL**: `https://your-worker.workers.dev/callback`

### Step 4: OAuth Handler Implementation

Create a comprehensive OAuth handler class:

```typescript
export class GitHubOAuthHandler {
  private env: Env;

  constructor(env: Env) {
    this.env = env;
  }

  async handleRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);

    switch (url.pathname) {
      case '/auth':
        return this.handleAuth(request);      // MCP client auth start
      case '/authorize': 
        return this.handleAuthorize(request); // Standard OAuth authorize
      case '/callback':
        return this.handleCallback(request);  // OAuth callback
      case '/token':
        return this.handleToken(request);     // Token exchange
      case '/register':
        return this.handleRegister(request);  // Dynamic client registration
      default:
        return new Response('Not Found', { status: 404 });
    }
  }

  // Implementation methods below...
}
```

### Step 5: Authorization Handler

Handle both standard OAuth and MCP client requests:

```typescript
private async handleAuthorize(request: Request): Promise<Response> {
  let clientId: string | null;
  let redirectUri: string | null;
  let state: string | null;
  let responseType: string | null;

  // Parse GET or POST parameters
  if (request.method === 'GET') {
    const url = new URL(request.url);
    clientId = url.searchParams.get('client_id');
    redirectUri = url.searchParams.get('redirect_uri');
    state = url.searchParams.get('state');
    responseType = url.searchParams.get('response_type');
  } else if (request.method === 'POST') {
    // Handle JSON or form data
    const contentType = request.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const body = await request.json();
      clientId = body.client_id;
      redirectUri = body.redirect_uri;
      state = body.state;
      responseType = body.response_type;
    }
  }

  // Handle MCP clients that may not send state parameter
  if (clientId && redirectUri && responseType === 'code' && !state) {
    state = this.generateSessionId();
  }

  // Handle MCP clients posting to /authorize with no parameters
  if (request.method === 'POST' && (!clientId || !redirectUri || !state)) {
    return this.redirectToGitHub(request);
  }

  // Validate required parameters
  if (!clientId || !redirectUri || responseType !== 'code') {
    return new Response(JSON.stringify({
      error: 'invalid_request',
      error_description: 'Missing required parameters: client_id, redirect_uri, response_type=code'
    }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  return this.redirectToGitHub(request, { clientId, redirectUri, state });
}

private async redirectToGitHub(request: Request, params?: any): Promise<Response> {
  const requestUrl = new URL(request.url);
  const sessionId = params?.state || this.generateSessionId();
  
  // Store session data
  const sessionData = {
    mcpRedirectUri: params?.redirectUri || `${requestUrl.origin}/callback`,
    mcpState: params?.state || sessionId,
    mcpClientId: params?.clientId || 'mcp_client',
    timestamp: Date.now()
  };

  await this.env.KV_STORE.put(
    `session:${sessionId}`,
    JSON.stringify(sessionData),
    { expirationTtl: 3600 }
  );

  // Redirect to GitHub
  const githubAuthUrl = new URL('https://github.com/login/oauth/authorize');
  githubAuthUrl.searchParams.set('client_id', this.env.GITHUB_CLIENT_ID);
  githubAuthUrl.searchParams.set('redirect_uri', `${requestUrl.origin}/callback`);
  githubAuthUrl.searchParams.set('state', sessionId);
  githubAuthUrl.searchParams.set('scope', 'user:email');

  return new Response(null, {
    status: 302,
    headers: { 'Location': githubAuthUrl.toString() }
  });
}
```

### Step 6: Callback Handler

Process the OAuth callback from GitHub:

```typescript
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

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      throw new Error(`GitHub token exchange failed: ${tokenResponse.status} ${errorText}`);
    }

    const responseText = await tokenResponse.text();
    let tokenData: any;
    try {
      tokenData = JSON.parse(responseText);
    } catch (e) {
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
        'User-Agent': 'Your-MCP-Server/1.0',
      },
    });

    if (!userResponse.ok) {
      throw new Error(`GitHub user info failed: ${userResponse.status}`);
    }

    const userData = await userResponse.json();

    // Generate MCP access token
    const mcpAccessToken = this.generateAccessToken();

    // Store user data and token mapping
    await this.env.KV_STORE.put(
      `mcp_token:${mcpAccessToken}`,
      JSON.stringify({
        githubToken: tokenData.access_token,
        user: userData,
        createdAt: Date.now(),
      }),
      { expirationTtl: 3600 * 24 * 7 } // 7 days
    );

    // Retrieve session data and redirect back to MCP client
    const sessionData = JSON.parse(await this.env.KV_STORE.get(`session:${sessionId}`));
    const redirectUrl = new URL(sessionData.mcpRedirectUri);
    redirectUrl.searchParams.set('code', mcpAccessToken);
    redirectUrl.searchParams.set('state', sessionData.mcpState);

    return new Response(null, {
      status: 302,
      headers: { 'Location': redirectUrl.toString() }
    });
  } catch (error) {
    console.error('OAuth callback error:', error);
    return new Response(`OAuth error: ${error.message}`, { status: 500 });
  }
}
```

### Step 7: Token Verification

Add authentication middleware to your MCP requests:

```typescript
private async handleMCPRequest(request: Request): Promise<Response> {
  const mcpRequest: MCPRequest = await request.json();
  
  // Handle initialization without auth
  if (mcpRequest.method === 'initialize') {
    return this.handleInitialize(mcpRequest, request);
  }

  // Check authentication for other methods
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return this.createErrorResponse('Authentication required', -32001, mcpRequest.id);
  }

  const token = authHeader.substring(7);
  const tokenData = await this.oauthHandler.verifyToken(token);
  
  if (!tokenData) {
    return this.createErrorResponse('Invalid or expired token', -32002, mcpRequest.id);
  }

  // Process authenticated request
  // ... rest of your MCP logic
}

async verifyToken(token: string): Promise<any> {
  try {
    const tokenData = await this.env.KV_STORE.get(`mcp_token:${token}`);
    
    if (!tokenData) {
      return null;
    }

    const data = JSON.parse(tokenData);
    
    // Check if token is expired (7 days)
    if (Date.now() - data.createdAt > 7 * 24 * 60 * 60 * 1000) {
      await this.env.KV_STORE.delete(`mcp_token:${token}`);
      return null;
    }

    return data;
  } catch (error) {
    console.error('Token verification error:', error);
    return null;
  }
}
```

### Step 8: Dynamic Client Registration

Support dynamic client registration for MCP clients:

```typescript
private async handleRegister(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const registrationData = await request.json();
    
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

    // Store client registration
    await this.env.KV_STORE.put(
      `client:${clientId}`,
      JSON.stringify(response),
      { expirationTtl: 86400 * 30 } // 30 days
    );

    return new Response(JSON.stringify(response), {
      status: 201,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ 
      error: 'invalid_request',
      error_description: 'Invalid registration request'
    }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
```

## 🐛 Common Issues & Solutions

### Issue 1: Method Not Allowed on Authorization
**Problem:** GET requests to `/authorize` return 405
**Solution:** Ensure your authorize handler supports both GET and POST methods

### Issue 2: Missing State Parameter
**Problem:** MCP clients don't send required `state` parameter
**Solution:** Auto-generate state parameter when missing:
```typescript
if (clientId && redirectUri && responseType === 'code' && !state) {
  state = this.generateSessionId();
}
```

### Issue 3: JSON Parsing Errors from GitHub
**Problem:** "Unexpected token" errors when parsing GitHub responses
**Solution:** Add proper error handling:
```typescript
const responseText = await tokenResponse.text();
let tokenData: any;
try {
  tokenData = JSON.parse(responseText);
} catch (e) {
  throw new Error(`Invalid response from GitHub: ${responseText.substring(0, 100)}`);
}
```

### Issue 4: CORS Headers Issues
**Problem:** "Can't modify immutable headers" errors
**Solution:** Check if headers exist before setting:
```typescript
Object.entries(corsHeaders).forEach(([key, value]) => {
  if (!response.headers.has(key)) {
    response.headers.set(key, value);
  }
});
```

### Issue 5: MCP 2025-DRAFT-v2 Compliance
**Problem:** "No resource metadata available" error
**Solution:** Add the protected resource metadata endpoint (Step 1)

### Issue 6: MCP Inspector Token Handling
**Problem:** "Authentication required" error after successful OAuth in MCP Inspector
**Root Cause:** MCP Inspector completes OAuth but doesn't send Bearer tokens in subsequent requests
**Solution:** Add development bypass for testing:
```typescript
// TEMPORARY: For MCP Inspector testing only
if (mcpRequest.method === 'tools/list' || mcpRequest.method === 'tools/call') {
  console.log('TEMPORARY: Bypassing auth for tools methods');
  // Continue without authentication for testing
} else {
  // Normal authentication logic
}
```
**Note:** Remove this bypass for production. Use Claude Desktop with `mcp-remote` proxy for proper token handling.

## 🔧 Environment Configuration

### Development (.dev.vars)
```env
GITHUB_CLIENT_ID="your-dev-oauth-app-client-id"
GITHUB_CLIENT_SECRET="your-dev-oauth-app-client-secret"
```

### Production (Wrangler Secrets)
```bash
wrangler secret put GITHUB_CLIENT_ID
wrangler secret put GITHUB_CLIENT_SECRET
```

## 🧪 Testing Your Implementation

### 1. Test OAuth Discovery
```bash
curl -s http://localhost:8787/.well-known/oauth-authorization-server | jq .
curl -s http://localhost:8787/.well-known/oauth-protected-resource | jq .
```

### 2. Test with MCP Inspector
```bash
npx @modelcontextprotocol/inspector@latest
# Connect to: http://localhost:8787/sse
# Note: May require authentication bypass for token handling issues
```

### 3. Test Authorization Flow
```bash
# Should redirect to GitHub
curl -I "http://localhost:8787/authorize?client_id=test&redirect_uri=http://test.com&response_type=code"
```

## 🔄 Adapting to Other OAuth Providers

To use a different OAuth provider (Google, Auth0, etc.):

1. **Update authorization URL:**
   ```typescript
   const authUrl = new URL('https://accounts.google.com/oauth/authorize'); // For Google
   ```

2. **Update token exchange endpoint:**
   ```typescript
   const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
     // Google token endpoint
   });
   ```

3. **Update user info endpoint:**
   ```typescript
   const userResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
     // Google user info endpoint
   });
   ```

4. **Update OAuth app configuration** in the respective provider's console

## 📚 Additional Resources

- [OAuth 2.0 RFC](https://tools.ietf.org/html/rfc6749)
- [MCP Specification](https://spec.modelcontextprotocol.io/)
- [GitHub OAuth Documentation](https://docs.github.com/en/apps/oauth-apps)
- [Cloudflare Workers KV](https://developers.cloudflare.com/workers/runtime-apis/kv/)

## 🎯 Success Checklist

- ✅ OAuth discovery endpoints respond correctly
- ✅ GitHub OAuth app configured with correct callback URLs
- ✅ Authorization flow redirects to GitHub successfully
- ✅ Callback processes tokens and user data correctly
- ✅ MCP client can authenticate and access protected tools
- ✅ Token verification works for subsequent requests
- ✅ Dynamic client registration supports MCP Inspector
- ✅ Authentication bypass works for MCP Inspector testing (if needed)
- ✅ Production deployment works with Claude Desktop via mcp-remote

This authentication setup provides a secure, standards-compliant OAuth 2.0 implementation that works with any MCP server and can be adapted for different OAuth providers.