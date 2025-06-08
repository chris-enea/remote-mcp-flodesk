# Federated MCP Server Architecture: Refactoring Plan

## 1. Overview

This document outlines the strategic plan to refactor the current monolithic MCP server into a federated, microservices-style architecture. The goal is to enhance security, scalability, and maintainability by separating authentication concerns from tool-specific business logic.

The new architecture will consist of two main components:
-   **A Central Auth Server**: A single, dedicated Cloudflare Worker responsible for handling user authentication with third-party providers (e.g., Google), managing user consent, and issuing secure, short-lived session tokens.
-   **Specialized Tool Servers**: Multiple, independent Cloudflare Workers (e.g., `gmail-mcp`, `flodesk-mcp`, `calendar-mcp`), each containing the logic for a specific service. These servers will not handle authentication directly but will authorize requests by validating the session token with the Central Auth Server.

This approach follows the best practice of "separation of concerns" and provides a robust foundation for adding hundreds of tools in the future without compromising security or creating a monolithic maintenance burden.

---

## 2. Recommended Project Structure (Monorepo)

To manage the multiple services (Auth Server, Tool Servers) effectively, a **monorepo** structure using NPM Workspaces is the recommended approach. This allows for shared code, simplified dependency management, and streamlined development workflows, and is fully compatible with Cloudflare Workers.

The project root (`remote-mcp/`) will contain a `packages/` directory, with each service residing in its own sub-folder.

```text
remote-mcp/
├── packages/
│   ├── auth-mcp/                 # The Central Auth Server (Phase 1)
│   │   ├── src/
│   │   ├── wrangler.toml
│   │   └── package.json
│   │
│   ├── gmail-mcp/                # The Gmail Tool Server (Phase 2)
│   │   ├── src/
│   │   ├── wrangler.toml
│   │   └── package.json
│   │
│   └── shared-types/             # A shared package for common types
│       ├── index.ts
│       └── package.json
│
├── .gitignore
└── package.json                  # The root package.json defining the workspaces
```

### Key Components:

*   **`packages/*`**: Each sub-directory is a self-contained Worker project with its own `wrangler.toml` and `package.json`.
*   **Root `package.json`**: This file at the project root configures the NPM workspaces, allowing you to manage all projects from a single location.
    ```json
    {
      "name": "remote-mcp-monorepo",
      "private": true,
      "workspaces": [
        "packages/*"
      ],
      "scripts": {
        "build": "npm run build --workspaces",
        "deploy:auth": "npm run deploy -w auth-mcp",
        "deploy:gmail": "npm run deploy -w gmail-mcp",
        "lint": "npm run lint --workspaces --if-present"
      }
    }
    ```
*   **`shared-types` package**: A dedicated package for sharing code (like TypeScript interfaces for session data) between the Auth Server and Tool Servers. This is achieved by listing `"shared-types": "workspace:*"` in the dependencies of other packages.

This structure should be set up *before* beginning Phase 1. The refactoring will involve moving the existing project files into the `packages/auth-mcp` directory and creating the new root `package.json`.

---

## 3. Phase 1: Refactor the Current Project into a Central Auth Server

The first phase is to strip down the existing server, removing all tool-specific logic and transforming it into a dedicated authentication and authorization service. This work will take place within the `packages/auth-mcp` directory.

### Tasks

-   [ ] **1.1: Implement Secure Session Storage**
    -   **Action**: In `wrangler.toml`, create a new KV namespace binding for storing session data.
        ```toml
        [[kv_namespaces]]
        binding = "SESSION_KV"
        id = "<new_kv_namespace_id>"
        preview_id = "<new_kv_preview_id>"
        ```
    -   **Rationale**: We need a secure place to store a mapping between a new session token and the sensitive Google OAuth tokens.

-   [ ] **1.2: Modify the OAuth Callback to Create Sessions**
    -   **Action**: Update the `/callback` logic in `src/google-handler.ts`.
    -   **Details**:
        1.  After successfully exchanging the `code` for a Google `accessToken` and `refreshToken`, generate a new, secure, random string to act as a `session_token`.
        2.  Store the Google tokens and user profile information in the `SESSION_KV` namespace. The `session_token` will be the key.
            ```json
            // Value stored in SESSION_KV
            {
              "userId": "google-user-id",
              "name": "User Name",
              "email": "user@example.com",
              "scopes": ["openid", "email", "profile", "..."],
              "googleAccessToken": "...",
              "googleRefreshToken": "...", // Crucial for long-term access
              "expiresAt": "..." // Expiration timestamp of the access token
            }
            ```
        3.  Redirect the user back to the client application (e.g., MCP Inspector), passing the new `session_token` in the URL fragment (`#session_token=...`).

