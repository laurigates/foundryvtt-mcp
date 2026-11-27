# ADR-013: Keep the World Cache Live From `modifyDocument` Broadcasts

**Status**: Accepted
**Date**: 2026-08-11 (commit e4e2548, PR #208; v14 batch broadcasts 2026-11-24, commit 81452f9, PR #326; recorded retroactively 2026-11-24)
**Domain**: data-layer
**Amends**: [ADR-004](../blueprint/adrs/ADR-004-in-memory-world-state-cache.md) (the cache is no longer a connect-time snapshot)
**Related**: [ADR-010](0010-mutation-api-conventions.md), [ADR-014](0014-foundry-v13-v14-wire-shapes.md)
**Issues**: #205, #232, #323

## Context

ADR-004 cached the `WorldData` received at connect time and left freshness to an explicit `refresh_world_data`. Once write tools existed, that broke the read-after-write pattern an LLM caller relies on: it writes, reads back to confirm, sees the old value, concludes the write failed and retries into duplicates. Changes made by other users (a player moving a token, the GM editing in the UI) were also invisible for the life of the connection (#205).

Foundry already sends every change to connected clients as a `modifyDocument` broadcast. From v14, a change with server-side side effects arrives as a `modifyDocumentBatch` event carrying `{ results: [...] }` (#232).

## Decision

`FoundryClient` subscribes to the `modifyDocument` broadcast and, from #326, to `modifyDocumentBatch`, and `src/foundry/world-cache.ts` applies each change to the cached collections.

- Applying is idempotent: `create` upserts by `_id`, `delete` tolerates a missing id.
- Document types not in `TOP_LEVEL_COLLECTIONS` / `EMBEDDED_COLLECTIONS` and unresolvable parents are dropped, so the cache goes stale rather than corrupt.
- Broadcast payloads are untrusted: `__proto__`, `constructor` and `prototype` keys are dropped before merging.
- The listeners attach only after a successful handshake and are removed on disconnect.
- `refresh_world_data` stays as the full-resync escape hatch, and `get_health_status` marks the world section stale when the cache stopped following changes (a dropped connection, whose missed broadcasts are never replayed).

## Consequences

**Positive:**
- Reads reflect other users' changes without a refresh.
- New document types need a map entry, not new plumbing.

**Negative:**
- **The writer's own changes are not broadcast back to it** (13.348 and 14.369 send the broadcast to every socket except the requester's). `modifyDocument()` does not apply its own ack, so a read right after an MCP write still returns the pre-write value until `refresh_world_data`. Read from the server source, not yet confirmed live (#323).
- Changes to synthetic token actors (unlinked tokens, `Scene.<sid>.Token.<tid>.Actor.<aid>`) are not applied.
- Broadcasts missed while disconnected are lost; only a refresh recovers them.

## Alternatives Considered

- **Refetch the world before each read.** Rejected: a full `world` round trip per tool call, the latency ADR-004 avoided.
- **Patch `worldData` inside each mutation method.** Rejected: duplicated in every write tool; if the own-write gap is closed, it is closed once in `modifyDocument()` by applying the ack through `world-cache.ts`.
