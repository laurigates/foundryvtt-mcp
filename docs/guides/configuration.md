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
| `FOUNDRY_USERNAME` | Socket.IO mode | Foundry user name. |
| `FOUNDRY_PASSWORD` | Socket.IO mode | Foundry user password. |
| `FOUNDRY_API_KEY` | Optional REST bridge | The key of the [REST bridge](#optional-rest-bridge-augment). With `FOUNDRY_REST_URL` and Socket.IO credentials it enables dual mode. |
| `FOUNDRY_REST_URL` | Optional REST bridge | The bridge server's URL (e.g. `http://localhost:3030`), an http/https URL. Without it, a set `FOUNDRY_API_KEY` selects the deprecated REST-only mode. |

### Optional

| Variable | Default | Description |
|----------|---------|-------------|
| `FOUNDRY_USER_ID` | — | 16-char user document `_id`; an **alternative to `FOUNDRY_USERNAME`** in Socket.IO mode (bypasses username resolution). |
| `FOUNDRY_SOCKET_PATH` | `/socket.io/` | Custom Socket.IO endpoint for reverse-proxy route prefixes. |
| `FOUNDRY_WRITE_ENABLED` | `false` | Allow the mutating MCP tools **only** with an active authenticated Socket.IO connection and Foundry GM/owner permissions. |
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

By default the MCP server connects through authenticated Socket.IO using a standard Foundry account. No Foundry module is required for the supported world-snapshot reads or Socket.IO writes. The optional [REST bridge](#optional-rest-bridge-augment) adds what only code inside Foundry can see, alongside the Socket.IO session (dual mode). See the [capability matrix — connection modes](./capabilities.md#connection-modes) for the canonical, mode-specific tool support.

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

The Foundry user needs access to the documents the tools will read. Write operations also require appropriate GM/owner permissions and `FOUNDRY_WRITE_ENABLED=true`; an active Socket.IO session is mandatory. Pack search is not part of the default world snapshot and requires the optional REST bridge.

### Optional: REST bridge augment

The REST bridge is [laurigates/foundryvtt-local-rest-api](https://github.com/laurigates/foundryvtt-local-rest-api). In dual mode it adds prepared dnd5e values (AC, character max HP, save totals), Foundry's dice engine, compendium search, logs and system health to the Socket.IO session. The [capability matrix](./capabilities.md#tools-by-mode) lists what it changes per tool. Socket.IO stays primary: writes, combat, journals and live updates never go through the bridge, and a failed bridge call falls back to the Socket.IO answer.

It has two parts, because module code runs in the browser and cannot serve HTTP:

- a **Foundry module**, which runs in a browser client and reads the game data;
- a **bridge server** (Node.js, port `3030` by default), which serves the REST API, logs in to Foundry as its own world user, and relays each request to the module.

The bridge answers only while a **Gamemaster is logged in through a browser** with the module enabled. Without that client, dual mode serves the Socket.IO answers only.

**Status:** the module has **no published release yet** (laurigates/foundryvtt-local-rest-api#2), so there is no manifest URL to paste into Foundry's module installer. It is verified on Foundry v13; the v14 port is in review (laurigates/foundryvtt-local-rest-api#4). Some routes the MCP uses do not work yet (laurigates/foundryvtt-local-rest-api#6): until that is fixed, compendium search, logs and system health report as unavailable even with a working bridge.

Until a release exists, install from a checkout of that repository and follow its README:

1. Put the module in your Foundry data directory under `Data/modules/foundryvtt-local-rest-api`, enable it in your world, turn on **Enable REST API** in its module settings and copy the generated API key.
2. Configure the bridge server in the checkout's `bridge-server/` directory: the Foundry URL, the API key, and the world user it logs in as. Start it and check `http://localhost:3030/api/status`.
3. Keep a Gamemaster logged in through a browser.
4. Add to the MCP's `.env`, alongside the Socket.IO credentials:
   ```env
   FOUNDRY_API_KEY=your_api_key_here
   FOUNDRY_REST_URL=http://localhost:3030
   ```

`FOUNDRY_URL` keeps pointing at Foundry itself. `get_health_status` shows the mode (`Socket.IO + REST bridge (dual)`) and whether the bridge is reachable.

**Deprecated REST-only mode.** `FOUNDRY_API_KEY` without Socket.IO credentials, or with credentials but no `FOUNDRY_REST_URL`, still selects the old REST-only mode, in which `FOUNDRY_URL` must point at the bridge. It has no writes, combat, journals, chat or live updates, and logs a warning at startup. Set `FOUNDRY_URL` to Foundry and `FOUNDRY_REST_URL` to the bridge to move to dual mode.
