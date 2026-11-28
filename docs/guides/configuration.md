# Configuration Guide

One MCP server process can connect to **one or several separately configured Foundry targets**. Every target selects a provider, has its own connection and cache, and can enable writes independently. The schema and default values are implemented in `src/config/targets.ts`. See [Providers and targets](providers-and-targets.md) for all provider options and the [example JSON](../../examples/targets.example.json).

## Choose exactly one configuration style

1. **Legacy/single-target environment:** ordinary `FOUNDRY_*` settings become one target (`default`, or `FOUNDRY_TARGET_ID` if set).
2. **Explicit target list:** set `FOUNDRY_TARGETS_FILE` **or** `FOUNDRY_TARGETS_JSON`; both together are invalid. An explicit list does **not** need `FOUNDRY_URL`, and does not inherit the global `FOUNDRY_WRITE_ENABLED` flag.

A target ID is a local routing identifier, not the Foundry world ID. With multiple configured targets, pass `target_id` for target-specific MCP tools regardless of which worlds are online. There is no mutable global selected world.

## Legacy single-target Socket.IO

Copy `.env.example` to `.env` and set, for example:

```dotenv
FOUNDRY_URL=http://localhost:30000
FOUNDRY_USERNAME=Assistant
FOUNDRY_PASSWORD=your-foundry-world-password
FOUNDRY_WRITE_ENABLED=false
```

With no `FOUNDRY_API_KEY` or explicit `FOUNDRY_PROVIDER`, this uses authenticated `socketio`. `FOUNDRY_USER_ID` can bypass username-to-ID lookup; it does not bypass Foundry authentication. An active world, appropriate user permissions and a reachable Socket.IO endpoint are needed.

| Setting | Purpose |
|---|---|
| `FOUNDRY_URL` | Server URL for legacy native/bridge targets, with HTTP(S) scheme |
| `FOUNDRY_USERNAME`, `FOUNDRY_PASSWORD` | Foundry world account for Socket.IO |
| `FOUNDRY_USER_ID` | Optional world user ID instead of username lookup |
| `FOUNDRY_SOCKET_PATH` | Socket.IO path (default `/socket.io/`) |
| `FOUNDRY_API_KEY` | **Historical** `/api/*` bridge key; with `FOUNDRY_REST_URL` and native credentials, enables read augmentation on the single Socket.IO target |
| `FOUNDRY_REST_URL` | Historical bridge URL; a key without this URL or native credentials retains the `legacy-rest` provider |
| `FOUNDRY_PROVIDER` | Optional explicit `socketio`, `legacy-rest`, `rest-api` or `composite` |
| `FOUNDRY_REST_RELAY_URL`, `FOUNDRY_REST_API_KEY`, `FOUNDRY_REST_CLIENT_ID` | Paired runtime relay configuration (separate from `FOUNDRY_API_KEY`) |
| `FOUNDRY_REST_EXECUTE_JS_PATH` | Optional relay execution endpoint path |
| `FOUNDRY_EXPECTED_WORLD_ID`, `FOUNDRY_EXPECTED_ORIGIN` | Optional destination-identity pins; world ID required for composite targets |
| `FOUNDRY_WRITE_ENABLED` | Single-target write opt-in, default `false` |
| `FOUNDRY_TIMEOUT`, `FOUNDRY_RETRY_ATTEMPTS`, `FOUNDRY_RETRY_DELAY` | Native/legacy transport timeouts and read retry settings |
| `LOG_LEVEL`, `NODE_ENV` | Server logging/environment |
| `CACHE_ENABLED`, `CACHE_TTL_SECONDS`, `CACHE_MAX_SIZE` | Legacy cache configuration; `CACHE_MAX_SIZE` must be a positive integer |

The relay-only legacy environment can use `FOUNDRY_PROVIDER=rest-api` with its `FOUNDRY_REST_*` settings instead of a separate native server URL. `USE_REST_MODULE` is ignored; it does not enable a second transport.

## Multiple targets

Put the following in a **local, private** JSON file, for example `foundry-targets.local.json`, and set `FOUNDRY_TARGETS_FILE` to its absolute path:

```json
{
  "version": 1,
  "targets": [
    {
      "id": "campaign-a",
      "provider": {
        "kind": "socketio",
        "baseUrl": "https://foundry-a.example.invalid",
        "usernameEnv": "FOUNDRY_A_USERNAME",
        "passwordEnv": "FOUNDRY_A_PASSWORD"
      },
      "writeEnabled": false
    },
    {
      "id": "campaign-b",
      "provider": {
        "kind": "socketio",
        "baseUrl": "https://foundry-b.example.invalid",
        "usernameEnv": "FOUNDRY_B_USERNAME",
        "passwordEnv": "FOUNDRY_B_PASSWORD"
      },
      "writeEnabled": false
    }
  ]
}
```

The `.invalid` URLs are placeholders; do not use them as live endpoints. `FOUNDRY_TARGETS_JSON` accepts the same JSON inline as an alternative to a file. Each provider may use `usernameEnv`, `passwordEnv` and `apiKeyEnv` instead of literal credentials; do not specify a literal value and an environment reference for the same field.

