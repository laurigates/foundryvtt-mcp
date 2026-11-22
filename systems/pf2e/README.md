# Pathfinder 2e integration

| Field | Value |
|---|---|
| Foundry system ID | `pf2e` |
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

`system_pf2e_get_actor_data` accepts `actor_uuid` and returns the Actor's ID,
UUID, name, type and unmodified `system` object. `target_id` is handled by the MCP
host, so the same tool can serve several independently configured worlds.

The binding resolves the UUID in that runtime, verifies the `pf2e` system and an
Actor document, and returns plain JSON. Missing documents and system mismatches
are explicit errors.

## Requirements and limits

- Foundry **13 or later** is the support and maintenance scope. Earlier versions
  remain outside it even if a probe succeeds; later versions still need validation.
- A provider with `runtime.execute` and an active Foundry client runtime.
- The selected target must use `pf2e` and pass its runtime probe.
- No additional Python packages are required.
- This initial adapter does not implement or guess PF2e skill-roll, degree of
  success, attack, condition or resource-spending APIs.
- No PF2e-specific HP/AC projection is invented; raw system data remains intact.
- Version restrictions are currently empty and the adapter is experimental.
  Runtime readiness is not proof of compatibility with every upstream release.

## Validation

Local tests cover adapter dispatch, separate per-target state, plain-data
results and rejection of unsupported operations. Record the inspected source in
`upstream.repository`, `upstream.reference` and `upstream.updatedAt` when establishing
or updating the adapter's baseline. Record actual Foundry/PF2e version pairs in
`compatibility.tested` and update `upstream.verifiedAt` only after live verification.
