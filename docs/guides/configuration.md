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
| `FOUNDRY_API_KEY` | — | Selects the Foundry Local REST API transport, including read-only compendium search and optional diagnostics. Not a ThreeHats REST Relay key. |
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

- Limit FoundryVTT user permissions to the minimum required
- Run the server on an internal network only
- Monitor logs for suspicious activity

## FoundryVTT Authentication

By default the MCP server connects through authenticated Socket.IO using a standard Foundry account. No Foundry module is required for the supported world-snapshot reads or Socket.IO writes. Setting `FOUNDRY_API_KEY` instead selects a different REST transport; it does not add REST capabilities alongside the Socket.IO session. See [Capability Matrix](./capabilities.md) for the exact mode-specific tool support.

### Socket.IO setup

1. Ensure FoundryVTT is running with an active world (not on the setup screen)
2. Create or use an existing FoundryVTT user account with appropriate permissions
3. Add credentials to your `.env` file

### Authentication Flow

The server authenticates via a 4-step Socket.IO flow:

1. Fetches the `/join` page to obtain a session cookie
2. Extracts the session cookie from the response
3. Resolves the username to a user ID (or uses `FOUNDRY_USER_ID` if set)
4. Emits `joinGame` with credentials to receive the complete world state

### Required permissions

The Foundry user needs access to the documents the tools will read. Write operations also require appropriate GM/owner permissions and `FOUNDRY_WRITE_ENABLED=true`; an active Socket.IO session is mandatory. Pack search is not part of the default world snapshot and requires the optional REST transport.

### Optional: REST-mode compendium search and diagnostics

The **Foundry Local REST API** module enables REST-only `search_compendium` and backend diagnostics endpoints. There are five diagnostics tool names, but `diagnose_errors` remains a **stub** and `get_health_status` provides a partial local summary without the backend. **Setting `FOUNDRY_API_KEY` changes the connection mode; it cannot be combined with Socket.IO write tools in the current implementation.**

To configure this optional mode:

1. In FoundryVTT: **Setup** > **Add-on Modules** > **Install Module**
2. Paste: `https://github.com/laurigates/foundryvtt-mcp/releases/latest/download/module.json`
3. Enable the module in your world and copy the generated API key
4. Add to `.env`:
   ```env
   FOUNDRY_API_KEY=your_api_key_here
   ```
