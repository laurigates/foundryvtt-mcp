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

With no API key this chooses `socketio`. When `FOUNDRY_API_KEY`,
`FOUNDRY_REST_URL` and native credentials are all present, the historical
`/api/*` bridge augments that Socket.IO target. A key without the complete
combination keeps `legacy-rest`. `FOUNDRY_PROVIDER=socketio` explicitly keeps
native access; a key alone does not switch an explicitly selected native provider.
The historical bridge key is not the ThreeHats relay key.

Select the new relay provider explicitly:

```dotenv
FOUNDRY_PROVIDER=rest-api
FOUNDRY_REST_RELAY_URL=https://relay.example.invalid
FOUNDRY_REST_API_KEY=your-relay-key
FOUNDRY_REST_CLIENT_ID=your-paired-client-id
FOUNDRY_EXPECTED_WORLD_ID=your-world-id
FOUNDRY_EXPECTED_ORIGIN=https://foundry.example.invalid
FOUNDRY_WRITE_ENABLED=false
```

`FOUNDRY_PROVIDER=composite` combines the direct Socket.IO settings with the relay
settings. It requires an expected world ID and verifies that both components
identify the same world, origin, and system. Known Foundry generations must also
match: different builds within one generation are accepted, while an unknown
generation is not inferred from the other connection. The execution runtime's user may
have different permissions from the core connection; inspect the configured
accounts and runtime permissions before enabling writes.

A composite target requires **both** connections to be available. A failed relay
also makes its core tools unavailable through that target, even if the native
socket remains connected. This is the intentional readiness contract: there is
no degraded native-only mode or automatic failover. Configure a separate
`socketio` target when independent native access is required.

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
| `integrationsEnabled` | Whether to load system/module integrations, default `true` |

