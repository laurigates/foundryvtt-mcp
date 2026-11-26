---
paths:
  - "src/foundry/**"
  - "src/tools/**"
---

# FoundryVTT Transport & Write Protocol

How the MCP server talks to FoundryVTT, and how to perform game-state
mutations. Read this before adding any tool that reads or (especially) writes
FoundryVTT documents.

## Transports — Socket.IO is primary, the REST bridge is an optional augment

| Mode | Trigger | What it does |
|------|---------|--------------|
| **Socket.IO** (`socket`, default) | `FOUNDRY_USERNAME` + `FOUNDRY_PASSWORD`, no `FOUNDRY_API_KEY` | Authenticates a real Foundry client session (4-step `/join` flow in `auth.ts`), connects to `FOUNDRY_URL` (`:30000`), and keeps a live `worldData` cache. Reads are served from that cache; writes use `modifyDocument`. |
| **Dual** (`dual`) | Socket.IO credentials + `FOUNDRY_API_KEY` + `FOUNDRY_REST_URL` | Socket.IO as above, plus the REST bridge for what only code inside Foundry sees: prepared actor values, Foundry's Roll engine, compendium search, logs, system health. |
| **REST only** (`rest`, deprecated) | `FOUNDRY_API_KEY` without credentials, or without `FOUNDRY_REST_URL` | `/api/*` on the bridge at `FOUNDRY_URL`; no writes, combat, journals or live updates. |

