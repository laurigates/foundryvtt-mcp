# Providers and target configuration

One local MCP process can maintain several independently configured Foundry
connections. A target identifies a world/runtime already reachable through its
provider; this server does not host or launch additional Foundry worlds.

## Run the overhaul branch

The overhaul is delivered on `feat/multiworld-provider-overhaul`; this change does
not publish a new npm release. Run the checkout to exercise these features:

```bash
git clone --branch feat/multiworld-provider-overhaul https://github.com/p4535992/foundryvtt-mcp.git
cd foundryvtt-mcp
npm install
npm run build
```

Point your MCP client at `node` with the checkout's absolute `dist/index.js`
path, and supply the environment settings below. For several targets, copy the
example configuration to a local file, replace its placeholders, and set
`FOUNDRY_TARGETS_FILE` to that file's absolute path. The existing setup wizard
continues to help with a legacy single-target configuration.

## Single-target compatibility

Existing configuration continues to describe one target, named `default`:

```dotenv
FOUNDRY_URL=http://localhost:30000
FOUNDRY_USERNAME=Assistant
FOUNDRY_PASSWORD=your-world-user-password
FOUNDRY_WRITE_ENABLED=false
```

With no API key this chooses `socketio`. The historical `FOUNDRY_API_KEY` selects
`legacy-rest`, the existing `/api/*` bridge. It is not the ThreeHats relay key.

Select the new relay provider explicitly:

```dotenv
FOUNDRY_PROVIDER=rest-api
FOUNDRY_REST_RELAY_URL=https://relay.example.invalid
FOUNDRY_REST_API_KEY=your-relay-key
FOUNDRY_REST_CLIENT_ID=your-paired-client-id
FOUNDRY_EXPECTED_WORLD_ID=your-world-id
FOUNDRY_EXPECTED_ORIGIN=https://foundry.example.invalid
FOUNDRY_PYTHON_EXECUTABLE=python3
FOUNDRY_WRITE_ENABLED=false
```

`FOUNDRY_PROVIDER=composite` combines the direct Socket.IO settings with the relay
settings. It requires an expected world ID and verifies that both components
identify the same world, origin, and system. The execution runtime's user may
have different permissions from the core connection; inspect the configured
accounts and runtime permissions before enabling writes.

## Multiple targets

Set exactly one of:

- `FOUNDRY_TARGETS_FILE=/absolute/path/foundry-targets.local.json`;
- `FOUNDRY_TARGETS_JSON`, containing the equivalent JSON.

The file format is `{ "version": 1, "targets": [...] }`; a bare target array is
also accepted. Explicit target configuration does not require `FOUNDRY_URL`.
Use [the example configuration](../../examples/targets.example.json) as a starting
point. Its `.invalid` addresses and credential references must be replaced.

Each target has:

| Field | Meaning |
|---|---|
| `id` | Stable, unique local routing ID, such as `campaign-a` |
| `label` | Optional display name |
| `provider` | Explicit provider configuration |
| `expectedWorldId` | Optional identity pin; required for a composite target |
| `expectedOrigin` | Optional expected Foundry origin |
| `writeEnabled` | Target-local write opt-in, default `false` |
| `pythonExecutable` | Python executable/path, default `python3` |
| `integrationTimeoutMs` | Worker operation timeout, default `10000` |
| `integrationsEnabled` | Whether to load system/module integrations, default `true` |

Credentials can be supplied as `usernameEnv`, `passwordEnv`, or `apiKeyEnv` in a
provider object. These fields name environment variables; their values are
resolved locally. A literal credential and its environment reference cannot be
specified together. Explicit targets do not inherit `FOUNDRY_WRITE_ENABLED`.

## Provider choices

| Kind | Configuration | Execution model |
|---|---|---|
| `socketio` | `baseUrl`, world user credentials, optional socket/timeouts | Native documents and world cache |
| `legacy-rest` | `baseUrl`, `apiKey` | Historical `/api/*` bridge; capability-limited |
| `rest-api` | `relayUrl`, `apiKey`, `clientId`, optional `executeJsPath` | Paired runtime through the relay |
| `composite` | `core` socket configuration and `execution` relay configuration | Deterministic core/runtime composition |

The REST provider currently uses `POST /execute-js`, with the configured client
ID in the query and body, and expects a JSON `{ "success": true, "result": ... }`
envelope. `executeJsPath` (or `FOUNDRY_REST_EXECUTE_JS_PATH` for environment
configuration) changes the route on the same relay. No redirects are followed.
The paired Foundry runtime must permit this operation. Credentials and runtime
permissions are configured upstream; this server does not enable those settings.

The relay backend obtains a world snapshot and executes fixed package-owned
bindings. It does not expose arbitrary JavaScript as an MCP tool. Protocol tests
use a local fake relay; verify the chosen upstream relay version and a real
Foundry runtime before relying on live compatibility.

The standalone relay backend does not subscribe to native document broadcasts.
Its core reads use the last snapshot; changes made elsewhere in Foundry require
`refresh_world_data`. Integration bindings read their requested data directly in
the runtime. The composite provider retains the native connection's document
updates for core access.

## Routing and discovery

Use `list_targets` first. Management tools remain available when worlds are
unreachable:

- `list_targets` — states, capabilities, and catalog conflicts;
- `get_target_status` — one target's identity and integration diagnostics;
- `list_systems` / `list_modules` — per-target integration availability;
- `reconnect_target` — explicit recovery of one configured target.

When one target is configured, `target_id` may be omitted. With multiple configured
targets it is mandatory, even when only one is online. It never changes implicitly
because a target disconnected.

Example MCP call arguments:

```json
{
  "name": "module_item-piles_get_items",
  "arguments": {
    "target_id": "campaign-a",
    "actor_uuid": "Actor.REPLACE_WITH_ACTOR_ID"
  }
}
```

Resources include the target:

```text
foundry://targets/campaign-a/actors
foundry://targets/campaign-b/actors
```

Legacy resource aliases such as `foundry://actors` work only when the target is
unambiguous. Tool results include target provenance. Core tools and integration
tools are listed according to actual capability and availability; the exact same
catalog handles their calls. A tool cached by an MCP client is checked again
before invocation.

## Lifecycle, writes, and freshness

Every target has its own connection generation, cache, diagnostics, integration
instances, and optional Python worker. A failure does not redirect requests to
another target. Reconnection and explicit refresh rebuild the affected runtime
context. A changed remote world/origin is rejected until the configuration and
connection are deliberately reconciled.

Operations on the same target are serialized; different targets remain
independent and can run concurrently. Before a subsequent cache-backed core
call, stale data is refreshed within that target's operation queue. This routine
freshness check preserves the session generation and Python worker. An explicit
`refresh_world_data` or reconnect deliberately rebuilds the runtime context.

Writes invalidate relevant cached state. Relay writes invalidate before dispatch
and again when they settle, including uncertain outcomes. A failed refresh is a
separate readiness problem; the mutation is not replayed.

A mutation timeout or lost connection can produce `outcome_unknown`. Inspect the
world before deciding whether to retry. The server does not automatically replay
such requests and does not provide distributed transactions or deduplication.

## Python and installed packages

Python 3.10 or later is required only for targets with executable Python
integrations. One worker hosts the system and module adapters for its target.
The initial adapters use the Python standard library. The worker is loaded from
the installed package, independently of the current working directory.

A missing Python executable, invalid manifest, failed API probe, or incompatible
version is reported in integration status. The healthy core connection remains
usable. The initial D&D 5e, PF2e, and Item Piles packages are experimental reads;
their READMEs deliberately list no unperformed live compatibility tests.