Credentials can be supplied as `usernameEnv`, `passwordEnv`, `apiKeyEnv`, or
`restApiKeyEnv` (the native provider's optional historical bridge key) in a
provider object. These fields name environment variables; their values are
resolved locally. A literal credential and its environment reference cannot be
specified together. Explicit targets do not inherit `FOUNDRY_WRITE_ENABLED`.

## Provider choices

| Kind | Configuration | Execution model |
|---|---|---|
| `socketio` | `baseUrl`, world user credentials, optional socket/timeouts and paired `restUrl` / `restApiKey` | Native documents and world cache, optionally augmented by historical bridge reads |
| `legacy-rest` | `baseUrl`, `apiKey` | Historical `/api/*` bridge; capability-limited |
| `rest-api` | `relayUrl`, `apiKey`, `clientId`, optional `executeJsPath` | Paired runtime through the relay |
| `composite` | `core` socket configuration and `execution` relay configuration | Deterministic core/runtime composition |

### Historical bridge read augmentation

A `socketio` provider, including the `core` of a composite, can set `restUrl`
and `restApiKey` (or `restApiKeyEnv`). The URL and key must be configured
together with native Socket.IO credentials. This optional bridge supplies
prepared actor fields, remote dice evaluation, compendium search and diagnostics;
Socket.IO still owns the native cache and writes. A failed bridge read can fall
back within the same provider where a native/local answer exists, without
changing target or retrying a write. Bridge failures and cooldowns are local to
that provider. See [bridge configuration](configuration.md#optional-rest-bridge-augment).

This optional augmentation does not change the composite's required paired-relay
contract. The historical bridge cannot execute the ThreeHats integration
bindings or replace the composite's `execution` provider.

### Paired runtime relay

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

Legacy resource aliases such as `foundry://actors` are listed and readable when
exactly one target is configured, ready and capable. Core tool content retains
its original shape; target provenance is additive in `_meta`. Integration tools
also include it in their declared structured wrapper. Core tools and integration
tools are listed according to actual capability and availability; the exact same
catalog handles their calls. A tool cached by an MCP client is checked again
before invocation. See [Backward compatibility](backward-compatibility.md).

## Lifecycle, writes, and freshness

Every target has its own connection generation, cache, diagnostics and integration
instances. A failure does not redirect requests to
another target. Reconnection and explicit refresh rebuild the affected runtime
context. A changed remote world/origin is rejected until the configuration and
connection are deliberately reconciled.

Native connection, refresh and identity inspection require a nonempty remote
world ID. A placeholder used for disconnected display is never accepted as a
session identity. Native authentication applies the configured timeout to each
HTTP or join stage, rather than one deadline for the whole login. Disconnecting
or replacing the connection aborts authentication already in progress. Repeated
session `close()` calls share the same cleanup completion.

Historical REST sessions inspect world identity before and after each successful
operation. A mismatch withholds the data and stops that target's queued work.
Because the bridge does not attach world identity to each data response, a world
switch and return entirely between those probes cannot be detected.

Operations on the same target are serialized; different targets remain
independent and can run concurrently. Before a subsequent cache-backed core
call, stale data is refreshed within that target's operation queue. This routine
freshness check preserves the session generation and integration state. An explicit
`refresh_world_data` or reconnect deliberately rebuilds the runtime context.

The operation context stays attached across asynchronous provider steps and
binding execution. Before every provider dispatch it checks the original session
and transport generation. After refresh, reconnect, close or operation
completion, a delayed continuation cannot send a new step in the old operation.
The ordinary target queue also waits for locally tracked provider requests to
settle after a public error. These guards stop
future sends; they cannot undo a mutation already received by Foundry or prove
that a remote request stopped executing after a local timeout.

Writes invalidate relevant cached state. Relay writes invalidate before dispatch
and again when they settle, including uncertain outcomes. A failed refresh is a
separate readiness problem; the mutation is not replayed.

Snapshot replacement is also guarded after asynchronous responses arrive. A late
automatic refresh or mutation result cannot overwrite a replacement session's
cache, including explicit refreshes that retain the same transport generation.
An obsolete connection attempt cannot clear the newer connection's snapshot.

Native write acknowledgements must have the expected envelope and result shape.
Malformed or missing success data leaves the outcome unknown and marks the
cache stale; an explicit remote rejection is reported separately. Native journal
page broadcasts update the journal cache, while cached document changes that
cannot be applied safely mark the snapshot stale for its next refresh.

A mutation timeout or lost connection can produce `outcome_unknown`. Inspect the
world before deciding whether to retry. The server does not automatically replay
such requests and does not provide distributed transactions or deduplication.

## Installed packages

Integration packages are plain JavaScript, so no additional runtime is required
beyond the Node.js host. The loader reads the installed package independently of
the current working directory and evaluates each declared binding and probe as a
script inside the selected operation context.

An invalid manifest, failed API probe, or incompatible
version is reported in integration status. The healthy core connection remains
usable. System and module packages provide explicitly classified reads, rolls
and mutations, each subject to the selected target's policy and runtime
permissions. All packages remain experimental and their READMEs distinguish
source inspection and local tests from live compatibility verification.

Generation packages live under `systems/<id>/<foundry-generation>/` and
`modules/<id>/<foundry-generation>/`. Each target selects only the folder matching
its observed Foundry version, for example `14/` for `14.370`. Missing generations
remain unavailable; the host does not try a neighboring version. This release
generation is separate from the session-generation counter used for reconnects.
The same upstream ID can therefore use independent adapters on targets running
different Foundry generations. Their source pins and adapter versions can differ.
See [external package installation](writing-integrations.md#install-a-third-party-adapter)
and the [system](../bridges/systems.md) / [module](../bridges/modules.md) catalogs.

Runtime package loading isolates malformed packages so unrelated valid packages
can still activate; inspect `list_systems`, `list_modules` or `get_target_status`
for failures. A closed worker is terminal and cannot be restarted by a delayed
call. If a mutating integration loses its worker response after invoking the
provider, it reports `outcome_unknown` and does not replay the request.

The original `module_item-piles_get_items` operation keeps its capability-based
availability. New Item Piles operations require module version `3.3.4`, Foundry
generation `13` or `14` through separate packages, and active `socketlib` /
`lib-wrapper` dependencies.
Unknown or different versions withhold those operations. Writes require a GM in
the paired runtime in addition to `writeEnabled: true`; reads require appropriate
document access. The two credentials of a composite target can represent
different users, so its native GM status does not establish runtime permission.
See the [Item Piles package](../../modules/item-piles/README.md) for arguments,
workflow limits and the source reference behind these gates. No live tested
combination is implied by them.
