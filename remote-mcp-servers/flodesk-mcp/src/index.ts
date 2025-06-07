import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const FLODESK_API_BASE = "https://api.flodesk.com/v1";

export class FlodeskMCP extends McpAgent {
  server = new McpServer({
    name: "Flodesk MCP Server",
    version: "1.0.0",
  });

  public env: any = null;

  private getApiKey(): string {
    const apiKey = this.env?.FLODESK_API_KEY;
    
    if (!apiKey) {
      throw new Error("Flodesk API key is required. Please set FLODESK_API_KEY environment variable in your Worker configuration or .dev.vars file.");
    }
    
    return apiKey;
  }

  async init() {
    // Add Subscriber Tool
    this.server.tool(
      "add_subscriber",
      {
  email: z.string().email("Invalid email format"),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  segment_ids: z.array(z.string()).optional(),
      },
      async ({ email, first_name, last_name, segment_ids }) => {
        try {
          const apiKey = this.getApiKey();
          const subscriber = {
            email,
            ...(first_name && { first_name }),
            ...(last_name && { last_name }),
            ...(segment_ids && { segment_ids }),
          };

          const result = await this.makeFlodeskRequest("/subscribers", apiKey, "POST", subscriber);
          return {
            content: [
              {
                type: "text",
                text: `✅ Successfully added subscriber:
📧 Email: ${result.email}
👤 Name: ${result.first_name || "N/A"} ${result.last_name || ""}
📊 Status: ${result.status}
🆔 ID: ${result.id}
📅 Created: ${result.created_at}`,
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `❌ Error adding subscriber: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
          };
        }
      }
    );

    // Get Subscriber Tool
    this.server.tool(
      "get_subscriber",
      {
        email: z.string().email("Invalid email format"),
      },
      async ({ email }) => {
        try {
          const apiKey = this.getApiKey();
          const response = await this.makeFlodeskRequest(
            `/subscribers?email=${encodeURIComponent(email)}`,
            apiKey
          );
          const subscriber = response.data?.[0];

          if (!subscriber) {
            return {
              content: [
                {
                  type: "text",
                  text: `❌ No subscriber found with email: ${email}`,
                },
              ],
            };
          }

          return {
            content: [
              {
                type: "text",
                text: `📋 Subscriber Details:
📧 Email: ${subscriber.email}
👤 Name: ${subscriber.first_name || "N/A"} ${subscriber.last_name || ""}
📊 Status: ${subscriber.status}
🆔 ID: ${subscriber.id}
🏷️ Segments: ${subscriber.segment_ids?.length || 0}
📅 Created: ${subscriber.created_at}
🔄 Updated: ${subscriber.updated_at}`,
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `❌ Error retrieving subscriber: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
          };
        }
      }
    );

    // Search Subscribers Tool
    this.server.tool(
      "search_subscribers",
      {
        query: z.string().min(1, "Search query is required"),
        limit: z.number().min(1).max(100).optional().default(10),
      },
      async ({ query, limit = 10 }) => {
        try {
          const apiKey = this.getApiKey();
          const searchParams = new URLSearchParams({
            search: query,
            limit: limit.toString(),
          });
          const result = await this.makeFlodeskRequest(
            `/subscribers?${searchParams.toString()}`,
            apiKey
          );

          if (!result.data || result.data.length === 0) {
            return {
              content: [
                {
                  type: "text",
                  text: `🔍 No subscribers found matching query: "${query}"`,
                },
              ],
            };
          }

          const subscriberList = result.data
            .map(
              (sub: any) =>
                `• ${sub.email} (${sub.first_name || "N/A"} ${sub.last_name || ""}) - ${sub.status}`
            )
            .join("\n");

          return {
            content: [
              {
                type: "text",
                text: `🔍 Found ${result.data.length} subscriber(s) matching "${query}":

${subscriberList}`,
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `❌ Error searching subscribers: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
          };
        }
      }
    );

    // Add to Segment Tool
    this.server.tool(
      "add_to_segment",
      {
        email: z.string().email("Invalid email format"),
        segment_id: z.string().min(1, "Segment ID is required"),
      },
      async ({ email, segment_id }) => {
        try {
          const apiKey = this.getApiKey();
          // Get subscriber first
          const response = await this.makeFlodeskRequest(
            `/subscribers?email=${encodeURIComponent(email)}`,
            apiKey
          );
          const subscriber = response.data?.[0];

          if (!subscriber) {
            return {
              content: [
                {
                  type: "text",
                  text: `❌ Subscriber with email ${email} not found`,
                },
              ],
            };
          }

          const currentSegmentIds = subscriber.segment_ids || [];
          if (currentSegmentIds.includes(segment_id)) {
            return {
              content: [
                {
                  type: "text",
                  text: `⚠️ Subscriber ${email} is already in segment ${segment_id}`,
                },
              ],
            };
          }

          const updatedSegmentIds = [...currentSegmentIds, segment_id];
          await this.makeFlodeskRequest(
            `/subscribers/${subscriber.id}`,
            apiKey,
            "PATCH",
            { segment_ids: updatedSegmentIds }
          );

          return {
            content: [
              {
                type: "text",
                text: `✅ Successfully added ${email} to segment ${segment_id}
🏷️ Total segments: ${updatedSegmentIds.length}`,
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `❌ Error adding to segment: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
          };
        }
      }
    );

    // Remove from Segment Tool
    this.server.tool(
      "remove_from_segment",
      {
  email: z.string().email("Invalid email format"),
  segment_id: z.string().min(1, "Segment ID is required"),
      },
      async ({ email, segment_id }) => {
        try {
          const apiKey = this.getApiKey();
          // Get subscriber first
          const response = await this.makeFlodeskRequest(
            `/subscribers?email=${encodeURIComponent(email)}`,
            apiKey
          );
          const subscriber = response.data?.[0];

          if (!subscriber) {
            return {
              content: [
                {
                  type: "text",
                  text: `❌ Subscriber with email ${email} not found`,
                },
              ],
            };
          }

          const currentSegmentIds = subscriber.segment_ids || [];
          if (!currentSegmentIds.includes(segment_id)) {
            return {
              content: [
                {
                  type: "text",
                  text: `⚠️ Subscriber ${email} is not in segment ${segment_id}`,
                },
              ],
            };
          }

          const updatedSegmentIds = currentSegmentIds.filter((id: string) => id !== segment_id);
          await this.makeFlodeskRequest(
            `/subscribers/${subscriber.id}`,
            apiKey,
            "PATCH",
            { segment_ids: updatedSegmentIds }
          );

          return {
            content: [
              {
                type: "text",
                text: `✅ Successfully removed ${email} from segment ${segment_id}
🏷️ Remaining segments: ${updatedSegmentIds.length}`,
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `❌ Error removing from segment: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
          };
        }
      }
    );

    // List Segments Tool
    this.server.tool(
      "list_segments",
      {},
      async () => {
        try {
          const apiKey = this.getApiKey();
          const result = await this.makeFlodeskRequest("/segments", apiKey);

          if (!result.data || result.data.length === 0) {
            return {
              content: [
                {
                  type: "text",
                  text: "📋 No segments found in your Flodesk account.",
                },
              ],
            };
          }

          const segmentList = result.data
            .map(
              (segment: any) =>
                `• ${segment.name} (ID: ${segment.id})${segment.color ? ` - ${segment.color}` : ""}`
            )
            .join("\n");

          return {
            content: [
              {
                type: "text",
                text: `📋 Available segments (${result.data.length}):

${segmentList}`,
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `❌ Error listing segments: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
          };
        }
      }
    );

    // Create Segment Tool
    this.server.tool(
      "create_segment",
      {
  name: z.string().min(1, "Segment name is required"),
  color: z.string().optional(),
      },
      async ({ name, color }) => {
        try {
          const apiKey = this.getApiKey();
          const segment = {
            name,
            ...(color && { color }),
          };

          const result = await this.makeFlodeskRequest("/segments", apiKey, "POST", segment);
          return {
            content: [
              {
                type: "text",
                text: `✅ Successfully created segment:
🏷️ Name: ${result.name}
🆔 ID: ${result.id}
🎨 Color: ${result.color || "Default"}
📅 Created: ${result.created_at}`,
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `❌ Error creating segment: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
          };
        }
      }
    );
  }

  private async makeFlodeskRequest(
    endpoint: string,
    apiKey: string,
    method = "GET",
    body: any = null
  ): Promise<any> {
    const url = `${FLODESK_API_BASE}${endpoint}`;
    const auth = btoa(`${apiKey}:`);
    const headers = {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
      "User-Agent": "Flodesk MCP Server (github.com/honeycomb)",
    };

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Flodesk API error: ${response.status} ${errorText}`);
    }

    return response.json();
  }
}

let mcpInstance: FlodeskMCP | null = null;

export default {
  fetch(request: Request, env: any, ctx: ExecutionContext) {
    const url = new URL(request.url);

    // Set environment on the class for access in tools
    if (!mcpInstance) {
      mcpInstance = new FlodeskMCP();
    }
    mcpInstance.env = env;

    if (url.pathname === "/sse" || url.pathname === "/sse/message") {
      return FlodeskMCP.serveSSE("/sse").fetch(request, env, ctx);
      }

    if (url.pathname === "/mcp") {
      return FlodeskMCP.serve("/mcp").fetch(request, env, ctx);
    }
    
    return new Response("Not found", { status: 404 });
  },
};
