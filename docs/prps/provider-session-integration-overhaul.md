# Provider/session/integration overhaul — implementation record

## Goal

Make all Foundry access target-scoped, preserve the existing core behind provider
ports, and support independently packaged Python integrations for game systems
and modules. The architecture must work with multiple configured worlds from the
first implementation rather than require another handler refactor later.

The full decision history and trade-offs are recorded in
[ADR-011](../adrs/0011-provider-session-integration-overhaul.md).

## Implementation map

| Area | Location | Responsibility |
|---|---|---|
| Provider contracts and backends | `src/providers/` | Core document port, execution, remote identity, capabilities |
| Target configuration | `src/config/targets.ts` | Explicit target list and legacy single-target conversion |
| Sessions | `src/sessions/` | Independent connections, generations, status, write policy |
| MCP catalog | `src/tools/catalog.ts` | Unified listing/calls, target routing, resources, schema conflicts |
| Integration loader/manager | `src/integrations/` | Manifest validation, activation, API probes, bindings |
| Python process runtime | `python/foundry_mcp_modules/` | Versioned JSONL worker and operation proxy |
| System packages | `systems/` | System-owned data/API interpretation |
| Module packages | `modules/` | Module-owned public API calls |

## Delivery sequence

1. Define provider and session contracts; extract the working transport engine.
2. Migrate all production handlers and diagnostic consumers to the core port.
3. Normalize legacy configuration into one target and add explicit multi-target
   configuration with separate relay credentials.
4. Add independent lifecycle, remote identity checks, and generation guards.
5. Unify MCP discovery and dispatch; add target-qualified resources and management
   tools available while destinations are offline.
6. Add the shared system/module manifest and optional Python process per target.
7. Add D&D 5e and PF2e actor-data reads and Item Piles item reads with runtime
   probes, DTO output, and exact upstream IDs in public tool names.
8. Include Python, manifests, bindings, projections, and READMEs in the installed
   package; exercise them from a separate working directory.
9. Run local regression, provider, session, worker, protocol, and packaging gates.
10. Verify the chosen upstream relay and actual Foundry/system/module versions in
    a live environment before marking the experimental adapters supported.

## Acceptance checks

- Two targets with identical document IDs return their own data.
- A missing target argument remains ambiguous when two targets are configured,
  even if one is offline.
- A target failure, refresh, shutdown, or worker failure leaves other targets
  independently usable.
- A replaced session rejects responses belonging to an old generation.
- Core handlers and resources use provider ports rather than a concrete client.
- Write enablement is local to a target and is checked before invocation.
- A lost mutation response is not automatically retried.
- The same MCP catalog governs availability and invocation.
- Item Piles can be used without a local adapter for the world's system when its
  own API and declared compatibility permit it.
- System-specific operations cannot run on a different system's target.
- Tool names preserve exact IDs, including `module_item-piles_get_items`.
- Conflicting public schemas never overwrite another target's definition.
- Worker protocol errors, missing Python, and invalid runtime output are visible.
- The packed distribution locates all integration resources outside the source
  working directory.

## Validation commands

```bash
npm run lint
npm exec tsc -- --noEmit
npm test
npm run test:python
npm run build
npm run smoke
npm run smoke:dotenv
npm run smoke:integrations
npm run smoke:pack
```

The corresponding Bun/Just commands remain available in the repository. Existing
live integration tests require a real Foundry setup; local fake-provider and
worker tests do not establish upstream live compatibility.

## Deliberately separate follow-up work

- Implement and verify rule-aware skill rolls or other system actions against
  pinned upstream APIs. The initial actor-data adapters do not claim those APIs.
- Live-verify the expanded Item Piles package against its inspected upstream
  contract before promoting its experimental compatibility status.
- Add a native bridge backend when a concrete Foundry-side bridge exists.
- Add operation-specific system capabilities when a module actually needs them.
- Design cross-world business operations separately; multiple independent worlds
  do not imply cross-world transactions or automatic replication.

## Evidence policy

Record exact commands/results in the delivery report. Keep the READMEs' live
tested-version lists empty until actual Foundry verification has taken place.
Do not substitute an upstream manifest's version, a mock test, or a successful
startup banner for a live compatibility result.