The mode is decided in `src/foundry/transport.ts`, and which source serves each
capability in `src/foundry/capabilities.ts` (see ADR-011,
`docs/adrs/0011-dual-mode-transport.md`). The bridge is
[laurigates/foundryvtt-local-rest-api](https://github.com/laurigates/foundryvtt-local-rest-api):
a Foundry module plus a Node bridge server (`:3030`). It answers only while a
GM is logged in through a browser. It is released (v2.1.2, Foundry v13 and
v14); the route fixes for laurigates/foundryvtt-local-rest-api#6 and #8 shipped
in its v2.1.0, and dual mode was checked by hand against a live world on 2026-11-26. A 5xx from the bridge pauses that capability for 30 s. **Writes never
go through the bridge.** Default deployments are Socket.IO-only, so do not
assume the bridge is present; a dual-mode read must fall back when it is down.

## Writes use the core `modifyDocument` Socket.IO protocol

Mutations go over the existing authenticated socket (no bridge), per PRD-003
(`docs/prds/write-operations.md`). The transport lives in `client.ts`:
`assertWriteable()` → `emitWithAck()` → `modifyDocument()`.

- **Gate**: writes require `FOUNDRY_WRITE_ENABLED=true` **and** an active socket
  (`assertWriteable`). The connected user needs GM/owner permission.
- **Request** (standard Socket.IO ack callback): `socket.emit("modifyDocument", request, cb)` where
  `request = { type, action, operation }`:
  - `type`: document name — `"Actor"`, `"Item"`, …
  - `action`: `"create" | "update" | "delete"`
  - `operation`: `data:[…]` (create) / `updates:[{_id, …}]` (update) / `ids:[…]` (delete),
    plus `broadcast:true`, `pack:null`, and — for embedded docs —
    `parentUuid:"Actor.<actorId>"`.
- **Response**: `{ type, action, operation, userId, result: object[]|string[], error? }`.
  Reject on `response.error`; `result` holds created/updated data or deleted ids.
  v14 adds `timestamp` and `sideEffect` (boolean) to each response.
- **v14 side effects (#232)**: when a write causes further server-side changes,
  the ack is `{ results: [...] }` instead of a single response: one entry per
  side effect (`sideEffect: true`) plus the primary response. `modifyDocument()`
  accepts both shapes, rejects if any entry carries an `error`, and returns the
  primary entry's `result`. A real trigger: creating an active Combat while
  another Combat is active makes the server deactivate the old one, so
  `startCombat` gets the `{ results }` form. Others seen in the 14.369 server:
  a Combatant on another scene clearing its Combat's `scene`, a Token move
  updating attached Regions, and Folder, Scene, Level, Setting and fog changes.
- Actor `system` updates take **dot-notation keys prefixed with `system.`**
  (e.g. `"system.attributes.hp.value"`); Foundry merges recursively.

## The cache follows writes automatically (#205)

`worldData` is no longer a connect-time snapshot. `client.ts` subscribes to the
`modifyDocument` **broadcast** — the same event, arriving unsolicited — and
`world-cache.ts` applies it to the cached collections, so changes made by
*other* users (a player moving a token, the GM editing in the UI) land in the
cache. From v14, a change that had side effects arrives instead as a
`modifyDocumentBatch` event carrying `{ results: [...] }` (side effects plus the
primary change, each shaped like a single broadcast); `client.ts` subscribes to
that too and applies the entries in order (#232).

**The writer's own changes are not broadcast back to it.** In both 13.348 and
14.369 the server sends the broadcast to every socket *except* the one that
made the request, and answers that socket only through the ack. `modifyDocument()`
does not apply the ack to `worldData`, so a read after the MCP's own write
returns the pre-write value until `refresh_world_data`. This is read from the
server source and not yet confirmed against a live world (#323).

Consequences for new write tools:

- **Do not hand-patch `worldData` in a single mutation method.** If the
  own-write gap above is closed, close it once, in `modifyDocument()`, by
  applying the ack through `world-cache.ts`. Applying is idempotent (`create`
  upserts by `_id`), so a change that also arrives as a broadcast is harmless.
- **A new document type needs a map entry**, not new plumbing: add it to
  `TOP_LEVEL_COLLECTIONS` or `EMBEDDED_COLLECTIONS` in `world-cache.ts`.
  Unmapped types are dropped silently (by design — an unmodelled payload leaves
  the cache stale rather than corrupt).
- **Known gap**: broadcasts parented to a *synthetic token actor*
  (`Scene.<sid>.Token.<tid>.Actor.<aid>`, unlinked tokens) are not applied —
  that actor is a per-token delta, not a document in any cached collection.
  Those still need `refresh_world_data`.
- `refreshWorldData()` (re-emits `world`) remains the full-resync escape hatch.

## Verify the protocol against the bundled app source — don't guess

The exact wire shape is FoundryVTT-version-specific and **not reliably
documented on the web** (the wiki is JS-rendered). The authoritative source is
the app build itself, cached by the sibling **foundryvtt-harness** checkout
under `data/container_cache/`. It holds `foundryvtt-13.348.zip` and
`foundryvtt-14.369.zip`; the harness runs 14.369. Run from the `foundryvtt-mcp`
root:

```
unzip -o -q ../foundryvtt-harness/data/container_cache/foundryvtt-14.369.zip 'client/data/client-backend.mjs' 'common/abstract/socket.mjs' 'dist/database/backend/server-backend.mjs' -d /tmp/fvtt-14369
```

The two zips are laid out differently: 13.348 keeps everything under
`resources/app/`, 14.369 (the Node build) at the archive root. The `client/` and
`common/` sources are unminified; `dist/` (the server) is minified, so
pretty-print it to read it. Read these files; do not copy them into this repo
(`../.claude/rules/foundryvtt-license.md`).

Key files: `client/data/client-backend.mjs` (`ClientDatabaseBackend`: request
building, dispatch, and the broadcast listeners), `client/helpers/socket-interface.mjs`
(emit-with-ack; bundled into `public/scripts/foundry.mjs` in v14),
`common/abstract/socket.mjs` + `common/abstract/_types.mjs` (response fields and
per-action `operation` fields), and `dist/database/backend/server-backend.mjs`
(the server's `modifyDocument` handler: what it acks and what it broadcasts).
Side-effect producers are in `dist/database/documents/*.mjs`.

### What was verified at 14.369 (#232)

Read from the 14.369 build; differences are against 13.348.

| Aspect | 14.369 | Changed? |
|--------|--------|----------|
| Request | `{ type, action, operation }`; embedded docs carry `operation.parentUuid` (the client fills it from the parent and drops the parent object) | No |
| Operation fields | create `data[]`, update `updates[]` (each with `_id`), delete `ids[]`; the server sets `modifiedTime`, `diff`, `recursive` and `render` defaults itself | No |
| Ack, no side effects | one response; `result` is created data, update diffs, or deleted ids | No |
| Ack, with side effects | `{ results: [...] }`: side-effect responses (`sideEffect: true`) plus the primary | **New** |
| Error | `error` on the failing response; inside `{ results }` the wrapper has no top-level `error` | **New** (follows from the above) |
| Broadcast, no side effects | `modifyDocument` with one response, to every socket but the requester's | No |
| Broadcast, with side effects | `modifyDocumentBatch` with `{ results: [...] }`, filtered to entries that have a result and are broadcast | **New** |
| Batched writes | a client may also *send* `modifyDocumentBatch` (an array of requests, dry-run first, then applied); the MCP does not use it | **New**, unused |
| Server-initiated changes | still emitted as `modifyDocument` to all sockets | No |

The client handles the two new shapes (`modifyDocument()` and
`onDocumentBatchBroadcast` in `client.ts`, `parseDocumentBroadcastBatch` in
`world-cache.ts`). **Live round-trip at 14.369: pending (#324).** The harness world is
a copy of production and the shell's `FOUNDRY_USERNAME` does not exist in it;
its GM users are `Gamemaster` and `bridge-server`. The write-path conclusions
above come from the source and the unit tests in
`src/foundry/__tests__/modify-document-v14.test.ts`, not from a live write.

When implementing a new write feature (combat, tokens, scenes — PRD-003
FR-018…FR-024), confirm the shape in these files first, then smoke-test one
round-trip against a live world.

## What does NOT map to `modifyDocument`

Compendium reads (`search_compendium`, compendium-source item create) use
`CompendiumCollection.getDocuments` / the pack index — a separate socket path,
not `modifyDocument`. `search_compendium` is served only by the REST
bridge (dual or REST-only mode): in Socket.IO mode it is hidden from
`tools/list` and a direct call is rejected by the availability gate (see
`src/tools/availability.ts`). The same capability-based hiding covers the other
bridge-only tools (`get_recent_logs`, `search_logs`, `get_system_health`), and
the write tools are hidden unless Socket.IO is connected and
`FOUNDRY_WRITE_ENABLED=true`. Compendium-source create stays rejected over
Socket.IO. Design a pack-read path before adding compendium writes.
