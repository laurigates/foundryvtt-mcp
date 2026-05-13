# ADR-010: Mutation API Conventions

**Status**: Proposed (revised 2026-05-13 after multi-model review)
**Date**: 2026-05-12 (v1); revised 2026-05-13 (v2)
**Confidence**: TBD (awaiting user review before Wave 4 implementation)

**Related issues**: [#142](https://github.com/laurigates/foundryvtt-mcp/issues/142) (actor item CRUD), [#143](https://github.com/laurigates/foundryvtt-mcp/issues/143) (actor attribute update), [#144](https://github.com/laurigates/foundryvtt-mcp/issues/144) (compendium search, read-only)

## Context

The MCP server is read-only today. Every existing tool reads from the in-memory `worldData` snapshot (see [ADR-004](../blueprint/adrs/ADR-004-in-memory-world-state-cache.md)) cached over the Socket.IO connection ([ADR-001](../blueprint/adrs/ADR-001-socketio-for-foundry-communication.md)). Issues #142 and #143 propose adding the first mutation surface — actor item CRUD plus actor attribute updates — to unblock AI-assisted workflows (D&D 5e 2014→2024 migration, end-of-session bookkeeping, party-wide updates). #144 is read-only but its result shape feeds #142's `create_actor_item({ source: { type: "compendium", … } })`, so the conventions established here apply to its handler contract too.

The decisions below set the conventions that every Wave 4 mutation tool will inherit. They are deliberately scoped to *conventions* (tool shape, patch semantics, validation strategy, audit/permission posture, response contract, idempotency, concurrency) rather than implementation detail (which Foundry RPC event to emit, exact wire format), since those should be settled inside the PRP for the first concrete tool that lands.

### Constraints already in place

- **Transport**: Socket.IO is the canonical path. The REST API module (`apiKey` mode) is a secondary surface used today only for diagnostics and a few `/api/actors`-style queries.
- **No mutation methods on `FoundryClient`** today. Methods `searchActors`, `getActor`, `searchItems`, `getCombatState` are reads from the cached `WorldData`.
- **Existing tool naming**: verb-first, snake_case, per-resource — `search_actors`, `get_actor_details`, `roll_dice`, `get_world_summary`.
- **Game system targeted**: D&D 5e (`dnd5e` system in `WorldData`). Other systems are out of scope for Wave 4 but the conventions must not bake in 5e specifics where it's avoidable.

## Decision

### 1. Tool granularity — per-resource verb-named tools

Add three actor-item tools (`create_actor_item`, `update_actor_item`, `delete_actor_item`) and one attribute tool (`update_actor_attribute`), matching the surface proposed in the issues. **Do not** introduce a unified `mutate_resource` CRUD tool with a discriminated-union payload.

**Rationale**:

- Mirrors the existing read-side convention (`search_actors`, `get_actor_details`) so the LLM's tool-selection prior stays consistent.
- Per-tool JSON schemas can describe the legal shape of `patch` precisely (e.g., `update_actor_attribute` accepts dot-paths into `actor.system`; `create_actor_item` accepts a discriminated `source: compendium | inline`). A unified tool would need either a permissive `Record<string, unknown>` payload (no validation help at the schema layer) or a giant discriminated union that's harder for the LLM to use correctly.
- Per-tool descriptions document scope: "this tool updates HP, currency, slots" vs "this tool deletes an actor's item". Clear scope reduces accidental mutations.

**Cost we accept**: more tools in the registry. Today there are ~20; Wave 4 adds 4. Still well under context-budget concerns.

### 2. Patch semantics — dot-paths for attributes, narrow per-tool shapes for items

Two distinct patch styles, picked per tool to match the natural shape of the change:

| Tool | Patch shape | Example |
|---|---|---|
| `update_actor_attribute` | `Record<string, number \| string \| boolean>` — **dot-paths into `actor.system`** | `{ "attributes.hp.value": 59, "currency.gp": 137 }` |
| `update_actor_item` | Top-level keys restricted to `{ name, img, system, flags }`; `system` accepts a JSON merge-patch tree applied to `item.system` | `{ "system": { "activities": { "<uuid>": { "type": "damage", … } } } }` |
| `create_actor_item` | Discriminated union — `{ type: "compendium", compendiumId, itemId }` or `{ type: "inline", item: { type, name, system }, inlineJustification?: string }` | n/a |
| `delete_actor_item` | No patch — just `actorId` + `itemId` | n/a |

**Rationale**:

- **Attributes are leaf-valued and orthogonal**: bumping HP doesn't logically touch currency. Dot-paths let the caller hit several leaves in one call without spelling out shared parent objects. They also let the post-update response report each path's new value cleanly (acceptance criterion in #143).
- **Item updates are tree-shaped**: adding a `damage` activity with consumption rules means adding a nested subtree to `item.system.activities.<uuid>`. JSON merge-patch (RFC 7396 semantics — keys merge, `null` deletes, arrays replace) maps directly onto how Foundry's `Document#update` already behaves. Forcing dot-paths here would either drop the LLM into a corner (it can't emit a single dot-path for a whole new object) or force flattening that defeats the point.
- **`update_actor_item` envelope is restricted**: top-level keys are a closed allowlist of `{ name, img, system, flags }` (vs the earlier permissive `Record<string, unknown>`). The Zod schema enforces this. The `system` key still accepts an arbitrary tree — the restriction reduces stray top-level writes (`type`, `_id`, etc.) without heavy schema work over `item.system`.
- **Full-replace rejected** for both: too easy to wipe unrelated state by accident, and noisy for the LLM to produce.
- **Mixing styles in one tool rejected**: the parser/validation logic diverges enough that two tools is clearer than one with a mode flag.
- **Absolute values only.** Patches encode *target state*, never relative arithmetic (`+9`, `-2`, `*1.5`). See "Idempotency & retries" below.

**Foundry update model alignment**: Foundry's `Document#update(data, options)` natively accepts the JSON-merge-patch shape — `{ "system.attributes.hp.value": 15 }` is interpreted as a dot-path *into* the document, and `{ system: { attributes: { hp: { value: 15 } } } }` is interpreted as a merge-patch. So the dot-path form for `update_actor_attribute` is a thin wrapper: the handler prepends `system.` to each key and forwards the flat map. The merge-patch form for `update_actor_item` is forwarded as-is, scoped to the targeted item document.

### 3. Validation — Zod at the boundary, system-specific clamps in a single module, **split disposition** (warn-but-allow for ranges, hard-fail for shape/path)

Three layers:

1. **Shape validation**: every mutation tool's input is parsed through a Zod schema before the handler runs. This is non-negotiable — it catches malformed payloads, wrong types, missing required fields. Mirrors the existing `WorldDataSchema.safeParse` pattern in `FoundryClient`.
2. **Semantic validation**: D&D 5e-specific clamps live in a single `src/foundry/validators/dnd5e.ts` module, one validator per concern:
   - `hp.value` clamped to `[0, hp.max + hp.temp]`
   - `attributes.exhaustion` clamped to `[0, 6]` (2014 rules) or `[0, 10]` (2024 rules) — read `system.source.rules` to choose
   - `spells.spell<N>.value` clamped to `spells.spell<N>.max`
   - `resources.<slot>.value` clamped to `resources.<slot>.max`
3. **Disposition is split by failure class**:

   **Warn-but-allow** for *value-range* semantics:
   - HP above `hp.max + hp.temp`
   - Exhaustion above the rules-defined cap
   - Spell-slot above max
   - Resource above max
   - Negative currency

   The mutation applies clamped to the legal range, the response sets `applied: true`, and `warnings[]` describes every clamp. Rationale: the user's source of truth is the live FoundryVTT world, and overly strict server-side rejection blocks legitimate edge cases (HP above max from a Heroes' Feast buff, exhaustion overrides during specific homebrew rules, etc.).

   **Hard-fail** for *shape and path safety*:
   - Unknown dot-paths in `update_actor_attribute` (e.g., `attributes.hp.valuue`) — must NOT silently no-op. Without this, the LLM thinks the change landed when Foundry quietly dropped it.
   - Non-scalar values for attribute leaves (object/array passed where number/string/boolean expected).
   - Prototype-pollution keys anywhere in any patch: `__proto__`, `constructor`, `prototype`.
   - Path-traversal patterns in keys: `../`, `..\\`, `\\`.

   On hard-fail the mutation does not run, the response sets `applied: false`, and `errors[]` describes the rejection.

