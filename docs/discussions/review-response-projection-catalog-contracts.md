# Review response: projection, catalog and integration-contract hardening

Status: P1–P6 are committed (`228368f`, `c3c1096`, `4280650`); the lint repair (P7),
the Node-only integration runtime (P8) and named relay operations (P9) are in the
working tree. The operator owns commit and push.

## Evidence policy

The upstream review thread was **not** read: pull-request descriptions, diffs,
files, comments, reviews, CI results and code-scanning alerts are outside the
allowed scope, so nothing below quotes or paraphrases them. Every claim is
derived from local evidence: git history, source, tests and the commands listed
in the verification log.

The code-scanning alert titles were supplied as text in the conversation, not
read from the repository, and are addressed in P6.

## Workstreams

| # | Change | Files | Commit |
|---|---|---|---|
| P1 | Projection display defects | `src/providers/projections.ts`, `src/providers/__tests__/projections.test.ts`, `systems/pf2e/{13,14}/actor-projection.json`, both PF2e `README.md` | `bf0bdfc` (test file still local) |
| P2 | Fragment-only `$id` in the catalog | `src/tools/catalog.ts`, `src/tools/__tests__/catalog-schema.test.ts` | `1ea0c5f` |
| P3 | Dual-mode capability matrix | `src/tools/__tests__/capability-matrix.test.ts`, `docs/adrs/0011-dual-mode-transport.md`, `docs/guides/capabilities.md` | `bd7e78b` |
| P4 | Integration contracts and the capability source of truth | `src/integrations/{types,manifest}.ts`, `src/tools/catalog.ts`, six `src/registry.mjs`, six `manifest.json`, `scripts/create-integration.mjs`, `docs/guides/writing-integrations.md`, three test files | `228368f` |
| P5 | Python interpreter resolution | `python-worker.ts` callers in four integration test files, `src/foundry/__tests__/legacy-client.test.ts` | `c3d1b89` |
| — | Load-dependent test timeouts | `src/integrations/__tests__/lifecycle.test.ts` | `228368f` |
| P6 | CodeQL alerts (2 high, 1 medium) | `src/tools/handlers/{chat,journals}.ts`, `src/foundry/{world-cache,world-search}.ts`, two handler tests | `c3c1096` |
| P7 | Lint scope widened by `66342fd` | 19 files: four `scripts/` files, `src/foundry/client.ts`, 14 test and source files | local |
| P8 | Node-only integration runtime (step 2) | `src/integrations/{manager,manifest}.ts`, `src/config/targets.ts`, `src/sessions/session.ts`, deleted `python/` and six `adapter.py`, `scripts/smoke-integrations.js` | local |
| P9 | Named relay operations (step 3) | `src/providers/{types,rest-api,composite}.ts`, `src/integrations/{manager,manifest}.ts`, `src/sessions/session.ts`, `src/config/targets.ts`, five test files | local |

### P1 — projection is display-only again

The HP cap error keeps its additive breakdown (`20 + 3 = 23`) and drops it when
the caller overrides the cap. `attributes.prof` is no longer invented: it is
derived only when the level itself was rebuilt from class items. PF2e 13 and 14
regained `actor-projection.json` mapping `system.attributes.hp{,.value,.max,.temp}`
and `system.attributes.ac.value`, so PF2e actors display HP and AC again.

The projection declares **display paths only**. It adds no validation bounds, so
PF2e writes keep the generic patch validation they had before projections
existed. This is a deliberate limit, not an oversight.

### P2 — `$id` is an identity, a fragment is an anchor

A fragment-only `$id` such as `#root` no longer becomes part of the generated
resource identity; the schema is published as `${base}result`, so local
`$ref: '#/$defs/...'` pointers resolve. The schema test now validates through the
shared strict `createContractAjv()` instead of a permissive `new Ajv({strict:false})`.

### P3 — the matrix was stale, the code was right

`verifyRestIdentity` probes `GET /api/world` before **and** after every REST call
in dual mode (`src/providers/document-provider.ts`), which is the security
property asserted by `src/foundry/__tests__/client-dual.test.ts`. The
`foundry://actors` and `foundry://system/diagnostics` dual cells now record that
probe, and ADR-0011 gained a "Bridge identity verification" section.

### P4 — one capability table, typed manifests, generation filters

- `matchesDeclaredVersion()` in `src/integrations/types.ts`: an empty list is
  unconstrained, a full string is an exact pin, and a bare integer matches the
  generation (`"14"` covers `14.370`). `matchesIntegrationCompatibility` uses it
  for both `foundryVersions` and `integrationVersions`.
- `src/integrations/manifest.ts` refines `binding`/`probe` to `.js`, so a manifest
  cannot point the host at a file it would misparse. P8 later removed the Python
  `entrypoint` this bullet originally described.
