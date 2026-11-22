# D&D5e integration packages

Each Foundry generation has an independent package. Copy the entire selected
folder, including its manifest, adapter, sources, generated scripts, tests and
examples. No package imports another generation. The host selects the exact
`foundryGeneration` reported by the target; it does not fall back to a sibling.

| Foundry generation | Package | Adapter | Upstream source baseline | Implemented scope |
|---|---|---|---|---|
| **13** | [13/README.md](13/README.md) | **0.1.1** | **[5.3.3](https://github.com/foundryvtt/dnd5e/releases/tag/release-5.3.3)**, source minimum **13.347** | Historical `get_actor_data` only: 1 read |
| **14** | [14/README.md](14/README.md) | **0.2.0** | **6.1.1**, source minimum **14.367** | 25 operations: 10 reads, 15 writes |

Both packages remain experimental with no live tested combinations. Source
baseline, runtime restrictions, examples and validation details belong to each
package README and UPSTREAM document. Tool names retain `system_dnd5e_*`;
`target_id` and generation selection choose the installed implementation.
