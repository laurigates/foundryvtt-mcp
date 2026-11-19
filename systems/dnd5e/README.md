# D&D 5e integration

| Field | Value |
|---|---|
| Foundry system ID | `dnd5e` |
| Adapter version | `0.1.0` |
| Adapter updated | 2026-11-19 |
| Status | Experimental |
| Upstream version / commit | Not pinned; no live compatibility claim |
| Upstream last update | Not verified |
| Last live verification | Not performed |
| Tested live combinations | None |
| Worker protocol | 1 |

## Operation

`system_dnd5e_get_actor_data` accepts `actor_uuid` and returns the Actor's ID,
UUID, name, type and unmodified `system` object. The MCP host also accepts
`target_id` and routes the request to that session before invoking the adapter.

The operation resolves the UUID in the active Foundry runtime, confirms the
`dnd5e` system and an Actor document, then returns a plain JSON projection. A
missing Actor is an error, not an empty successful response.

## Requirements and limits

- A provider with `runtime.execute` and an active Foundry client runtime.
- The selected target must use `dnd5e`; the runtime probe is repeated on calls.
- No local Python dependencies beyond the standard library.
- No skill rolls, attacks, rests or rule calculations are implemented here.
- Empty version restrictions permit experimental API probing. They are not a
  statement that every Foundry or dnd5e version is supported.

`actor-projection.json` contains the existing HP, AC, level and ability display
paths moved out of generic provider code. It is a data projection rather than a
reimplementation of D&D rules. Its behavior is tested locally; live versions
still need to be recorded in `manifest.json` after a real validation run.

## Validation

Local adapter tests verify operation dispatch and the target-bound invocation
contract. Runtime-binding tests use fixtures. A real Foundry instance is required
to establish upstream compatibility; populate `upstream` and
`compatibility.tested` when that verification is performed.
