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
| `FOUNDRY_API_KEY` | **Historical** `/api/*` bridge key; chooses `legacy-rest` by default, not the relay |
| `FOUNDRY_PROVIDER` | Optional explicit `socketio`, `legacy-rest`, `rest-api` or `composite` |
| `FOUNDRY_REST_RELAY_URL`, `FOUNDRY_REST_API_KEY`, `FOUNDRY_REST_CLIENT_ID` | Paired runtime relay configuration (separate from `FOUNDRY_API_KEY`) |
| `FOUNDRY_REST_EXECUTE_JS_PATH` | Optional relay execution endpoint path |
| `FOUNDRY_EXPECTED_WORLD_ID`, `FOUNDRY_EXPECTED_ORIGIN` | Optional destination-identity pins; world ID required for composite targets |
| `FOUNDRY_WRITE_ENABLED` | Single-target write opt-in, default `false` |
| `FOUNDRY_PYTHON_EXECUTABLE` | Optional Python executable (default `python3`) |
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

Each target accepts `id`, optional `label`, `provider`, optional `expectedWorldId` / `expectedOrigin`, `writeEnabled` (default `false`), `pythonExecutable` (default `python3`), `integrationTimeoutMs` (default `10000`), and `integrationsEnabled` (default `true`). Target IDs are unique and URL-safe. The provider-specific options and expected identity checks are documented in [Providers and targets](providers-and-targets.md).

## Providers and capabilities

| Provider kind | Connection model | Capabilities and limits |
|---|---|---|
| `socketio` | Authenticated native Foundry session | World cache, read tools, native `modifyDocument` writes when permitted |
| `legacy-rest` | Historical `/api/*` bridge | Bridge reads, compendium and REST diagnostics; not equivalent to a Socket.IO world cache |
| `rest-api` | Paired relay with `clientId` and authenticated runtime | Snapshot reads and package-owned JS bindings; may perform target-enabled document writes through runtime APIs |
| `composite` | Socket.IO core + relay execution | Core documents via Socket.IO, integration bindings through paired relay; remote identity must agree |

Capability support is **checked per target** by `src/tools/catalog.ts`. A tool can appear in discovery because one target supports it but still be unavailable when called for a different target. For exact implemented operations see [Capability matrix](capabilities.md). No automatic provider failover occurs after a failed write.

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
