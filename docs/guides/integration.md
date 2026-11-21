# MCP Client Integration Guide

The FoundryVTT MCP server is a **local stdio MCP process**. It connects to a running Foundry VTT world using the URL and authentication details you configure. The Foundry host may be another machine (for example a remote Linux server); the MCP client does not need to keep the Foundry browser UI open.

The available tools and connection-mode boundaries are described in the [capability matrix](./capabilities.md). For a complete remote-host setup, see [Remote Linux Setup](./remote-linux.md).

## Connect via Socket.IO (default)

Use this mode for supported world-state reads and the opt-in write tools. Keep `FOUNDRY_API_KEY` **unset**. Foundry must have an active world and the account must have the necessary permissions.

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

## Optional Foundry Local REST API mode

Setting `FOUNDRY_API_KEY` switches the connection to **Foundry Local REST API mode** — a transport switch, not an extra key on top of Socket.IO. See the [capability matrix](./capabilities.md#connection-modes-not-interchangeable) for the canonical description of what each mode supports; in short, REST mode offers compendium search and REST-backed diagnostics, while the write tools require Socket.IO.

For example, to use REST-backed searches and diagnostics, configure a separate MCP entry:

```json
{
  "mcpServers": {
    "foundry-rest": {
      "command": "npx",
      "args": ["-y", "foundryvtt-mcp"],
      "env": {
        "FOUNDRY_URL": "https://foundry.example.com",
        "FOUNDRY_API_KEY": "REPLACE_WITH_REST_MODULE_KEY"
      }
    }
  }
}
```

The REST mode above expects the **Foundry Local REST API** module's `/api/...` endpoints. REST-only behavior depends on the endpoints implemented by the installed module.

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
