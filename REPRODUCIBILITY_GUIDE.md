# Comprehensive Guide to Deploying the Flodesk Remote MCP Server

This document provides a detailed, step-by-step guide to configure, deploy, and verify the Flodesk Remote MCP Server on Cloudflare Workers. It is based on a real-world debugging and deployment process and includes key architectural concepts and troubleshooting advice to avoid common pitfalls.

## Table of Contents
1.  [Prerequisites](#1-prerequisites)
2.  [Initial Project Setup](#2-initial-project-setup)
3.  [Google OAuth Configuration](#3-google-oauth-configuration)
4.  [Environment Configuration](#4-environment-configuration)
5.  [Deployment to Cloudflare](#5-deployment-to-cloudflare)
6.  [Registering an OAuth Client](#6-registering-an-oauth-client)
7.  [Verification with MCP Inspector](#7-verification-with-mcp-inspector)
8.  [Key Architectural Concepts](#8-key-architectural-concepts)
9.  [Troubleshooting and Best Practices](#9-troubleshooting-and-best-practices)

---

## 1. Prerequisites

Before you begin, ensure you have the following accounts and tools:

-   **Cloudflare Account**: To deploy Workers, use KV namespaces, and use Durable Objects.
-   **Google Cloud Account**: To create OAuth 2.0 credentials for user authentication.
-   **Flodesk Account**: To obtain an API key for interacting with the Flodesk service.
-   **Node.js and npm**: A current LTS version of Node.js is recommended.
-   **Wrangler CLI**: The command-line tool for managing Cloudflare Workers. Install with `npm install -g wrangler`.
-   **MCP Inspector**: A local tool for testing and debugging MCP servers. Run it on-demand with `npx @modelcontextprotocol/inspector@latest`.

---

## 2. Initial Project Setup

1.  **Clone the Repository**:
    ```bash
    git clone <your-repository-url>
    cd flodesk-remote-mcp
    ```

2.  **Install Dependencies**:
    ```bash
    npm install
    ```

---

## 3. Google OAuth Configuration

This server uses Google for user authentication. You must register it as an OAuth application in the Google API Console.

1.  **Navigate to the Google API Console Credentials Page**: [https://console.cloud.google.com/apis/credentials](https://console.cloud.google.com/apis/credentials)
2.  **Create a New Project** or select an existing one.
3.  Click **+ CREATE CREDENTIALS** and select **OAuth client ID**.
4.  **Application type**: Select **Web application**.
5.  **Authorized redirect URIs**: This is the most critical step. You must add two URIs:
    -   **For Production**: `https://<your-worker-name>.<your-account-name>.workers.dev/callback`
    -   **For Local Development**: `http://localhost:8788/callback` (The port `8788` is defined in `wrangler.toml`).
6.  Click **Create**. A dialog will appear with your **Client ID** and **Client Secret**. Keep these values safe; you will need them in the next step.

---

## 4. Environment Configuration

Your server needs several secret values to operate. These are managed differently for local development and production.

### Local Development (`.dev.vars`)

1.  Create a file named `.dev.vars` in the root of your project. **Do not commit this file to source control.**
2.  Add the following key-value pairs to the file:

    ```sh
    # .dev.vars - For local development only

    # From Google API Console
    GOOGLE_CLIENT_ID="<your-google-client-id>"
    GOOGLE_CLIENT_SECRET="<your-google-client-secret>"

    # From your Flodesk Account
    FLODESK_API_KEY="<your-flodesk-api-key>"

    # A securely generated random string for signing cookies
    COOKIE_ENCRYPTION_KEY="<generate-a-random-string>"
    ```
    *To generate a secure `COOKIE_ENCRYPTION_KEY`, run this command in your terminal:*
    ```bash
    openssl rand -base64 32
    ```

### Production (Wrangler Secrets)

For your deployed worker, secrets must be set using Wrangler commands. This stores them securely in your Cloudflare account.

Run the following commands, pasting the secret value when prompted:
```bash
wrangler secret put GOOGLE_CLIENT_ID
wrangler secret put GOOGLE_CLIENT_SECRET
wrangler secret put FLODESK_API_KEY
wrangler secret put COOKIE_ENCRYPTION_KEY
```

---

## 5. Deployment to Cloudflare

With the configuration in place, you can now deploy the worker.

1.  **Open `wrangler.toml`** and ensure your top-level `name` is set correctly.
2.  **Run the deploy command**:
    ```bash
    wrangler deploy
    ```
    This command will:
    -   Upload your code.
    -   Create and bind the `FLODESK_KV` and `OAUTH_KV` namespaces.
    -   Create and bind the `MyMCP` Durable Object.
    -   Apply the necessary database migrations for the Durable Object.

---

## 6. Registering an OAuth Client

The deployed server acts as its *own* OAuth2 authorization server for client applications like the MCP Inspector. Before the inspector can connect, you must register it with your live server.

1.  **Run the following `curl` command** in your terminal, replacing `<your-worker-url>` with your actual worker URL (e.g., `flodesk-remote-mcp.chris-1bd.workers.dev`).

    ```bash
    curl -X POST https://<your-worker-url>/register \
    -H "Content-Type: application/json" \
    -d '{
      "client_name": "MCP Inspector",
      "redirect_uris": ["http://127.0.0.1:6274/oauth/callback", "http://localhost:6274/oauth/callback", "http://127.0.0.1:6274/oauth/callback/debug"],
      "client_uri": "http://127.0.0.1:6274",
      "contacts": ["inspector@example.com"]
    }'
    ```
2.  This command hits the `/register` endpoint on your live worker and adds the MCP Inspector's details to the production `OAUTH_KV` namespace. It will return a `client_id` and `client_secret` for the inspector, which the tool will handle automatically.

---

## 7. Verification with MCP Inspector

1.  **Launch the Inspector**:
    ```bash
    npx @modelcontextprotocol/inspector@latest
    ```
    This will open the tool in your browser, typically at `http://localhost:6274`.

2.  **Connect to your Server**:
    -   In the "Server URL" field, enter the full SSE endpoint of your worker: `https://<your-worker-url>/sse`
    -   Click **Connect**.

3.  **Authenticate**: You will be redirected to the Google login and consent screens. Complete the authentication flow.

4.  **Verify Connection**: After authentication, you will be redirected back to the Inspector. It should now show a "Connected" status and list the available tools (e.g., `add`, `user_info`, `list_segments`). The process is now complete.

---

## 8. Key Architectural Concepts

-   **Double OAuth Flow**: The authentication is a two-level process. Your MCP server acts as both a *client* (to Google) and a *server* (to the MCP Inspector). This is why you need both Google credentials and a separate client registration for the inspector.
-   **Durable Objects (`MyMCP`)**: This is the core of the agent. A Durable Object provides a single-threaded, stateful environment for each connection, ensuring that context (like the user's `accessToken`) is maintained securely for each session. The `[[migrations]]` block in `wrangler.toml` is a mandatory declaration for using them.
-   **KV Namespaces (`OAUTH_KV`)**: This is a simple key-value database used to store the list of registered client applications (like the MCP Inspector) that are allowed to connect to your server.
-   **Manual Routing (`/callback`)**: The `@cloudflare/workers-oauth-provider` library handles most OAuth routes automatically, but the `/callback` route from the external provider (Google) must be manually routed in `src/index.ts` to the correct handler (`GoogleHandler`).

---

## 9. Troubleshooting and Best Practices

-   **DO**: Use `wrangler tail` to see live logs from your deployed worker. It is your most powerful debugging tool.
-   **DON'T**: Confuse local and production environments. KV namespaces have separate databases for local (`preview_id`) and production (`id`). A client registered locally will not exist in production until you register it against the live URL.
-   **DO**: Be precise with Redirect URIs in the Google Console. They must match *exactly* what the worker provides, including the protocol (`http` vs `https`) and port.
-   **DON'T**: Manually edit Durable Object migrations in `wrangler.toml` unless you understand the implications. The error messages from `wrangler deploy` are the best source of truth for what is required.
-   **DO**: Ensure `.dev.vars` is in your `.gitignore` file. Never commit secrets to your repository.
-   **If you see a 404 on `/callback`**: Your routing logic in `src/index.ts` is likely not deployed or incorrect.
-   **If you see "invalid_client" or "invalid request"**: The client application (e.g., Inspector) is likely not registered in the correct environment's `OAUTH_KV` namespace.
-   **If you see "Body has already been used"**: An error response was not cloned before being read by a logging function. This indicates a bug in the error handling itself. 