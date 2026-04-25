# User Stories

Working catalog of user stories for the foundryvtt-mcp server, used to audit test
coverage and surface blind spots. Stories are grouped by persona, then by the
cross-cutting setup/connection surface and the documented MCP resource URIs.

Coverage legend:

- ✓ — exercised by an existing unit or integration test that asserts the behavior
- ⚠ — partially covered (method called but key branch/edge case unasserted)
- ❌ — no test covers this path

Stories should be revised as the codebase evolves. The intent is that every story
maps to at least one test; gaps in this table become a tracked test backlog.

## Personas

- **Game Master (GM)** — runs sessions, manages encounters, narrates the world.
  Read-heavy, but cares about freshness (post-edit refresh, current scene, live
  combat state).
- **Player** — queries their character and the shared world. Almost entirely
  read-only.
- **Admin / Diagnostics user** — monitors Foundry server health and debugs
  issues. Gated on the optional REST API module (`FOUNDRY_API_KEY`).
- **Operator (cross-cutting)** — anyone setting up or running the MCP server.
  Cares about config, auth, retries, and clean disconnects.

## Game Master stories

| ID | Story | Tools | Coverage |
|---|---|---|---|
| GM-1 | As a GM, I want to roll dice with modifiers so I can resolve attacks/saves at the table. | `roll_dice` | ⚠ `RollDiceTool` covered by `registry.test.ts`; legacy handler in `dice.ts:16` and formula-bounds branch (max 100 chars) untested |
| GM-2 | As a GM, I want to see the initiative order with HP/AC so I can run combat. | `get_combat_state` | ❌ no handler test (`combat.ts:8`); "no active combat" branch (`combat.ts:15-19`) unverified |
| GM-3 | As a GM, I want to see the active scene's lighting/dimensions so I can describe the environment. | `get_scene_info` | ⚠ integration covers `getScenes`/`getCurrentScene`; handler default-current branch (`scenes.ts:13`) untested |
| GM-4 | As a GM, I want to find a creature by name and pull its full stat block. | `search_actors`, `get_actor_details` | ⚠ integration covers `searchActors`; `get_actor_details` handler (`actors.ts:62`) and "not found" McpError branch untested |
| GM-5 | As a GM, I want to refresh world data after editing content in Foundry without restarting the MCP. | `refresh_world_data` | ❌ no test asserts cache replacement after re-emit (`world.ts:92`, `client.ts:247`) — see DEF-2 |
| GM-6 | As a GM, I want to generate an NPC or loot pile on demand so I can improvise encounters. | `generate_npc`, `generate_loot` | ❌ untested (`generation.ts:14`, `:57`); level (1–20) and CR (0–30) bounds unverified |
| GM-7 | As a GM, I want to look up a rule mid-session without leaving chat. | `lookup_rule` | ❌ untested (`generation.ts:93`); system default ("D&D 5e") branch unverified |
| GM-8 | As a GM, I want to know who's currently connected and their role so I know who to address. | `get_users` | ⚠ `getUsers` called in integration; `ROLE_NAMES` mapping (0–4) and "Role {n}" fallback at `users.ts:16` not asserted |
| GM-9 | As a GM, I want to scan recent chat for a player decision I missed. | `get_chat_messages` | ❌ no handler test; **schema-vs-handler drift** — schema caps `limit` at 100, handler at `chat.ts:8` does not enforce. See DEF-1 |

## Player stories

| ID | Story | Tools | Coverage |
|---|---|---|---|
| PL-1 | As a player, I want to roll my own dice through the assistant. | `roll_dice` | ⚠ same as GM-1 |
| PL-2 | As a player, I want to find my character and check my own stats. | `search_actors`, `get_actor_details` | ⚠ partial (see GM-4) |
| PL-3 | As a player, I want to search items I might own or buy. | `search_items` | ⚠ integration covers `searchItems`; `type`/`rarity`/`limit` filter branches at `items.ts:13` untested |
| PL-4 | As a player, I want to read campaign notes/journals to recall plot. | `search_journals`, `get_journal` | ❌ no handler test (`journals.ts:9`, `:47`); page HTML stripping and 500-char truncation at `:60` unverified |
| PL-5 | As a player, I want a fuzzy "anything about dragons?" world search. | `search_world` | ❌ untested (`world.ts:8`); per-collection limit slicing and empty-section handling unverified |

