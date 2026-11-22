# Pathfinder 2e Foundry 13: source status

| Field | Value |
|---|---|
| System ID / Foundry generation | `pf2e` / **13** |
| Adapter version / update | **0.1.1** / **2026-11-22** |
| Upstream repository reference | **Unrecorded for this variant** |
| Upstream release, tag, resolved commit, source version and date | **Not inspected or pinned** |
| Latest upstream reference checked for Foundry 13 | **Not performed** |
| Live verification | **None** |

This package preserves the repository's historical `get_actor_data` schema,
binding and probe. The inspected evidence is that existing local implementation,
not a specific upstream system release. It resolves an Actor UUID, checks the
system ID, calls `Actor.toObject()` and returns the identity plus source
`system` data without rule evaluation or a mutation API.

The manifest intentionally retains null upstream fields and an empty live test
matrix. Source evidence for a newer system release requiring Foundry 14 does
not establish a Foundry-13 contract. No backport of those new operations is
included, and no upstream version number is inferred from the adapter version.

Generation selection belongs to the host, using the folder and matching numeric
`foundryGeneration: 13`. The preserved probe tests capabilities only. Both
constraints apply when installed in the host; there is no cross-generation
fallback. Every source needed to generate or test this package is inside it.

A future expansion needs an explicitly inspected Foundry-13-compatible source
baseline, following the [release → tag → commit policy](../../../docs/guides/writing-integrations.md#upstream-source-references),
and operation-specific contracts/tests. Mark live support only after actual
runtime validation; local fixture tests do not establish it.
