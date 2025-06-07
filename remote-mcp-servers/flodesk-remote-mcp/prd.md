# PRD: Flodesk Remote MCP Server

## 1. Product overview
### 1.1 Document title and version
- PRD: Flodesk Remote MCP Server
- Version: 1.0

### 1.2 Product summary
This document outlines the requirements for a remote Model Context Protocol (MCP) server designed to interact with the Flodesk API. The server will be deployed on Cloudflare Workers, providing a secure, scalable, and standardized interface for managing Flodesk resources.

The primary function of this server is to expose a set of tools for managing subscribers and segments within a Flodesk account. These tools will enable AI agents and developers to perform common operations programmatically, such as adding new subscribers, searching for existing ones, and organizing them into segments. The server will adhere to the MCP specification, handle authentication via OAuth, and provide rich, user-friendly responses to enhance the developer experience.

## 2. Goals
### 2.1 Business goals
- Streamline integrations with Flodesk by providing a standardized API.
- Increase developer productivity by abstracting away the complexities of the native Flodesk API.
- Enable the creation of new automated workflows and AI-powered features that leverage Flodesk data.
- Ensure all interactions with Flodesk are secure and authenticated.

### 2.2 User goals
- To have a simple and reliable way to manage Flodesk subscribers and segments programmatically.
- To receive clear, informative feedback and error messages when using the tools.
- To easily integrate Flodesk management into existing scripts, applications, or AI agents.
- To connect to the service securely without exposing raw Flodesk API keys on the client side.

### 2.3 Non-goals
- This project will not provide a graphical user interface (GUI) for managing Flodesk.
- Management of Flodesk billing, account settings, or other non-subscriber/segment resources is out of scope.
- The server will not support any email marketing platform other than Flodesk.
- The server will not store any user data from Flodesk; it will act as a pass-through proxy.

## 3. User personas
### 3.1 Key user types
- AI Agent
- Developer

### 3.2 Basic persona details
- **AI Agent**: An automated system or large language model that needs to perform Flodesk operations on behalf of a user in a conversational or automated context.
- **Developer**: A software engineer building custom integrations, scripts, or applications that need to interact with Flodesk data.

### 3.3 Role-based access
- **Authenticated User**: Can connect to the MCP server, and access the full suite of tools for managing subscribers and segments after a successful OAuth authentication flow.

## 4. Functional requirements
- **Authentication** (Priority: Critical)
  - The server must protect its endpoints and require users to authenticate via an OAuth 2.0 flow before granting access to any tools.
- **`add_subscriber`** (Priority: High)
  - Allows adding a new subscriber to Flodesk.
  - Requires `email` and accepts optional `first_name`, `last_name`, and `segment_ids[]`.
  - Must perform email format validation and check for duplicate subscribers.
- **`get_subscriber`** (Priority: High)
  - Allows retrieving detailed information for a single subscriber.
  - Requires `email`.
- **`search_subscribers`** (Priority: Medium)
  - Allows searching for subscribers using a text query.
  - Requires `query` and accepts an optional `limit` for pagination (default 10, max 100).
- **`list_segments`** (Priority: High)
  - Allows retrieving a list of all segments in the Flodesk account.
  - Takes no inputs.
- **`create_segment`** (Priority: Medium)
  - Allows creating a new segment.
  - Requires `name` and accepts an optional `color`.
  - Must check for duplicate segment names.
- **`add_to_segment`** (Priority: High)
  - Allows adding an existing subscriber to a specific segment.
  - Requires `email` and `segment_id`.
  - Must validate that both the subscriber and segment exist.
- **`remove_from_segment`** (Priority: High)
  - Allows removing a subscriber from a specific segment.
  - Requires `email` and `segment_id`.

## 5. User experience
### 5.1. Entry points & first-time user flow
- A user (developer or AI agent) receives the URL for the remote MCP server.
- The user configures their MCP client (e.g., MCP Inspector, Claude Desktop with `mcp-remote` proxy) to connect to the server's `/sse` endpoint.
- Upon connection, the user is redirected to an OAuth provider (e.g., GitHub) to authorize the application.
- After successful authentication, the user is redirected back to their client and can now list and call the available tools.

