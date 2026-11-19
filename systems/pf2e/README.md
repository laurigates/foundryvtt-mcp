# Pathfinder 2e integration

| Field | Value |
|---|---|
| Foundry system ID | `pf2e` |
| Adapter version | `0.1.0` |
| Adapter updated | 2026-11-19 |
| Status | Experimental |
| Upstream version / commit | Not pinned; no live compatibility claim |
| Upstream last update | Not verified |
| Last live verification | Not performed |
| Tested live combinations | None |
| Worker protocol | 1 |

## Operation

`system_pf2e_get_actor_data` accepts `actor_uuid` and returns the Actor's ID,
UUID, name, type and unmodified `system` object. `target_id` is handled by the MCP
host, so the same tool can serve several independently configured worlds.

The binding resolves the UUID in that runtime, verifies the `pf2e` system and an
Actor document, and returns plain JSON. Missing documents and system mismatches
are explicit errors.

## Requirements and limits

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
results and rejection of unsupported operations. Record an actual Foundry and
PF2e version pair in `compatibility.tested` only after live verification.
