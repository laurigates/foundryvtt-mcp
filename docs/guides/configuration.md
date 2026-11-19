# Configuration Guide

## Environment Variables

Copy `.env.example` and set the required values:

```bash
cp .env.example .env
```

### Required / conditional authentication

| Variable | Required when | Description |
|----------|---------------|-------------|
| `FOUNDRY_URL` | Always | Active Foundry world URL (e.g. `https://foundry.example.com` or `http://localhost:30000`). |
| `FOUNDRY_USERNAME` (or `FOUNDRY_USER_ID`) | Socket.IO mode | Foundry user name (or its ID). |
| `FOUNDRY_PASSWORD` | Socket.IO mode | Foundry user password. |
| `FOUNDRY_API_KEY` | Optional REST mode | Authenticates to the **Foundry Local REST API module** and switches the MCP to REST mode. |

### Optional

| Variable | Default | Description |
|----------|---------|-------------|
| `FOUNDRY_USER_ID` | — | 16-char document `_id` (bypasses username resolution) |
| `FOUNDRY_SOCKET_PATH` | `/socket.io/` | Custom Socket.IO endpoint for reverse-proxy route prefixes. |
| `FOUNDRY_WRITE_ENABLED` | `false` | Allow 11 mutating MCP tools **only** with an active authenticated Socket.IO connection and Foundry GM/owner permissions. |
| `LOG_LEVEL` | `info` | Logging verbosity (`debug`, `info`, `warn`, `error`) |
| `NODE_ENV` | `development` | Environment mode |
| `FOUNDRY_TIMEOUT` | `10000` | Request timeout in ms |
| `FOUNDRY_RETRY_ATTEMPTS` | `3` | Retry failed requests |
| `FOUNDRY_RETRY_DELAY` | `1000` | Delay between retries in ms |
| `CACHE_ENABLED` | `true` | Enable response caching |
| `CACHE_TTL_SECONDS` | `300` | Cache duration in seconds |
| `CACHE_MAX_SIZE` | — | Maximum cache entries |

## Server Settings

```env
# Logging
LOG_LEVEL=info  # debug, info, warn, error

# Performance
FOUNDRY_TIMEOUT=10000      # Request timeout (ms)
FOUNDRY_RETRY_ATTEMPTS=3   # Retry failed requests
```

## Security

- Limit FoundryVTT user permissions to the minimum required.
- Use HTTPS for remote Foundry instances; ensure the reverse proxy supports WebSocket upgrades.
- Keep Foundry passwords and optional REST keys in private environment/client settings, not in source control.
- Keep `FOUNDRY_WRITE_ENABLED=false` until you intend to use write tools, and monitor logs.

## FoundryVTT Authentication

By default the MCP server connects through authenticated Socket.IO using a standard Foundry account. No Foundry module is required for the supported world-snapshot reads or Socket.IO writes. Setting `FOUNDRY_API_KEY` instead selects a different REST transport; it does not add REST capabilities alongside the Socket.IO session. See [Capability Matrix](./capabilities.md) for the exact mode-specific tool support.

### Socket.IO setup

1. Ensure FoundryVTT is running with an active world (not on the setup screen)
2. Create or use an existing FoundryVTT user account with appropriate permissions
3. Add credentials to your `.env` file

### Authentication Flow

The server authenticates through a four-stage flow:

1. Requests `/join` to obtain a session cookie.
2. Resolves a user name to a document ID via Socket.IO `getJoinData` (unless `FOUNDRY_USER_ID` is supplied).
3. Submits credentials to `POST /join` to authenticate the session.
4. Opens an authenticated Socket.IO connection and requests the world snapshot using the `world` event.

This flow runs against the Foundry URL and does not require an open browser tab on the client PC.

### Required permissions

The Foundry user needs access to the documents the tools will read. Write operations also require appropriate GM/owner permissions and `FOUNDRY_WRITE_ENABLED=true`; an active Socket.IO session is mandatory. Pack search is not part of the default world snapshot and requires the optional REST transport.

### Optional: REST-mode compendium search and diagnostics

The **Foundry Local REST API** module enables REST-only `search_compendium` and backend diagnostics endpoints; its key is **not** a ThreeHats REST API Relay key. There are five diagnostics tool names, but `diagnose_errors` remains a **stub** and `get_health_status` provides a partial local summary without the backend. **Setting `FOUNDRY_API_KEY` changes the connection mode; it cannot be combined with Socket.IO write tools in the current implementation.**

To configure this optional mode:

1. In FoundryVTT: **Setup** > **Add-on Modules** > **Install Module**
2. Paste: `https://github.com/laurigates/foundryvtt-mcp/releases/latest/download/module.json`
3. Enable the module in your world and copy the generated API key
4. Add to `.env`:
   ```env
   FOUNDRY_API_KEY=your_api_key_here
   ```
