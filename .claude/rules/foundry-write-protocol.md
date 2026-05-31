---
paths:
  - "src/foundry/**"
  - "src/tools/**"
---

# FoundryVTT Transport & Write Protocol

How the MCP server talks to FoundryVTT, and how to perform game-state
mutations. Read this before adding any tool that reads or (especially) writes
FoundryVTT documents.

## Two transports — Socket.IO is primary

| Mode | Trigger | What it does |
|------|---------|--------------|
| **Socket.IO** (primary) | `FOUNDRY_USERNAME` + `FOUNDRY_PASSWORD` | Authenticates a real Foundry client session (4-step `/join` flow in `auth.ts`), connects to `FOUNDRY_URL` (`:30000`), and loads a read-only `worldData` snapshot. Reads are served from that cache. |
| **REST / `apiKey`** (secondary) | `FOUNDRY_API_KEY` set | Hits `/api/*` on the REST module / bridge. Optional — per the README it powers "REST API diagnostics". May be extracted (`feat/extract-rest-api-module`). |

`.env.example` states Socket.IO is the primary method and `FOUNDRY_API_KEY` is
commented out. **Do not assume the bridge/REST path is in use** — default
deployments are Socket.IO-only. The bridge repo (`foundryvtt-local-rest-api`)
is local-only (no remote) with active WIP; treat it as out-of-scope.

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
- Actor `system` updates take **dot-notation keys prefixed with `system.`**
  (e.g. `"system.attributes.hp.value"`); Foundry merges recursively.
- After a write, `worldData` is stale — document it / expose `refresh_world_data`
  (the `refreshWorldData()` method re-emits `world`). Do not assume the cache updated.

## Verify the protocol against the bundled app source — don't guess

The exact wire shape is FoundryVTT-version-specific and **not reliably
documented on the web** (the wiki is JS-rendered). The authoritative source is
the actual app, shipped unminified under `data/container_cache/foundryvtt-<ver>.zip`:

```
unzip -o -q data/container_cache/foundryvtt-13.348.zip 'resources/app/client/data/client-backend.mjs' -d /tmp/fvtt
```

Key files: `client/data/client-backend.mjs` (`#buildRequest`/`#dispatchRequest`),
`client/helpers/socket-interface.mjs` (`dispatch` = emit-with-ack), and
`common/abstract/socket.mjs` + `common/abstract/_types.mjs` (response shape and
per-action `operation` fields). When implementing a new write feature
(combat, tokens, scenes — PRD-003 FR-018…FR-024), confirm the shape there
first, then smoke-test one round-trip against a live world.

## What does NOT map to `modifyDocument`

Compendium reads (`search_compendium`, compendium-source item create) use
`CompendiumCollection.getDocuments` / the pack index — a separate socket path,
not `modifyDocument`. Currently `search_compendium` stays on the REST path
(graceful-empty without `apiKey`) and compendium-source create is rejected over
Socket.IO. Design a pack-read path before adding compendium writes.