- `src/tools/catalog.ts` deleted `WRITES`, `READS`, `CACHED`, `DIAGNOSTICS` and
  `requiredCapability()`. `TOOL_CAPABILITIES` in `src/foundry/capabilities.ts` is
  now the single source through `primaryCapability()`, `isWriteTool()`,
  `transportMode()` and `sourceOrder()`. `available()` rejects unclassified tools
  and tools whose transport mode has no source. Local generators work offline and
  dispatch directly through `routeToolRequest`, bypassing `session.run()`.
- All six packages declare `["13"]` or `["14"]` in `src/registry.mjs`;
  `scripts/create-integration.mjs` emits `[String(foundryGeneration)]`.
  `docs/guides/writing-integrations.md` documents the new matching rules.

### P5 — the interpreter is resolved, not assumed

`python-worker.ts` defaulted to `python3`, which does not exist on Windows, so 23
integration tests failed with `python_unavailable`. The default is now
platform-aware and `FOUNDRY_PYTHON_EXECUTABLE` overrides it; the four integration
test files pass `pythonExecutable` explicitly. `legacy-client.test.ts` declares
`types: ['node']` for its ad-hoc program.

P8 removes the interpreter and both options, so this section is historical: it
records why the branch was green before the runtime was deleted, not a current
contract.

### Load-dependent test timeouts

Three lifecycle tests used a 250 ms timeout against a real Python start. Under 65
parallel workers the start sometimes consumed the timeout, so the assertion saw a
different error code. Timeouts are now 2500 ms and the adapter sleep is 5 s, which
keeps the same assertions but makes the ordering deterministic.

P8 deletes those tests with the worker they measured. Their remaining coverage —
operation-context fencing, confirmed no-write codes and uncertain writes — is kept
in `src/integrations/__tests__/lifecycle.test.ts`, and the session-queue ordering
assertion lives in `src/sessions/__tests__/operation-lifecycle.test.ts`.

### P6 — CodeQL alerts

Three alerts were reported on code touched by this work.

**Incomplete multi-character sanitization** (`src/tools/handlers/chat.ts`,
`src/tools/handlers/journals.ts`). Both stripped markup with
`replace(/<[^>]+>/g, '')`, which rebuilds a tag from split input:
`<scr<script>ipt>alert(1)</script>` becomes `<script>alert(1)</script>`. The
handlers now call `stripMarkup`, the linear scanner that already existed in
`src/foundry/world-search.ts` and is now exported. It removes comments,
script/style elements and tags in one pass, keeps an unmatched `<` as literal
text, and never runs a multi-character regex. Reuse beats a second copy, and the
scanner is already covered by 37 tests.

**Prototype-polluting assignment** (`src/foundry/world-cache.ts`). `mergePatch`
already skipped dangerous keys, but through `FORBIDDEN_KEYS.has(key)`, which
static analysis cannot follow, so the assignment below it was reported as a sink.
The guard is now the literal comparison the query documents
(`key === '__proto__' || key === 'constructor' || key === 'prototype'`). The
`FORBIDDEN_KEYS` set stays for `sanitize`, and the existing prototype-pollution
tests cover both paths.

Two regression tests assert the sanitization fix: a chat message and a journal
page built from `<scr<script>ipt>alert(1)</script>` must leave no `<` in the
output.

### P7 — the widened lint scope is green again

`66342fd style(lint): run Biome over scripts/ and tests/, not only src/` widened
`files.includes` to `scripts/**`, `tests/**` and `*.config.ts`, but the files it
newly covered still carried 51 errors: 30 `useBlockStatements`, 3
`organizeImports` and 18 files the formatter had never seen. `bun run lint` is
`biome check`, so the job failed on the branch while `main` stayed green.

The repair stays inside what the linter reported. `biome check --write` applied
the safe fixes (format and import order) to 19 files, and `--write --unsafe`
wrapped the 30 brace-less statements in the four `scripts/` files. No assertion,
behaviour or test count changed: `src/foundry/client.ts` only reorders a
re-export, and the script diffs are reflows and blocks.

**Windows pitfall, worth remembering.** With `core.autocrlf=true` the working
tree is CRLF while the repository stores LF, so `biome check` in the checkout
reports 174 errors, 141 of them format-only false positives the Linux runner
never sees. The real figure comes from the LF blobs: export the index with
`git -c core.autocrlf=false checkout-index -a -f --prefix=<tmp>` and run Biome
there. That is how the 51 errors were separated from the noise.

### P8 — the integration runtime is Node-only (step 2)

