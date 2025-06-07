# Flodesk Remote MCP Server

A remote Model Context Protocol (MCP) server for interacting with the Flodesk API, deployed on Cloudflare Workers.

## Features

- 🔐 OAuth authentication with GitHub
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
- [GitHub account](https://github.com) for OAuth
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
   - GitHub OAuth app credentials
   - Flodesk API key

### GitHub OAuth Setup

#### Local Development
1. Go to [GitHub Settings > Developer settings](https://github.com/settings/developers)
2. Create a new OAuth App with:
   - **Application name**: `Flodesk MCP Server (local)`
   - **Homepage URL**: `http://localhost:8787`
   - **Authorization callback URL**: `http://localhost:8787/callback`
3. Add the Client ID and Secret to your `.dev.vars` file

#### Production
1. Create another OAuth App for production:
   - **Application name**: `Flodesk MCP Server (production)`
   - **Homepage URL**: `https://your-worker.your-account.workers.dev`
   - **Authorization callback URL**: `https://your-worker.your-account.workers.dev/callback`
2. Set the production secrets:
```bash
wrangler secret put GITHUB_CLIENT_ID
wrangler secret put GITHUB_CLIENT_SECRET
wrangler secret put FLODESK_API_KEY
```

### Development

Start the development server:
```bash
npm start
```

Your MCP server will be available at `http://localhost:8787/sse`

### Testing with MCP Inspector

1. Install and run MCP Inspector:
```bash
npx @modelcontextprotocol/inspector@latest
```

2. Open http://localhost:5173 in your browser
3. Connect to `http://localhost:8787/sse`
4. Complete the GitHub OAuth flow
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