# Flodesk Remote MCP Server - Complete Deployment Guide

**🎯 Production Ready** - This server is fully functional with OAuth authentication and real Flodesk data integration.

**⚠️ Implementation Notes**: This uses a custom OAuth implementation that is fully compatible with `mcp-remote` and Claude Desktop. We explored using official Cloudflare OAuth libraries but found compatibility issues with current `mcp-remote` versions.

This guide walks you through deploying a working remote MCP server for the Flodesk API on Cloudflare Workers, with OAuth authentication via GitHub.

## 🎯 What You'll Build

A remote MCP server that provides 7 Flodesk API tools:
- `add_subscriber` - Add new subscribers with optional segments
- `get_subscriber` - Retrieve subscriber details by email  
- `search_subscribers` - Search subscribers with pagination
- `list_segments` - Get all segments in your account
- `create_segment` - Create new segments with colors
- `add_to_segment` - Add subscribers to segments
- `remove_from_segment` - Remove subscribers from segments

## 📋 Prerequisites

- [Cloudflare account](https://cloudflare.com) (free tier works)
- [Flodesk account](https://flodesk.com) and API key
- [GitHub account](https://github.com) for OAuth authentication
- [Node.js](https://nodejs.org) 18+ installed locally
- Basic familiarity with command line

## 🚀 Step-by-Step Setup

### 1. Project Structure Setup

Create the project directory and files:

```bash
mkdir flodesk-remote-mcp
cd flodesk-remote-mcp
```

Create `package.json`:
```json
{
  "name": "flodesk-remote-mcp",
  "version": "1.0.0",
  "description": "Remote MCP server for Flodesk API integration",
  "main": "src/index.ts",
  "scripts": {
    "start": "wrangler dev",
    "deploy": "wrangler deploy",
    "dev": "wrangler dev --local",
    "build": "wrangler deploy --dry-run"
  },
  "dependencies": {
    "@cloudflare/workers-types": "^4.20241218.0",
    "@modelcontextprotocol/sdk": "^1.0.2",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "typescript": "^5.7.2",
    "wrangler": "^4.0.0"
  },
  "keywords": ["mcp", "flodesk", "cloudflare-workers", "oauth"],
  "author": "Your Name",
  "license": "MIT"
}
```

Create `wrangler.toml`:
```toml
name = "flodesk-remote-mcp"
main = "src/index.ts"
compatibility_date = "2024-12-18"

[env.production]
name = "flodesk-remote-mcp"

[env.development]
name = "flodesk-remote-mcp-dev"

[durable_objects]
bindings = [
  { name = "SESSIONS", class_name = "SessionStorage" }
]

[[migrations]]
tag = "v1"
new_classes = [ "SessionStorage" ]

[[kv_namespaces]]
binding = "FLODESK_KV"
id = "flodesk_mcp_data"
preview_id = "flodesk_mcp_data_preview"
```

Create `tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "ES2022",
    "moduleResolution": "bundler",
    "allowSyntheticDefaultImports": true,
    "esModuleInterop": true,
    "allowJs": true,
    "checkJs": false,
    "declaration": true,
    "declarationMap": true,
    "skipLibCheck": true,
    "strict": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "types": ["@cloudflare/workers-types"]
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

### 2. Install Dependencies

```bash
npm install
```

**Important:** If you get a Wrangler version warning, update it:
```bash
npm install --save-dev wrangler@4
```

### 3. GitHub OAuth App Setup

You need **two** GitHub OAuth apps - one for development, one for production.

#### Development OAuth App

1. Go to [GitHub Settings > Developer Settings](https://github.com/settings/developers)
2. Click "New OAuth App"
3. Fill in:
   - **Application name**: `Flodesk MCP Server (local)`
   - **Homepage URL**: `http://localhost:8787`
   - **Authorization callback URL**: `http://localhost:8787/callback`
4. Click "Register application"
5. Note the **Client ID**
6. Generate a **Client Secret**

#### Production OAuth App

1. Create another OAuth App:
   - **Application name**: `Flodesk MCP Server (production)`  
   - **Homepage URL**: `https://your-worker-name.your-account.workers.dev`
   - **Authorization callback URL**: `https://your-worker-name.your-account.workers.dev/callback`
2. Note the **Client ID** and generate a **Client Secret**

### 4. Environment Variables

Create `.dev.vars` file:
```bash
# GitHub OAuth Configuration (for local development)
GITHUB_CLIENT_ID="your-local-oauth-app-client-id"
GITHUB_CLIENT_SECRET="your-local-oauth-app-client-secret"

# Flodesk API Configuration  
FLODESK_API_KEY="your-flodesk-api-key"
```

**⚠️ Security Note:** Never commit `.dev.vars` to git. Add it to `.gitignore`.

### 5. Core Implementation Files

You'll need to create these files in the `src/` directory:

- `src/index.ts` - Main Cloudflare Worker entry point
- `src/oauth-handler.ts` - GitHub OAuth authentication logic
- `src/mcp-server.ts` - MCP protocol implementation
- `src/flodesk-api.ts` - Flodesk API integration

**💡 Tip:** The complete source code is available in this repository. Copy the files from the `src/` directory.

### 6. Local Development

Start the development server:
```bash
npm start
```

The server will be available at `http://localhost:8787/sse`

### 7. Testing with MCP Inspector

Install and run the MCP Inspector:
```bash
npx @modelcontextprotocol/inspector@latest
```

1. Open http://localhost:5173 in your browser
2. Enter URL: `http://localhost:8787/sse`
3. Click "Connect"
4. You'll be redirected to GitHub for authorization
5. After authorizing, you'll return to the inspector
6. Click "List Tools" to see the 7 Flodesk tools
7. Test tools like `list_segments` or `add_subscriber`

**⚠️ Note:** The MCP Inspector may require an authentication bypass (see Issue 7 in troubleshooting) because it doesn't properly pass Bearer tokens after OAuth completion. This is normal for testing - production usage with Claude Desktop works correctly.

### 8. Production Deployment

Set production secrets:
```bash
wrangler secret put GITHUB_CLIENT_ID
# Enter your production OAuth app client ID

wrangler secret put GITHUB_CLIENT_SECRET  
# Enter your production OAuth app client secret

wrangler secret put FLODESK_API_KEY
# Enter your Flodesk API key
```

Deploy to Cloudflare:
```bash
npm run deploy
```

Your server will be live at: `https://your-worker-name.your-account.workers.dev/sse`

### 9. Using with Claude Desktop

Install the mcp-remote proxy:
```bash
npm install -g mcp-remote
```

Update your Claude Desktop configuration (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):
```json
{
  "mcpServers": {
    "flodesk": {
      "command": "npx",
      "args": ["mcp-remote", "https://your-worker-name.your-account.workers.dev/sse"]
    }
  }
}
```

Restart Claude Desktop and complete the OAuth flow when prompted.

## 🐛 Common Issues & Solutions

### Issue 1: "Method Not Allowed" on OAuth requests
**Symptom:** GET requests to `/authorize` return 405 error
**Solution:** Ensure your `handleAuthorize` method supports both GET and POST requests properly.

### Issue 2: "Missing required parameters" OAuth error  
**Symptom:** `client_id, redirect_uri, state, response_type=code` error
**Solution:** Make the `state` parameter optional and auto-generate it for MCP clients:
```typescript
// If this is a request missing state parameter (MCP Inspector pattern), generate one
if (clientId && redirectUri && responseType === 'code' && !state) {
  state = this.generateSessionId();
}
```

### Issue 3: "Unexpected token 'R'" JSON parsing error
**Symptom:** OAuth callback fails with JSON parsing error
**Solution:** Add proper error handling for GitHub API responses:
```typescript
const responseText = await tokenResponse.text();
let tokenData: any;
try {
  tokenData = JSON.parse(responseText);
} catch (e) {
  throw new Error(`Invalid response from GitHub: ${responseText.substring(0, 100)}`);
}
```

### Issue 4: "No resource metadata available" MCP error
**Symptom:** MCP Inspector can't discover OAuth endpoints
**Solution:** Add the OAuth protected resource endpoint:
```typescript
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
```

### Issue 5: Wrangler version conflicts
**Symptom:** Durable Objects configuration errors
**Solution:** Update to Wrangler v4 and use the new syntax:
```toml
[durable_objects]
bindings = [
  { name = "SESSIONS", class_name = "SessionStorage" }
]
```

### Issue 6: CORS headers causing "immutable headers" error
**Symptom:** Can't modify immutable headers error
**Solution:** Only add CORS headers if they don't exist:
```typescript
Object.entries(corsHeaders).forEach(([key, value]) => {
  if (!response.headers.has(key)) {
    response.headers.set(key, value);
  }
});
```

### Issue 7: MCP Inspector authentication bypass needed
**Symptom:** "Authentication required" error when clicking "List Tools" after successful OAuth
**Root Cause:** MCP Inspector completes OAuth flow but doesn't send Bearer token in subsequent API calls
**Solution:** Add temporary authentication bypass for testing:
```typescript
// TEMPORARY: Skip auth check for debugging tools methods
if (mcpRequest.method === 'tools/list' || mcpRequest.method === 'tools/call') {
  console.log('TEMPORARY: Bypassing auth for tools methods');
  // Continue without authentication for testing
} else {
  // Normal authentication check for other methods
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return this.createErrorResponse('Authentication required', -32001, mcpRequest.id);
  }
  // ... rest of auth logic
}
```

**⚠️ Important:** This bypass should only be used for development/testing. For production:
- Use Claude Desktop with `mcp-remote` proxy (handles tokens properly)
- Or implement session-based authentication instead of token-based
- Remove the bypass and implement proper token handling

## 🔍 Debugging Tips

1. **Enable verbose logging** in development by adding console.log statements
2. **Check Wrangler logs** for detailed error information during OAuth flow
3. **Test OAuth endpoints individually** using curl:
   ```bash
   curl -s http://localhost:8787/.well-known/oauth-authorization-server | jq .
   curl -s http://localhost:8787/.well-known/oauth-protected-resource | jq .
   ```
4. **Verify GitHub OAuth app configuration** matches your callback URLs exactly

## 📚 Key Endpoints

- `/sse` - MCP Server-Sent Events endpoint
- `/authorize` - OAuth authorization endpoint  
- `/callback` - OAuth callback endpoint
- `/token` - OAuth token exchange endpoint
- `/register` - Dynamic client registration endpoint
- `/.well-known/oauth-authorization-server` - OAuth discovery
- `/.well-known/oauth-protected-resource` - Resource metadata (MCP 2025-DRAFT-v2)

## 🎉 Success Indicators

You know everything is working when:
- ✅ MCP Inspector connects without errors
- ✅ OAuth flow redirects to GitHub successfully  
- ✅ All 7 Flodesk tools are listed and callable
- ✅ Tool responses are richly formatted with emojis
- ✅ Claude Desktop can connect via mcp-remote proxy

## 🔬 Implementation Notes & Lessons Learned

### OAuth Library Exploration
During development, we explored using the official Cloudflare libraries:
- `@cloudflare/workers-oauth-provider` - Official OAuth provider
- `agents` - Official MCP agent framework

**Challenges Encountered:**
1. **Runtime Errors**: The `agents` library requires `nodejs_compat` flag and has complex initialization
2. **mcp-remote Compatibility**: Current `mcp-remote` versions don't fully support the official OAuth provider pattern
3. **Error Handling**: Official libraries throw exceptions that cause 500 errors instead of proper OAuth error responses

**Current Solution:**
- Custom OAuth implementation using standard OAuth 2.0 flows
- Direct GitHub API integration for user authentication
- Manual token management via Cloudflare KV storage
- Full compatibility with `mcp-remote` and Claude Desktop

**Future Considerations:**
As `mcp-remote` and the official Cloudflare libraries mature, migrating to the official implementation would be beneficial for:
- Better security practices
- Official support and updates
- Standardized OAuth flows

### Flodesk API Integration
**Authentication Format:** Flodesk uses Basic authentication with API key as username and empty password:
```typescript
const authString = btoa(`${apiKey}:`);
headers['Authorization'] = `Basic ${authString}`;
```

**Not** Bearer token format as initially implemented.

## 📖 Additional Resources

- [MCP Specification](https://spec.modelcontextprotocol.io/)
- [Cloudflare Workers Documentation](https://developers.cloudflare.com/workers/)
- [Flodesk API Documentation](https://developers.flodesk.com/)
- [GitHub OAuth Apps Guide](https://docs.github.com/en/apps/oauth-apps)

## 🤝 Contributing

Found an issue or improvement? Please update this guide to help future implementers avoid the same pitfalls!