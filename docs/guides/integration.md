# MCP Client Integration Guide

The FoundryVTT MCP server is a **local stdio MCP process**. It connects to a running Foundry VTT world using the URL and authentication details you configure. The Foundry host may be another machine (for example a remote Linux server); the MCP client does not need to keep the Foundry browser UI open.

The available tools and connection-mode boundaries are described in the [capability matrix](./capabilities.md). For a complete remote-host setup, see [Remote Linux Setup](./remote-linux.md).

## Connect via Socket.IO (default)

Use this mode for supported world-state reads and the opt-in write tools. It needs no Foundry module; leave `FOUNDRY_API_KEY` unset unless you add the [REST bridge](#optional-dual-mode-with-the-rest-bridge). Foundry must have an active world and the account must have the necessary permissions.

### Claude Desktop / MCP clients using `mcpServers`

```json
{
  "mcpServers": {
    "foundryvtt": {
      "command": "npx",
      "args": ["-y", "foundryvtt-mcp"],
      "env": {
        "FOUNDRY_URL": "https://foundry.example.com",
        "FOUNDRY_USERNAME": "mcp-api",
        "FOUNDRY_PASSWORD": "REPLACE_WITH_SECRET",
        "FOUNDRY_WRITE_ENABLED": "false"
      }
    }
  }
}
```

Substitute your real Foundry URL and an authorized user. A local development server can use `http://localhost:30000`; remote deployments should use HTTPS.

Setting `FOUNDRY_WRITE_ENABLED=true` enables the mutation tools **only when Socket.IO is connected and Foundry grants the required GM/owner permissions** (see the [capability matrix](./capabilities.md) for the full list). Leave it disabled while testing connectivity and read operations.

### VS Code client configuration

VS Code uses `servers` instead of `mcpServers` for its standard MCP configuration:

```json
{
  "servers": {
    "foundryvtt": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "foundryvtt-mcp"],
      "env": {
        "FOUNDRY_URL": "https://foundry.example.com",
        "FOUNDRY_USERNAME": "mcp-api",
        "FOUNDRY_PASSWORD": "REPLACE_WITH_SECRET"
      }
    }
  }
}
```

## Optional: dual mode with the REST bridge

Adding the [REST bridge](./configuration.md#optional-rest-bridge-augment) (laurigates/foundryvtt-local-rest-api) to a Socket.IO configuration selects **dual mode**: Socket.IO stays primary, and the bridge adds prepared actor values, Foundry's dice engine, compendium search, logs and system health. Set `FOUNDRY_API_KEY` and `FOUNDRY_REST_URL` **in addition to** the Socket.IO credentials; `FOUNDRY_URL` keeps pointing at Foundry. See the [capability matrix](./capabilities.md#connection-modes) for what each mode supports. Install the module from its manifest URL and run the bridge server as the configuration guide describes.

```json
{
  "mcpServers": {
    "foundryvtt": {
      "command": "npx",
      "args": ["-y", "foundryvtt-mcp"],
      "env": {
        "FOUNDRY_URL": "https://foundry.example.com",
        "FOUNDRY_USERNAME": "mcp-api",
        "FOUNDRY_PASSWORD": "REPLACE_WITH_SECRET",
        "FOUNDRY_API_KEY": "REPLACE_WITH_BRIDGE_KEY",
        "FOUNDRY_REST_URL": "http://localhost:3030"
      }
    }
  }
}
```

The bridge answers only while a Gamemaster is logged in to the world through a browser. Setting `FOUNDRY_API_KEY` without the Socket.IO credentials, or without `FOUNDRY_REST_URL`, selects the deprecated REST-only mode instead, which has no write tools, combat, journals or live updates.

## Running a fork checkout

The commands above invoke the **published npm package**. To run a local checkout of your own fork/branch, build it and point the MCP client at its absolute `dist/index.js` path instead.

```bash
# Clone the upstream repository, or your own fork's URL
git clone https://github.com/laurigates/foundryvtt-mcp.git
cd foundryvtt-mcp
git checkout <your-branch>
bun install
bun run build
```

Example for a cloned checkout (replace the path with the absolute path on your computer):

```json
{
  "mcpServers": {
    "foundryvtt-fork": {
      "command": "node",
      "args": ["/absolute/path/to/foundryvtt-mcp/dist/index.js"],
      "env": {
        "FOUNDRY_URL": "https://foundry.example.com",
        "FOUNDRY_USERNAME": "mcp-api",
        "FOUNDRY_PASSWORD": "REPLACE_WITH_SECRET",
        "FOUNDRY_WRITE_ENABLED": "false"
      }
    }
  }
}
```

`node` must be installed and available to the client. Do not commit real credentials to the repository.

## Using a custom MCP SDK client

```typescript
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: "node",
  args: ["/absolute/path/to/foundryvtt-mcp/dist/index.js"],
  env: {
    ...process.env,
    FOUNDRY_URL: "https://foundry.example.com",
    FOUNDRY_USERNAME: "mcp-api",
    FOUNDRY_PASSWORD: process.env.FOUNDRY_PASSWORD ?? ""
  }
});

const client = new Client({ name: "foundry-client", version: "1.0.0" });
await client.connect(transport);

const result = await client.callTool({
  name: "roll_dice",
  arguments: { formula: "1d20+5", reason: "Initiative check" }
});
console.log(result);
await client.close();
```

## Example tool arguments

### `roll_dice`

```json
{ "formula": "1d20+5", "reason": "Attack roll against goblin" }
```

### `search_world` (names only)

```json
{ "query": "dragon", "limit": 10 }
```

### `search_actors`

```json
{ "query": "goblin", "type": "npc", "limit": 10 }
```

### `get_combat_state`

```json
{}
```

### `move_token` (Socket.IO write mode and permissions required)

```json
{ "tokenId": "REPLACE_WITH_TOKEN_ID", "sceneId": "REPLACE_WITH_SCENE_ID", "x": 300, "y": 450 }
```
