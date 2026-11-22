# Pathfinder 2e Foundry 13: upstream source reference

| Field | Value |
|---|---|
| System ID / Foundry generation | `pf2e` / **13** |
| Adapter version / update | **0.1.1** / **2026-11-22** |
| Upstream repository | [foundryvtt/pf2e](https://github.com/foundryvtt/pf2e) |
| Upstream system release / version | **[7.12.2](https://github.com/foundryvtt/pf2e/releases/tag/pf2e-7.12.2)** |
| Reference kind / tag | Official release / `pf2e-7.12.2` |
| Resolved source commit | [`522dec9d289c7da8b69ac0167b11ccd639871fef`](https://github.com/foundryvtt/pf2e/commit/522dec9d289c7da8b69ac0167b11ccd639871fef) |
| Upstream published on | **2026-04-06** |
| Upstream-declared Foundry compatibility | Minimum **13.348**, verified **13.351**, maximum **13** |
| Source inspection date | **2026-11-22** |
| Latest compatible release checked for Foundry 13 | **7.12.2**, checked **2026-11-22** |
| Live verification | **None** |

## Why this release

The official repository publishes several products. Release selection filters
the actual `pf2e` system and checks its product-specific
[`system.pf2e.json`](https://github.com/foundryvtt/pf2e/blob/522dec9d289c7da8b69ac0167b11ccd639871fef/system.pf2e.json).
That immutable manifest declares system version **7.12.2** and Foundry generation
**13**, with the build requirements above. The stable `pf2e` release records and
the manifests for all newer stable versions **8.0.0 through 8.7.1** were checked:
those newer releases require Foundry generation **14**. The latest compatible
release found for this package is therefore **7.12.2**, not the repository's
latest release of any product or generation.

This is a release reference under the
[release → tag → commit policy](../../../docs/guides/writing-integrations.md#upstream-source-references).
The full commit resolves the release's source; it does not replace the existing
release version with a commit-only fallback.

## Scope of the source inspection

The inspection concerns the existing **single raw Actor read**, not PF2e's full
rules API. At the pinned commit:

- [`src/module/actor/base.ts`](https://github.com/foundryvtt/pf2e/blob/522dec9d289c7da8b69ac0167b11ccd639871fef/src/module/actor/base.ts)
  defines `ActorPF2e` as a Foundry Actor subclass, retains its source-document
  type and uses `toObject()` for source snapshots.
- [`src/module/actor/data/base.ts`](https://github.com/foundryvtt/pf2e/blob/522dec9d289c7da8b69ac0167b11ccd639871fef/src/module/actor/data/base.ts)
  distinguishes Actor system source data from prepared system data. The adapter
  returns the source `system` object without interpreting those fields or
  recalculating derived statistics.

The package preserves its historical `get_actor_data` schema, binding and probe
byte-for-byte. The binding resolves an Actor UUID, checks the document and system
identities, calls `Actor.toObject()` and returns the identity plus source
`system` data. This metadata correction does not add rolls, resource changes,
conditions, spell casting, damage application or other rule operations.

The manifest now records repository, release tag plus resolved commit and release
date. Adapter **0.1.1** remains unchanged because the operation's implementation
and public contract are unchanged. The original capability probe and empty
exact-version filters are preserved; recording **7.12.2** identifies examined
source and does not introduce a new runtime restriction or claim every release
works. `compatibility.tested` remains empty and `upstream.verifiedAt` remains
`null` because no live Foundry world was tested.

Generation selection belongs to the host, using the folder and matching numeric
`foundryGeneration: 13`. The preserved probe tests capabilities only. Both
constraints apply when installed in the host; there is no cross-generation
fallback. Every source needed to generate or test this package is inside it.

A future expansion needs operation-specific source inspection and contracts/tests
against this or another explicitly selected Foundry-13-compatible release. No
backport of generation-14 operations is included. Mark live support only after
actual runtime validation; local fixture tests do not establish it.
