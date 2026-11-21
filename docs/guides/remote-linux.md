# Remote Linux Foundry VTT + Local MCP Client

This guide shows how to connect the **FoundryVTT MCP server on your computer** to a **Foundry VTT instance hosted on a remote Linux machine**. The MCP process communicates directly with Foundry; it does not require a browser window to remain open on the local MCP client machine.

## Components

```text
Local workstation                          Remote Linux server
┌───────────────────────┐                 ┌────────────────────────┐
│ MCP-compatible AI     │                 │ Foundry VTT             │
│ client                │                 │ (active world)          │
│          │            │                 │                        │
│          ▼            │  HTTPS/WSS      │                        │
│ foundryvtt-mcp        ├────────────────►│ Foundry HTTP/Socket.IO │
│ stdio MCP process     │                 │                        │
└───────────────────────┘                 └────────────────────────┘
```

The Foundry host can run Linux while the MCP client runs Windows, macOS or Linux with an appropriate Node.js runtime.

## Prerequisites

1. Foundry VTT is running **with a world active** on the remote Linux server.
2. An account exists in that world with the appropriate document permissions. Prefer a dedicated account.
3. The remote URL is reachable from your local workstation, ideally over HTTPS; the reverse proxy must support WebSocket upgrades and the Foundry Socket.IO endpoint.
4. Node.js 18+ is available locally (or use Bun).
5. Your MCP client supports local `command`/`args` stdio processes.

No extra Foundry module is needed for the supported Socket.IO features.

## Configure the MCP client (read-only first)

Use the canonical Socket.IO client configuration from the [integration guide](./integration.md#connect-via-socketio-default) — the published npm package, with `FOUNDRY_WRITE_ENABLED` left `false` and `FOUNDRY_API_KEY` deliberately **omitted** (supplying it switches the MCP to a separate Foundry Local REST API mode; see the [capability matrix](./capabilities.md#connection-modes-not-interchangeable)). For a checked-out Git branch, follow [Running a fork checkout](./integration.md#running-a-fork-checkout) and point the command to the checkout's built `dist/index.js`.

## Test progressively

1. Confirm you can reach the Foundry URL and that the active world accepts the dedicated user's credentials.
2. Start your MCP client and verify that the `foundryvtt` server connects.
3. Call read-only tools such as `get_world_summary`, `search_actors` and `get_scene_info`.
4. Use `roll_dice` to confirm the local dice roller responds; Socket.IO mode evaluates these rolls locally rather than posting them to Foundry chat.
5. If you require mutations, ensure backups and permissions are appropriate, then set `FOUNDRY_WRITE_ENABLED=true` and try a small, reversible action before making broader changes.

For additional diagnostics and connection checks, see [Troubleshooting](../../TROUBLESHOOTING.md).

## Remote reverse proxies and route prefixes

A standard installation uses `FOUNDRY_SOCKET_PATH=/socket.io/`. If Foundry is served under a route prefix, configure both the base URL and the Socket.IO path:

```env
FOUNDRY_URL=https://foundry.example.com/foundry
FOUNDRY_SOCKET_PATH=/foundry/socket.io/
```

HTTP join requests use the full URL, while Socket.IO uses the URL's origin plus the configured socket path. Check the reverse proxy's WebSocket configuration for your deployment.

## World data and refresh behavior

Socket.IO loads a world snapshot when connecting. Document change broadcasts update the cache while connected. When the connection has dropped, changes that occurred during the gap are not replayed; use `refresh_world_data` after reconnection. Changes to synthetic/unlinked token actors can also require an explicit refresh.

## Permissions and security

- Use HTTPS for remote deployments; avoid sending Foundry credentials over unencrypted HTTP.
- Never place real Foundry passwords or REST keys in committed configuration examples.
- Begin with `FOUNDRY_WRITE_ENABLED=false` and use only the document permissions needed.
- `end_combat` deletes the active encounter; `delete_actor_item` permanently removes an owned item. Confirm target IDs before destructive calls.
- The local client uses MCP over **stdio**; its network calls go to the configured Foundry URL.

## Foundry version support

The repository's integration test environment targets Foundry **V14.367**. Authentication handles conventions used by V13 and V14, while the actual supported behavior depends on the installed core build, game system and server configuration. Validate the exact operations you plan to use against your own world.

## Optional REST functions

The Foundry **Local REST API** configuration (`FOUNDRY_API_KEY`) is a separate transport for features such as `search_compendium` and REST diagnostics. See the [capability matrix](./capabilities.md#connection-modes-not-interchangeable) for transport-specific tool support.
