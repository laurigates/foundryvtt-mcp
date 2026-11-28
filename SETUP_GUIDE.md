# FoundryVTT MCP Server Setup Guide

This guide walks you through setting up the FoundryVTT MCP Server.

> **Scope:** the steps below describe primarily the legacy **single-target Socket.IO** setup. For multiple worlds, the `rest-api` relay, `composite` providers and per-target write settings on `feat/multiworld-provider-overhaul`, use the [provider and target configuration guide](docs/guides/providers-and-targets.md) and [current configuration reference](docs/guides/configuration.md). The published npm package may not include these branch-only changes.

## Quick Start

1. **Install dependencies**:

   ```bash
   npm install
   ```

2. **Copy environment file**:

   ```bash
   cp .env.example .env
   ```

3. **Configure your connection** (see below)

4. **Start the server**:
   ```bash
   npm run dev
   ```

## Connection Setup

The MCP server connects to FoundryVTT via Socket.IO using a standard user account. No custom modules are required for full game data access.

### Prerequisites

- FoundryVTT server running with an **active world** (not on the setup screen)
- A FoundryVTT user account with appropriate permissions

### Setup Types

Before configuring, determine your FoundryVTT deployment:

#### Local Development Setup
- FoundryVTT running on your local machine
- Typically uses `http://localhost:30000` or similar
- No reverse proxy or SSL/TLS

#### Reverse Proxy / Remote Setup
- FoundryVTT behind a reverse proxy (nginx, Apache, Caddy, etc.)
- Custom domains with SSL/TLS (e.g., `https://foundry.example.com`)
- Cloud hosting or remote server deployments
- May use custom ports or paths

#### Network/IP Setup
- FoundryVTT accessible via local network IP
- Different port configurations
- Direct IP access without domain names

### Configuration

Update your `.env` file based on your setup type:

**Local Development:**
```env
FOUNDRY_URL=http://localhost:30000
FOUNDRY_USERNAME=your_username
FOUNDRY_PASSWORD=your_password
```

**Reverse Proxy / Remote:**
```env
FOUNDRY_URL=https://foundry.example.com
FOUNDRY_USERNAME=your_username
FOUNDRY_PASSWORD=your_password
```

**Network/IP:**
```env
FOUNDRY_URL=http://192.168.1.100:30000
FOUNDRY_USERNAME=your_username
FOUNDRY_PASSWORD=your_password
```

### Features Available

With `FOUNDRY_URL`, a Foundry username (or user ID) and a password, the MCP client uses authenticated **Socket.IO**:

- Search world actors, world items, scenes and journals by name/type as exposed by each tool.
- Read actor attributes, current scene metadata, combat state, recent chat and user presence.
- Search actor, item, scene and journal **names** with `search_world` (not document-body full-text search).
- Roll basic dice notation locally (terms and integer modifiers joined by `+` or `-`); with the optional REST bridge, supported rolls go to Foundry's Roll engine.
- Read world statistics and synchronize the world snapshot through `refresh_world_data`.
- Generate **text** NPCs and loot suggestions (these do not create documents).
- With `FOUNDRY_WRITE_ENABLED=true` and GM/owner permissions, perform supported actor, token, journal and combat changes via Socket.IO.

