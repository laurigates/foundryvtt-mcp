# ADR-011: Providers, isolated targets, and system/module integrations

**Status:** Accepted for implementation on `feat/multiworld-provider-overhaul`

**Date:** 2026-11-19

**Baseline:** `1b59ec4c710de9dff868e83b3474caa3d40f1632`

> **Superseded in part:** the Python adapter runtime described below was removed
> in the Node-only integration step. Manifests no longer declare an `entrypoint`,
> and the host evaluates the fixed bindings directly. The provider, session and
> target decisions in this ADR remain current; the Python transport sections are
> historical.

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

Both directories contain trusted, locally distributed integration packages under
`<upstream-id>/<foundry-generation>/`. Every generation is self-contained:

- `manifest.json`;
- `adapter.py`;
- `README.md`;
- runtime bindings/probes and tests as needed.

The manifest discriminates `kind: system | module` and declares the integer
`foundryGeneration` matching its directory. The integration manager,
protocol, loader, validation, catalog registration, and lifecycle are shared.
The exact observed Foundry generation selects a variant before Python import or
runtime probing. The world's single system is selected independently from its
active modules. Targets on different generations can use different variants of
the same integration at the same time. A missing variant does not fall back.

Versioned packages require Foundry generation 13 or later. Legacy flat packages
without generation metadata retain their schema-1 compatibility contract, but
cannot coexist with numeric variants for the same ID. Such a mixed layout is
rejected as ambiguous. Copying an external complete generation directory is
sufficient for discovery; no provider/registry table needs editing. Package-local
helpers and runtime resources must not depend on a sibling generation.

Runtime package validation isolates malformed packages and withholds all
participants in a name collision within overlapping generation scopes. The same
public operation name across distinct exact generations is allowed. Unrelated valid packages remain available;
development/package checks can use the loader's strict mode to reject the whole
load. A broken unselected variant is recorded without blocking a valid selected
variant. Status reports the selected and available generations plus variant errors.

Systems own system-specific API and data interpretation. Modules own their own
public API bindings. The provider owns the execution mechanism and contains no
per-module dispatch table. Core documents remain generic; system projections are
declared with the corresponding generation package. Core projection lookup also
uses the target's actual Foundry generation; missing or unidentified variants
leave raw document data instead of borrowing another generation's interpretation.

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

A larger package may generate standalone scripts from a package-local operation
registry and shared helper factory. Item Piles 0.2 uses this pattern: generated
manifest, binding and probe files are checked in and verified for drift during
build/tests. Generated files use the same fixed-binding protocol as hand-authored packages. A binding still
contains one fixed operation; JSON arguments cannot select an arbitrary method
or executable source. A probe constructs the same helper factory without running
the operation, keeping readiness and permission policy consistent.

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

### 7. Named operations are the contract; `execute-js` is compatibility

The REST provider sends **named operations** by default: `POST /mcp/operation`
with `{ clientId, operation, args, write }`. The relay resolves the identifier, so
no script source crosses the wire and the read-only claim holds for the transport
itself. Core work uses `core.snapshot`, `core.modify_document` and
`core.roll_dice`; a package operation is `<kind>.<id>.<generation>.<operation>`
and its readiness check is the same name with a `#probe` suffix.

The historical `execute-js` route remains a supported transport, selected
explicitly by `runtimeMode: 'execute-js'` or by setting `executeJsPath`. It posts
the package-owned binding source the manifest already declares; there is still no
free-form JavaScript MCP tool. A target cannot mix the two modes: the target
schema and the provider constructor reject `executeJsPath` with `named` and
`runtimePath` with `execute-js`.

Neither mode falls back to the other. A relay that does not implement an
operation fails the call; it is never downgraded to script execution. Identity is
verified by an optional `identity` echo in the envelope, and a mismatch drops the
bound identity instead of trusting the answer.

A different provider must support the same operation contract or declare the
operation unsupported. Merely defining an `execute` method does not guarantee
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

Each generation package documents its adapter version/update date, upstream reference,
upstream update date where known, last verification date, capabilities, and actual
tested combinations. The remote installed version belongs to session status.
Keep Foundry generation, upstream release and adapter version separate. Select
the latest upstream release compatible with that generation; a newer-generation
release must not advance an older directory's source pin. If the project has no
releases, use a compatible tag; only projects without either use a commit hash.

The adapters remain experimental. Empty tested-version lists mean no live
compatibility claim. A runtime method probe is not equivalent to a live test of
all system rules. The initial delivery contained only reads; Item Piles 0.2 adds
explicit reads and mutations using its inspected 3.3.4 API contract. New
operations require that version, Foundry generation 13 or 14 and the module's
active dependencies; mutations additionally require a GM runtime and target
write opt-in. Its original `get_items` remains capability-based. System adapters
0.2 add explicit reads, rule-aware rolls and selected mutations using pinned
D&D 5e 6.1.1 and PF2e 8.7.1 contracts. New system operations require their inspected
Foundry 14 build minimum and runtime APIs; mutation and side-effecting roll tools
also require target write opt-in and document ownership. The detailed system
adapters reside in `14/`; their `13/` variants preserve only the original raw
read, with scoped source references to D&D 5e **5.3.3** and PF2e **7.12.2**.
Those generation-13 pins document the inspected raw-data contract and do not
backport the generation-14 rules operations or change the original capability
probes. Item Piles
has independent `13/` and `14/` packages using the inspected 3.3.4 source. Original
raw reads retain their input/output/capability contracts inside the selected
generation. None of these source checks establishes live support.

Operation names remain explicit. [Core/system/module call selection](../guides/core-system-module-calls.md)
is based on the requested effect, not a global precedence determined by installed
modules. Bindings call the current runtime objects; unknown wrappers can change
semantics and are not certified merely by a successful method probe.

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