### 5.2. Core experience
- **Tool Discovery**: The user lists the available tools and sees the 7 Flodesk management tools with their descriptions.
- **Tool Execution**: The user calls a tool (e.g., `add_subscriber`) with the required parameters. The server validates the inputs using Zod schemas.
- **Response Handling**: The server executes the request against the Flodesk API and returns a richly formatted, emoji-enhanced response indicating success or failure.
  - Success responses are clear and confirm the action taken (e.g., `✅ Successfully added subscriber...`).
  - Error responses are specific, indicating what went wrong (e.g., validation error, API error, resource not found).

### 5.3. Advanced features & edge cases
- **Pagination**: The `search_subscribers` tool provides paginated results to handle large datasets efficiently.
- **Duplicate Handling**: The server prevents the creation of duplicate subscribers or segments, providing clear errors.
- **Invalid IDs**: Calling tools with non-existent `segment_id` or subscriber `email` results in a "Not Found" error.
- **Rate Limiting**: The server should gracefully handle and pass through any rate-limiting errors from the Flodesk API.

### 5.4. UI/UX highlights
- **Rich Formatting**: Responses are formatted with Markdown and emojis for enhanced readability and quick comprehension within MCP clients.
- **Clear Error Messaging**: Field-level validation errors and contextual API errors help users quickly diagnose and fix issues with their tool calls.

## 6. Narrative
Alex is a developer tasked with creating an automated workflow that adds new customers from their company's CRM to a "New Customers" welcome sequence in Flodesk. Instead of writing custom integration code from scratch, Alex uses this tool. He connects his scripting environment to the secure MCP server endpoint, goes through a one-time login, and can immediately use the `add_subscriber` and `add_to_segment` tools. The rich, formatted responses in his terminal make it easy to see that each customer is being added correctly, saving him hours of development and debugging time.

## 7. Success metrics
### 7.1. User-centric metrics
- Number of active users/integrations connecting to the server.
- High ratio of successful tool calls to errors.
- Qualitative feedback on the ease of use and quality of responses.

### 7.2. Business metrics
- Time and cost saved on developing Flodesk integrations.
- Number of new automated workflows enabled by the server.

### 7.3. Technical metrics
- Server uptime and availability (target >99.9%).
- Low median and p95 response times for all tool calls.
- A low rate of validation or API-related errors.

## 8. Technical considerations
### 8.1. Integration points
- **Flodesk API**: The server will make authenticated calls to the official Flodesk API.
- **OAuth Provider**: An external OAuth 2.0 provider (e.g., GitHub, Google) will be used for user authentication.
- **MCP Clients**: The server must be compatible with clients supporting the MCP specification, such as the MCP Inspector or clients using the `mcp-remote` proxy.

### 8.2. Data storage & privacy
- The server is stateless and does not store any Flodesk subscriber or segment data. It acts as a secure proxy.
- Flodesk API keys and OAuth client secrets must be stored securely as encrypted secrets in the Cloudflare Workers environment and never exposed to the client.

### 8.3. Scalability & performance
- The server will be deployed on Cloudflare's serverless platform (Workers), which scales automatically with demand.
- Input validation using Zod is performed at the edge for fast rejection of invalid requests.

### 8.4. Potential challenges
- Handling breaking changes or deprecations in the Flodesk API.
- Managing Flodesk API rate limits effectively to prevent service disruptions.
- Ensuring the implementation stays compliant with evolving versions of the MCP specification.

## 10. User stories
### 10.1. Securely connect to the server
- **ID**: US-001
- **Description**: As a developer, I want to authenticate with the MCP server using OAuth so that I can securely access the Flodesk tools.
- **Acceptance criteria**:
  - When I connect an MCP client to the server endpoint, I am prompted to log in via a third-party OAuth provider.
  - After successful authentication, my client is granted an access token.
  - My client can use this token to make authenticated requests to the server.
  - Unauthorized requests without a valid token are rejected with an authentication error.

### 10.2. Discover available tools
- **ID**: US-002
- **Description**: As a developer, I want to list all available tools so that I know what operations I can perform.
- **Acceptance criteria**:
  - Given I am authenticated.
  - When I call the `tools/list` method.
  - Then the server returns a list of all 7 available tools for Flodesk management.
  - Each tool in the list includes its name and a clear description of its purpose.

