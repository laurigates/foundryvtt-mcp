# ADR-011: Providers, isolated targets, and system/module integrations

**Status:** Accepted for implementation on `feat/multiworld-provider-overhaul`

**Date:** 2026-11-19

**Baseline:** `1b59ec4c710de9dff868e83b3474caa3d40f1632`

## Context

The MCP server needs extensible integrations for Foundry game systems and modules,
including Item Piles, and must be able to address more than one live world from a
single local MCP process. The existing client combines Socket.IO, a historical
HTTP bridge contract, caches, and domain projections. MCP discovery and execution
also use different paths. Adding only a module execution gateway would leave the
core outside the new architecture.

The agreed scope is a complete application-boundary migration. Core tools,
resources, diagnostics, and extensions all resolve a target session and use its
provider. The working transport implementation is reused behind that boundary.

## Decisions

### 1. One provider boundary for each target

`FoundryCore` defines the document and core-operation port. `FoundryProvider`
adds identity inspection, capabilities, lifecycle generations, and execution of
repository-owned runtime bindings. Handlers depend on interfaces, not a concrete
transport client. The historical client import is retained as a compatibility
export for existing consumers/tests, not as a second application connection.

Providers are selected before dispatch:

- `socketio`: the existing direct Foundry connection and per-instance world cache;
- `legacy-rest`: the historical `/api/*` bridge contract;
- `rest-api`: the ThreeHats relay/runtime execution contract;
- `composite`: explicit core Socket.IO plus runtime REST execution for one world.

The historical `FOUNDRY_API_KEY` retains its historical meaning. A relay API key
is configured separately. A future native bridge can implement the same ports.

Provider composition assigns operations to components deterministically. It is
not retry-based failover. A transport's capabilities are explicit; sharing an
interface does not imply that every backend implements every operation.

A composite target is ready only while both components are connected and their
identities agree. Degraded native-only operation is deliberately outside this
contract; independent native access requires a separately configured target.

### 2. Targets and sessions are the unit of isolation

`target_id` is a stable local configuration identifier, distinct from the remote
world ID, a relay client ID, and a connection generation. The session manager owns
a collection of targets even when only one is configured.

Each session owns its provider, world cache, diagnostics context, integration
availability, Python worker, write setting, and pending work. A disconnected
target does not stop other targets or MCP management tools. Expected world and
origin checks bind the configured destination to the observed runtime.

Connection generations prevent results from an old connection being accepted
into a replacement session. A timeout after dispatching a write has an unknown
outcome; it does not authorize another send.

Ordinary operations are serialized within a target, while different targets can
operate concurrently. Automatic cache freshness runs in that same queue without
replacing the session. This prevents a concurrent read from interrupting a write
or refreshing a pre-write snapshot and treating it as current. Explicit lifecycle
refresh/reconnect still invalidates work from the previous generation. A queued
write cancelled before dispatch is distinguished from an in-flight unknown
outcome.

The session's operation context also guards every individual provider dispatch,
including later steps in a multi-step core method and Python callbacks. Rejecting
an old public result alone is insufficient: an old continuation must not acquire
a replacement connection and send another mutation. Ordinary queue ownership
lasts until tracked local provider work settles, even when a worker reports an
earlier error. Generation replacement fences future sends; it neither rolls back
completed steps nor guarantees remote cancellation after a timeout.

Native authentication is abortable and bounded per HTTP/join stage. Session close
is idempotent in completion as well as state: concurrent callers await the same
cleanup. Native world identity must contain a valid nonempty world ID; display
fallbacks cannot establish a session identity.

### 3. Explicit routing instead of mutable global selection

All target-bound tools accept `target_id`. It may be omitted only when exactly
one target is configured. Two configured targets remain ambiguous even when only
one is online. There is no shared mutable current-world selection.

Resources use `foundry://targets/<target_id>/<resource-path>`. Historical resource
URIs remain aliases only when target resolution is unambiguous. Results identify
their source target and session generation.

### 4. Separate `systems/` and `modules/`, shared infrastructure

Both directories contain trusted, locally distributed integration packages:

- `manifest.json`;
- `adapter.py`;
- `README.md`;
- runtime bindings/probes and tests as needed.

The manifest discriminates `kind: system | module`. The integration manager,
protocol, loader, validation, catalog registration, and lifecycle are shared.
The adapter matching the world's system is selected independently from adapters
for its active modules.

Runtime package validation isolates malformed packages and withholds all
participants in a name collision. Unrelated valid packages remain available;
development/package checks can use the loader's strict mode to reject the whole
load. Errors stay visible in per-target integration status.

Systems own system-specific API and data interpretation. Modules own their own
public API bindings. The provider owns the execution mechanism and contains no
per-module dispatch table. Core documents remain generic; system projections are
declared with the corresponding system package.

A missing local system adapter does not disable generic core operations or an
independent module. Compatibility with a system is distinct from dependence on
a capability supplied by our system adapter. Foundry and upstream modules remain
responsible for their own installation dependencies.

### 5. Exact upstream identifiers in tool names

Public names are constructed as:

```text
system_{system_id}_{operation_id}
module_{module_id}_{operation_id}
```

For example: `system_dnd5e_get_actor_data`, `system_pf2e_get_actor_data`, and
`module_item-piles_get_items`. The hyphen in `item-piles` is preserved. The
registry stores kind, ID, and operation separately; it never reconstructs them
by splitting a public name. Invalid names and collisions are rejected rather
than silently normalized.

`target_id` stays an argument, not a tool-name suffix. One public name has one
input contract across targets. Incompatible schemas are reported and withheld,
not replaced by whichever session loaded last.

The integration result schema is embedded as its own JSON Schema resource inside
the provenance wrapper. Preserve local references, recursion and nested `$id`
scope; do not rewrite reference strings indiscriminately. Synthetic resource
IDs are deterministic for equivalent tool/schema contracts and require no remote
schema resolution. External schema registration remains outside the loader's
current contract.

### 6. Python adapters with a private process protocol

One optional Python worker belongs to each target and hosts all its active
integrations. This deliberately spends some process overhead for isolation and
independent failure/cleanup. The provider and its credentials remain in Node.

The versioned JSONL protocol is bidirectional: Node invokes an adapter; the
adapter invokes its bound operation through a proxy; Node executes the packaged
binding and returns JSON. IDs, generation checks, timeouts, and call tokens keep
requests correlated. Python logs use stderr; worker stdout is private and never
inherited by the MCP stdout transport.

Closing a worker is terminal. A delayed request cannot restart it after the
owning manager has invalidated its calls. Call tokens preserve the originating
operation context across the subprocess callback boundary.

No Python interpreter is needed by targets without executable Python integrations.
Dependencies are not installed automatically. The worker environment excludes
provider credentials. Trusted integration code is not an untrusted-code sandbox.

### 7. `execute-js` is an implementation detail

The REST provider executes fixed bindings owned by integration packages with
JSON-serialized arguments. There is no free-form JavaScript MCP tool. Bindings
resolve runtime documents, call public APIs, and return serializable results.

A different provider must support the same binding/operation contract or declare
the operation unsupported. Merely defining an `execute` method does not guarantee
portability. Runtime API probes and version declarations are separate checks.

### 8. Availability is per operation and per target

Installed, active, compatible, runtime-ready, and executable are separate
conditions. A module's active flag is not proof that its API is ready. Discovery
is reconciled on connection, refresh, and reconnection. Calls recheck their target
even if a client cached an earlier catalog.

MCP tool listing and calls use one application catalog. Tools available on any
target can be listed; calls must be supported on the requested target. Catalog
changes generate MCP list-change notifications.

### 9. Writes remain target-scoped and explicit

The existing write opt-in becomes a target setting. Explicit multi-target
configuration does not inherit a global write enable flag. Foundry/runtime
permissions continue to apply.

Reads and writes carry their actual operation classification. Unknown write
outcomes are surfaced without automatic retry, transport fallback, or movement
to another target. Correlation IDs alone do not provide deduplication or atomic
transactions across documents/worlds.

Native success acknowledgements must contain valid result data; malformed
acknowledgements produce an unknown outcome and invalidate the cache. Explicit
remote rejection remains a distinct error. Worker loss after a mutating runtime
callback began is also potentially unknown; a worker timeout alone cannot prove
that the remote write failed.

### 10. Version information describes evidence

Each integration documents its adapter version/update date, upstream reference,
upstream update date where known, last verification date, capabilities, and actual
tested combinations. The remote installed version belongs to session status.

The initial adapters are experimental. Empty tested-version lists mean no live
compatibility claim. A runtime method probe is not equivalent to a live test of
all system rules. The initially shipped operations are read operations; examples
of proposed skill-roll names in the design discussion are not advertised as
implemented roll methods.

## Alternatives considered

- Keeping a global core client beside a new module gateway: rejected because the
  agreed overhaul covers all application access to Foundry.
- Putting Item Piles beside transport adapters: rejected because it is a feature
  integration and belongs under `modules/`.
- Combining systems and modules into one public directory: rejected to keep
  their different activation and domain responsibilities visible.
- Global `select_world`: rejected because concurrent requests could change each
  other's destinations.
- One tool name per world: rejected because it multiplies the catalog; routing
  is an argument instead.
- Normalizing upstream IDs: rejected because it breaks identity correspondence
  and can introduce collisions.
- Automatic fallback after a write timeout: rejected because the first write
  may already have completed.
- A process for every module: unnecessary for the initial scope; a process per
  target gives the required isolation.

## Consequences and validation

The application is more explicit about unsupported capabilities, stale sessions,
and unavailable integrations. It gains an additional optional Python runtime and
packaging responsibility. Provider tests, two-target isolation tests, real worker
process tests, and installed-package smoke tests are required. Live Foundry tests
remain a distinct verification tier requiring an actual world and runtime.

See [the implementation record](../prps/provider-session-integration-overhaul.md),
[configuration guide](../guides/providers-and-targets.md), and
[integration authoring guide](../guides/writing-integrations.md).