**Out of scope for Wave 4**: spell-slot accounting across short/long rest, multi-class spell-slot fusion, currency conversion. The validators are intentionally narrow — clamps only, no business rules.

**Module location**: `src/foundry/validators/dnd5e.ts` (new). Wave 4 only ships the dnd5e validators; the directory structure leaves room for `pf2e.ts`, `swade.ts`, etc. without refactoring.

### 4. Audit log & permission model — "Assistant GM" role, every mutation emits a chat message **plus structured flags**

**Permission posture**:

- The MCP server authenticates as a single FoundryVTT user (existing `FOUNDRY_USERNAME` / `FOUNDRY_PASSWORD`). For mutation work, that user **must** have the **Assistant GM** role (Foundry role level 3) or higher. The MCP server does not impersonate other users.
- The "Assistant GM" role is the right minimum: it allows document updates and creates, but the actual GM (role 4) retains the ability to revoke, world-undo, and override.
- **Permission enforcement lives at the Foundry layer**, not in the MCP server. If the configured user lacks permission to update a specific actor (e.g., an actor with restricted ownership), the Foundry server rejects the mutation and the handler surfaces the error verbatim. The MCP server does **not** maintain its own ACL — that would duplicate Foundry's permission system and rot.

**Out-of-band guardrails (NOT enforced by this layer)**:

- "The AI shouldn't be able to delete the BBEG" — the right answer is **not** a hardcoded blocklist in this server. The right answer is the GM setting up Foundry-side ownership/permission on important actors, or running the MCP server with a less-privileged account during sessions where the AI shouldn't have free rein. The server's job is to be honest about what its credentials can do.

**Audit attribution**:

- Every mutation emits a **Foundry chat message** attributed to the MCP user with **both** human-readable text in the body **and** a structured payload in `flags["foundryvtt-mcp"]`. Format:

  Body (human-readable, GM-only visibility):
  ```
  [MCP] update_actor_attribute on <ActorName>:
    attributes.hp.value: 50 -> 59
    currency.gp: 100 -> 137
  ```

  Flags (structured, machine-readable):
  ```ts
  flags["foundryvtt-mcp"] = {
    version: 1,
    tool: "update_actor_attribute",
    actorId,
    mutations: [{ path, before, after }],
    warnings: [],
    requestId,
    timestamp,
  }
  ```

- Chat message visibility: **GM-only** (so it shows in the chat log for the GM but doesn't spam the player chat).
- Rationale: chat is the existing Foundry audit surface — every GM watches it. Structured flags cost ~zero now and unlock undo/diff later (see "Undo foundation" below). The schema is **versioned** (`version: 1`) to manage contract risk as the payload grows.
- The chat message is **best-effort** — if the post fails, the mutation has already succeeded. Mutation success is **not** gated on audit success, but the audit failure is surfaced in the tool response under `warnings: [{ type: "audit_failed", message: ... }]` so the LLM/GM doesn't assume the audit landed when it didn't.

### 5. Path allowlist for `update_actor_attribute`

Wave 4 ships with a **curated allowlist of dot-paths** under `system.*`, not freeform `system.*`. Unknown paths hard-fail (see Decision 3). The allowlist lives in `src/foundry/validators/dnd5e.ts` next to the clamps so adding a path is a small, system-scoped Zod-schema change.

Initial Wave 4 allowlist (dnd5e):

- `attributes.hp.value`, `attributes.hp.temp`, `attributes.hp.tempmax`
- `attributes.exhaustion`
- `attributes.death.success`, `attributes.death.failure`
- `attributes.inspiration`
- `currency.{cp,sp,ep,gp,pp}`
- `spells.spell{1..9}.value`, `spells.pact.value`
- `resources.{primary,secondary,tertiary}.value`

Out-of-allowlist paths can be unblocked per system without changing the convention. Other game systems (`pf2e`, `swade`) bring their own allowlist in their own validator module.

### 6. Response & error contract

Every mutation tool returns a uniform shape. This is a contract the LLM can rely on for self-correction loops.

```ts
{
  applied: boolean,           // true even if some clamp fired (warn-but-allow)
  changes: Array<{
    path: string,
    before: unknown,
    after: unknown,
  }>,
  warnings: Array<{
    type: "clamp" | "audit_failed" | "inline_item_used" | string,
    message: string,
    path?: string,
  }>,
  errors: Array<{
    type: "unknown_path" | "shape_violation" | "permission_denied" | "not_found" | "rate_limited" | string,
    message: string,
    rejectedKeys?: string[],
  }>,
  requestId?: string,
}
```

Invariants:

- `applied: false` ⇔ `errors[]` non-empty.
- `warnings[]` is non-fatal. The mutation applied; the LLM should treat it as informational unless it implies the wrong thing happened (e.g., a clamp turned 100 HP into 50 HP).
- `requestId` is echoed from the request when provided (see "Idempotency & retries").

### 7. Idempotency & retries

- Mutations accept an **optional `requestId: string`** input. The server echoes it back in the response and in `flags["foundryvtt-mcp"].requestId`. Wave 4 does **not** dedupe server-side, but capturing the ID enables future dedupe and post-hoc debugging.
- **Absolute values only.** Relative arithmetic (`+9`, `-2`, `*1.5`) is explicitly forbidden anywhere in any patch shape. Absolute updates are naturally idempotent under socket retries; relative updates would double-apply damage on retry.
- Tool descriptions call out the absolute-only rule loudly so the LLM doesn't even attempt relative encoding.

### 8. Concurrency stance — last-write-wins, per-actor serialization, soft rate limit

- Foundry resolves concurrent writes via **last-write-wins**. The MCP server inherits this — no optimistic locking in Wave 4.
- An `ifMatch` precondition (e.g., `ifMatch: { "attributes.hp.value": 50 }`) is a candidate for a later iteration if real-world conflict cases surface, but explicitly out of scope now.
- The in-memory `worldData` snapshot (ADR-004) may be stale relative to live Foundry state. Mutations target the **live document** via Foundry's `Document#update`, not the snapshot. The snapshot updates via the existing change-feed pipeline.
- **Per-actor concurrency = 1**: a tool handler that mutates actor `X` waits for any in-flight mutation on `X` to complete. Implemented as a small in-process queue keyed by `actorId`. Prevents intra-LLM-loop spam and Foundry socket thread thrashing. Not a distributed coordinator — single MCP-server process only.
- **Soft global cap**: a configurable maximum (default ~30 mutations / minute) across all actors. Exceeding the cap returns `applied: false, errors: [{ type: "rate_limited", message: ... }]` so the LLM can back off rather than retry-loop.

### 9. Inline item construction — accept, but guard

`create_actor_item` keeps both compendium and inline source paths. Inline is necessary for homebrew items, missing compendia, and on-the-fly creation. Mitigations on the inline path:

- The discriminated `source.type` is mandatory (already in v1).
- When `source.type === "inline"`, the response always carries a `warnings: [{ type: "inline_item_used", message: "Prefer compendium source when possible; inline creation may miss system-required fields" }]`. Forces the warning into the LLM's view of what happened.
- An optional `inlineJustification: string` field on the inline branch. Short free-text. Not enforced server-side but its presence in the schema forces the LLM to "think" before constructing inline and reduces casual misuse. The justification is echoed into the audit flags.
- The inline `item` shape is parsed through a strict Zod schema modeled after Foundry's expected `Item` shape (best-effort for dnd5e). Shape failures hard-fail per Decision 3.

Inline is **not** hard-blocked. The cost of false positives (legitimate homebrew refused) outweighs the cost of false negatives (an over-eager inline that the GM can revert).

## Resolved Questions

These four were "Open Questions" in v1; the multi-model review (gemini-3-pro-preview + gpt-5.2) converged on answers.

1. **Should `update_actor_attribute` reach outside `system.*`?** **No.** It stays scoped to `system.*` only. If actor metadata edits (`name`, `img`, `prototypeToken.*`) are needed later, propose a separate `update_actor_metadata` tool with a small explicit allowlist. Both reviewing models firm on this — keeps the tool's scope honest with its name.
2. **Audit format — text-only or structured?** **Both.** Human-readable text in the chat message body for GM visibility, plus a structured (and versioned) payload in `flags["foundryvtt-mcp"]`. Structured costs nothing now and unlocks undo/diff tooling later. See Decision 4 for the schema.
3. **Inline item construction — guard or accept?** **Accept, but guard.** Inline is necessary; mitigations live in Decision 9 (mandatory discriminator, mandatory `inline_item_used` warning, optional `inlineJustification`, strict Zod over the inline shape). No hard block.
4. **Multi-document atomicity?** **Punt to Wave 5.** Real DB transactions don't exist over Foundry's socket; simulating them is high-complexity and low-payoff. The LLM gets the failure on a partial multi-call sequence and can compensate. Per-tool descriptions document the playbook for migration flows: do the additive op first and the destructive op second so failures leave the actor in a recoverable state. A best-effort batch tool (`apply_actor_item_changeset`) was floated as a middle path; deferred (see Alternatives Considered).

## Consequences

**Positive**:

- Tool surface mirrors existing read patterns; low cognitive load for users and for LLM tool selection.
- Patch semantics align with Foundry's native update model — minimal translation, minimal surprise.
- Validators are scoped and pluggable; new game systems can be added without touching core mutation handlers.
- Hard-fail on unknown paths catches LLM typos that v1's blanket warn-but-allow would have hidden.
- Path allowlist gives the LLM a clear, documentable surface and bounds the blast radius per system.
- Uniform response/error contract makes self-correction loops mechanical for the LLM.
- Structured audit flags lay the foundation for a future `revert_last_mcp_mutation` tool without re-litigating the schema.
- Per-actor serialization + soft rate cap prevent retry-loop and concurrent-write thrash without distributed coordination.
- Audit messages give the GM real-time visibility without inventing a new artifact type.
- Permission model stays simple: the Foundry server is the single source of truth.

**Negative**:

- Four new tools (vs one CRUD tool) — slightly more surface area to maintain.
- Two distinct patch styles (dot-path vs merge-patch) — the LLM must pick the right one. Mitigation: tool descriptions and examples make the difference obvious.
- Split disposition (warn-but-allow vs hard-fail) is two rules to internalize. Mitigation: the split is along a clear axis (range vs shape/path), and tool descriptions spell it out.
- Allowlist-only paths require a code change to add a new attribute. Mitigation: the change is one line in `dnd5e.ts` plus a test.
- "Warn-but-allow" disposition for value ranges still means a buggy LLM call can push HP to a weird state; the warning is the safety net. The GM's chat log surfaces this.
- Audit messages add chat noise; mitigated by GM-only visibility. If volume becomes a problem, the next iteration could batch or route to a dedicated chat tab.
- Per-actor serialization can stall a workflow that wants to fan out updates across one actor. Mitigation: queue is per-actor only; cross-actor parallelism is unaffected, and the soft global cap is generous enough for normal session use.

## Undo foundation

Wave 4 does not ship an undo tool. The structured audit flags (Decision 4) deliberately capture enough state — `{ path, before, after }` per mutation, plus `tool`, `actorId`, `requestId`, `timestamp` — to make a future `revert_last_mcp_mutation({ requestId? | actorId? | sinceTimestamp? })` tool implementable as a pure read of chat-message flags + a single inverse mutation. This is part of the rationale for choosing structured-flags-now in (b) above; calling it out here so the option stays visible.

## Alternatives Considered

### Tool granularity

- **Unified `mutate_resource({ resource, action, payload })`** — rejected. The discriminated payload either loses schema-level validation or becomes a giant `oneOf` that's harder for the LLM to navigate than four distinct tools.
- **Per-attribute tools (`apply_damage`, `consume_spell_slot`, `spend_resource`)** as suggested in #143's "Notes" — rejected for Wave 4. Higher discoverability, but a much larger tool count and harder to keep complete. A general `update_actor_attribute` covers the common ground; we can layer convenience tools later if a clear win emerges.

### Patch semantics

- **Pure JSON merge-patch for both attribute and item updates** — rejected. Forces callers to spell out nested parent objects for simple HP bumps. Less ergonomic than dot-paths for the leaf-heavy attribute case.
- **Pure dot-paths for both** — rejected. Doesn't compose for `update_actor_item` where adding a new activity means inserting a whole sub-document.
- **Full document replace** — rejected. Easy to wipe unrelated state, high token cost.
- **Permissive `Record<string, unknown>` envelope on `update_actor_item`** — rejected. The closed top-level allowlist (`{ name, img, system, flags }`) costs nothing to enforce and prevents stray writes to top-level fields the LLM has no business touching (`type`, `_id`).
- **Relative arithmetic in patches (`+9`, `-2`)** — rejected. Not idempotent under retries; risks double-applying damage. Absolute values only.

### Validation

- **Hard-reject on every clamp violation** — rejected. Too many legitimate edge cases (buffs, homebrew). The LLM's job is harder if a routine HP bump fails because a buff already pushed HP over `hp.max`.
- **Blanket warn-but-allow (v1's position)** — rejected on review. Silently dropping unknown dot-paths means the LLM thinks the change landed when Foundry no-op'd it. Split disposition is the fix: warn-but-allow for ranges, hard-fail for shape/path/safety.
- **Freeform `system.*` paths** — rejected. The path allowlist (Decision 5) bounds blast radius and turns "did the LLM hit a real field?" into a server-side check.
- **No validation, trust the caller** — rejected. The LLM will, eventually, send `attributes.exhaustion: 47`. We should at least surface that.
- **Validation in Foundry, not in the MCP server** — partially adopted: hard correctness (existence of fields, permission to write) is Foundry's job. Soft sanity (clamps, ranges) and shape/path safety is the MCP server's job because it gives the LLM immediate feedback before the mutation hits the wire.

### Audit

- **Text-only chat message (v1's position)** — rejected on review. Structured flags are nearly free to add now and unlock undo/diff later. Versioned to manage contract risk.
- **Journal entry per mutation** — rejected. Heavy artifact, easy to miss, clutters the journal sidebar.
- **Server-side audit log file** — rejected. Invisible to the GM during a session.
- **No audit, rely on Foundry's own undo** — rejected. Foundry's undo is short-window and doesn't tell you *what* changed without diffing.

### Multi-document atomicity

- **Tool-level transaction wrapper (`migrate_actor_item({ remove, add })`)** — rejected for Wave 4. Real DB transactions don't exist over Foundry's socket; simulating them with rollback-on-failure semantics is high-complexity and the failure modes (partial rollback failing mid-rollback) compound.
- **Best-effort batch tool (`apply_actor_item_changeset({ operations })`)** — deferred. A middle path: serialize the operations and report per-op success/failure in one response. Adds Wave 4 scope and the LLM can already achieve the same outcome by sequencing two tool calls and reading the response. Reconsider if the per-call latency or audit-message volume becomes a real-world problem.
- **Punt entirely** — adopted. The LLM gets the error and compensates; per-tool descriptions document the additive-first-destructive-second playbook for migration flows.

### Concurrency

- **Optimistic locking (`ifMatch` precondition)** — deferred. Worth revisiting if conflict cases surface in real use; not justified for Wave 4 given last-write-wins is Foundry's own semantics.
- **No serialization** — rejected. Without per-actor queueing, an LLM retry-loop can stack writes faster than Foundry's socket settles them.

## Revision history

- **v1** (2026-05-12): initial proposal by ADR drafter.
- **v2** (2026-05-13): incorporates multi-model review feedback (gemini-3-pro-preview + gpt-5.2). Resolves the four open questions, splits the validation disposition (warn-but-allow for ranges vs hard-fail for shape/path), adds path allowlist (Decision 5), response/error contract (Decision 6), idempotency (Decision 7 — `requestId`, absolute values only), concurrency stance (Decision 8 — last-write-wins, per-actor serialization, soft rate cap), structured audit flags (Decision 4), `update_actor_item` envelope tightening, inline-item guard (Decision 9), audit-failure surfacing into the tool response, and explicit undo foundation note.
