# PRP: Implement Write Operations

**Source**: docs/prds/write-operations.md (PRD-003)
**Priority**: High (FR-018), Medium (FR-019, FR-020, FR-021), Low (FR-022, FR-023, FR-024)
**Confidence**: 8/10

## Goal

Add write operations to foundryvtt-mcp, starting with combat management (FR-018) as the highest-value first step.

## Status (current)

| Area | Status |
|------|--------|
| Write guard (`FOUNDRY_WRITE_ENABLED`) | ✅ Shipped — `assertWriteable()` in `src/foundry/client.ts`, config `writeEnabled` in `src/config/index.ts` |
| Socket.IO write transport | ✅ Shipped — `modifyDocument()` (NOT the generic `emitWrite` originally sketched below); see "Design correction" |
| Actor attribute mutation (FR-021) | ✅ Shipped — `update_actor_attributes` (#143) |
| Actor item CRUD (FR-021) | ✅ Shipped — `create_actor_item` / `update_actor_item` / `delete_actor_item` (#142, #159) |
| Combat write — `next_turn`, `end_combat`, `set_initiative` (FR-018) | ✅ Shipped — Phase 1a, this PRP |
| Combat write — `start_combat` (FR-018) | ✅ Shipped — [#172](https://github.com/laurigates/foundryvtt-mcp/issues/172) |
| `next_turn` skipDefeated refinement | ✅ Shipped — [#173](https://github.com/laurigates/foundryvtt-mcp/issues/173) |
| Token manipulation — `move_token`, `apply_status_effect` (FR-019) | ✅ Shipped — [#174](https://github.com/laurigates/foundryvtt-mcp/issues/174) |
| Token manipulation — `update_token` (name/visibility/disposition) (FR-019) | ⏳ Deferred |

## Design correction: `modifyDocument`, not `emitWrite`

The early sketch below proposed a generic `emitWrite(event, data)` helper. The
implementation instead uses FoundryVTT's core **`modifyDocument`** Socket.IO
protocol — the request shape verified against the bundled v13.348 app source
(`client/data/client-backend.mjs` `#buildRequest`). All writes go through:

```
assertWriteable()  →  emitWithAck('modifyDocument', { type, action, operation })  →  modifyDocument()
```

where `operation` carries `data:[…]` (create) / `updates:[{_id,…}]` (update,
with `diff`/`recursive`) / `ids:[…]` (delete), plus `parentUuid:"<Parent>.<id>"`
for embedded documents (e.g. `Combatant` → `Combat.<combatId>`). See
`.claude/rules/foundry-write-protocol.md`.

## Combat Phase 1a (FR-018) — as shipped

Three GM-gated tools operating on the **active** combat, disabled by default:

- `next_turn` — advance turn; wraps to next round past the last combatant.
  Skips `defeated` combatants when the `skipDefeated` arg is set (or the combat's
  `settings.skipDefeated`); see [#173](https://github.com/laurigates/foundryvtt-mcp/issues/173)
- `end_combat` — delete the active combat encounter
- `set_initiative` — set a combatant's initiative (`combatId` defaults to active)
- `start_combat` — create a Combat and seed Combatants from `tokenIds` (or the
  active scene's tokens); see [#172](https://github.com/laurigates/foundryvtt-mcp/issues/172)

Client methods: `updateCombat`, `endCombat`, `setCombatantInitiative`, `startCombat`
(`src/foundry/client.ts`). Pure helper `computeNextTurn` and handlers in
`src/tools/handlers/combat-mutations.ts`.

## Files (combat Phase 1a)

| File | Action |
|------|--------|
| `src/foundry/client.ts` | `updateCombat` / `endCombat` / `setCombatantInitiative` |
| `src/tools/handlers/combat-mutations.ts` | New — `computeNextTurn` + 3 handlers |
| `src/tools/definitions.ts` | `combatMutationTools` + register in `getAllTools()` |
| `src/tools/router.ts` | dispatch cases + imports |
| `src/tools/handlers/__tests__/combat-mutations.test.ts` | New — unit tests (mocked socket) |
| `tests/integration/combat.integration.test.ts` | New — gated live round-trip (skip/revert idiom) |
| `README.md` | "Write Operations" subsection + `FOUNDRY_WRITE_ENABLED` env row |
| `.env.example` | already documents `FOUNDRY_WRITE_ENABLED` |

## Test Checklist

- [x] Unit: all write handlers tested with mocked Socket.IO
- [x] Unit: write guard returns error when `FOUNDRY_WRITE_ENABLED=false`
- [x] Unit: emitted `modifyDocument` wire shape asserted (Combat update / delete, Combatant `parentUuid`)
- [~] Integration: `set_initiative` + `next_turn` live round-trip+restore — gated; skips when no active GM combat or no licensed test instance (CI gap #140)

## Deferred (separate issues)

- `start_combat` (FR-018, highest-risk — creates Combat + Combatant docs): ✅ shipped via [#172](https://github.com/laurigates/foundryvtt-mcp/issues/172)
- `next_turn` skipDefeated refinement: ✅ shipped via [#173](https://github.com/laurigates/foundryvtt-mcp/issues/173)
- Token manipulation tools (FR-019 — `move_token`, `apply_status_effect`): ✅ shipped via [#174](https://github.com/laurigates/foundryvtt-mcp/issues/174). `update_token` (name/visibility/disposition) still deferred.

## Success Criteria

- [x] All write tools disabled by default (`FOUNDRY_WRITE_ENABLED` not set)
- [x] All write tools documented with clear opt-in instructions
- [x] Unit test coverage for new handlers (every branch exercised; coverage tooling `@vitest/coverage-v8` not installed locally)
- [x] No regressions in existing read-only tools

---

## Original Phase 1 sketch (superseded — retained for history)

The steps below were the initial plan. Steps 1–2 shipped via a better
mechanism (`modifyDocument`, see "Design correction"); the combat tools shipped
in Phase 1a; token tools (Step 4) are deferred to [#174](https://github.com/laurigates/foundryvtt-mcp/issues/174).

### Step 1: Add write guard

Add `FOUNDRY_WRITE_ENABLED` env var to config:

```typescript
// src/config/index.ts
FOUNDRY_WRITE_ENABLED: z.string().optional().transform(v => v === 'true'),
```

All write tool handlers check this at the start and return an error if false.

### Step 2: Add Socket.IO write helper to FoundryClient

> Superseded: implemented as `modifyDocument()` over `emitWithAck()`, not the
> generic `emitWrite()` below.

```typescript
// src/foundry/client.ts
async emitWrite<T>(event: string, data: unknown): Promise<T> {
  if (!this.config.FOUNDRY_WRITE_ENABLED) {
    throw new Error('Write operations disabled. Set FOUNDRY_WRITE_ENABLED=true');
  }
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Write timeout')), this.config.FOUNDRY_TIMEOUT);
    this.socket.emit(event, data, (response: T) => {
      clearTimeout(timeout);
      resolve(response);
    });
  });
}
```

### Step 3: Implement combat handler tools

Shipped as `next_turn` / `end_combat` / `set_initiative` (`start_combat` deferred to [#172](https://github.com/laurigates/foundryvtt-mcp/issues/172)).

### Step 4: Implement token manipulation tools

Shipped as `move_token` / `apply_status_effect` via [#174](https://github.com/laurigates/foundryvtt-mcp/issues/174).
Client methods `moveToken` / `createActorStatusEffect` / `deleteActorEffect` plus
the `findToken` worldData resolver (`src/foundry/client.ts`); handlers in
`src/tools/handlers/token-mutations.ts`. `update_token` (name/visibility/disposition)
remains deferred.

### Step 5: Register tool schemas

Done for combat tools in `src/tools/definitions.ts` (`combatMutationTools`).

### Step 6: Write unit tests

Done — `src/tools/handlers/__tests__/combat-mutations.test.ts` (mocked socket;
guard, wire shape, error handling).

### Step 7: Update documentation

Done — README "Write Operations" subsection + `FOUNDRY_WRITE_ENABLED` env row.
