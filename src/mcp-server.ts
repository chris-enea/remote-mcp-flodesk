import { z } from 'zod';
import { FlodeskAPI, FlodeskSubscriber, FlodeskSegment } from './flodesk-api';
import { GitHubOAuthHandler } from './github-handler';
import { Env } from './index';

interface MCPRequest {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: any;
}

interface MCPResponse {
  jsonrpc: '2.0';
  id: number | string;
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}

interface MCPTool {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
}

const addSubscriberSchema = z.object({
  email: z.string().email('Invalid email format'),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  segment_ids: z.array(z.string()).optional(),
});

const getSubscriberSchema = z.object({
  email: z.string().email('Invalid email format'),
});

const searchSubscribersSchema = z.object({
  query: z.string().min(1, 'Query cannot be empty'),
  limit: z.number().int().min(1).max(100).default(10),
});

const createSegmentSchema = z.object({
  name: z.string().min(1, 'Name cannot be empty'),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Color must be a valid hex code').optional(),
});

const segmentActionSchema = z.object({
  email: z.string().email('Invalid email format'),
  segment_id: z.string().min(1, 'Segment ID cannot be empty'),
});

export class MCPServer {
  private flodeskAPI: FlodeskAPI;
  private oauthHandler: GitHubOAuthHandler;
  private env: Env;
  private userProps: any;
  private flodeskConnected: boolean = false;

  constructor(flodeskAPI: FlodeskAPI, env: Env, userProps?: any) {
    this.flodeskAPI = flodeskAPI;
    this.oauthHandler = new GitHubOAuthHandler(env);
    this.env = env;
    this.userProps = userProps;
    // Test Flodesk connection on startup
    this.testFlodeskConnection();
  }

  private async testFlodeskConnection(): Promise<void> {
    try {
      console.log('Testing Flodesk API connection...');
      this.flodeskConnected = await this.flodeskAPI.testConnection();
      console.log(`Flodesk API connection test: ${this.flodeskConnected ? 'SUCCESS' : 'FAILED'}`);
      if (!this.flodeskConnected) {
        console.log('Flodesk API test failed - will use mock data');
      }
    } catch (error) {
      console.error('Error testing Flodesk connection:', error);
      this.flodeskConnected = false;
    }
  }

