# Item Piles integration packages

Select the package for the target's exact Foundry generation. Each folder is
self-contained: copy its entire contents together. Both variants pin official
Item Piles **3.3.4**, whose inspected source declares Foundry 13–14 support.
The host chooses the matching numeric `foundryGeneration`; there is no fallback
to another generation and no source/runtime import between the packages.

| Foundry generation | Package | Adapter | Upstream module version | Implemented scope |
|---|---|---|---|---|
| **13** | [13/README.md](13/README.md) | **0.2.1** | **3.3.4** | 40 operations: 13 reads, 27 writes |
| **14** | [14/README.md](14/README.md) | **0.2.1** | **3.3.4** | 40 operations: 13 reads, 27 writes |

Both variants are experimental with no live tested combinations. Their own
README and UPSTREAM documents contain the pinned commit, generation gate,
permissions, complete recipes and coverage limits. Public names remain
`module_item-piles_*`; the target selects the implementation.
