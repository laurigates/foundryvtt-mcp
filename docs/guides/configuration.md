# Configuration Guide

## Environment Variables

Copy `.env.example` and set the required values:

```bash
cp .env.example .env
```

### Required

| Variable | Description |
|----------|-------------|
| `FOUNDRY_URL` | FoundryVTT server URL (e.g. `http://localhost:30000`) |
| `FOUNDRY_USERNAME` | FoundryVTT user account |
| `FOUNDRY_PASSWORD` | FoundryVTT user password |

### Optional

| Variable | Default | Description |
|----------|---------|-------------|
| `FOUNDRY_USER_ID` | — | 16-char document `_id` (bypasses username resolution) |
| `FOUNDRY_API_KEY` | — | REST API module key (enables 5 diagnostics tools) |
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

The MCP server connects to FoundryVTT via Socket.IO using a standard user account. No custom modules are required for full game data access.

### Setup

1. Ensure FoundryVTT is running with an active world (not on the setup screen)
2. Create or use an existing FoundryVTT user account with appropriate permissions
3. Add credentials to your `.env` file

### Authentication Flow

The server authenticates via a 4-step Socket.IO flow:

1. Fetches the `/join` page to obtain a session cookie
2. Extracts the session cookie from the response
3. Resolves the username to a user ID (or uses `FOUNDRY_USER_ID` if set)
4. Emits `joinGame` with credentials to receive the complete world state

### Required Permissions

Your FoundryVTT user needs:

- View actors, items, scenes, and journals
- Access compendium data
- Use dice rolling API

### Optional: Diagnostics Tools

Installing the **Foundry Local REST API** module adds 5 server monitoring tools (`get_recent_logs`, `search_logs`, `get_system_health`, `diagnose_errors`, `get_health_status`):

1. In FoundryVTT: **Setup** > **Add-on Modules** > **Install Module**
2. Paste: `https://github.com/laurigates/foundryvtt-mcp/releases/latest/download/module.json`
3. Enable the module in your world and copy the generated API key
4. Add to `.env`:
   ```env
   FOUNDRY_API_KEY=your_api_key_here
   ```
