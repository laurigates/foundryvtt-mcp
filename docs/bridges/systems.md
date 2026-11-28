# System bridge catalog

This catalog lists the game-system integrations shipped with the MCP server.
Follow each package README for its operations, prerequisites and limitations.
An unlisted system can still use generic core document operations and independent
module integrations when the selected provider supports them.

## Foundry version policy

The supported integration scope starts at **Foundry VTT 13, inclusive**. Foundry
12 and earlier are outside this scope. The minimum is an eligibility requirement,
not evidence that every later generation or every release of a game system is
compatible. Each package must document its upstream baseline, narrower runtime
restrictions and actually verified Foundry/system combinations independently.

The system adapters are experimental. Their upstream source baselines are pinned
below; **no live Foundry/system combination has been verified**. Runtime capability
checks and local fixtures do not establish live compatibility.

Each row is an independent package in `systems/<id>/<generation>/`. A target uses
the exact Foundry generation and its single active system to select a package.
An absent generation is unavailable; the loader never borrows an adjacent
generation. Legacy flat third-party packages retain their original contract.

## Included systems

| System / generation package | System version used (upstream) | Adapter version / updated | Pinned upstream source | Foundry scope / runtime checks | Status / verified live combinations |
|---|---|---|---|---|---|
| [D&D 5e / 13](../../systems/dnd5e/13/README.md) (`dnd5e`) | **[5.3.3](https://github.com/foundryvtt/dnd5e/releases/tag/release-5.3.3)** (release; raw-read source baseline) | `0.1.1` / `2026-11-22` | Commit [965ad2d0](https://github.com/foundryvtt/dnd5e/commit/965ad2d0cf5d063dac675ba078b5bd3c3c0dd449) | **Generation 13 only**; upstream minimum **13.347**; retained capability probe for `get_actor_data` | Experimental / **none** |
| [D&D 5e / 14](../../systems/dnd5e/14/README.md) (`dnd5e`) | **[6.1.1](https://github.com/foundryvtt/dnd5e/releases/tag/release-6.1.1)** (release) | `0.2.0` / `2026-11-22` | Commit [bc1b2c92](https://github.com/foundryvtt/dnd5e/commit/bc1b2c921e2f306dc5079f8de883ad64607118a6) | **Generation 14 only**; new operations require build **367+**, exact system 6.1.1 and API/permission checks | Experimental / **none** |
| [Pathfinder 2e / 13](../../systems/pf2e/13/README.md) (`pf2e`) | **[7.12.2](https://github.com/foundryvtt/pf2e/releases/tag/pf2e-7.12.2)** (release; raw-read source baseline) | `0.1.1` / `2026-11-22` | Commit [522dec9d](https://github.com/foundryvtt/pf2e/commit/522dec9d289c7da8b69ac0167b11ccd639871fef) | **Generation 13 only**; upstream minimum **13.348**, maximum **13**; retained capability probe for `get_actor_data` | Experimental / **none** |
| [Pathfinder 2e / 14](../../systems/pf2e/14/README.md) (`pf2e`) | **[8.7.1](https://github.com/foundryvtt/pf2e/releases/tag/pf2e-8.7.1)** (release) | `0.2.1` / `2026-11-22` | Commit [397f125a](https://github.com/foundryvtt/pf2e/commit/397f125aea87e6d6fa36e878c9c07d0e672826cf) | **Generation 14 only**; new operations require build **361+**, exact system 8.7.1 and API/permission checks | Experimental / **none** |

The generation-14 adapters expose **25 D&D 5e operations** and **22 PF2e operations**,
including system-specific reads and selected rule workflows with separate mutation
contracts. Generation 13 deliberately preserves only `get_actor_data`; it does not
claim the newer rules integration. That original operation keeps its input/output
and capability contract within each selected generation. The project minimum of
13 does not make the generation-14 releases **6.1.1** and **8.7.1** compatible
with Foundry 13. The generation-13 source references are **5.3.3** and **7.12.2**;
recording them does not add exact-version gates to the preserved raw read or
backport the generation-14 rules operations.
Other system releases remain subject to each operation's documented probes and
gates; these source references establish no live compatibility.
Read each package README for supported operations, explicit exclusions and examples.

The upstream reference check was performed on **2026-11-22**. D&D 5e **5.3.3** and
PF2e **7.12.2** are the latest stable releases whose upstream manifests permit
Foundry 13; their newer stable release families require Foundry 14. The PF2e repository
publishes several products: `pf2e-8.7.1` is the latest release for the `pf2e`
system, rather than the unrelated product returned by the repository-wide latest
release endpoint.

See [Choosing core, system and module calls](../guides/core-system-module-calls.md)
for operation selection, runtime overrides and the absence of automatic fallback.

### Core text demonstrations

The core `generate_npc` and `generate_loot` helpers are currently advertised only
for targets whose system ID is `dnd5e`. They generate local demonstration text and
do not write documents or implement the system's rules API. These are existing
core helpers, not capabilities introduced by the system adapter.

## Reading and maintaining the catalog

The **system version used (upstream)** is the external system release or tag
inspected for this integration; if neither exists, it is the full commit hash.
The **adapter version** identifies our package, and the **pinned upstream source**
identifies the exact inspected game-system code. An unknown source version does
not mean that the official system has no releases or tags, and it must not be
replaced with an unexamined latest release.

When establishing or updating a baseline, use the latest official release
compatible with that Foundry generation. If the project has no releases, use the
latest compatible official tag; if neither releases nor tags exist, use a
compatible default-branch commit and display its full hash as the upstream version. Record
the resolved commit and source-check date in the package README. Source inspection
can be recorded before live testing; those are separate activities.

Follow the complete [upstream source reference policy](../guides/writing-integrations.md#upstream-source-references).
Keep this catalog and each package README aligned with the corresponding manifest.
Record verified Foundry/system pairs in `compatibility.tested` and update
`upstream.verifiedAt` only after an actual live test. A newer generation's release
must not silently replace the source pin for an older generation. The
generation-13 source inspection covers the retained raw-data contract; its release
reference does not imply that the generation-14 rules operations were backported.

See also the [module bridge catalog](modules.md) and the
[system package structure](../../systems/README.md).
