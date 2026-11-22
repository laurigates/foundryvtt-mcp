# D&D 5e integration

| Field | Value |
|---|---|
| Foundry system ID | `dnd5e` |
| Adapter version | `0.1.0` |
| Adapter updated | 2026-11-19 |
| Status | Experimental |
| Upstream repository / source version / kind | Not yet recorded |
| Upstream source commit / date | Not yet recorded |
| Source inspection / latest reference check | Not yet recorded |
| Project Foundry scope | **13 or later**, including 13; exact compatible combinations not established |
| Runtime checks | System identity and Actor API probes; no shared minimum-generation guard |
| Last live verification | Not performed |
| Tested live combinations | None |
| Worker protocol | 1 |

No upstream source baseline is recorded for this adapter yet. This does not mean
the official system has no releases or tags. Establish the baseline by inspecting
the latest release, otherwise the latest tag, otherwise the default-branch commit,
following the [upstream source reference policy](../../docs/guides/writing-integrations.md#upstream-source-references).
Keep that source version and resolved commit separate from adapter version `0.1.0`
and from live verification. See the [system bridge catalog](../../docs/bridges/systems.md)
for the integration list and version status.

## Operation

`system_dnd5e_get_actor_data` accepts `actor_uuid` and returns the Actor's ID,
UUID, name, type and unmodified `system` object. The MCP host also accepts
`target_id` and routes the request to that session before invoking the adapter.

The operation resolves the UUID in the active Foundry runtime, confirms the
`dnd5e` system and an Actor document, then returns a plain JSON projection. A
missing Actor is an error, not an empty successful response.

## Requirements and limits

- Foundry **13 or later** is the support and maintenance scope. Earlier versions
  remain outside it even if a probe succeeds; later versions still need validation.
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
to establish live compatibility. Record the inspected source in
`upstream.repository`, `upstream.reference` and `upstream.updatedAt` when establishing
or updating the adapter's baseline. Populate `compatibility.tested` and
`upstream.verifiedAt` only after an actual live verification.
