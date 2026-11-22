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
- Expand Item Piles beyond the initial read operation after live API verification.
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