## Recorded verification — 2026-11-19

The local verification environment used Node.js 24.22.3, npm 11.9.0, and
Python 3.12.14. Bun and Just were unavailable, so the equivalent npm commands
were used for the required quality gates.

| Check | Result |
|---|---|
| `npm run lint` | Passed; 13 warnings remain, no errors |
| `npm exec tsc -- --noEmit` | Passed |
| `npm test -- --reporter=dot` | 652 tests passed across 43 files |
| `npm run test:python` | 11 tests passed |
| `npm run build` | Passed |
| `npm run smoke` | Passed |
| `npm run smoke:dotenv` | Passed |
| `npm run smoke:integrations` | Passed with an actual Python worker process |
| Connection helper | Ran against two offline targets; reported both, returned failure status, and closed cleanly |
| Installed MCP stdio process | Handshake, offline management discovery, target status, ambiguity rejection and resource listing passed |

The ordinary `npm run smoke:pack` invocation, restricted to offline npm, reached
archive creation but could not resolve uncached registry metadata (`ENOTCACHED`).
A separate controlled packaging check then installed the actual application
archive into a fresh consumer with `npm ci --offline --ignore-scripts`. It used
116 dependencies repacked from the already-installed dependency graph and the
repository's existing overrides. All 117 packages were installed as real
directories, with no source symlinks. The packaged Python callback smoke,
installed server import, and real stdio checks passed from that consumer.

This establishes that the application package contains and locates its runtime
assets and works with the tested dependency graph. It does not establish a
fresh npm registry resolution or the original dependency archive bytes. The
normal packaging script remains available for a network-enabled dependency
installation.

Regression checks include independent worlds with identical document IDs,
same-target write/read ordering, concurrent work on different targets,
cancellation of queued operations after reconnect, stale-response rejection,
relay identity changes, unknown mutation outcomes, exact integration IDs,
schema conflicts, and the MCP SDK's output-schema validation on errors.

No live Foundry server, upstream relay deployment, D&D 5e/PF2e installation, or
Item Piles installation was exercised. The initial adapter compatibility
matrices remain empty, and their status remains experimental.

## Second provider-boundary pass — 2026-11-22

This pass tightens the existing architecture without adding a provider, degraded
composite mode, new integration operation or live compatibility claim.

| Boundary | Change |
|---|---|
| Session/provider dispatch | Carry the original operation context through asynchronous steps and Python callbacks; check it before sending, and keep ordinary target work queued until locally tracked requests settle |
| Lifecycle cleanup | Share the in-progress close promise; abort replaced native authentication and bound each login stage by its configured timeout |
| Native identity and writes | Reject missing/blank world IDs; validate acknowledgement success data and distinguish explicit rejection from unknown outcomes |
| Cache | Apply supported journal-page broadcasts, mark unhandled cached changes stale, and prevent late refresh/mutation responses from overwriting a replacement snapshot |
| Integration lifecycle | Prevent closed-worker resurrection; report malformed packages independently while preserving strict loader checks for development |
| Integration writes | Treat worker failure after a mutating provider callback began as potentially unknown; do not replay it |
| MCP schemas | Embed result schemas as separate resources so local references, recursive roots and nested IDs preserve their scope inside the provenance wrapper |
| Documentation/discovery text | Describe all four providers, target-local writes, qualified resources and single-target aliases; retain experimental read-only adapter status |

The schema regression was reproduced before the fix against the actual catalog
source. After the fix, eight schema cases passed validation with the installed
Python `jsonschema` Draft7 validator: absent, empty, fragment-only, relative and
absolute root IDs, recursive references and nested resources. The validation
registry explicitly rejects external resource retrieval. Valid results pass,
invalid result values and missing provenance fail, and the original schema is
not mutated. An exact-source catalog probe also confirmed stable resource IDs
for equivalent key ordering and continued rejection of conflicting schemas.
Ajv/Vitest regressions and a real MCP protocol fixture using `$defs`/`$ref` are
included for the provisioned test environment.

