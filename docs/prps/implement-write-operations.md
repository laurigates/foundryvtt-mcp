# PRP: Implement Write Operations

**Source**: docs/prds/write-operations.md (PRD-003)
**Priority**: High (FR-018), Medium (FR-019, FR-020, FR-021), Low (FR-022, FR-023, FR-024)
**Confidence**: 8/10

## Goal

Add write operations to foundryvtt-mcp, starting with combat management (FR-018) as the highest-value first step.

## Phase 1 Implementation Plan (FR-018 + FR-019)

### Step 1: Add write guard

Add `FOUNDRY_WRITE_ENABLED` env var to config:

```typescript
// src/config/index.ts
FOUNDRY_WRITE_ENABLED: z.string().optional().transform(v => v === 'true'),
```

All write tool handlers check this at the start and return an error if false.

### Step 2: Add Socket.IO write helper to FoundryClient

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

```typescript
// src/tools/handlers/combat-write.ts
export async function startCombat(client: FoundryClient, tokenIds: string[]): Promise<string>
export async function endCombat(client: FoundryClient, combatId: string): Promise<void>
export async function nextTurn(client: FoundryClient, combatId: string): Promise<CombatState>
export async function setInitiative(client: FoundryClient, combatId: string, combatantId: string, initiative: number): Promise<void>
```

### Step 4: Implement token manipulation tools

```typescript
// src/tools/handlers/tokens.ts
export async function moveToken(client: FoundryClient, tokenId: string, x: number, y: number): Promise<void>
export async function applyStatusEffect(client: FoundryClient, tokenId: string, effect: string, active: boolean): Promise<void>
```

### Step 5: Register tool schemas

Add to `src/tools/definitions.ts`:
- `start_combat`, `end_combat`, `next_turn`, `set_initiative`
- `move_token`, `apply_status_effect`

### Step 6: Write unit tests

```typescript
// src/tools/handlers/__tests__/combat-write.test.ts
// Mock socket.emit responses
// Test: write guard blocks when disabled
// Test: start_combat emits correct Socket.IO event
// Test: error handling on Socket.IO failure
```

### Step 7: Update documentation

- README: add "Write Operations" section with `FOUNDRY_WRITE_ENABLED` instructions
- Add tool descriptions to API reference

## Test Checklist

- [ ] Unit: all write handlers tested with mocked Socket.IO
- [ ] Unit: write guard returns error when `FOUNDRY_WRITE_ENABLED=false`
- [ ] E2E: `start_combat` creates combat with correct tokens (requires live Foundry)
- [ ] E2E: `next_turn` advances initiative correctly

## Files to Create/Modify

| File | Action |
|------|--------|
| `src/config/index.ts` | Add `FOUNDRY_WRITE_ENABLED` |
| `src/foundry/client.ts` | Add `emitWrite()` helper |
| `src/tools/handlers/combat-write.ts` | New file |
| `src/tools/handlers/tokens.ts` | New file |
| `src/tools/definitions.ts` | Add tool schemas |
| `src/tools/registry.ts` | Register write tools |
| `tests/unit/combat-write.test.ts` | New tests |
| `README.md` | Document write ops |
| `.env.example` | Add `FOUNDRY_WRITE_ENABLED=false` |

## Success Criteria

- All write tools disabled by default (`FOUNDRY_WRITE_ENABLED` not set)
- All write tools documented with clear opt-in instructions
- Unit test coverage ≥ 80% for new handlers
- No regressions in existing read-only tools
