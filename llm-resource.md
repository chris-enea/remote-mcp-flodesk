# Build a Remote MCP server

URL: https://developers.cloudflare.com/agents/guides/remote-mcp-server/

import { Details, Render, PackageManagers } from "~/components";

## Deploy your first MCP server

This guide will show you how to deploy your own remote MCP server on Cloudflare, with two options:

- **Without authentication** â€” anyone can connect and use the server (no login required).
- **With [authentication and authorization](/agents/guides/remote-mcp-server/#add-authentication)** â€” users sign in before accessing tools, and you can control which tools an agent can call based on the user's permissions.

You can start by deploying a [public MCP server](https://github.com/cloudflare/ai/tree/main/demos/remote-mcp-authless) without authentication, then add user authentication and scoped authorization later. If you already know your server will require authentication, you can skip ahead to the [next section](/agents/guides/remote-mcp-server/#add-authentication).

The button below will guide you through everything you need to do to deploy this [example MCP server](https://github.com/cloudflare/ai/tree/main/demos/remote-mcp-authless) to your Cloudflare account:

[![Deploy to Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/cloudflare/ai/tree/main/demos/remote-mcp-authless)

Once deployed, this server will be live at your workers.dev subdomain (e.g. remote-mcp-server-authless.your-account.workers.dev/sse). You can connect to it immediately using the [AI Playground](https://playground.ai.cloudflare.com/) (a remote MCP client), [MCP inspector](https://github.com/modelcontextprotocol/inspector) or [other MCP clients](/agents/guides/remote-mcp-server/#connect-your-remote-mcp-server-to-claude-and-other-mcp-clients-via-a-local-proxy). Then, once you're ready, you can customize the MCP server and add your own [tools](/agents/model-context-protocol/tools/). 

If you're using the "Deploy to Cloudflare" button, a new git repository will be set up on your GitHub or GitLab account for your MCP server, configured to automatically deploy to Cloudflare each time you push a change or merge a pull request to the main branch of the repository. You can then clone this repository, [develop locally](/agents/guides/remote-mcp-server/#local-development), and start writing code and building.

### Set up and deploy your MCP server via CLI

Alternatively, you can use the command line as shown below to create a new MCP Server on your local machine.

<PackageManagers
	type="create"
	pkg="cloudflare@latest"
	args={"my-mcp-server --template=cloudflare/ai/demos/remote-mcp-authless"}
/>

Now, you have the MCP server setup, with dependencies installed. Move into that project folder:

```sh
cd my-mcp-server
```

#### Local development

In the directory of your new project, run the following command to start the development server:

```sh
npm start
```

Your MCP server is now running on `http://localhost:8787/sse`.

In a new terminal, run the [MCP inspector](https://github.com/modelcontextprotocol/inspector). The MCP inspector is an interactive MCP client that allows you to connect to your MCP server and invoke tools from a web browser.

```sh
npx @modelcontextprotocol/inspector@latest
```

Open the MCP inspector in your web browser:

```sh
open http://localhost:5173
```

In the inspector, enter the URL of your MCP server, `http://localhost:8787/sse`, and click **Connect**. You should see the "List Tools" button, which will list the tools that your MCP server exposes.

![MCP inspector â€” authenticated](~/assets/images/agents/mcp-inspector-authenticated.png)

#### Deploy your MCP server

You can deploy your MCP server to Cloudflare using the following [Wrangler CLI command](/workers/wrangler) within the example project:

```sh
npx wrangler@latest deploy
```

If you have already [connected a git repository](/workers/ci-cd/builds/) to the Worker with your MCP server, you can deploy your MCP server by pushing a change or merging a pull request to the main branch of the repository.

After deploying, take the URL of your deployed MCP server, and enter it in the MCP inspector running on `http://localhost:5173`. You now have a remote MCP server, deployed to Cloudflare, that MCP clients can connect to.

### Connect your Remote MCP server to Claude and other MCP Clients via a local proxy

Now that your MCP server is running, you can use the [`mcp-remote` local proxy](https://www.npmjs.com/package/mcp-remote) to connect Claude Desktop or other MCP clients to it â€” even though these tools aren't yet _remote_ MCP clients, and don't support remote transport or authorization on the client side. This lets you test what an interaction with your MCP server will be like with a real MCP client.

Update your Claude Desktop configuration to point to the URL of your MCP server. You can use either the `localhost:8787/sse` URL, or the URL of your deployed MCP server:

```json
{
	"mcpServers": {
		"math": {
			"command": "npx",
			"args": [
				"mcp-remote",
				"https://your-worker-name.your-account.workers.dev/sse"
			]
		}
	}
}
```

Restart Claude Desktop after updating your config file to load the MCP Server. Once this is done, Claude will be able to make calls to your remote MCP server. You can test this by asking Claude to use one of your tools. For example: "Could you use the math tool to add 23 and 19?". Claude should invoke the tool and show the result generated by the MCP server.

Learn more about other ways of using remote MCP servers with MCP clients here in [this section](/agents/guides/test-remote-mcp-server).

## Add Authentication

Now that youâ€™ve deployed a public MCP server, letâ€™s walk through how to enable user authentication using OAuth.

The public server example you deployed earlier allows any client to connect and invoke tools without logging in. To add authentication, youâ€™ll update your MCP server to act as an OAuth provider, handling secure login flows and issuing access tokens that MCP clients can use to make authenticated tool calls.

This is especially useful if users already need to log in to use your service. Once authentication is enabled, users can sign in with their existing account and grant their AI agent permission to interact with the tools exposed by your MCP server, using scoped permissions.

In this example, we use GitHub as an OAuth provider, but you can connect your MCP server with any [OAuth provider](/agents/model-context-protocol/authorization/#2-third-party-oauth-provider) that supports the OAuth 2.0 specification, including Google, Slack, [Stytch](/agents/model-context-protocol/authorization/#stytch), [Auth0](/agents/model-context-protocol/authorization/#stytch), [WorkOS](/agents/model-context-protocol/authorization/#stytch), and more.

### Step 1 â€” Create and deploy a new MCP server

Run the following command to create a new MCP server:

<PackageManagers
	type="create"
	pkg="cloudflare@latest"
	args={
		"my-mcp-server-github-auth --template=cloudflare/ai/demos/remote-mcp-github-oauth"
	}
/>

Now, you have the MCP server setup, with dependencies installed. Move into that project folder:

```sh
cd my-mcp-server-github-auth
```

Then, run the following command to deploy the MCP server:

```sh
npx wrangler@latest deploy
```

You'll notice that in the example MCP server, if you open `src/index.ts`, the primary difference is that the `defaultHandler` is set to the `GitHubHandler`:

```ts ins="OAuthProvider.GitHubHandler"
import GitHubHandler from "./github-handler";

export default new OAuthProvider({
	apiRoute: "/sse",
	apiHandler: MyMCP.Router,
	defaultHandler: GitHubHandler,
	authorizeEndpoint: "/authorize",
	tokenEndpoint: "/token",
	clientRegistrationEndpoint: "/register",
});
```

This will ensure that your users are redirected to GitHub to authenticate. To get this working though, you need to create OAuth client apps in the steps below.

### Step 2 â€” Create an OAuth App

You'll need to create two [GitHub OAuth Apps](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app) to use GitHub as an authentication provider for your MCP server â€”Â one for local development, and one for production.

#### First create a new OAuth App for local development

Navigate to [github.com/settings/developers](https://github.com/settings/developers) to create a new OAuth App with the following settings:

- **Application name**: `My MCP Server (local)`
- **Homepage URL**: `http://localhost:8787`
- **Authorization callback URL**: `http://localhost:8787/callback`

For the OAuth app you just created, add the client ID of the OAuth app as `GITHUB_CLIENT_ID` and generate a client secret, adding it as `GITHUB_CLIENT_SECRET` to a `.dev.vars` file in the root of your project, which [will be used to set secrets in local development](/workers/configuration/secrets/).

```sh
touch .dev.vars
echo 'GITHUB_CLIENT_ID="your-client-id"' >> .dev.vars
echo 'GITHUB_CLIENT_SECRET="your-client-secret"' >> .dev.vars
cat .dev.vars
```

#### Next, run your MCP server locally

Run the following command to start the development server:

```sh
npm start
```

Your MCP server is now running on `http://localhost:8787/sse`.

In a new terminal, run the [MCP inspector](https://github.com/modelcontextprotocol/inspector). The MCP inspector is an interactive MCP client that allows you to connect to your MCP server and invoke tools from a web browser.

```sh
npx @modelcontextprotocol/inspector@latest
```

Open the MCP inspector in your web browser:

```sh
open http://localhost:5173
```

In the inspector, enter the URL of your MCP server, `http://localhost:8787/sse`, and click **Connect**:

You should be redirected to a GitHub login or authorization page. After authorizing the MCP Client (the inspector) access to your GitHub account, you will be redirected back to the inspector. You should see the "List Tools" button, which will list the tools that your MCP server exposes.

#### Second â€”Â create a new OAuth App for production

You'll need to repeat these steps to create a new OAuth App for production.

Navigate to [github.com/settings/developers](https://github.com/settings/developers) to create a new OAuth App with the following settings:

- **Application name**: `My MCP Server (production)`
- **Homepage URL**: Enter the workers.dev URL of your deployed MCP server (ex: `worker-name.account-name.workers.dev`)
- **Authorization callback URL**: Enter the `/callback` path of the workers.dev URL of your deployed MCP server (ex: `worker-name.account-name.workers.dev/callback`)

For the OAuth app you just created, add the client ID and client secret, using Wrangler CLI:

```sh
wrangler secret put GITHUB_CLIENT_ID
```

```sh
wrangler secret put GITHUB_CLIENT_SECRET
```

#### Finally, connect to your MCP server

Now that you've added the ID and secret of your production OAuth app, you should now be able to connect to your MCP server running at `worker-name.account-name.workers.dev/sse` using the [AI Playground](https://playground.ai.cloudflare.com/), MCP inspector or ([other MCP clients](/agents/guides/remote-mcp-server/#connect-your-mcp-server-to-claude-and-other-mcp-clients)), and authenticate with GitHub.

## Next steps

- Add [tools](/agents/model-context-protocol/tools/) to your MCP server.
- Customize your MCP Server's [authentication and authorization](/agents/model-context-protocol/authorization/).

---

# Test a Remote MCP Server

URL: https://developers.cloudflare.com/agents/guides/test-remote-mcp-server/

import { Render } from "~/components";

Remote, authorized connections are an evolving part of the [Model Context Protocol (MCP) specification](https://spec.modelcontextprotocol.io/specification/draft/basic/authorization/). Not all MCP clients support remote connections yet.

This guide will show you options for how to start using your remote MCP server with MCP clients that support remote connections. If you haven't yet created and deployed a remote MCP server, you should follow the [Build a Remote MCP Server](/agents/guides/remote-mcp-server/) guide first.

## The Model Context Protocol (MCP) inspector

The [`@modelcontextprotocol/inspector` package](https://github.com/modelcontextprotocol/inspector) is a visual testing tool for MCP servers.

You can run it locally by running the following command:

```bash
npx @modelcontextprotocol/inspector
```

Then, enter the URL of your remote MCP server. You can use an MCP server running on your local machine on localhost, or you can use a remote MCP server running on Cloudflare.

![MCP inspector](~/assets/images/agents/mcp-inspector-enter-url.png)

Once you have authenticated, you will be redirected back to the inspector. You should see the "List Tools" button, which will list the tools that your MCP server exposes.

![MCP inspector â€” authenticated](~/assets/images/agents/mcp-inspector-authenticated.png)

## Connect your remote MCP server to Claude Desktop via a local proxy

Even though [Claude Desktop](https://claude.ai/download) doesn't yet support remote MCP clients, you can use the [`mcp-remote` local proxy](https://www.npmjs.com/package/mcp-remote) to connect it to your remote MCP server. This lets you to test what an interaction with your remote MCP server will be like with a real-world MCP client.

1. Open Claude Desktop and navigate to Settings -> Developer -> Edit Config. This opens the configuration file that controls which MCP servers Claude can access.
2. Replace the content with a configuration like this:

```json
{
	"mcpServers": {
		"math": {
			"command": "npx",
			"args": ["mcp-remote", "http://my-mcp-server.my-account.workers.dev/sse"]
		}
	}
}
```

This tells Claude to communicate with your MCP server running at `http://localhost:8787/sse`.

3. Save the file and restart Claude Desktop (command/ctrl + R). When Claude restarts, a browser window will open showing your OAuth login page. Complete the authorization flow to grant Claude access to your MCP server.

Once authenticated, you'll be able to see your tools by clicking the tools icon in the bottom right corner of Claude's interface.