Focused local probes also exercise the actual TypeScript control flow with
dependency doubles for unavailable packages; provider/session probes use the
real Node asynchronous context mechanism. The Python worker/adapter suite runs
with the local interpreter. These checks are narrower than the project gates:
this environment has no installed project npm dependencies, TypeScript compiler,
Vitest, Biome, Bun, Just or Gitleaks. The full build, typecheck, MCP/Ajv suite,
installed-package smoke and hook checks have not been rerun for this pass.
The 2026-11-19 results above are historical and do not establish those gates for
this change. No live Foundry or upstream relay test was performed.

A second local review exercised three relay response-order races against the
actual provider source with HTTP/parser/cache dependencies replaced by doubles.
All passed: an obsolete automatic refresh cannot replace the newer snapshot,
an old mutation result is rejected after a provider generation change, and a
mutation response does not patch a different snapshot within the same transport
generation. A separate session probe confirmed that closing during integration
cleanup does not start a new provider connection after close was requested.

Final local verification for this pass:

| Check | Result |
|---|---|
| Native provider, authentication and cache control-flow scenarios | 37/37 passed |
| Session operation/queue/close control-flow scenarios | 7/7 passed |
| Relay response-order and close-before-connect probes | 4/4 passed |
| Integration lifecycle/package scenarios, including a real session and Python worker queue test | 16/16 passed |
| Previous compatibility control-flow checks rerun against the changed source | 24/24 passed |
| Wrapped JSON Schema validation with external retrieval disabled | 8/8 passed |
| Python worker/adapter unittest suite | 11/11 passed |
| Syntax parsing | 141 TypeScript, 10 JavaScript/bindings, 19 JSON and 10 Python files passed |
| `npm run build`, `npm test`, `npm run lint` | Attempted; blocked by missing `tsc`, `vitest` and `biome` executables |

The 88 control-flow checks above execute the actual changed source with local
dependency doubles. They include a real Node async context and, for integration
lifecycle cases, a real Python process. The combined session/worker regression
keeps an ordinary target operation queued after the caller receives
`outcome_unknown`, until the underlying provider request settles. These results
do not substitute for the unavailable dependency, typechecking, packaging or
live-server gates.

## Item Piles package expansion — 2026-11-22

The subsequent Item Piles 0.2 work expands the earlier single read into explicit
inventory, currency, transfer, merchant, pile and vault operations. The package
records the inspected upstream 3.3.4 source reference separately from live
verification. Its status remains experimental and its tested-version matrix
remains empty.

Authored code is split into a package-local operation registry, domain handlers
and a self-contained runtime helper factory. A deterministic generator produces
the manifest and standalone binding/probe files consumed by the existing loader.
Each binding contains one fixed handler; the caller cannot select an arbitrary
API method or executable source. The Python adapter reads its allowlist from the
installed manifest, without relying on the process working directory.

The historical `get_items` name, input and result shape remain unchanged, with
capability-based availability. New operations require Item Piles `3.3.4`, Foundry
generation `13` or `14`, and active `socketlib` / `lib-wrapper`. Mutations also
require target write enablement and a GM in the execution runtime. The package's
runtime constructor applies the same readiness policy in probes and bindings.
This strict source-version gate is not a live compatibility claim.

The main build and test commands check generated-file drift; regeneration is
explicit through `npm run generate:item-piles`. `npm run test:item-piles` checks
the package with Node's standard-library test runner, including per-operation
readiness/write classification, version/dependency failures, deterministic
generation and orphan handling. Python adapter tests are included in the shared
Python suite. Installed-package smoke now loads Item Piles and exercises both a
read and a write callback through the real worker with local provider fixtures.

Local verification of the expanded package on 2026-11-22:

| Check | Result |
|---|---|
| `node modules/item-piles/build.mjs --write` | Generated 40 operations (13 reads, 27 writes) and 81 files |
| `npm run check:item-piles` | Passed; checked-in output matches the authored sources |
| `npm run test:item-piles` | 242 Node tests passed, none skipped |
| `npm run test:python` | 16 tests passed, including the real Python worker's Item Piles read/write callbacks and uncertain-outcome propagation |
| Offline JSON Schema validation | All 80 input/output schemas checked with Python Draft 7 validation; all 56 recipes cover the 40 operations and validate after routing is removed |
| Rejected example inputs | 56 undeclared-property cases, 90 missing-required-property cases and 12 unsafe/invalid cases rejected; external schema retrieval disabled |
| Offline npm pack dry-run | All 87 required Item Piles runtime/doc/example files included; package tests excluded. This is a file-list check, not an installed build |
| Full build/test/lint gates | Attempted; generated checks and 242 Node tests pass, then missing `tsc`, `vitest` or `biome` prevents completion |
| `npm run smoke:integrations` | Attempted; unavailable built `dist/integrations/manifest.js` prevents the installed-runtime smoke |

