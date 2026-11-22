# Backward compatibility of the provider overhaul

The provider/session architecture preserves the existing single-world setup and
the public contracts below. Internally, there is one implementation of each
operation: compatibility adapters route into the same target-owned providers,
sessions and handlers. There is no second legacy server.

This contract was compared with fork `main` at
`7c2a8752e85c0073dccff6f5d43b56802da31431`; the integration starts from the documented
overhaul at `c3a729e86f452408c38d6fad9706157e812c1747`. It concerns this branch's
configuration and application API, not a claim about a published npm release or
support for additional Foundry versions.

## Preserved contracts

| Existing usage | Behavior on this branch |
|---|---|
| `FOUNDRY_URL`, username/user ID, password and existing transport settings | Normalized into one target, `default` unless `FOUNDRY_TARGET_ID` is set; no target file is required |
| `FOUNDRY_API_KEY` | Selects the historical `/api/*` bridge when no provider override is given; it is never reinterpreted as a relay credential |
| `FOUNDRY_WRITE_ENABLED=true` | Enables writes for the legacy single target only; the selected provider and remote permissions must also allow the operation |
| Existing core tool names and parameters | Retained for supported operations; `target_id` is optional with exactly one configured target |
| Core tool `content`, including `content[0]` | Kept in the handler's original order and shape; target information is added in `_meta`, without a text preamble |
| `refresh_world_data` | Keeps the original success message and collection counts, while refreshing the target lifecycle once |
| `foundry://actors` and the other base resource URIs | Both listed and readable for one configured, ready, capable target; target-qualified URIs are also listed |
| Unknown tool name | MCP `MethodNotFound`; existing typed MCP errors retain their codes and messages |
| `dist/foundry/client.js` imports | `FoundryClient`, its existing configuration/search/patch types, and `probeRestModule` remain exported |
| Constructing an old `Config` object | `targets` remains optional in the public input type; the exported runtime configuration uses `ResolvedConfig`, where targets are always present |
| Custom tools using `ToolContext.foundryClient` | Supported by a shared context adapter in both `BaseTool` and `ToolRegistry` |

Descriptions, discovery metadata, management tools and integration operations
may be added. Clients should select tools/resources by their names and URIs,
rather than assuming fixed catalog sizes. The nine base resource definitions
remain unchanged; single-target discovery also includes their qualified aliases.

### Single target

An existing MCP call remains valid:

```json
{
  "name": "search_actors",
  "arguments": { "query": "Hero", "limit": 10 }
}
```

The response keeps the existing content and adds metadata such as:

```json
{
  "target_id": "default",
  "world_id": "example-world",
  "session_generation": 1
}
```

These are illustrative `_meta` values. Integration operations, which are new in
the overhaul, continue to use their declared structured result wrapper with
`target_id`, `world_id`, `session_generation` and `result`.

That wrapper now gives the result schema its own resource identity so local
`$ref` and nested `$id` scopes survive embedding. Only schema metadata changes;
the structured payload fields remain the same. External schema documents are
not fetched or registered by the integration loader.

### Multiple targets

Once two or more targets are configured, pass `target_id` on calls and use
`foundry://targets/<target_id>/<path>` for resources. A second offline target
still makes an unqualified call ambiguous. No target is chosen based on which
world happens to be online.

Explicit targets do not inherit global credentials or the global write opt-in.
Set their own provider configuration and `writeEnabled`. See
[Providers and targets](providers-and-targets.md) for complete examples.

### Embedded TypeScript consumers and custom tools

The historical import stays available:

```typescript
import {
  FoundryClient,
  probeRestModule,
  type FoundryClientConfig,
} from 'foundryvtt-mcp/dist/foundry/client.js';
```

`FoundryClient` is a compatibility export of the shared document implementation.
Its existing public methods, including HTTP helpers, remain available. New core
code should depend on `FoundryCore`; it should not create an extra compatibility
client for an already connected target.

Both `{ foundryClient }` and the new `{ provider }` tool contexts are accepted.
The adapter supplies both names for the same instance, including to custom
registry tools that do not extend `BaseTool`. Passing two different instances in
one context is rejected before execution. Existing subclasses can retain
`ToolContext`; new handlers can use `ResolvedToolContext` for the provider port.

