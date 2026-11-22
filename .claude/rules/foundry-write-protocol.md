---
paths:
  - "src/foundry/**"
  - "src/providers/**"
  - "src/sessions/**"
  - "src/integrations/**"
  - "src/tools/**"
---

# FoundryVTT Transport & Write Protocol

Read this before changing document reads, writes, providers, integration bindings or routing. The architecture is target-scoped: see [ADR-011](../../docs/adrs/0011-provider-session-integration-overhaul.md) and [Provider configuration](../../docs/guides/providers-and-targets.md).

## Target and capability boundaries

`src/tools/catalog.ts` is the active MCP discovery **and** execution gate. A target is resolved through `src/sessions/` and checked for readiness, the needed provider capability and the target-local `writeEnabled` flag. `src/tools/availability.ts` retains older transport-only compatibility helpers; it is **not** the authoritative multi-target dispatch path.

| Provider | Core reads/writes | Integration execution |
|---|---|---|
| `socketio` | Direct authenticated Foundry world; cache with native document broadcasts; opt-in core writes through `modifyDocument` | No generic runtime binding executor |
| `legacy-rest` | Historical `/api/*` bridge; different capabilities, no native Socket.IO write path | No paired relay execution |
| `rest-api` | Paired runtime/relay snapshot and opt-in document writes using Foundry's runtime document APIs | Fixed package-owned JS bindings over `execute-js` |
| `composite` | Socket.IO for core operations and write protocol | Paired relay for packaged integration bindings on the same identity-verified world |

In legacy environment configuration, `FOUNDRY_API_KEY` chooses **`legacy-rest`**, not the ThreeHats relay. The relay uses separate `FOUNDRY_REST_*` settings or an explicit target provider. Explicit target lists do not inherit the global write flag. Verify remote world/origin and permissions before enabling writes.

## Native Socket.IO document writes

The inherited engine is `src/providers/document-provider.ts` (imported through `src/providers/socketio.ts`); `src/foundry/client.ts` is only a compatibility re-export. `assertWriteable()` requires opt-in and an authenticated socket; the remote user must have appropriate GM/owner permission.

Native writes send the Foundry `modifyDocument` event and await a Socket.IO acknowledgement:

```text
socket.emit("modifyDocument", {
  type: "Actor" | "Item" | ...,
  action: "create" | "update" | "delete",
  operation: {
    broadcast: true,
    pack: null,
    modifiedTime: ...,
    data: [...] | updates: [{ _id: ..., ... }] | ids: [...],
    parentUuid: "Actor.<id>"  // for embedded documents
  }
}, acknowledgement)
```

The response includes `result` and may include `error`. Actor `system` changes use dot-notated `system.*` keys. Do not invent packet shapes or bypass the provider's write guard. The exact wire contract may change by Foundry version.

### Cache and acknowledgements

- `src/foundry/world-cache.ts` applies native `modifyDocument` broadcasts; do **not** also mutate the cache manually in a document method. Map new supported document types into the cache helper.
- Synthetic unlinked-token actors (`Scene.<sid>.Token.<tid>.Actor.<aid>`) cannot be fully updated by the generic world cache and may require `refresh_world_data`.
- A timeout, lost acknowledgement or connection change after dispatch can leave a mutation's outcome **unknown**. Report `outcome_unknown`; never automatically resend the write.
- Every target has its own cache, serialized operation queue, generation and pending-work set. A reconnect may invalidate an old response; it must not cancel another target's work.

## Relay document writes and runtime bindings

`src/providers/rest-api.ts` implements document mutation by executing **fixed, code-owned** Foundry runtime document methods (for example `createDocuments` / `updateDocuments` / `deleteDocuments` or the parent's embedded equivalents). It is not the historical `/api/*` bridge and does **not** use the Socket.IO `modifyDocument` packet. The relay is authenticated through its configured `clientId` and API key and must match the expected paired world/origin.

Relay writes invalidate the snapshot before dispatch and again when settling. The REST client cannot assume it receives native document broadcasts for changes made elsewhere. An ambiguous remote reply or transport loss after sending a mutation is `outcome_unknown`, and no fallback/replay is permitted.

`composite` uses the Socket.IO core for ordinary documents and the relay specifically for packaged system/module bindings. The runtime user may be different from the core user; validate that identity and the necessary permissions for both. Integration manifests (`systems/` and `modules/`) declare whether bindings are read-only. A target write flag and provider/runtime permission are mandatory for mutating operations.

There is no free-form JavaScript MCP tool. The Python worker is an optional per-target adapter runtime that invokes only packaged operations; credentials stay in Node. Validate arguments/results and run runtime probes before claiming a module or system operation is available.

## Verify the native protocol against Foundry itself

The historic native protocol implementation was checked against unminified **Foundry v13.348** application source (`client/data/client-backend.mjs`, `client/helpers/socket-interface.mjs` and common socket types). The repository's later test container is pinned to **v14.367**, and the wire contract has not been confirmed against that version by the historical check.

Do **not** claim current v14 write compatibility based on the v13 verification. Obtain a licensed, disposable v14 build for verification rather than upgrading or mutating an unrelated persistent Foundry installation; inspect the actual runtime source and test one reversible round-trip in an isolated world.

## Other operations and safety boundaries

- Compendium queries are separate from `modifyDocument`; `search_compendium` is gated by `compendium.read` rather than the native world cache.
- REST diagnostics (`get_recent_logs`, `search_logs`, `get_system_health`) require `diagnostics.read`; a generic relay does not automatically implement the historical bridge's diagnostics API.
- Game document operations are authorized both by this MCP server and **by Foundry**. Read the document ID/target before destructive actions and check the outcome afterward.
- Do not add a transport fallback after a write, an automatic cross-world transaction, a global selected world or an unclassified new write operation.

The [capability matrix](../../docs/guides/capabilities.md) and [testing rules](testing.md) describe current catalog gates and verification tiers.