The Python layer added no capability. Every `adapter.py` was the same wrapper:
validate the operation name, then `await context.invoke(operation, arguments)`.
`worker.py` only spoke JSONL on stdout and waited for Node to run the binding;
Python never reached Foundry and never received credentials. Each call therefore
crossed the process boundary four times to reach the same JavaScript.

The manager now executes the registered binding directly:

- `src/integrations/manager.ts` keeps the operation fence, the write
  classification and the `outcome_unknown` rule, and drops `PythonWorker`,
  `WorkerInvocation`, the per-target generation handshake and the worker timeout.
  `reconcile(environment)` no longer takes a session generation.
- `src/integrations/manifest.ts` removes `entrypoint` and `PythonEntrypoint`;
  `bindings`/`probes` stay `.js` and remain contained by `containedFile`.
- `src/config/targets.ts` and `src/sessions/session.ts` drop `pythonExecutable`
  and `integrationTimeoutMs`; the strict target schema rejects both.
- Deleted: `src/integrations/python-worker.ts`, `python/foundry_mcp_modules/`,
  six `adapter.py`, six `test_*_adapter.py`, `npm run test:python`,
  `just test-python`, the `python/` entry in `package.json#files`.
- `scripts/smoke-integrations.js` now loads the packaged manifests, compiles every
  contract, validates the recipes and asserts that no package still ships Python.
- The scaffolder no longer writes `adapter.py`; `integration-packages.mjs` no
  longer requires an entrypoint.

Two behaviours changed with the deletion, both intentional:

1. **`operation_pending` is gone.** It existed because a worker call could fail
   while a previously dispatched binding was still running. With one binding per
   call, the awaited execution is the only in-flight request, so the manager has
   nothing to quarantine. The session queue still waits for tracked provider
   requests (`src/sessions/__tests__/operation-lifecycle.test.ts`).
2. **A provider error without a `code` is now `outcome_unknown` after a write.**
   The worker used to relabel it `provider_error`; the manager treats an uncoded
   failure as an unknown outcome, which is the safer reading.

The door stays open: if a future adapter needs a Python-only library, it can be
reintroduced as an opt-in per package, never as a mandatory entrypoint for every
target.

### P9 — named relay operations (step 3)

Point 1 of the review was that the REST provider sends JavaScript to
`/execute-js`. The provider now sends **named operations** by default:

- `src/providers/types.ts` adds `RestRuntimeMode` (`named` | `execute-js`),
  `runtimeMode` and `runtimePath`; `execute()` takes `{ readOnly, operation? }`.
- `src/providers/rest-api.ts` splits the old `request()` into `requestScript()`
  and `requestOperation()` over a shared `send()`. Named mode posts
  `{ clientId, operation, args, write }` to `/mcp/operation`, so **no script
  source crosses the wire**. Core work uses `core.snapshot`,
  `core.modify_document` and `core.roll_dice`; snapshot and watch resolve per
  mode, and `capabilities` adds `runtime.named`.
- `src/integrations/manifest.ts` derives `<kind>.<id>.<generation>.<operation>`
  and `src/integrations/manager.ts` carries it as `runtime`/`runtimeProbe` into
  every binding and probe.
- `src/config/targets.ts` accepts `runtimeMode`/`runtimePath`, cross-checks them
  against `executeJsPath`, and reads `FOUNDRY_REST_RUNTIME_MODE` and
  `FOUNDRY_REST_RUNTIME_PATH`.

`execute-js` survives as an explicit opt-in — `runtimeMode: 'execute-js'` or a
configured `executeJsPath` — because the existing relay implements that route.
The default is `named`; there is no silent fallback in either direction, and a
target that pairs the wrong path with the wrong mode is rejected by both the
schema and the constructor.

Identity verification moved with the transport: the injected JavaScript guard is
gone, and the relay may echo `identity` in the envelope. A mismatch drops the
bound identity; without an echo, identity is verified at snapshot time only.

**Not verifiable end to end.** The named contract must be implemented by the
relay, which is outside this repository. Until it ships, a default `rest-api`
target fails fast with `unsupported_operation` instead of degrading, and the
existing relay keeps working through the opt-in.

## What is gained

1. **PF2e actors display HP and AC again** and the HP cap error is actionable.
2. **No invented document data**: `prof` appears only when it was derived.
3. **Local result schemas resolve** and are validated strictly, so a broken
   `$ref` fails in tests instead of at runtime.
4. **Discovery and execution cannot drift**: one table decides both, and an
   unclassified tool is hidden rather than silently treated as a read.
5. **Local generators work offline** — a real capability gain, since they never
   touch Foundry.
6. **Version filters express intent**: a package can say "generation 14" without
   pinning a patch build.
7. **Manifest mistakes fail early** with a targeted message instead of a runtime
   traceback.
