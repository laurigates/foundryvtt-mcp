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
| `socketio` | Direct authenticated Foundry world; cache with native document broadcasts; opt-in core writes through `modifyDocument`; optional historical REST read augmentation | No generic runtime binding executor |
| `legacy-rest` | Historical `/api/*` bridge; different capabilities, no native Socket.IO write path | No paired relay execution |
| `rest-api` | Paired runtime/relay snapshot and opt-in document writes using Foundry's runtime document APIs | Named package-owned operations by default, fixed bindings over `execute-js` as an opt-in |
| `composite` | Socket.IO for core operations and write protocol | Paired relay for packaged integration bindings on the same identity-verified world |

In legacy environment configuration, `FOUNDRY_API_KEY` with `FOUNDRY_REST_URL` and native credentials augments the Socket.IO target with the historical bridge. A key without that complete combination retains **`legacy-rest`**. An explicit native target uses `restUrl` and `restApiKey` (or `restApiKeyEnv`) for the same augmentation. The ThreeHats relay uses separate `FOUNDRY_REST_RELAY_URL`, `FOUNDRY_REST_API_KEY` and `FOUNDRY_REST_CLIENT_ID` settings. Explicit target lists do not inherit global credentials or the global write flag. Verify remote world/origin and permissions before enabling writes.

Historical bridge reads may fall back to their native/local answer. Transport failures pause the optional bridge and server failures pause a capability for 30 seconds. This read policy does not apply to mutations: writes stay on their selected native/relay path and an unknown outcome must never trigger fallback or replay. A native target remains usable when its optional historical bridge fails; a composite still requires its paired relay.

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

The response includes `type`, `action`, `operation`, `userId` and `result`, and may include `error`. Foundry v14 adds `timestamp` and `sideEffect`. When the operation causes further server-side changes, v14 can return `{ results: [...] }` with side-effect responses and the primary response. Check every entry for an error; the wrapper need not have a top-level error. The provider returns the primary entry's result. Creating an active Combat while another is active is one source of this response shape.

Actor `system` changes use dot-notated `system.*` keys. Do not invent packet shapes or bypass the provider's write guard. The exact wire contract may change by Foundry version.

### Cache and acknowledgements

- `src/foundry/world-cache.ts` applies native `modifyDocument` broadcasts and the ordered entries of v14 `modifyDocumentBatch` events (`{ results: [...] }`). Do **not** mutate the cache manually in an individual document method; keep common acknowledgement and broadcast handling centralized.
- Add new supported document types to `TOP_LEVEL_COLLECTIONS` or `EMBEDDED_COLLECTIONS`. Unmapped and invalid payloads must not corrupt unrelated cached collections.
- Synthetic unlinked-token actors (`Scene.<sid>.Token.<tid>.Actor.<aid>`) cannot be fully updated by the generic world cache and may require `refresh_world_data`.
- A timeout, lost acknowledgement or connection change after dispatch can leave a mutation's outcome **unknown**. Report `outcome_unknown`; never automatically resend the write.
- Every target has its own cache, serialized operation queue, generation and pending-work set. A reconnect may invalidate an old response; it must not cancel another target's work.

## Relay document writes and runtime bindings

`src/providers/rest-api.ts` implements document mutation by executing **fixed, code-owned** Foundry runtime document methods (for example `createDocuments` / `updateDocuments` / `deleteDocuments` or the parent's embedded equivalents). It is not the historical `/api/*` bridge and does **not** use the Socket.IO `modifyDocument` packet. The relay is authenticated through its configured `clientId` and API key and must match the expected paired world/origin.

Relay writes invalidate the snapshot before dispatch and again when settling. The REST client cannot assume it receives native document broadcasts for changes made elsewhere. An ambiguous remote reply or transport loss after sending a mutation is `outcome_unknown`, and no fallback/replay is permitted.

`composite` uses the Socket.IO core for ordinary documents and the relay specifically for packaged system/module bindings. The runtime user may be different from the core user; validate that identity and the necessary permissions for both. Integration manifests (`systems/` and `modules/`) declare whether bindings are read-only. A target write flag and provider/runtime permission are mandatory for mutating operations.

There is no free-form JavaScript MCP tool. The host evaluates only the fixed binding declared by a packaged operation; credentials stay in Node. Validate arguments/results and run runtime probes before claiming a module or system operation is available.

## Verify the native protocol against Foundry itself

The upstream [wire-shape record](../../docs/adrs/0014-foundry-v13-v14-wire-shapes.md) compares Foundry **v13.348** and **v14.369** application source. It records the v14 side-effect acknowledgement and batch-broadcast shapes; it does not establish a live round-trip result for this target-scoped branch. The regression coverage is in `src/foundry/__tests__/modify-document-v14.test.ts` and the provider/cache suites.

Relevant application files are `client/data/client-backend.mjs`, `common/abstract/socket.mjs`, `common/abstract/_types.mjs` and `dist/database/backend/server-backend.mjs`; v13 and v14 archives have different root layouts. Inspect a licensed build matching the target version without copying proprietary runtime source into this repository. A new write feature also needs a reversible round-trip in a disposable world before live compatibility is claimed.

## Other operations and safety boundaries

- Compendium queries are separate from `modifyDocument`; `search_compendium` is gated by `compendium.read` rather than the native world cache.
- REST diagnostics (`get_recent_logs`, `search_logs`, `get_system_health`) require `diagnostics.read`; a generic relay does not automatically implement the historical bridge's diagnostics API.
- Game document operations are authorized both by this MCP server and **by Foundry**. Read the document ID/target before destructive actions and check the outcome afterward.
- Do not add a transport fallback after a write, an automatic cross-world transaction, a global selected world or an unclassified new write operation.

The [capability matrix](../../docs/guides/capabilities.md) and [testing rules](testing.md) describe current catalog gates and verification tiers.
