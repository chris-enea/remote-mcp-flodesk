# Flodesk Remote MCP Server

A remote Model Context Protocol (MCP) server for interacting with the Flodesk API, deployed on Cloudflare Workers.

## Features

- 🔐 OAuth authentication with Google
- ✉️ Complete Flodesk subscriber management
- 🏷️ Segment creation and management
- 🔍 Subscriber search functionality
- 📊 Rich, formatted responses with emojis
- ⚡ Deployed on Cloudflare Workers for global performance

## Available Tools

1. **add_subscriber** - Add new subscribers with optional segments
2. **get_subscriber** - Retrieve subscriber details by email
3. **search_subscribers** - Search subscribers with pagination
4. **list_segments** - Get all segments in your account
5. **create_segment** - Create new segments with colors
6. **add_to_segment** - Add subscribers to segments
7. **remove_from_segment** - Remove subscribers from segments

## Setup

### Prerequisites

- [Cloudflare account](https://cloudflare.com)
- [Flodesk account](https://flodesk.com) and API key
- [Google account](https://console.cloud.google.com/) for OAuth
- [Node.js](https://nodejs.org) 18+

### Installation

1. Install dependencies:
```bash
npm install
```

2. Create your environment variables:
```bash
cp .dev.vars.example .dev.vars
```

3. Configure your `.dev.vars` file with:
   - Google OAuth app credentials
   - Flodesk API key

### Google OAuth Setup

#### Local Development
1. Go to the [Google API Console](https://console.cloud.google.com/apis/credentials)
2. Create a new OAuth 2.0 Client ID for a "Web application".
3. Add an authorized redirect URI: `http://localhost:8788/callback` (Note: port is 8788 as per wrangler.toml)
4. Copy the Client ID and Client Secret to your `.dev.vars` file.

#### Production
1. Create another OAuth 2.0 Client ID for production.
2. Add the authorized redirect URI for your production worker: `https://your-worker.your-account.workers.dev/callback`
3. Set the production secrets using Wrangler:
```bash
wrangler secret put GOOGLE_CLIENT_ID
wrangler secret put GOOGLE_CLIENT_SECRET
wrangler secret put FLODESK_API_KEY
```

### Development

Start the development server:
```bash
npm start
```

Your MCP server will be available at `http://localhost:8788/sse`

### Testing with MCP Inspector

1. Install and run MCP Inspector:
```bash
npx @modelcontextprotocol/inspector@latest
```

2. Open http://localhost:5173 in your browser
3. Connect to `http://localhost:8788/sse`
4. Complete the Google OAuth flow
5. Test the available tools

### Deployment

Deploy to Cloudflare Workers:
```bash
npm run deploy
```

### Using with Claude Desktop

1. Install the mcp-remote proxy:
```bash
npm install -g mcp-remote
```

2. Update your Claude Desktop config:
```json
{
  "mcpServers": {
    "flodesk": {
      "command": "npx",
      "args": ["mcp-remote", "https://your-worker.your-account.workers.dev/sse"]
    }
  }
}
```

3. Restart Claude Desktop and complete the OAuth flow

## API Endpoints

- `/sse` - MCP Server-Sent Events endpoint
- `/authorize` - OAuth authorization endpoint
- `/callback` - OAuth callback endpoint
- `/token` - OAuth token exchange endpoint
- `/health` - Health check endpoint

## Error Handling

The server provides detailed error messages for:
- Invalid email formats
- Missing required parameters
- Duplicate subscribers/segments
- Authentication failures
- Flodesk API errors

## Security

- All API keys are stored securely as Cloudflare Worker secrets
- OAuth tokens are validated and have expiration times
- CORS headers are properly configured
- Input validation using Zod schemas