# Module bridge catalog

This catalog lists the module integrations shipped with the MCP server. Follow
each package README for installation, dependencies, operations, examples and
limitations. Provider selection and target configuration are documented in the
[provider guide](../guides/providers-and-targets.md).

## Foundry version policy

The supported integration scope starts at **Foundry VTT 13, inclusive**. Foundry
12 and earlier are outside this scope. A minimum of 13 does not establish support
for every subsequent generation: the upstream contract, package restrictions and
operation probes can narrow the usable versions further.

The table distinguishes that scope from **actually verified live combinations**.
An experimental adapter with passing local tests or runtime probes has not thereby
been verified in a real Foundry world. Empty version-filter arrays are not a
promise of compatibility with every version.

Each row is an independent package in `modules/<id>/<generation>/`. The loader
selects the target's exact generation before checking the installed module and
probing its operations. A missing `15/` package does not fall back to `14/` or
`13/`. Legacy flat third-party packages retain their original loading contract;
the shipped versioned packages enforce the generation boundary.

## Included modules

| Module / generation package | Module version used (upstream) | Adapter version / updated | Pinned upstream source | Foundry scope / runtime checks | Status / verified live combinations |
|---|---|---|---|---|---|
| [Item Piles / 13](../../modules/item-piles/13/README.md) (`item-piles`) | **[3.3.4](https://github.com/fantasycalendar/FoundryVTT-ItemPiles/releases/tag/3.3.4)** (release) | `0.2.1` / `2026-11-22` | Commit [85ab9714](https://github.com/fantasycalendar/FoundryVTT-ItemPiles/commit/85ab971406623fb1c5d01eb1f093fe4855ede6e4) | **Generation 13 only**; new operations require exact module version and API/dependency probes | Experimental / **none** |
| [Item Piles / 14](../../modules/item-piles/14/README.md) (`item-piles`) | **[3.3.4](https://github.com/fantasycalendar/FoundryVTT-ItemPiles/releases/tag/3.3.4)** (release) | `0.2.1` / `2026-11-22` | Commit [85ab9714](https://github.com/fantasycalendar/FoundryVTT-ItemPiles/commit/85ab971406623fb1c5d01eb1f093fe4855ede6e4) | **Generation 14 only**; new operations require exact module version and API/dependency probes | Experimental / **none** |

The original Item Piles `get_items` operation retains capability-based checks
without an exact module-version gate inside each selected generation. That legacy
read does not cross generation boundaries or establish verified combinations.
See its README for the differences between that operation and the newer API
operations, including the requirements for mutations.

## Reading and maintaining the catalog

The **module version used (upstream)** is the external module release or tag
inspected for this integration; it is not our adapter version. If upstream has
neither releases nor tags, that column contains the full commit hash instead.
The **adapter version** identifies our integration package, and the **pinned
upstream source** identifies the exact inspected code. These values are separate
from the version observed in a connected world and from live compatibility tests.

Use the latest official release compatible with the row's Foundry generation as
the synchronization reference. If the project has no releases, use the latest
compatible official tag; if there are neither releases nor tags, use a compatible
default-branch commit and display its full hash as the upstream
version. Always record the resolved commit, source-check date and any pending
alignment in the package README. A newer reference becomes the adapter's baseline
only after its contract has been inspected and the integration aligned.

Follow the complete [upstream source reference policy](../guides/writing-integrations.md#upstream-source-references).
Keep this catalog and the individual README consistent when changing a package's
adapter version, source baseline or Foundry restrictions. Record performed live
tests separately in `compatibility.tested` and `upstream.verifiedAt`. Updating
`14/` does not change the baseline of `13/`, even when both originally used the
same upstream release.

See also the [system bridge catalog](systems.md) and the
[module package structure](../../modules/README.md).