## Admin / Diagnostics stories

All gated on `FOUNDRY_API_KEY`.

| ID | Story | Tools | Coverage |
|---|---|---|---|
| AD-1 | As an admin, I want a one-shot health summary of my Foundry server. | `get_health_status`, `get_system_health` | ⚠ `DiagnosticsClient` methods mocked; handlers (`diagnostics.ts:104`, `:193`) and Promise.all error-swallowing fallback at `:199-202` untested |
| AD-2 | As an admin, I want recent logs filtered by level. | `get_recent_logs` | ⚠ client method tested; handler at `diagnostics.ts:16` ignores `limit`/`level`/`since` params (returns all) — coverage hides this drift |
| AD-3 | As an admin, I want to grep logs with regex. | `search_logs` | ❌ pattern matching at `diagnostics.ts:57` untested; regex injection safety not checked |
| AD-4 | As an admin, I want guided troubleshooting for current errors. | `diagnose_errors` | ❌ handler at `diagnostics.ts:137` is a stub (`:147-151` always returns nominal); `category` filter ignored at `:143` |
| AD-5 | As an admin without the REST API, I expect a clear "this needs the REST API module" error rather than silence. | all 5 diagnostics | ❌ "missing API key" path untested. Resource version (`foundry://system/diagnostics`) does degrade gracefully at `resources.ts:228-246`; tool versions do not |

## Operator / setup / connection stories

| ID | Story | Surface | Coverage |
|---|---|---|---|
| CN-1 | As a new user, I run the setup wizard and get a working `.env`. | `scripts/setup-wizard.ts` | ❌ |
| CN-2 | As a user behind a reverse proxy, I configure HTTPS + custom socket path. | `FOUNDRY_URL`, `FOUNDRY_SOCKET_PATH` | ⚠ config schema tested; live HTTPS path not |
| CN-3 | As a user, plaintext HTTP to a non-localhost host warns me. | `auth.ts:117-132` | ❌ warning is emitted in code; no unit test asserts `logger.warn` is called |
| CN-4 | As a user with `FOUNDRY_USER_ID` set, I skip the username→ID lookup step. | `auth.ts:47-52`, `client.ts:146` | ⚠ `auth.integration.test.ts:41-62` covers ID resolution; pure unit branch (16-char regex shortcut, no Socket.IO emit) not isolated |
| CN-5 | As a user, when Foundry restarts mid-session the client surfaces the disconnect cleanly. | `client.ts` disconnect/cleanup | ⚠ `connectAndLoadWorld` cleans listeners on resolve/reject/timeout (`client.ts:169-217`); `refreshWorldData` (`client.ts:247-270`) leaks the `world` listener on timeout — see DEF-2 |
| CN-6 | As a user, retry/backoff (`FOUNDRY_RETRY_ATTEMPTS`/`_DELAY`) actually retries transient failures. | `client.ts:691-720` | ⚠ `client.test.ts:122-152` covers happy-path backoff; non-transient (4xx except 429) skip-retry branch and jitter unverified |
| CN-7 | As a user, schema-mismatched world payloads warn but don't crash the server. | `client.ts:198-203`, `:256-260` | ❌ `WorldDataSchema.safeParse` warns and proceeds; no test feeds a malformed payload to assert warn-and-continue |

## MCP resource URI stories

All 9 advertised URIs are registered in `src/tools/resources.ts` and handled in
`src/tools/handlers/resources.ts`. README and code agree on the surface. None
have dedicated tests.

| ID | URI | Returns | Client method | Coverage |
|---|---|---|---|---|
| RU-1 | `foundry://actors` | real data, limit 100 | `searchActors()` | ❌ |
| RU-2 | `foundry://items` | real data, limit 100 | `searchItems()` | ❌ |
| RU-3 | `foundry://scenes` | real data | `getScenes()` | ❌ |
| RU-4 | `foundry://scenes/current` | real data, graceful null | `getCurrentScene()` | ❌ |
| RU-5 | `foundry://journals` | real data | `getJournals()` | ❌ |
| RU-6 | `foundry://users` | real data | `getUsers()` | ❌ |
| RU-7 | `foundry://combat` | real data, graceful null | `getCombatState()` | ❌ |
| RU-8 | `foundry://world/settings` | real data | `getWorldInfo()` | ❌ |
| RU-9 | `foundry://system/diagnostics` | graceful stub when no API key | `diagnosticsClient.getSystemHealth()` | ❌ |