8. **Documentation matches behaviour** again (matrix, ADR-0011, integration guide).
9. **The suite is deterministic and platform-independent**: five consecutive full
   runs were green before P8, and the Node-only suite no longer needs an
   interpreter to exercise the integration lifecycle.
10. **Tool text output is tag-free by construction.** The handlers no longer rely
    on a regex that can rebuild the tag it removed, and the scanner they share is
    linear on hostile input.
11. **The lint scope and the code agree.** `scripts/` and `tests/` are both linted
    and clean now, so the widened `files.includes` no longer hides a failing gate.
12. **One fewer runtime.** Integrations need only Node: no interpreter to install,
    no process to supervise, no duplicate wrapper per package.

## What is lost or accepted as risk

1. **Local tools leave the session queue.** They bypass `session.run()`, so a
   generator invoked while a write is in flight is not serialized with it. This is
   intentional (no Foundry access) but is a real ordering change.
2. **`available()` now reads `session.config.provider`.** Any test double that
   omits `config` throws; `catalog-schema.test.ts` was updated to model a complete
   session. Production sessions always carry `config`.
3. **Bare-integer matching loosens a constraint.** `"14"` accepts every 14.x
   build, including untested patch releases; `compatibility.tested` remains the
   only record of live verification.
4. **Removed configuration is rejected, not ignored.** A target that still sets
   `pythonExecutable` or `integrationTimeoutMs`, or a manifest that still sets
   `entrypoint`, fails validation. That is deliberate: silently ignoring them
   would hide a package that cannot load.
5. **Line endings are still a local trap.** `node <package>/build.mjs --check`
   compares bytes, so a checkout with `core.autocrlf=true` regenerates CRLF and
   the check fails. The generated files are LF now and the check passes, but a
   fresh checkout will fail again until `.gitattributes` pins `eol=lf`.
6. **No live Foundry evidence.** PF2e projections, the dual-mode identity probe
   and the new filters are verified by tests and source only, not against a
   running world.

## Deferred and open items

- **Re-run CodeQL** on the branch to confirm the three alerts close.
- **`.gitattributes`** (`* text=auto eol=lf`) or `core.autocrlf=false`: an
  operator decision, because it changes checkout behaviour for everyone.
- **Commit and push**: operator-only.
- **Live verification** of PF2e HP/AC display and the dual-mode probe.
- **Local lint on Windows** still needs the LF-blob export above (or
  `.gitattributes` with `eol=lf`) before it agrees with CI.
- **Maintainer reply**: point 2 (Node-only) and point 1 (named operations, with
  `execute-js` retained as a documented opt-in for the existing relay) both need
  to be posted. The relay-side implementation of the named contract is still
  outstanding upstream; until it ships, an existing relay keeps working through
  `runtimeMode: 'execute-js'`.
- **`smoke:pack`** was not run locally: it needs a published build, dependency
  resolution and a POSIX `chmod`. The installed-package path is therefore verified
  by `smoke:integrations` only.

## Verification log

| Command | Result |
|---|---|
| `node node_modules/typescript/bin/tsc --noEmit` | exit 0 |
| `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.scripts.json` | exit 0 |
| `node node_modules/vitest/vitest.mjs run` | 65 files, 1214 tests, all green |
| `node scripts/integrations.mjs check` | 6 packages checked |
| `node scripts/integrations.mjs test` | 646 tests, 0 failures |
| `node scripts/smoke-integrations.js` | 6 packages, 258 strict schemas, 168 validated recipes |
| `node_modules/.bin/biome.exe check <touched files>` | no errors (one pre-existing unsafe-fix info) |
| `node_modules/.bin/biome.exe check` (CRLF working tree) | format noise only; the LF blobs are the reference |

Test count moved from 1171 to 1207 across P1–P7, then to 1204 with P8: three tests
described the Python worker and one new test rejects a legacy `entrypoint`. P9 adds
ten: five cover the named transport (no `script` on the wire, a core write, a
missing operation, a cross-mode path, an identity mismatch) and five the
configuration, the environment variables and the propagated operation name.

## Note on `git status`

After regenerating the packages, `git status` lists about 120 modified files
while `git diff --numstat` reports content changes in 22 of them. The extra
entries are stale stat cache: the generator rewrote unchanged files with LF while
`core.autocrlf=true` expects CRLF, so git flags them until it refreshes the index.
`git diff` compares content and shows nothing, and the next `git add` records no
change for them.

## How to re-verify

```
node node_modules/typescript/bin/tsc --noEmit
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.scripts.json
node node_modules/vitest/vitest.mjs run
node scripts/integrations.mjs check
node scripts/integrations.mjs test
node scripts/smoke-integrations.js
```