The optional **REST bridge** ([laurigates/foundryvtt-local-rest-api](https://github.com/laurigates/foundryvtt-local-rest-api)) runs alongside Socket.IO (dual mode) and adds prepared actor values, `search_compendium` and diagnostics; the mutation tools always use Socket.IO. `lookup_rule` is a placeholder, not a rules database. See the [capability matrix](docs/guides/capabilities.md) for tool-specific details.

### Environment Variables

| Variable           | Required | Description                                  | Default |
| ------------------ | -------- | -------------------------------------------- | ------- |
| `FOUNDRY_URL`      | Yes      | FoundryVTT server URL                        | -       |
| `FOUNDRY_USERNAME` | Socket.IO | Foundry user name | - |
| `FOUNDRY_PASSWORD` | Socket.IO | Foundry user password | - |
| `FOUNDRY_USER_ID` | No | Optional alternative to `FOUNDRY_USERNAME`: 16-character user `_id` (bypasses username resolution) | - |
| `FOUNDRY_API_KEY` | REST bridge | Key of the optional REST bridge; with `FOUNDRY_REST_URL` and the Socket.IO credentials it enables dual mode (see the [capability matrix](docs/guides/capabilities.md#connection-modes)) | - |
| `FOUNDRY_REST_URL` | REST bridge | REST bridge server URL, e.g. `http://localhost:3030` | - |
| `FOUNDRY_WRITE_ENABLED` | No | Enable supported mutations in authenticated Socket.IO mode only | `false` |
| `FOUNDRY_SOCKET_PATH` | No | Socket.IO path (change behind a route prefix) | `/socket.io/` |
| `LOG_LEVEL` | No | Logging level | `info` |

### Optional: Diagnostics Tools

The log and system-health tools need the optional **REST bridge** ([laurigates/foundryvtt-local-rest-api](https://github.com/laurigates/foundryvtt-local-rest-api): a Foundry module plus a bridge server). Five diagnostic tools exist (including a `diagnose_errors` placeholder and a `get_health_status` summary that works without the bridge):

- `get_recent_logs` - Retrieve filtered FoundryVTT logs
- `search_logs` - Search logs by pattern, listing the matching entries
- `get_system_health` - Server health status with versions, user/module counts, memory and log error counts (no CPU or disk metrics)
- `diagnose_errors` - **stub**: returns a fixed "no errors detected" summary
- `get_health_status` - Comprehensive health diagnostics: the transport mode, the Socket.IO
  state and the bridge state (reachable, unreachable, answering with errors, rejected or
  unusable response, with the last error and any running pauses)

The module has **no published release yet** (laurigates/foundryvtt-local-rest-api#2), so there is no manifest URL to install from. To enable it from a checkout:
1. Install and enable the module in your world, turn on its REST API setting and copy the generated API key
2. Configure and start the bridge server (`bridge-server/` in that repository; port `3030` by default)
3. Keep a Gamemaster logged in through a browser; the bridge answers only through that client
4. Add `FOUNDRY_API_KEY=your_key` and `FOUNDRY_REST_URL=http://localhost:3030` to your `.env`, keeping the Socket.IO credentials (dual mode)

The full steps and current limits are in the [configuration guide](docs/guides/configuration.md#optional-rest-bridge-augment).

## Testing Your Setup

### 1. Test Connection

```bash
npm run dev
```

Look for these success messages:

```
Connected to FoundryVTT successfully
FoundryVTT MCP Server running
```

### 2. Test with AI Assistant

Once the server is running, test these commands with your AI assistant:

**Dice Rolling**:

- "Roll 1d20+5 for an attack roll"
- "Roll 2d6 + 1d4 + 3"

**Data Queries**:

- "Search for goblin actors"
- "Find all magic weapons"
- "What's the current scene information?"
- "Who's online?"

**Content Generation**:

- "Generate a random NPC"
- "Create some loot for a level 5 party"

## Troubleshooting

### Common Issues

#### "Failed to connect to FoundryVTT"

- **Check**: FoundryVTT is running at the configured URL with an active world
- **Check**: No firewall blocking the connection
- **Try**: Test URL in browser (local: `http://localhost:30000`, remote: `https://foundry.example.com`)
- **For reverse proxy**: Ensure WebSocket upgrades are properly configured

#### "Authentication failed"

- **Check**: Username matches a FoundryVTT user exactly (case-sensitive)
- **Check**: Password is correct
- **Check**: User has necessary permissions in FoundryVTT
- **Try**: Set `FOUNDRY_USER_ID` to the 16-character document `_id` to bypass username resolution

#### "World data not received"

- **Check**: A world is active in FoundryVTT (not on the setup screen)
- **Check**: Socket.IO authentication completed (check server logs)
- **Try**: Restart both FoundryVTT and the MCP server

#### "Empty search results"

- **Check**: Data exists in your FoundryVTT world
- **Check**: User has permission to view the data
- **Check**: World data loaded on connect (look for worldData log on startup)

#### "WebSocket connection issues"

- **Check**: FoundryVTT allows WebSocket connections
- **Check**: No proxy server blocking WebSocket upgrades
- **Try**: Different port or direct connection

#### "Reverse Proxy / SSL Issues"

**SSL Certificate Problems:**
- **Check**: SSL certificate is valid and not expired
- **Check**: Certificate includes your domain name
- **Try**: Test with curl: `curl -I https://foundry.example.com`

**Proxy Configuration:**
- **Nginx**: Ensure `proxy_set_header Upgrade $http_upgrade;` and `proxy_set_header Connection "upgrade";`
- **Apache**: Enable `mod_proxy_wstunnel` for WebSocket support
- **Caddy**: WebSocket support is automatic with `reverse_proxy`

**Port and Path Issues:**
- **Check**: Reverse proxy forwards to correct FoundryVTT port (usually 30000)
- **Check**: No path conflicts (e.g., `/socket.io/` path is preserved)
- **Try**: Direct connection to bypass proxy temporarily

### Getting Help

1. **Check logs**: Run with `LOG_LEVEL=debug` for detailed information
2. **Test manually**: Try accessing FoundryVTT directly in your browser
3. **Network issues**: Verify firewall and network configuration

## Advanced Configuration

### Direct User ID

If username resolution fails, set the user ID directly. Find the 16-character document `_id` for your user in FoundryVTT's data:

```env
FOUNDRY_USER_ID=abc123def456ghij
```

### Custom Socket Path (reverse proxy / `routePrefix`)

`FOUNDRY_SOCKET_PATH` is the Socket.IO endpoint path on the server; it defaults
to `/socket.io/`. FoundryVTT serves Socket.IO under its `routePrefix`, so a
server behind a prefix needs both settings — the prefix in `FOUNDRY_URL` and
again in the socket path. That prefixed socket path follows issue #231 and has
not yet been verified against a live server behind a `routePrefix` (#253).

```env
FOUNDRY_URL=https://example.com/foundry
FOUNDRY_SOCKET_PATH=/foundry/socket.io/
```

The `/join` login requests use the full `FOUNDRY_URL`. The Socket.IO connection
goes to the URL's origin (`https://example.com`) with `FOUNDRY_SOCKET_PATH` as
its path, because socket.io-client would read a path in the URL as a namespace.
The socket path is not derived from `FOUNDRY_URL`: leaving it at the default
behind a prefix makes the connection time out without a `connect_error`.

### Timeout Settings

For slow connections, increase timeouts:

```env
FOUNDRY_TIMEOUT=30000
FOUNDRY_RETRY_ATTEMPTS=5
FOUNDRY_RETRY_DELAY=2000
```

### Production Deployment

For production use:

```env
NODE_ENV=production
LOG_LEVEL=warn
```

## What's Next?

Once you have a working connection:

1. **Explore all available tools**: Check the README for a complete list
2. **Customize for your game**: Many tools can be configured for specific game systems
3. **Add more features**: The server is extensible - add your own tools and resources
4. **Contribute**: Found bugs or want new features? Contributions welcome!

## FoundryVTT Version Compatibility

The integration test environment is configured for **Foundry V14.367**. The authentication code handles v13/v14 session conventions; actual behavior also depends on the Foundry core build, system, permissions, reverse proxy and enabled modules. Test the connection and required operations against your own version and world before using write tools.

For a remote Linux server that does not require a browser open on the MCP client machine, see [Remote Linux Setup](docs/guides/remote-linux.md).

---

**Need more help?** Check the main README or open an issue on GitHub.