The most valuable test is a single integration test that calls
`ReadResourceRequestSchema` for each URI and asserts a non-empty payload (or
the documented graceful-null/stub for RU-4, RU-7, RU-9).

## Discovered defects

These were surfaced while auditing user stories against the code. Each should
become a tracked issue, not just a test gap.

- **DEF-1 — `get_chat_messages` limit cap not enforced.** The tool schema in
  `src/tools/definitions.ts` declares `limit` max 100, but the handler at
  `src/tools/handlers/chat.ts:8` passes the raw value through to the client
  without capping. Either enforce the cap in the handler or drop the schema
  bound. Story: GM-9.
- **DEF-2 — `FoundryClient.refreshWorldData` leaks Socket.IO listener on
  timeout.** `client.ts:247-270` registers a `world` callback path but the
  timeout reject branch (`:252-253`) never calls `socket.off('world', …)`.
  This violates `.claude/rules/development.md` ("Socket.IO event listeners
  must be cleaned up with `socket.off()` on all exit paths"). Repeated
  refresh timeouts will accumulate handlers. Story: CN-5, GM-5.
- **DEF-3 — Dead resource definitions in `src/resources/index.ts`.** The file
  defines 14 `foundry://` URIs (e.g. `foundry://world/info`,
  `foundry://compendium/*`, `foundry://playlists/all`) that are not registered
  in `src/tools/resources.ts` and have no handler in
  `src/tools/handlers/resources.ts`. The server uses the tools-side
  registration, so this file is unreferenced. Either delete it or implement
  and register the URIs.
- **DEF-4 — `diagnose_errors` and `get_recent_logs` filter params are
  silently ignored.** `diagnostics.ts:137` returns a static nominal stub
  (`:147-151`) regardless of `category`; `diagnostics.ts:16` ignores `limit`,
  `level`, and `since` and returns the full set. Both are advertised in the
  tool schema as filterable. Stories: AD-2, AD-4.

## Blind spots, ranked

1. **Every `src/tools/handlers/*` file** has zero direct unit tests. The
   router → handler → client path is exercised only transitively via
   integration tests, and only for the four entities the integration suite
   happens to touch.
2. **Error/edge cases are uniformly missing**: invalid IDs, no active combat,
   empty world, missing API key for diagnostics tools, `limit` over the
   documented max (DEF-1).
3. **`refresh_world_data`** is meaningless if cache invalidation isn't
   asserted — and it isn't. Compounded by DEF-2.
4. **All 9 MCP resource URIs** are wired up but completely uncovered. One
   integration test that walks every URI would close most of this.
5. **Procedural generation** (`generate_npc`/`generate_loot`/`lookup_rule`)
   has no schema or range assertions on output — risky because output flows
   straight to an LLM.
6. **Diagnostics handlers are stubs or pass-throughs that drop schema-declared
   filters** (DEF-4). Tests would have caught the drift.
7. **No Playwright E2E tests exist** despite the config and rules referencing
   them.
8. **Auth resilience unit tests are thin**: HTTP warning (CN-3),
   `FOUNDRY_USER_ID` shortcut (CN-4 — only integration), schema-mismatch
   warn-and-continue (CN-7), and the `refreshWorldData` listener leak
   (CN-5 / DEF-2) are all unverified at the unit level, despite
   `.claude/rules/development.md` explicitly calling out listener cleanup as
   a project rule.

## How to use this document

1. When a story changes (new tool, new behavior), update the row.
2. When a test is added, flip the row's status. A row at ✓ means: a test
   exercises this path *and* asserts the user-visible behavior, not just that
   the code ran.
3. Treat `❌` and `⚠` rows as the prioritized test backlog. Pick from the
   "Blind spots, ranked" section to triage which to write first.