Each target accepts `id`, optional `label`, `provider`, optional `expectedWorldId` / `expectedOrigin`, `writeEnabled` (default `false`) and `integrationsEnabled` (default `true`). Target IDs are unique and URL-safe. A Socket.IO provider can additionally configure `restUrl` together with `restApiKey` or `restApiKeyEnv` for historical bridge augmentation; native credentials remain required. The provider-specific options and expected identity checks are documented in [Providers and targets](providers-and-targets.md).

## Providers and capabilities

| Provider kind | Connection model | Capabilities and limits |
|---|---|---|
| `socketio` | Authenticated native Foundry session, optionally augmented by its historical REST bridge | World cache, read tools, native `modifyDocument` writes when permitted; bridge-provided prepared values, compendium search and diagnostics when configured |
| `legacy-rest` | Historical `/api/*` bridge | Bridge reads, compendium and REST diagnostics; not equivalent to a Socket.IO world cache |
| `rest-api` | Paired relay with `clientId` and authenticated runtime | Snapshot reads and package-owned JS bindings; may perform target-enabled document writes through runtime APIs |
| `composite` | Socket.IO core + relay execution | Core documents via Socket.IO, integration bindings through paired relay; remote identity must agree |

Capability support is **checked per target** by `src/tools/catalog.ts`. A tool can appear in discovery because one target supports it but still be unavailable when called for a different target. For exact implemented operations see [Capability matrix](capabilities.md). No automatic provider failover occurs after a failed write.

## Optional REST bridge augment

The historical bridge is [laurigates/foundryvtt-local-rest-api](https://github.com/laurigates/foundryvtt-local-rest-api). It has a Foundry module running in a browser client and a separate Node bridge server (port `3030` by default). It needs a Gamemaster logged into the world through a browser with the module enabled. It is distinct from the ThreeHats paired relay used by `rest-api` and `composite` integration execution.

1. Install the Foundry module using `https://github.com/laurigates/foundryvtt-local-rest-api/releases/latest/download/module.json`, enable it in the world, enable its REST API setting and copy its API key.
2. Configure the repository's `bridge-server/` component with the Foundry URL, that API key and the world user it should use, then start the bridge server.
3. Keep a Gamemaster logged into the world through a browser with the module enabled. See the bridge's [usage guide](https://github.com/laurigates/foundryvtt-local-rest-api/blob/main/docs/usage.md#installation) for its complete installation configuration.

For the legacy single-target environment, keep `FOUNDRY_URL` and the native credentials pointing at Foundry, then set:

```dotenv
FOUNDRY_API_KEY=your-historical-bridge-key
FOUNDRY_REST_URL=http://localhost:3030
```

For an explicit target, set `provider.kind` to `socketio`, keep its native connection fields, and add `restUrl` plus `restApiKeyEnv` (or `restApiKey`). The bridge URL and key must be supplied together. These settings belong to that target; explicit targets do not inherit a global bridge configuration.

The bridge augments prepared actor values, dice rolling, compendium search and diagnostics. Socket.IO remains the source for native document mutations and the live world cache. A bridge read failure falls back to the native answer where one exists, or reports the unavailable capability. A transport failure pauses the bridge; a server error pauses the affected capability. Those pauses last 30 seconds and do not replay writes. Native connection startup does not depend on a successful bridge response.

A legacy environment key without the complete combination of bridge URL and native credentials keeps the historical `legacy-rest` mode. In that mode `FOUNDRY_URL` points to the bridge, and native world-cache operations and Socket.IO writes are unavailable. `FOUNDRY_REST_RELAY_URL`, `FOUNDRY_REST_API_KEY` and `FOUNDRY_REST_CLIENT_ID` continue to configure the separate paired relay.

The historical bridge is authenticated by probing `/api/world`; a successful `/api/status` response from Foundry itself does not establish that the bridge or the API key works.

## Resources and diagnostics

Use `list_targets` and `get_target_status` to inspect remote identity, connection state, capabilities and integration availability. With multiple targets, resource URIs are qualified:

```text
foundry://targets/campaign-a/actors
foundry://targets/campaign-b/actors
```

Historical unqualified aliases such as `foundry://actors` are accepted only when target selection is unambiguous. Relay snapshot reads may require an explicit `refresh_world_data` after changes performed by another client.

## Security and verification

- Keep passwords, keys, token files and local target JSON containing secrets out of source control. For remote Foundry, use HTTPS and correctly forward Socket.IO traffic.
- Default to `writeEnabled: false`. A target write opt-in **and** appropriate provider capabilities and Foundry permissions are necessary. Different provider kinds have different write execution mechanisms.
- Relay execution is limited to trusted, packaged bindings; it is not a general-purpose JavaScript MCP tool.
- Mutation timeouts can have an **unknown outcome**; inspect the selected world before any retry. Reconnect/refresh is target-specific.
- Validate with `just qa` and `just build`. For connection checks run `bun run test-connection` against your actual configured targets. Local fake-relay tests do not prove upstream live compatibility.

For connection problems see [Troubleshooting](../../TROUBLESHOOTING.md) and [the target configuration guide](providers-and-targets.md).
