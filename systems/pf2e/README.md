# Pathfinder 2e integration packages

Each Foundry generation has an independent package. Copy the entire selected
folder, including its manifest, adapter, sources, generated scripts, tests and
examples. No package imports another generation. The host selects the exact
`foundryGeneration` reported by the target; it does not fall back to a sibling.

| Foundry generation | Package | Adapter | Upstream source baseline | Implemented scope |
|---|---|---|---|---|
| **13** | [13/README.md](13/README.md) | **0.1.1** | **[7.12.2](https://github.com/foundryvtt/pf2e/releases/tag/pf2e-7.12.2)**, source minimum **13.348**, maximum **13** | Historical `get_actor_data` only: 1 read |
| **14** | [14/README.md](14/README.md) | **0.2.1** | **8.7.1**, source minimum **14.361** | 22 operations: 10 reads, 12 writes |

Both packages remain experimental with no live tested combinations. Source
baseline, runtime restrictions, examples and validation details belong to each
package README and UPSTREAM document. Tool names retain `system_pf2e_*`;
`target_id` and generation selection choose the installed implementation.