### 10.3. Add a new subscriber
- **ID**: US-003
- **Description**: As a developer, I want to add a new subscriber to Flodesk so that I can grow a mailing list.
- **Acceptance criteria**:
  - Given I call the `add_subscriber` tool with a valid `email` and optional `first_name`, `last_name`, and `segment_ids`.
  - Then a new subscriber is created in Flodesk with the provided details.
  - And a success message is returned containing the new subscriber's profile information.
  - Given the `email` format is invalid, a validation error is returned.
  - Given the `email` already exists in Flodesk, an error is returned indicating a duplicate.

### 10.4. Retrieve a subscriber's details
- **ID**: US-004
- **Description**: As a developer, I want to retrieve the full details of a specific subscriber so that I can check their status and segment memberships.
- **Acceptance criteria**:
  - Given I call `get_subscriber` with the `email` of an existing subscriber.
  - Then the server returns a formatted profile with their complete information.
  - Given I call `get_subscriber` with an `email` that does not exist.
  - Then a "Not Found" error is returned.

### 10.5. Search for subscribers
- **ID**: US-005
- **Description**: As a developer, I want to search for subscribers using a query so that I can find specific users without knowing their exact email.
- **Acceptance criteria**:
  - Given I call `search_subscribers` with a `query`.
  - Then the server returns a paginated list of subscriber summaries matching the query.
  - Given I provide a `limit` parameter, the number of results per page is adjusted accordingly.
  - If no subscribers match the query, an empty list is returned.

### 10.6. List all segments
- **ID**: US-006
- **Description**: As a developer, I want to list all available segments so that I can see how subscribers are organized.
- **Acceptance criteria**:
  - Given I call the `list_segments` tool.
  - Then the server returns a complete, formatted list of all segments, including their names, IDs, and colors.

### 10.7. Create a new segment
- **ID**: US-007
- **Description**: As a developer, I want to create a new segment so that I can organize subscribers into new groups.
- **Acceptance criteria**:
  - Given I call `create_segment` with a unique `name` and an optional `color`.
  - Then a new segment is created in Flodesk.
  - And a success message is returned with the new segment's details.
  - Given the `name` already exists, an error is returned indicating a duplicate.
  - Given the `color` is not a valid hex code, a validation error is returned.

### 10.8. Add a subscriber to a segment
- **ID**: US-008
- **Description**: As a developer, I want to add a subscriber to a segment so that I can organize my audience.
- **Acceptance criteria**:
  - Given I call `add_to_segment` with a valid `email` and `segment_id`.
  - Then the specified subscriber is added to the specified segment.
  - And a confirmation message is returned, including the updated member count for the segment.
  - Given the `email` or `segment_id` does not exist, a "Not Found" error is returned.
  - Given the subscriber is already in the segment, the server returns a success message indicating no action was needed.

### 10.9. Remove a subscriber from a segment
- **ID**: US-009
- **Description**: As a developer, I want to remove a subscriber from a segment so that I can refine my audience lists.
- **Acceptance criteria**:
  - Given I call `remove_from_segment` with a valid `email` and `segment_id`.
  - Then the specified subscriber is removed from the specified segment.
  - And a confirmation message is returned.
  - Given the `email` or `segment_id` does not exist, a "Not Found" error is returned.
  - Given the subscriber is not in the segment, the server returns a success message indicating no action was needed.

### 10.10. Handle errors gracefully
- **ID**: US-010
- **Description**: As a developer, I want to receive clear and helpful error messages so that I can easily debug my requests.
- **Acceptance criteria**:
  - Given my request has a missing or invalid parameter (e.g., malformed email).
  - Then the server returns a `400 Bad Request` status with a detailed validation error message pointing to the specific field.
  - Given my request references a resource that doesn't exist (e.g., unknown subscriber).
  - Then the server returns a `404 Not Found` error.
  - Given the Flodesk API is down or returns an unexpected error.
  - Then the server returns a `500 Internal Server Error` with a contextual message. 