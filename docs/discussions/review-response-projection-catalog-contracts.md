# Review response: projection, catalog and integration-contract hardening

Status: working tree only, not committed. The operator owns commit and push.

## Evidence policy

The upstream review thread was **not** read: pull-request descriptions, diffs,
files, comments, reviews, CI results and code-scanning alerts are outside the
allowed scope, so nothing below quotes or paraphrases them. Every claim is
derived from local evidence: git history, source, tests and the commands listed
in the verification log.

Code-scanning alerts cannot be triaged from here. Paste the alert titles as text
(`js/rule-name src/file.ts:line`) to map them onto this work.

## Workstreams

| # | Change | Files | Commit |
|---|---|---|---|
| P1 | Projection display defects | `src/providers/projections.ts`, `src/providers/__tests__/projections.test.ts`, `systems/pf2e/{13,14}/actor-projection.json`, both PF2e `README.md` | `bf0bdfc` (test file still local) |
| P2 | Fragment-only `$id` in the catalog | `src/tools/catalog.ts`, `src/tools/__tests__/catalog-schema.test.ts` | `1ea0c5f` |
| P3 | Dual-mode capability matrix | `src/tools/__tests__/capability-matrix.test.ts`, `docs/adrs/0011-dual-mode-transport.md`, `docs/guides/capabilities.md` | `bd7e78b` |
| P4 | Integration contracts and the capability source of truth | `src/integrations/{types,manifest}.ts`, `src/tools/catalog.ts`, six `src/registry.mjs`, six `manifest.json`, `scripts/create-integration.mjs`, `docs/guides/writing-integrations.md`, three test files | local |
| P5 | Python interpreter resolution | `python-worker.ts` callers in four integration test files, `src/foundry/__tests__/legacy-client.test.ts` | `c3d1b89` |
| — | Load-dependent test timeouts | `src/integrations/__tests__/lifecycle.test.ts` | local |

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
- `src/integrations/manifest.ts` refines `entrypoint` to `.py` and
  `binding`/`probe` to `.js`, so a manifest cannot point the worker at a file it
  would misparse.
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

### Load-dependent test timeouts

Three lifecycle tests used a 250 ms timeout against a real Python start. Under 65
parallel workers the start sometimes consumed the timeout, so the assertion saw a
different error code. Timeouts are now 2500 ms and the adapter sleep is 5 s, which
keeps the same assertions but makes the ordering deterministic.

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
7. **Manifest mistakes fail early** with a targeted message instead of a Python
   traceback.
8. **Documentation matches behaviour** again (matrix, ADR-0011, integration guide).
9. **The suite is deterministic**: five consecutive full runs are green, and the
   Python integration tests actually execute on Windows.

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
4. **Three lifecycle tests are slower.** Timeouts moved from 250 ms to 2500 ms
   (adapter sleep 2 s to 5 s) so the timeout lands after dispatch instead of
   during a loaded Python start. Assertions are unchanged; the suite costs about
   7 s more.
5. **Line endings are still a local trap.** `node <package>/build.mjs --check`
   compares bytes, so a checkout with `core.autocrlf=true` regenerates CRLF and
   the check fails. The generated files are LF now and the check passes, but a
   fresh checkout will fail again until `.gitattributes` pins `eol=lf`.
6. **No live Foundry evidence.** PF2e projections, the dual-mode identity probe
   and the new filters are verified by tests and source only, not against a
   running world.

## Deferred and open items

- **Code-scanning alerts**: need the titles pasted as text.
- **`.gitattributes`** (`* text=auto eol=lf`) or `core.autocrlf=false`: an
  operator decision, because it changes checkout behaviour for everyone.
- **Commit and push**: operator-only.
- **Live verification** of PF2e HP/AC display and the dual-mode probe.

## Verification log

| Command | Result |
|---|---|
| `node node_modules/typescript/bin/tsc --noEmit` | exit 0 |
| `npx vitest run` (five consecutive runs) | 65 files, 1205 tests, all green |
| `node scripts/integrations.mjs check` | 6 packages checked |
| `node scripts/integrations.mjs test` | 646 tests, 0 failures |
| `node --test scripts/tests/integration-tooling.test.mjs` | 7 tests, 0 failures |
| `node_modules/.bin/biome.exe check <touched files>` | no findings (only the pre-existing deprecated-config warning) |

Test count moved from 1171 to 1205 across this work.

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
npx vitest run
node scripts/integrations.mjs check
node scripts/integrations.mjs test
node --test scripts/tests/integration-tooling.test.mjs
```