-   [ ] **1.3: Create a Secure Token Introspection Endpoint**
    -   **Action**: Create a new route, `/introspect`, on the Auth Server.
    -   **Details**:
        1.  This endpoint will accept a `POST` request with the `session_token`.
        2.  It will look up the token in `SESSION_KV`.
        3.  If the token is valid, it will check if the `googleAccessToken` has expired. If so, it will use the `googleRefreshToken` to get a new one from Google, update the record in `SESSION_KV`, and then return the session data (including the fresh `googleAccessToken`) to the caller.
        4.  If the token is invalid or not found, it will return a `401 Unauthorized` error.
    -   **Security**: This endpoint should be protected. In Cloudflare, this is best done using [Service Bindings](https://developers.cloudflare.com/workers/runtime-apis/service-bindings/), ensuring only other workers in your account can call it.

-   [ ] **1.4: Clean Up the Project**
    -   **Action**: Remove all non-authentication code from this project.
    -   **Details**:
        -   Delete `src/flodesk-api.ts`.
        -   Remove all Flodesk-related tools (`list_segments`, `add_subscriber`, etc.) from `src/index.ts`.
        -   Remove the `FLODESK_API_KEY` secret and the `FLODESK_KV` namespace from `wrangler.toml`. The project should now be lean and focused entirely on authentication.

---

## 4. Phase 2: Build the First Specialized Tool Server (Gmail MCP)

This phase involves creating a brand-new, independent worker that provides Gmail-related tools and relies on the Central Auth Server for security. This will take place in the `packages/gmail-mcp` directory.

### Tasks

-   [ ] **2.1: Scaffold a New Worker Project**
    -   **Action**: In the `packages/` directory, create a new Cloudflare Worker project.
        ```bash
        # From the monorepo root
        cd packages
        npx wrangler init gmail-mcp
        cd ..
        ```

-   [ ] **2.2: Configure Service Binding to the Auth Server**
    -   **Action**: In the `gmail-mcp/wrangler.toml` file, add a service binding to the deployed Central Auth Server.
        ```toml
        [[services]]
        binding = "AUTH_SERVER"
        service = "auth-mcp" # The name of your auth worker
        ```
    -   **Rationale**: This allows the Gmail worker to make secure, direct calls to the Auth Server's `/introspect` endpoint.

-   [ ] **2.3: Implement Authorization in the MCP Agent**
    -   **Action**: In `gmail-mcp/src/index.ts`, modify the `McpAgent` to perform authorization before executing any tools.
    -   **Details**:
        1.  The client (MCP Inspector) will need to include the `session_token` in the `Authorization` header of its request to the Gmail server.
        2.  The `McpAgent` will extract this token.
        3.  It will call the `AUTH_SERVER.fetch()` method, hitting the `/introspect` endpoint with the token.
        4.  If the introspection is successful, the agent will populate its `this.props` with the user data and the `googleAccessToken` returned by the Auth Server.
        5.  If it fails, the connection is rejected with an authentication error.

-   [ ] **2.4: Implement the Gmail Tool**
    -   **Action**: Create the necessary files and logic for the Gmail tool.
    -   **Details**:
        1.  Create a `src/gmail-api.ts` file. The `GmailAPI` class will be instantiated with the `googleAccessToken` received from the introspection step.
        2.  In `src/index.ts`, define the `list_recent_emails` tool. This tool will use the `GmailAPI` instance to fetch data from Google.

---

## 5. Phase 3: Update the Client Application

The final step is to adjust the client-side application (e.g., MCP Inspector) to work with this new federated flow.

### Tasks

-   [ ] **3.1: Adjust the Authentication Flow**
    -   **Action**: The client's OAuth handling logic needs to be updated.
    -   **Details**: After being redirected back from the Central Auth Server, the client must parse the `session_token` from the URL fragment. It must store this token locally for subsequent API calls.

-   [ ] **3.2: Modify Tool Invocation**
    -   **Action**: When calling a tool on any Tool Server (`gmail-mcp`, `flodesk-mcp`, etc.), the client must now include the `session_token` in the request headers.
        ```
        Authorization: Bearer <session_token>
        ```

## 6. Conclusion

By completing this refactoring, the system will be transformed into a modern, secure, and scalable platform. Adding new capabilities in the future will be as simple as creating a new, focused Tool Server and adding it to the ecosystem, without modifying the core authentication logic or bloating existing services. 