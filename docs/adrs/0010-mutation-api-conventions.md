# ADR-010: Mutation API Conventions

**Status**: Proposed
**Date**: 2026-05-12
**Confidence**: TBD (awaiting user review before Wave 4 implementation)

**Related issues**: [#142](https://github.com/laurigates/foundryvtt-mcp/issues/142) (actor item CRUD), [#143](https://github.com/laurigates/foundryvtt-mcp/issues/143) (actor attribute update), [#144](https://github.com/laurigates/foundryvtt-mcp/issues/144) (compendium search, read-only)

## Context

The MCP server is read-only today. Every existing tool reads from the in-memory `worldData` snapshot (see [ADR-004](../blueprint/adrs/ADR-004-in-memory-world-state-cache.md)) cached over the Socket.IO connection ([ADR-001](../blueprint/adrs/ADR-001-socketio-for-foundry-communication.md)). Issues #142 and #143 propose adding the first mutation surface — actor item CRUD plus actor attribute updates — to unblock AI-assisted workflows (D&D 5e 2014→2024 migration, end-of-session bookkeeping, party-wide updates). #144 is read-only but its result shape feeds #142's `create_actor_item({ source: { type: "compendium", … } })`, so the conventions established here apply to its handler contract too.

The decisions below set the four conventions that every Wave 4 mutation tool will inherit. They are deliberately scoped to *conventions* (tool shape, patch semantics, validation strategy, audit/permission posture) rather than implementation detail (which Foundry RPC event to emit, exact wire format), since those should be settled inside the PRP for the first concrete tool that lands.

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
| `update_actor_item` | `Record<string, unknown>` — **JSON merge-patch applied to `item.system`** | `{ "activities": { "<uuid>": { "type": "damage", … } } }` |
| `create_actor_item` | Discriminated union — `{ type: "compendium", compendiumId, itemId }` or `{ type: "inline", item: { type, name, system } }` | n/a |
| `delete_actor_item` | No patch — just `actorId` + `itemId` | n/a |

**Rationale**:

- **Attributes are leaf-valued and orthogonal**: bumping HP doesn't logically touch currency. Dot-paths let the caller hit several leaves in one call without spelling out shared parent objects. They also let the post-update response report each path's new value cleanly (acceptance criterion in #143).
- **Item updates are tree-shaped**: adding a `damage` activity with consumption rules means adding a nested subtree to `item.system.activities.<uuid>`. JSON merge-patch (RFC 7396 semantics — keys merge, `null` deletes, arrays replace) maps directly onto how Foundry's `Document#update` already behaves. Forcing dot-paths here would either drop the LLM into a corner (it can't emit a single dot-path for a whole new object) or force flattening that defeats the point.
- **Full-replace rejected** for both: too easy to wipe unrelated state by accident, and noisy for the LLM to produce.
- **Mixing styles in one tool rejected**: the parser/validation logic diverges enough that two tools is clearer than one with a mode flag.

**Foundry update model alignment**: Foundry's `Document#update(data, options)` natively accepts the JSON-merge-patch shape — `{ "system.attributes.hp.value": 15 }` is interpreted as a dot-path *into* the document, and `{ system: { attributes: { hp: { value: 15 } } } }` is interpreted as a merge-patch. So the dot-path form for `update_actor_attribute` is a thin wrapper: the handler prepends `system.` to each key and forwards the flat map. The merge-patch form for `update_actor_item` is forwarded as-is, scoped to the targeted item document.

### 3. Validation — Zod at the boundary, system-specific clamps in a single module, **warn-but-allow** by default

Three layers:

1. **Shape validation**: every mutation tool's input is parsed through a Zod schema before the handler runs. This is non-negotiable — it catches malformed payloads, wrong types, missing required fields. Mirrors the existing `WorldDataSchema.safeParse` pattern in `FoundryClient`.
2. **Semantic validation**: D&D 5e-specific clamps live in a single `src/foundry/validators/dnd5e.ts` module, one validator per concern:
   - `hp.value` clamped to `[0, hp.max + hp.temp]`
   - `attributes.exhaustion` clamped to `[0, 6]` (2014 rules) or `[0, 10]` (2024 rules) — read `system.source.rules` to choose
   - `spells.spell<N>.value` clamped to `spells.spell<N>.max`
   - `resources.<slot>.value` clamped to `resources.<slot>.max`
3. **Disposition: warn-but-allow**, not hard-reject. If a clamp is violated, the mutation still applies (clamped to the legal range) and the response includes a `warnings` array describing every clamp. Rationale: the user's source of truth is the live FoundryVTT world, and overly strict server-side rejection blocks legitimate edge cases (HP above max from a Heroes' Feast buff, exhaustion overrides during specific homebrew rules, etc.). The LLM gets explicit feedback when it nudges outside expected ranges; the GM stays in control.

**Out of scope for Wave 4**: spell-slot accounting across short/long rest, multi-class spell-slot fusion, currency conversion. The validators are intentionally narrow — clamps only, no business rules.

**Module location**: `src/foundry/validators/dnd5e.ts` (new). Wave 4 only ships the dnd5e validators; the directory structure leaves room for `pf2e.ts`, `swade.ts`, etc. without refactoring.

### 4. Audit log & permission model — "Assistant GM" role, every mutation emits a chat message

**Permission posture**:

- The MCP server authenticates as a single FoundryVTT user (existing `FOUNDRY_USERNAME` / `FOUNDRY_PASSWORD`). For mutation work, that user **must** have the **Assistant GM** role (Foundry role level 3) or higher. The MCP server does not impersonate other users.
- The "Assistant GM" role is the right minimum: it allows document updates and creates, but the actual GM (role 4) retains the ability to revoke, world-undo, and override.
- **Permission enforcement lives at the Foundry layer**, not in the MCP server. If the configured user lacks permission to update a specific actor (e.g., an actor with restricted ownership), the Foundry server rejects the mutation and the handler surfaces the error verbatim. The MCP server does **not** maintain its own ACL — that would duplicate Foundry's permission system and rot.

**Out-of-band guardrails (NOT enforced by this layer)**:

- "The AI shouldn't be able to delete the BBEG" — the right answer is **not** a hardcoded blocklist in this server. The right answer is the GM setting up Foundry-side ownership/permission on important actors, or running the MCP server with a less-privileged account during sessions where the AI shouldn't have free rein. The server's job is to be honest about what its credentials can do.

**Audit attribution**:

- Every mutation emits a **Foundry chat message** attributed to the MCP user, with format:
  ```
  [MCP] update_actor_attribute on <ActorName>:
    attributes.hp.value: 50 -> 59
    currency.gp: 100 -> 137
  ```
- Chat message visibility: **GM-only** (so it shows in the chat log for the GM but doesn't spam the player chat).
- Rationale: chat is the existing Foundry audit surface — every GM watches it. Journal entries are heavier and easy to miss. A dedicated audit log file is invisible to the GM.
- The chat message is **best-effort** — if the post fails, the mutation has already succeeded and the handler logs a warning. Mutation success is not gated on audit success.

## Consequences

**Positive**:

- Tool surface mirrors existing read patterns; low cognitive load for users and for LLM tool selection.
- Patch semantics align with Foundry's native update model — minimal translation, minimal surprise.
- Validators are scoped and pluggable; new game systems can be added without touching core mutation handlers.
- Audit messages give the GM real-time visibility without inventing a new artifact type.
- Permission model stays simple: the Foundry server is the single source of truth.

**Negative**:

- Four new tools (vs one CRUD tool) — slightly more surface area to maintain.
- Two distinct patch styles (dot-path vs merge-patch) — the LLM must pick the right one. Mitigation: tool descriptions and examples make the difference obvious.
- "Warn-but-allow" disposition means a buggy LLM call can push HP to a weird state; the warning is the safety net, not a hard guard. The GM's chat log surfaces this.
- Audit messages add chat noise; mitigated by GM-only visibility. If volume becomes a problem, the next iteration could batch or route to a dedicated chat tab.

## Alternatives Considered

### Tool granularity

- **Unified `mutate_resource({ resource, action, payload })`** — rejected. The discriminated payload either loses schema-level validation or becomes a giant `oneOf` that's harder for the LLM to navigate than four distinct tools.
- **Per-attribute tools (`apply_damage`, `consume_spell_slot`, `spend_resource`)** as suggested in #143's "Notes" — rejected for Wave 4. Higher discoverability, but a much larger tool count and harder to keep complete. A general `update_actor_attribute` covers the common ground; we can layer convenience tools later if a clear win emerges.

### Patch semantics

- **Pure JSON merge-patch for both attribute and item updates** — rejected. Forces callers to spell out nested parent objects for simple HP bumps. Less ergonomic than dot-paths for the leaf-heavy attribute case.
- **Pure dot-paths for both** — rejected. Doesn't compose for `update_actor_item` where adding a new activity means inserting a whole sub-document.
- **Full document replace** — rejected. Easy to wipe unrelated state, high token cost.

### Validation

- **Hard-reject on clamp violation** — rejected. Too many legitimate edge cases (buffs, homebrew). The LLM's job is harder if a routine HP bump fails because a buff already pushed HP over `hp.max`.
- **No validation, trust the caller** — rejected. The LLM will, eventually, send `attributes.exhaustion: 47`. We should at least surface that.
- **Validation in Foundry, not in the MCP server** — partially adopted: hard correctness (existence of fields, permission to write) is Foundry's job. Soft sanity (clamps, ranges) is the MCP server's job because it gives the LLM immediate feedback before the mutation hits the wire.

### Audit

- **Journal entry per mutation** — rejected. Heavy artifact, easy to miss, clutters the journal sidebar.
- **Server-side audit log file** — rejected. Invisible to the GM during a session.
- **No audit, rely on Foundry's own undo** — rejected. Foundry's undo is short-window and doesn't tell you *what* changed without diffing.

## Open Questions (for user review)

1. **Should `update_actor_attribute` accept a dotted-path map that targets fields outside `system.*`** (e.g., `name`, `img`, `prototypeToken.*`)? Current proposal scopes it to `actor.system.*`. Expanding the scope is easy but blurs the line with a general `update_actor` tool.
2. **Chat audit format** — text-only as proposed, or include a structured payload (JSON blob in chat message flags) so a future tool can mine the audit history? Structured is more powerful but the format becomes a contract.
3. **Compendium write protection** — #144 is read-only, but #142's `create_actor_item({ source: { type: "inline", … } })` lets the caller side-step compendia entirely. Worth a guard that nudges the LLM toward "search a compendium first" before falling back to inline construction? Or accept inline as a valid escape hatch?
4. **Multi-document atomicity** — if a session writes "delete legacy Divine Smite feat" + "add 2024 Divine Smite spell" as two tool calls and the second fails, the actor is left in a partial state. Worth a tool-level transaction wrapper (`migrate_actor_item({ remove, add })`) for Wave 4, or punt to Wave 5? Current proposal: punt.