  async handleRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);
    console.log(`=== MCP Request ===`);
    console.log(`Method: ${request.method}`);
    console.log(`Path: ${url.pathname}`);
    console.log(`Headers:`, Object.fromEntries(request.headers.entries()));

    // Handle OPTIONS for CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept, X-Flodesk-API-Key',
          'Access-Control-Max-Age': '86400',
        }
      });
    }

    if (request.method === 'GET') {
      // SSE connections also need authentication
      const authHeader = request.headers.get('Authorization');
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        // Redirect to OAuth if no auth header
        const url = new URL(request.url);
        return new Response(null, {
          status: 302,
          headers: {
            'Location': `${url.origin}/authorize`
          }
        });
      }
      
      const token = authHeader.substring(7);
      const tokenData = await this.oauthHandler.verifyToken(token);
      if (!tokenData) {
        return new Response('Authentication required', { status: 401 });
      }
      
      return this.handleSSEConnection(request);
    }

    if (request.method === 'POST') {
      return this.handleMCPRequest(request);
    }

    return new Response('Method not allowed', { status: 405 });
  }

  private async handleSSEConnection(request: Request): Promise<Response> {
    console.log('=== SSE Connection Request ===');
    console.log('URL:', request.url);
    console.log('Headers:', Object.fromEntries(request.headers.entries()));

    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();

    // Send initial SSE headers
    const headers = new Headers({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept, X-Flodesk-API-Key',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    });

    // Start the SSE connection
    (async () => {
      try {
        console.log('Starting SSE connection...');
        
        // Send initial connection message
        await writer.write(encoder.encode('data: {"jsonrpc":"2.0","method":"notifications/initialized","params":{}}\\n\\n'));
        
        // Send server capabilities
        await writer.write(encoder.encode(`data: {"jsonrpc":"2.0","method":"notifications/message","params":{"level":"info","message":"Connected to Flodesk MCP Server"}}\\n\\n`));
        
        // Keep connection alive with periodic pings
        const interval = setInterval(async () => {
          try {
            await writer.write(encoder.encode('data: {"type":"ping"}\\n\\n'));
          } catch (error) {
            console.error('SSE ping error:', error);
            clearInterval(interval);
          }
        }, 30000);

        console.log('SSE connection established successfully');
        
      } catch (error) {
        console.error('SSE connection error:', error);
        await writer.close();
      }
    })();

    return new Response(readable, { headers });
  }

  private async handleMCPRequest(request: Request): Promise<Response> {
    try {
      const requestBody = await request.text();
      console.log(`Raw request body: ${requestBody}`);
      
      let mcpRequest: MCPRequest;
      try {
        mcpRequest = JSON.parse(requestBody);
      } catch (parseError) {
        console.error('JSON parse error:', parseError);
        return new Response(JSON.stringify({
          jsonrpc: '2.0',
          id: null,
          error: { code: -32700, message: 'Parse error' }
        }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      
      console.log(`=== MCP Request ===`);
      console.log(`Method: ${mcpRequest.method}`);
      console.log(`ID: ${mcpRequest.id}`);
      console.log(`JSONRPC: ${mcpRequest.jsonrpc}`);
      console.log(`Headers:`, Object.fromEntries(request.headers.entries()));
      
      // Handle initialization without auth - ALWAYS allow this
      if (mcpRequest.method === 'initialize') {
        console.log('Handling initialize method without authentication');
        return this.handleInitialize(mcpRequest, request);
      }

      // Check authentication for other methods
      let userContext: any = null;
      
      // If we have userProps from the official OAuth flow, use them
      if (this.userProps) {
        userContext = {
          userId: this.userProps.userLogin,
          username: this.userProps.userName,
          permissions: ['flodesk:read', 'flodesk:write'],
          userProps: this.userProps
        };
        console.log(`Using provided user context: ${this.userProps.userLogin}`);
      } else {
        // Fall back to token-based authentication
        const authHeader = request.headers.get('Authorization');
        const userAgent = request.headers.get('User-Agent') || '';
        console.log(`Auth header: ${authHeader}`);
        console.log(`User-Agent: ${userAgent}`);
        
        // Require authentication for all requests except initialize
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
          console.log('No valid Authorization header found');
          return this.createErrorResponse('Authentication required', -32001, mcpRequest.id);
        }
        
        const token = authHeader.substring(7);
        console.log(`Token: ${token.substring(0, 10)}...`);
        
        const tokenData = await this.oauthHandler.verifyToken(token);
        console.log(`Token verification result:`, tokenData ? 'valid' : 'invalid');
        
        if (!tokenData) {
          return this.createErrorResponse('Invalid or expired token', -32002, mcpRequest.id);
        }
        
        // Store user context for tool calls
        userContext = {
          userId: tokenData.userId || tokenData.githubId,
          username: tokenData.username,
          permissions: ['flodesk:read', 'flodesk:write'], // All authenticated users get full access
          tokenData
        };
      }
      
      if (mcpRequest.jsonrpc !== '2.0') {
        return this.createErrorResponse('Invalid JSON-RPC version', -32600, mcpRequest.id);
      }

      // Handle notifications (no response expected - these don't have an id field)
      if (mcpRequest.id === undefined || mcpRequest.id === null) {
        console.log(`Handling notification: ${mcpRequest.method}`);
        return new Response('', { status: 204 }); // No Content
      }

      let result: any;

      switch (mcpRequest.method) {
        case 'tools/list':
          result = await this.listTools();
          break;
        case 'tools/call':
          result = await this.callTool(mcpRequest.params, userContext);
          break;
        case 'ping':
          result = {};
          break;
        default:
          console.log(`Unknown method: ${mcpRequest.method}`);
          return this.createErrorResponse('Method not found', -32601, mcpRequest.id);
      }

      return this.createSuccessResponse(result, mcpRequest.id);
    } catch (error) {
      console.error('MCP request error:', error);
      return this.createErrorResponse(
        error instanceof Error ? error.message : 'Internal error',
        -32603
      );
    }
  }

  private async handleInitialize(mcpRequest: MCPRequest, request?: Request): Promise<Response> {
    // Get the origin from the request if available, otherwise use localhost
    const origin = request ? new URL(request.url).origin : 'http://localhost:8787';
    
    const result = {
      protocolVersion: '2024-11-05',
      capabilities: {
        tools: {},
        oauth: {
          authUrl: `${origin}/authorize`
        }
      },
      serverInfo: {
        name: 'Flodesk Remote MCP Server',
        version: '1.0.0'
      }
    };

    return this.createSuccessResponse(result, mcpRequest.id);
  }

  private async listTools(): Promise<{ tools: MCPTool[] }> {
    const tools: MCPTool[] = [
      {
        name: 'add_subscriber',
        description: '✉️ Add a new subscriber to Flodesk with optional first name, last name, and segment assignments',
        inputSchema: {
          type: 'object',
          properties: {
            email: { type: 'string', description: 'Email address of the subscriber' },
            first_name: { type: 'string', description: 'First name of the subscriber' },
            last_name: { type: 'string', description: 'Last name of the subscriber' },
            segment_ids: {
              type: 'array',
              items: { type: 'string' },
              description: 'Array of segment IDs to add the subscriber to'
            }
          },
          required: ['email']
        }
      },
      {
        name: 'get_subscriber',
        description: '🔍 Retrieve detailed information for a specific subscriber by email',
        inputSchema: {
          type: 'object',
          properties: {
            email: { type: 'string', description: 'Email address of the subscriber to retrieve' }
          },
          required: ['email']
        }
      },
      {
        name: 'search_subscribers',
        description: '🔎 Search for subscribers using a text query with pagination support',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query to find subscribers' },
            limit: { type: 'number', description: 'Maximum number of results to return (1-100, default: 10)' }
          },
          required: ['query']
        }
      },
      {
        name: 'list_segments',
        description: '📋 Get a complete list of all segments in the Flodesk account',
        inputSchema: {
          type: 'object',
          properties: {},
          required: []
        }
      },
      {
        name: 'create_segment',
        description: '🆕 Create a new segment with an optional color',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Name of the new segment' },
            color: { type: 'string', description: 'Hex color code for the segment (e.g., #FF5733)' }
          },
          required: ['name']
        }
      },
      {
        name: 'add_to_segment',
        description: '➕ Add an existing subscriber to a specific segment',
        inputSchema: {
          type: 'object',
          properties: {
            email: { type: 'string', description: 'Email address of the subscriber' },
            segment_id: { type: 'string', description: 'ID of the segment to add the subscriber to' }
          },
          required: ['email', 'segment_id']
        }
      },
      {
        name: 'remove_from_segment',
        description: '➖ Remove a subscriber from a specific segment',
        inputSchema: {
          type: 'object',
          properties: {
            email: { type: 'string', description: 'Email address of the subscriber' },
            segment_id: { type: 'string', description: 'ID of the segment to remove the subscriber from' }
          },
          required: ['email', 'segment_id']
        }
      }
    ];

    return { tools };
  }

  private async callTool(params: any, userContext?: any): Promise<any> {
    const { name, arguments: args } = params;

    try {
      // Log user context for debugging
      if (userContext) {
        console.log('Tool called with user context:', userContext);
      }

      switch (name) {
        case 'add_subscriber':
          return await this.addSubscriber(args);
        case 'get_subscriber':
          return await this.getSubscriber(args);
        case 'search_subscribers':
          return await this.searchSubscribers(args);
        case 'list_segments':
          return await this.listSegments();
        case 'create_segment':
          return await this.createSegment(args);
        case 'add_to_segment':
          return await this.addToSegment(args);
        case 'remove_from_segment':
          return await this.removeFromSegment(args);
        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return {
        content: [
          {
            type: 'text',
            text: `❌ **Error**: ${message}`
          }
        ]
      };
    }
  }

  private async addSubscriber(args: any) {
    const validation = addSubscriberSchema.safeParse(args);
    if (!validation.success) {
      throw new Error(`Validation error: ${validation.error.errors.map(e => e.message).join(', ')}`);
    }

    const { email, first_name, last_name, segment_ids } = validation.data;
    const subscriber = await this.flodeskAPI.addSubscriber(email, first_name, last_name, segment_ids);

    const segmentText = segment_ids && segment_ids.length > 0 
      ? ` and added to ${segment_ids.length} segment(s)`
      : '';

    return {
      content: [
        {
          type: 'text',
          text: `✅ **Successfully added subscriber!**

📧 **Email**: ${subscriber.email}
👤 **Name**: ${[subscriber.first_name, subscriber.last_name].filter(Boolean).join(' ') || 'Not provided'}
📅 **Created**: ${new Date(subscriber.created_at).toLocaleString()}
📊 **Status**: ${subscriber.status}${segmentText}

**Subscriber ID**: \`${subscriber.id}\``
        }
      ]
    };
  }

  private async getSubscriber(args: any) {
    const validation = getSubscriberSchema.safeParse(args);
    if (!validation.success) {
      throw new Error(`Validation error: ${validation.error.errors.map(e => e.message).join(', ')}`);
    }

    const { email } = validation.data;
    const subscriber = await this.flodeskAPI.getSubscriber(email);

    const segmentList = subscriber.segments.length > 0
      ? subscriber.segments.map(s => `• ${s.name} (${s.id})`).join('\\n')
      : 'No segments';

    return {
      content: [
        {
          type: 'text',
          text: `👤 **Subscriber Details**

📧 **Email**: ${subscriber.email}
👤 **Name**: ${[subscriber.first_name, subscriber.last_name].filter(Boolean).join(' ') || 'Not provided'}
📊 **Status**: ${subscriber.status}
📅 **Created**: ${new Date(subscriber.created_at).toLocaleString()}
🔄 **Updated**: ${new Date(subscriber.updated_at).toLocaleString()}

**📋 Segments**:
${segmentList}

**Subscriber ID**: \`${subscriber.id}\``
        }
      ]
    };
  }

  private async searchSubscribers(args: any) {
    const validation = searchSubscribersSchema.safeParse(args);
    if (!validation.success) {
      throw new Error(`Validation error: ${validation.error.errors.map(e => e.message).join(', ')}`);
    }

    const { query, limit } = validation.data;
    const subscribers = await this.flodeskAPI.searchSubscribers(query, limit);

    if (subscribers.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: `🔍 **Search Results**

No subscribers found matching query: "${query}"`
          }
        ]
      };
    }

    const subscriberList = subscribers.map(s => {
      const name = [s.first_name, s.last_name].filter(Boolean).join(' ') || 'No name';
      const segmentCount = s.segments.length;
      return `• **${s.email}** (${name}) - ${segmentCount} segment(s)`;
    }).join('\\n');

    return {
      content: [
        {
          type: 'text',
          text: `🔍 **Search Results**

**Query**: "${query}"
**Found**: ${subscribers.length} subscriber(s)

${subscriberList}`
        }
      ]
    };
  }

  private async listSegments() {
    // Test connection fresh each time instead of relying on cached result
    console.log('Testing Flodesk connection for list_segments...');
    const isConnected = await this.flodeskAPI.testConnection();
    console.log(`Fresh connection test result: ${isConnected}`);
    
    if (!isConnected) {
      return {
        content: [
          {
            type: 'text',
            text: `⚠️ **Flodesk API Connection Issue**\n\nThe Flodesk API key appears to be invalid or expired. Please check your API key configuration.\n\n**Showing Mock Data for Testing:**\n\n• **Newsletter Subscribers** #3498db - 150 subscriber(s)\n  ID: \`segment_123\`\n\n• **VIP Customers** #e74c3c - 45 subscriber(s)\n  ID: \`segment_456\`\n\n**To fix this:** Update your Flodesk API key in the server configuration.`
          }
        ]
      };
    }

    try {
      const segments = await this.flodeskAPI.listSegments();

      if (segments.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: '📋 **Segments**\n\nNo segments found in your Flodesk account.'
            }
          ]
        };
      }

      const segmentList = segments.map(s => {
        const color = s.color ? ` ${s.color}` : '';
        return `• **${s.name}**${color} - ${s.subscriber_count} subscriber(s)\n  ID: \`${s.id}\``;
      }).join('\n\n');

      return {
        content: [
          {
            type: 'text',
            text: `📋 **Segments** (${segments.length} total)\n\n${segmentList}`
          }
        ]
      };
    } catch (error) {
      console.error('Flodesk API error:', error);
      return {
        content: [
          {
            type: 'text',
            text: `❌ **Flodesk API Error**\n\n${error instanceof Error ? error.message : 'Unknown error occurred'}\n\nPlease check your API key and try again.`
          }
        ]
      };
    }
  }

  private async createSegment(args: any) {
    const validation = createSegmentSchema.safeParse(args);
    if (!validation.success) {
      throw new Error(`Validation error: ${validation.error.errors.map(e => e.message).join(', ')}`);
    }

    const { name, color } = validation.data;
    const segment = await this.flodeskAPI.createSegment(name, color);

    const colorText = segment.color ? ` with color ${segment.color}` : '';

    return {
      content: [
        {
          type: 'text',
          text: `✅ **Successfully created segment!**

🏷️ **Name**: ${segment.name}${colorText}
📅 **Created**: ${new Date(segment.created_at).toLocaleString()}
👥 **Subscribers**: ${segment.subscriber_count}

**Segment ID**: \`${segment.id}\``
        }
      ]
    };
  }

  private async addToSegment(args: any) {
    const validation = segmentActionSchema.safeParse(args);
    if (!validation.success) {
      throw new Error(`Validation error: ${validation.error.errors.map(e => e.message).join(', ')}`);
    }

    const { email, segment_id } = validation.data;
    
    // Verify subscriber and segment exist
    await this.flodeskAPI.getSubscriber(email);
    const segment = await this.flodeskAPI.getSegment(segment_id);
    
    await this.flodeskAPI.addToSegment(email, segment_id);

    return {
      content: [
        {
          type: 'text',
          text: `✅ **Successfully added subscriber to segment!**

📧 **Subscriber**: ${email}
🏷️ **Segment**: ${segment.name}
👥 **New member count**: ${segment.subscriber_count + 1}`
        }
      ]
    };
  }

  private async removeFromSegment(args: any) {
    const validation = segmentActionSchema.safeParse(args);
    if (!validation.success) {
      throw new Error(`Validation error: ${validation.error.errors.map(e => e.message).join(', ')}`);
    }

    const { email, segment_id } = validation.data;
    
    // Verify subscriber and segment exist
    await this.flodeskAPI.getSubscriber(email);
    const segment = await this.flodeskAPI.getSegment(segment_id);
    
    await this.flodeskAPI.removeFromSegment(email, segment_id);

    return {
      content: [
        {
          type: 'text',
          text: `✅ **Successfully removed subscriber from segment!**

📧 **Subscriber**: ${email}
🏷️ **Segment**: ${segment.name}
👥 **New member count**: ${Math.max(0, segment.subscriber_count - 1)}`
        }
      ]
    };
  }

  private createSuccessResponse(result: any, id: number | string): Response {
    const response: MCPResponse = {
      jsonrpc: '2.0',
      id,
      result
    };

    return new Response(JSON.stringify(response), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  private createErrorResponse(message: string, code: number, id?: number | string): Response {
    const response: MCPResponse = {
      jsonrpc: '2.0',
      id: id || null,
      error: {
        code,
        message
      }
    };

    return new Response(JSON.stringify(response), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}