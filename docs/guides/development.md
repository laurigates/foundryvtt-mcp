# Development guide and project handoff

This guide describes the target-scoped provider/session architecture on `feat/multiworld-provider-overhaul`. For architectural rationale see [ADR-011](../adrs/0011-provider-session-integration-overhaul.md), for configuration see [Providers and targets](providers-and-targets.md), and for extension contracts see [Writing integrations](writing-integrations.md).

## Start here when continuing the project

**Handoff updated: 2026-11-22.** This is the canonical development/handoff document.
The implementation is an experimental architecture under review. Local test
success, an inspected upstream release and a populated directory are separate
from live compatibility or readiness to merge.

The generation-package implementation was published at
[`742751d`](https://github.com/p4535992/foundryvtt-mcp/commit/742751dfd89ab604eed00ac2ce3fd154a35b82f0).
The follow-up review documented here builds on that baseline; the commit is a
historical reference, not a claim that it is still the branch head. Check the
actual local revision and changes before editing. Preserve unrelated work.

For the reasoning and open decisions, read the
[discussion draft](../discussions/provider-integration-expansion-draft.md).
It is material for a possible future PR discussion, not a record of an opened PR
or an approval to merge. The [verification record](../prps/provider-session-integration-overhaul.md)
contains dated results and remaining validation gaps.

### Current implementation

| Area | Implemented behavior |
|---|---|
| Target ownership | One active world and one system per target, with independently evaluated modules; several targets can coexist |
| Providers | Explicit native, historical REST, paired runtime REST and composite paths with distinct capabilities |
| Integration layout | Self-contained `systems/<id>/<generation>/` and `modules/<id>/<generation>/` packages |
| Variant selection | Exact Foundry generation, then installed identity/version, runtime capability, readiness and permission checks |
| Public names | `system_{id}_{operation}` and `module_{id}_{operation}`, preserving the upstream ID |
| External adapters | Filesystem discovery and an offline scaffold; no central module/system dispatch registry |
| Compatibility migration | Legacy flat packages without generation metadata remain readable; mixed flat/numeric layouts are rejected |
| Core/system/module coexistence | Explicit contracts and current runtime methods; no global precedence or automatic mutation fallback |
| Verification state | Experimental; no shipped variant has a live-tested compatibility matrix |

The six bundled packages are examples of the contract, not a closed list of
identities supported by the loader. Generation 15 and later can follow the same
layout once a separate compatible implementation is supplied. No generation-15
adapter or live support is established by the current directory convention.

| Package | Adapter / inspected upstream | Coverage and scope |
|---|---|---|
| `systems/dnd5e/13/` | `0.1.1` / D&D 5e `5.3.3` | Original `get_actor_data` only; upstream minimum 13.347 |
| `systems/dnd5e/14/` | `0.2.0` / D&D 5e `6.1.1` | 25 operations; new rules operations require Foundry 14 build 367+ |
| `systems/pf2e/13/` | `0.1.1` / PF2e `7.12.2` | Original `get_actor_data` only; upstream minimum 13.348, maximum 13 |
| `systems/pf2e/14/` | `0.2.1` / PF2e `8.7.1` | 22 operations; new rules operations require Foundry 14 build 361+ |
| `modules/item-piles/13/` | `0.2.1` / Item Piles `3.3.4` | 40 operations, generation 13 only |
| `modules/item-piles/14/` | `0.2.1` / Item Piles `3.3.4` | 40 operations, generation 14 only |

Consult the [system](../bridges/systems.md) and [module](../bridges/modules.md)
catalogs and package READMEs for exact source commits, API coverage and exclusions.
The root README should remain generic and link to those catalogs. Keep specific
module/system version claims in their dedicated documentation.

The generation-13 source references were established on **2026-11-22** from the
latest compatible official releases and their relevant Actor serialization
sources. Their adapter versions, raw-read behavior and capability checks remain
unchanged. The newer release for another Foundry generation is not the correct
reference for an older directory.

### Read these files before changing a boundary

| Question | Starting points |
|---|---|
| How does a target bind to a world and survive refresh/reconnection? | `src/sessions/session.ts`, `src/sessions/manager.ts`, `src/providers/operation-context.ts` |
| Which transport actually executes an operation? | `src/providers/types.ts`, `factory.ts`, `document-provider.ts`, `rest-api.ts`, `composite.ts` |
| How are manifests and variants selected? | `src/integrations/manifest.ts`, `manager.ts`, `types.ts` |
| How is an adapter called and fenced? | `src/integrations/python-worker.ts`, `python/foundry_mcp_modules/worker.py` |
| Which tool/schema is public across multiple targets? | `src/tools/catalog.ts` and its catalog/protocol/schema tests |
| Where do system display fields and patch bounds come from? | `src/providers/projections.ts` and the selected system's `actor-projection.json` |
| How are external packages created and checked? | `scripts/create-integration.mjs`, `integration-packages.mjs`, `integrations.mjs` |
| Where should an integration behavior be edited? | The selected generation's authored `src/` files; regenerate its manifest/bindings/probes afterward |

### Invariants to preserve

- **Keep the three versions separate.** Foundry generation selects the directory;
  upstream release/commit identifies the inspected contract; adapter version
  identifies our implementation. A session-generation counter is a different
  concept used to invalidate stale work.
- **Never borrow an adjacent generation.** Unknown/missing variants withhold their
  tools. A malformed unselected variant remains diagnostic without activating it.
  Package runtime/build resources must not depend on sibling generations.
- **Apply declared version restrictions consistently.** Core projections must
  respect the manifest's Foundry/system filters as well as its generation, even
  on cache hits. Missing required version information keeps generic core data.
  Composite connections must reject known, different Foundry generations.
- **Keep the public contract stable.** Do not normalize IDs or change the original
  raw-read schemas silently. Different generations may implement the same tool,
  but incompatible schemas across active targets are withheld by the catalog.
- **Choose effects explicitly.** A core HP patch, system damage workflow and module
  transaction are different operations. Use current runtime instances so wrappers
  participate; do not bypass them through a captured base prototype.
- **Classify side effects honestly.** Chat-producing/resource-consuming rolls and
  mutations require `readOnly: false`, target write permission and runtime checks.
  Returned roll details must respect actual message visibility, including wrapper
  changes that disagree with system-specific flags.
- **Fence uncertain work.** Preserve the originating target/session/callback token.
  `outcome_unknown` is not permission to retry, switch provider or perform a
  substitute core write. An interrupted request may already have changed Foundry.
- **Separate evidence.** Empty compatibility arrays impose no extra exact-version
  filter; they do not certify compatibility. Keep `tested: []` and
  `verifiedAt: null` until the corresponding live checks actually occur.

### Latest review and evidence

The follow-up to `742751d` corrected three boundaries: core projections now honor
manifest version restrictions on every use, composite connections reject known
different Foundry generations, and PF2e roll results respect the actual chat
message's visibility when it disagrees with system-specific flags. The PF2e
generation-14 adapter is now `0.2.1`; its upstream baseline remains `8.7.1`.

The final local pass on **2026-11-22** used Node **24.22.3** and Python **3.12.14**:

| Check | Observed result |
|---|---|
| `npm run test:bindings` | 646 passed; all 6 independent generation packages checked |
| `npm run test:python` | 46 passed |
| Offline schema/recipe checks | 258 schemas and 168 recipes; 168 unknown-property and 280 missing-required-field cases rejected |
| Changed host files | 7 syntax checks passed; this is not TypeScript typechecking or Vitest execution |
| Documentation and packaging | 99 relative links checked; offline pack lists 355 files and includes both handoff/draft documents plus all six variants' runtime/docs/examples |
| Full host toolchain, installed runtime and live Foundry | Not completed in this environment |

The [dated verification record](../prps/provider-session-integration-overhaul.md)
distinguishes this pass from earlier isolated-package and recorded-output checks.
Do not carry forward a historical test result as proof for a later revision.

Those runtime-suite results belong to the review published as `329eeaa`. The
subsequent generation-13 source-reference update changed documentation, upstream
metadata and the existing metadata assertions. Its package checks and targeted
tests are recorded separately; it did not change host behavior, bindings, probes,
operation schemas or adapter versions.

### Next work should resolve these gaps

The immediate validation gap is the full host toolchain and installed runtime,
followed by live tests against the pinned Foundry/system/module combinations.
The current local environment lacks project dependencies and built `dist`;
recheck that fact in a new environment instead of carrying it forward as a rule.
Node 18+ is the declared runtime range; the recorded offline checks used Node 24,
so those checks do not establish the minimum-version matrix.

Architecture questions remain open: handling incompatible upstream releases
within one Foundry generation, the long-term flat-layout migration policy,
cross-target schema versioning, external adapter update/trust/dependency
management, generated-file review cost and whether the Python worker remains the
right extension boundary. A semantic intent resolver is only a proposal; no
automatic core/system/module preference engine is implemented.

For the next change, identify the affected boundary first, read its contract and
tests, make a narrow change, regenerate affected packages and record the checks
actually run. Do not extend API coverage or advance a source pin merely because
a newer release exists. Select the latest compatible release for the actual
upstream product and generation; use a tag only when releases do not exist, or a
full commit hash only when neither releases nor tags exist. Missing provenance
is not evidence that upstream has no releases.

## Toolchain and conventions

- Node.js 18+ and TypeScript ES modules (`.js` suffixes in source imports); Bun is the preferred package manager (`bun.lock`).
- Use the `justfile` recipes for repeatable local checks. Biome formats/lints, Zod checks external data, Vitest tests TypeScript and Python's standard-library unittest runs adapters.
- Follow **RED → GREEN → REFACTOR** for behavior changes. Write tests for new behavior and for any fixes affecting a public contract.
- Keep secrets out of commits and logs; the pre-commit hook requires Gitleaks and runs `lint-staged`. Never use `as any` to bypass contract validation.
- Use conventional commit messages (`feat(scope):`, `fix(scope):`, `docs:`, `test:`, etc.).

## Architecture and ownership

| Location | Responsibility |
|---|---|
| `src/index.ts`, `src/tools/catalog.ts` | MCP startup/shutdown, discovery, calls and resources |
| `src/sessions/` | Target resolution, lifecycle, identity and operation queue |
| `src/providers/`, `src/diagnostics/` | Transport, core ports, world cache, execution and scoped diagnostics |
| `src/integrations/` | Manifest validation, selection, probes and Python worker client |
| `systems/<id>/<generation>/`, `modules/<id>/<generation>/` | Independent game-system and module packages |
| `src/config/` | Environment migration, explicit target schemas, credentials and routing IDs |
| `src/foundry/` | Authentication, data types and generic cache/search helpers |
| `src/tools/definitions.ts`, `router.ts`, `handlers/` | Static core contracts, dispatch and provider-independent handlers |
| `python/foundry_mcp_modules/` | Optional private JSONL worker |
| `tests/integration/`, `tests/e2e/` | Live integration and browser test tiers |

`src/foundry/client.ts` is a **compatibility re-export**, not the application's shared client. New handlers accept `FoundryCore` from `src/providers/types.ts`. A `FoundrySession` owns one provider, cache, optional Python worker, generation/identity guards, write settings and pending operations. Different targets may run concurrently; work within a target is serialized.

The [backward compatibility contract](backward-compatibility.md) covers legacy
environment settings, client imports, custom tool contexts and MCP payloads.
Preserve core content and put provenance in `_meta`; capture its session context
before dispatch and verify it again immediately before constructing the response.
`BaseTool` and `ToolRegistry` normalize old `foundryClient` contexts to the same
provider instance. Keep this adapter at the extension boundary.

Supported provider kinds are `socketio`, `legacy-rest` (the historical `/api/*` bridge), `rest-api` (paired ThreeHats runtime relay) and `composite` (native core plus relay execution). Their capabilities are not interchangeable and there is no fallback between providers after a failed mutation.

## Add or change a core MCP tool

1. Add/update its JSON input schema in `src/tools/definitions.ts` and add tests for the contract.
2. Implement the handler under `src/tools/handlers/` using `FoundryCore`, without constructing a new client or changing a global active world.
3. Wire dispatch in `src/tools/router.ts` and test routing/error handling.
4. Review `src/tools/catalog.ts` for required capability, read/write classification, system gating, discovery and execution checks. Tool listing and invocation must enforce the **same** target-local policy; unknown operations must not default to writable/available.
5. Keep `src/tools/availability.ts` and its legacy-transport contract tests consistent where relevant. It is **not** the server's target-aware discovery/dispatch implementation.
6. Cover offline targets, multiple target IDs, disabled writes, capability mismatch, stale generations and result provenance in catalog/session tests.

For resources, update `src/tools/resources.ts` and the corresponding capability/routing logic in `src/tools/catalog.ts` / `src/tools/router.ts`. Public resources are target-qualified (`foundry://targets/<target_id>/actors`); unqualified aliases only work when exactly one target is configured.

## Add a provider or change transport behavior

- Define/extend the `FoundryCore` and `FoundryProvider` ports in `src/providers/types.ts` and add the backend to `src/providers/factory.ts`.
- Validate configuration in `src/config/targets.ts`; a target ID is not a remote world ID or a relay client ID.
- Give each connection its own lifecycle, cache, identity checks, capability set and generation handling. Do not return results from an obsolete connection.
- Use `src/providers/operation-context.ts` at dispatch boundaries: check the originating operation immediately before sending and track the actual local provider request until it settles. Multi-step methods and callbacks must retain the original context; capturing a fresh generation for each send is insufficient.
- Keep the target queue occupied by tracked provider work after a public worker failure. Lifecycle replacement may invalidate the old generation, but cannot roll back completed remote steps or prove remote cancellation after a timeout.
- Make connection/authentication stages bounded and abortable, and share cleanup completion across concurrent `close()` calls. Never admit a missing/blank world ID as a session identity.
- Preserve the distinction between the native Socket.IO document protocol and relay-executed Foundry document APIs. Never replay uncertain writes automatically; report `outcome_unknown` and require inspection.
- Validate mutation acknowledgement envelopes/results before returning success. Update supported journal-page broadcasts and mark cached changes stale when they cannot be applied safely.
- Keep system-specific projections in `systems/<system-id>/<generation>/actor-projection.json`. Pass the target's actual Foundry version to projection/validation helpers; never borrow a descriptor from another generation.
- Add provider, session and protocol regression tests. Live compatibility with a specific Foundry version requires an actual world test; mocked or fake-relay tests cannot establish it.

## Add a system or module integration

1. Put a trusted, self-contained package in `systems/<upstream-id>/<generation>/` or `modules/<upstream-id>/<generation>/`, preserving the exact upstream ID. `npm run create:integration -- --kind module --id example-module --foundry 14` creates an unavailable starting skeleton.
2. Supply `manifest.json` with matching numeric `foundryGeneration`, `adapter.py`, `README.md`, fixed JS bindings/probes and adapter tests. Validate the contract using `src/integrations/manifest.ts`.
3. Use the shared `src/integrations/manager.ts` / `python-worker.ts` infrastructure; one optional Python process is scoped to each target. Credentials and provider selection stay in Node, not in Python.
4. Expose names as `system_{id}_{operation}` or `module_{id}_{operation}`. Never normalize hyphens, silently overwrite conflicting schemas or expose arbitrary JS execution as an MCP tool.
5. Probe the actual runtime API, return JSON-safe DTOs, validate inputs/outputs, and only advertise an operation while its target and provider can execute it.
6. Record the latest compatible upstream source for that Foundry generation, the separate adapter version and actual live-tested combinations. Keep experimental status until live verification is performed.

The system and module packages keep authored registries, domain handlers and
helper factories under their generation's `src/` directory. Run
`npm run generate:integrations` after editing those sources, then
`npm run check:integrations`. Discovery covers every local package without a
central list of IDs; generators, when supplied, verify deterministic output and
reject drift/orphan files. `npm run test:bindings` discovers Node binding/tooling
tests and `npm run test:python` discovers Python adapter tests. Existing system
and Item Piles aliases select their respective packages across generations.
Generated files remain standalone scripts; they are not compiled in the request
path. A hand-authored external package does not require a generator.

`check:integrations` checks local layout, required files, basic metadata, binding
syntax and optional generator drift. Full manifest/schema validation still
belongs to the host's Zod/Ajv checks and Vitest/installed-runtime tests; the basic
checker is not a replacement for those gates. Installing an adapter also does
not install its upstream Foundry package or any external dependencies.

Copying a complete external generation directory is sufficient for discovery.
Do not import a sibling generation's source. Refresh/reconnect after installation,
and check selected/available generations in integration status. Legacy flat
packages without generation metadata remain loadable only when not mixed with
numeric variants for the same ID. Test missing/unknown generations, per-target
selection, nonselected broken variants and same-generation name collisions.

Keep system rules separate from administrative document edits. The
[core/system/module selection guide](core-system-module-calls.md) documents
runtime overrides, explicit namespaces and why a failed rule operation must not
fall back to a generic core patch. Call the actual runtime object, without
bypassing module wrappers through a captured prototype.

Runtime package errors must remain local to their package; keep strict loader
validation available for development and smoke checks. A closed worker must not
restart from a delayed callback. Include wrapped-output schema tests for local
references, recursive roots and nested resource IDs: validation of the unwrapped
operation result alone does not prove the MCP output contract.

The detailed manifest and binding contract is in [Writing integrations](writing-integrations.md).

## Development and validation

```bash
bun install --frozen-lockfile
just qa                    # Biome, src/ + scripts/ TypeScript, Vitest, Python tests
just build                 # TypeScript -> dist/
bun run smoke              # Installed entry point startup
bun run smoke:dotenv       # dotenv load order
bun run smoke:integrations # Packaged Python worker integration path
bun run smoke:pack         # npm package in a fresh consumer (requires dependency resolution)
bun run test:item-piles    # Generation check and standalone Node binding contracts
bun run test:systems       # Generation checks and both system binding contracts
bun run check:integrations # Every discovered package and optional generator
bun run test:bindings      # All discovered Node binding/tooling contracts
just docs-check            # TypeDoc check
just antipatterns          # ast-grep scan
```

You may run narrower checks while iterating (`just test`, `just check-types`, `just check-types-scripts`, `just test-python`, `just lint`). Before committing, run `just qa` and the relevant build/smoke checks. The regular GitHub test workflow also runs build, script typecheck, Vitest, startup/dotenv/package smoke tests and Biome; not all integration gates are part of that workflow.

### Live tests and evidence boundaries

- `bun run test:integration` exercises `tests/integration/**` against an already running Foundry world, normally on port `30001`. `just test-integration-docker` manages the test container; it needs a local `.env.integration` with the requisite credentials/license. Do not point destructive tests at a production world.
- `just test-e2e` runs Playwright; it requires the matching browser/runtime setup.
- `bun run test:python` and `bun run smoke:integrations` test local worker/adapter contracts, **not** real upstream D&D 5e, PF2e or Item Piles compatibility.
- A successful package smoke test validates shipped assets and runtime paths; it does not substitute for an external Foundry/relay integration test.
- Record commands, versions and actual results. The dated baseline in [the implementation record](../prps/provider-session-integration-overhaul.md) is historical evidence, not proof of the current commit's status.

## API documentation

```bash
just docs
just docs-check
```

TypeDoc output is generated under `build/docs/`. Document public provider contracts and configuration, rather than presenting `FoundryClient` as the production application's sole API.