The default legacy `ToolContext` type retains the full `FoundryClient` interface.
An externally supplied implementation of `FoundryCore` may omit the extra raw
HTTP helpers, so an extension that uses those helpers must receive a client
implementing them. The adapter does not manufacture unsupported transport APIs.

## Deliberate boundaries

- **Availability is checked per target.** Unsupported, offline, unclassified or
  disabled operations are not advertised as usable. D&D 5e demo helpers remain
  system-specific. Diagnostics and compendium access require their own provider
  capabilities.
- **Writes stay opt-in.** Compatibility does not enable a transport, relax
  Foundry permissions, or repeat a mutation after a lost acknowledgement.
- **Results stay bound to their original session.** A reconnect between
  execution and response construction discards stale reads; an interrupted write
  can return `outcome_unknown`. Its result is never relabeled as a newer session.
- **Delayed operations cannot send new steps after invalidation.** The original
  operation context reaches provider dispatches and Python callbacks. Ordinary
  work remains queued while tracked local provider requests settle, even if a
  worker already failed. This does not roll back remote mutations or guarantee
  their cancellation after a timeout.
- **Legacy REST identity is rechecked.** Session operations inspect the world
  immediately before dispatch and after successful completion. A mismatch
  withholds the response, marks that target in error and blocks queued work.
  This costs two additional identity inspections per successful operation.
  The historical bridge has no response-bound world identity, so a complete
  A → B → A switch between the probes remains undetectable. This guard does not
  turn that bridge into an atomic, identity-bound protocol.
- **Diagnostics use the selected provider.** A different target's API key cannot
  change how a local dice result is assessed. Checking an already connected
  native or historical REST client does not replace its session generation.
- **System data remains system-specific.** Unknown systems retain raw data;
  D&D 5e field assumptions are not restored for unrelated systems.
- **Invalid configuration is rejected.** Negative retry settings or nonpositive
  timeouts accepted by older loose validation are not a supported compatibility
  contract.
- **Foundry-version support is separate.** This work does not establish live
  compatibility with a new Foundry, game-system, module or relay version.

## Regression coverage and verification

The repository regression tests cover the legacy environment mapping, a typed
pre-overhaul consumer, old/custom tool contexts, unchanged result content,
resource aliases, typed errors, refresh output, late reconnects and REST world
changes. The package smoke check now imports the legacy client from a freshly
installed consumer and checks the declaration files as well as the Python assets.

The initial compatibility verification on 2026-11-22 used Node 24.22.3 and Python
3.12.14. The subsequent provider-boundary pass is recorded separately in the
[implementation record](../prps/provider-session-integration-overhaul.md).
Exact-source Node
probes execute the changed TypeScript after stripping its types, with external
I/O, validators and MCP dependencies replaced by test doubles. These probes
verify the targeted control flow; they do not verify dependency behavior or
replace the project's actual Vitest and TypeScript checks.

| Check actually performed | Result |
|---|---|
| Exact-source catalog/session control-flow probes | 14/14 passed |
| Exact-source client/context/diagnostic control-flow probes | 10/10 passed |
| `python3 -B -m unittest discover -s python/tests -v` | 11/11 passed |
| Node TypeScript transform and module syntax parsing | 134 TypeScript files passed; no typechecking |
| JavaScript/binding, JSON and Python syntax parsing | 10 JavaScript, 19 JSON and 10 Python files passed |
| `node --check scripts/smoke-pack.js` | Passed; installed-package execution remains pending |

The editing environment has no installed project npm dependencies, Bun, Just,
TypeScript, Vitest, Biome or Gitleaks. Full QA, the build, installed-package smoke
and the Gitleaks pre-commit check therefore remain unverified here. No live
Foundry/relay tests were performed, and no integration `compatibility.tested`
claim was added.

In a provisioned checkout, run the existing gates:

```bash
just qa
just build
bun run smoke
bun run smoke:dotenv
bun run smoke:integrations
bun run smoke:pack
```

The normal pre-commit hook additionally runs Gitleaks and lint-staged. Use a
disposable configured world for the separate live integration tier described in
the [development guide](development.md).
