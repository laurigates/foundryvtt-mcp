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

The existing system adapters are experimental. Their exact upstream source
baselines and supported version combinations have **not yet been recorded**.
Runtime capability checks and local fixtures do not establish live compatibility.

This minimum is a support and maintenance policy, not a shared runtime version
check. A probe succeeding on Foundry 12 or earlier does not bring that installation
into the supported scope.

## Included systems

| System / package documentation | Adapter version / updated | Upstream source baseline | Foundry scope / runtime checks | Status / verified live combinations |
|---|---|---|---|---|
| [D&D 5e](../../systems/dnd5e/README.md) (`dnd5e`) | `0.1.0` / `2026-11-19` | **Not yet recorded** | **13+ policy**; exact combinations not established; system identity and Actor API probes | Experimental / **none** |
| [Pathfinder 2e](../../systems/pf2e/README.md) (`pf2e`) | `0.1.0` / `2026-11-19` | **Not yet recorded** | **13+ policy**; exact combinations not established; system identity and Actor API probes | Experimental / **none** |

The bundled operations read Actor data. They do not establish support for the
systems' rule calculations or other system-specific APIs. Read the individual
README before selecting an adapter for a workflow.

### Core text demonstrations

The core `generate_npc` and `generate_loot` helpers are currently advertised only
for targets whose system ID is `dnd5e`. They generate local demonstration text and
do not write documents or implement the system's rules API. These are existing
core helpers, not capabilities introduced by the system adapter.

## Reading and maintaining the catalog

The **adapter version** identifies our package. The **upstream source baseline**
must identify the game-system code inspected for it. An unknown baseline does not
mean that the official system has no releases or tags, and it must not be replaced
with an unexamined latest release.

When establishing or updating a baseline, use the latest official release; if
none exists, use the latest official tag; if neither exists, use the current
default-branch commit and display its full hash as the upstream version. Record
the resolved commit and source-check date in the package README. Source inspection
can be recorded before live testing; those are separate activities.

Follow the complete [upstream source reference policy](../guides/writing-integrations.md#upstream-source-references).
Keep this catalog and each package README aligned with the corresponding manifest.
Record verified Foundry/system pairs in `compatibility.tested` and update
`upstream.verifiedAt` only after an actual live test.

See also the [module bridge catalog](modules.md) and the
[system package structure](../../systems/README.md).