The Node tests execute the actual package runtime and serialized handlers in VM
contexts with local Foundry/API fixtures. They cover the public contracts,
permissions, missing APIs, version gates, quantities, parser boundaries,
postconditions, output projections, and generation drift. The worker tests use
real Python processes with local provider callback fixtures; these are not live
Foundry tests.

A Vitest regression additionally compiles every generated input/output schema
with the manager's strict Ajv options and validates the complete recipe catalog.
Those Ajv/Vitest regressions could not execute in this dependency-free workspace;
the full TypeScript build and installed-package smoke could not complete.
The earlier provider-pass and 2026-11-19 results above remain separate historical
evidence. No live Foundry compatibility is recorded for this expansion.
## Detailed systems and generation packages — verification on 2026-11-22

This follow-up adds detailed system APIs and then separates all shipped bridges
by Foundry generation. It supersedes earlier flat-package paths and read-only
system coverage statements in this historical record.

### Implemented packages

| Generation package | Adapter | Inspected upstream baseline | Operations |
|---|---|---|---|
| `systems/dnd5e/13/` | `0.1.1` | Unrecorded; preserved raw-data contract only | 1 read |
| `systems/dnd5e/14/` | `0.2.0` | D&D 5e `release-6.1.1`, commit `bc1b2c921e2f306dc5079f8de883ad64607118a6` | 25: 10 reads, 15 writes |
| `systems/pf2e/13/` | `0.1.1` | Unrecorded; preserved raw-data contract only | 1 read |
| `systems/pf2e/14/` | `0.2.0` | PF2e `pf2e-8.7.1`, commit `397f125aea87e6d6fa36e878c9c07d0e672826cf` | 22: 10 reads, 12 writes |
| `modules/item-piles/13/` | `0.2.1` | Item Piles `3.3.4`, commit `85ab971406623fb1c5d01eb1f093fe4855ede6e4` | 40: 13 reads, 27 writes |
| `modules/item-piles/14/` | `0.2.1` | Item Piles `3.3.4`, same inspected source | 40: 13 reads, 27 writes |

D&D 5e's new operations require generation 14, build 367 or later and exact
system version 6.1.1. PF2e's require generation 14, build 361 or later and exact
system version 8.7.1. The latter repository publishes multiple products; the
release reference was selected for the actual `pf2e` system. Their package
READMEs and `UPSTREAM.md` files record inspected methods, source links, examples
and explicit coverage boundaries. Generation 13 does not claim a backport of
those newer rules APIs or an inspected older upstream release.

Original Actor reads, the Item Piles `get_items` binding/probe and the existing
D&D display descriptor were preserved in each corresponding variant. Public
tool names and original read schemas remain stable. Package selection now
deliberately confines those bindings to their generation.

### Selection, copying and call semantics

The manifest's integer `foundryGeneration` must match its numeric directory.
The loader selects the exact generation of the connected target before importing
Python or probing runtime methods; it does not fall back across generations.
System and module identity, exact-version restrictions, runtime readiness,
operation permissions and target write enablement continue to apply.

Status has one entry per integration with `foundryGeneration`,
`availableGenerations` and diagnostic `variantErrors`. Invalid unselected
variants do not block a healthy selected variant. Same-generation public-name
collisions withhold their owners, while mutually exclusive generation variants
can preserve one public name. The multi-target catalog continues to withhold
incompatible schemas. Session-generation fencing remains separate from the
Foundry-generation selector.

Legacy flat third-party packages without generation metadata remain readable.
Mixing a flat manifest with numeric variants for one ID is an explicit error.
Structural symlink aliases and files escaping a variant are rejected. Python
worker loading validates the matching identity/generation path independently.

Every shipped variant contains its own sources, generated scripts, adapter,
tests, source notes and examples. The six packages were also copied and checked
one at a time without sibling packages. The offline scaffolder
`npm run create:integration -- --kind module --id example-module --foundry 14`
creates an unavailable skeleton; it does not overwrite an existing variant,
download code or install dependencies. Generic discovery/check/test commands
require no central list of integration IDs.

Core projections now select the same generation and validate manifest identity;
their caches distinguish canonical paths and descriptor/manifest revisions.
Missing variants retain raw document data and generic patch validation. The
provider normalizes the release version or generation consistently for world
inspection and projections. Files at would-be directory paths do not break core
reads, and descriptors cannot alias a sibling generation.

The [call selection guide](../guides/core-system-module-calls.md) documents
core document operations, system rules and module workflows as distinct
contracts. There is no global module/system/core priority, automatic replacement
of a named tool or fallback after a dispatched mutation. Bindings call current
runtime objects so installed overrides participate; arbitrary module stacks are
not thereby certified.

### Review corrections

- D&D rolls use Foundry-14 message modes and redact results when actual chat
  visibility cannot confirm access. Spell slots are explicit and base-level;
  unsupported upcasting and continuation assumptions are rejected. Activity
  attack damage keeps explicit ability/mode/ammunition context. Rest results
  verify the returned Actor/Item update plan, with effect/hook limits documented.
- PF2e strike calls respect the actual wrapper's dialog behavior and explicit
  token/target/Item identity. Conditions and currency use system APIs. Recharge
  checks source-document changes against the returned plan, rather than treating
  prepared data or an `affected` report as persistence confirmation.
- Writes and side-effecting rolls retain target permission gates; uncertain
  outcomes are propagated without replay. Python tests cover real callback
  routing for both system reads and mutations.

### Verification performed

Environment: Node.js **24.22.3**, Python **3.12.14**. Package-manager dependency
installation was not performed; this workspace has no `node_modules` or built
`dist`. Tests needing a temporary directory used a writable workspace `TMPDIR`.

| Check | Observed result |
|---|---|
| Generic package/generator checks | All **6 generation packages** passed |
| Node binding and tooling contracts | **634 passed, 0 failed, 0 skipped** across 15 files |
| Python worker/adapter suite | **46 passed**, including path/generation isolation and uncertain-outcome propagation |
| Each variant copied in isolation | Its generator, Node tests and Python adapter tests passed without the repository or sibling variants |
| JSON Schema Draft 7 checks with external retrieval disabled | **258 input/output schemas**, **168 recipes** and **25 workflows** checked; all operations covered |
| Invalid recipe cases | **168 unknown-property** and **280 missing-required-field** cases rejected |
| Recorded outputs from executed D&D/PF2e bindings | All **47 generation-14 operation samples** revalidated against their input/output contracts |
| Legacy raw binding/probe and descriptor preservation | Original bytes/schemas compared with the pre-change baseline |
| TypeScript/JavaScript syntax | Modified host/tooling sources parsed with Node 24; this is not a typecheck |
| Local Markdown links | **158 relative links** in 30 current documents checked |
| Offline npm pack dry-run | All six variants' runtime/docs/examples and the new guide included; tests/cache artifacts excluded; no built distribution claimed |
| `npm test` | Node phase passed as above; full command stopped because **Vitest is unavailable** |
| `npm run build` | Package checks passed; TypeScript compilation stopped because **tsc is unavailable** |
| `npm run lint` | Not executable: **Biome is unavailable** |
| Installed integration smoke | Not executable: **Ajv and built `dist` are unavailable** |

New Vitest cases cover host generation selection and core projection isolation,
including distinct 13/14 descriptors, missing/future generations, malformed
manifests, layout ambiguity, symlinks, caches and independent target write policy.
They were syntax-checked and reviewed, but not executed here. Full TypeScript
typechecking, Ajv strict/Vitest validation and installed-runtime smoke remain
required in an environment with the declared dependencies.

**No live Foundry world was exercised.** Every shipped variant remains
`experimental`, with `compatibility.tested: []` and `upstream.verifiedAt: null`.
Source inspection, generated-file checks, local fixtures and packaging checks
are separate from live system/module compatibility verification.

