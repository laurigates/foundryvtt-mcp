# Item Piles integration

| Field | Value |
|---|---|
| Foundry module ID | `item-piles` |
| Adapter version | `0.1.0` |
| Adapter updated | 2026-11-19 |
| Status | Experimental |
| Upstream repository | https://github.com/fantasycalendar/FoundryVTT-ItemPiles |
| Upstream version / commit | Not pinned for a live compatibility claim |
| Upstream last update | Not verified |
| Last live verification | Not performed |
| Tested live combinations | None |
| Worker protocol | 1 |

## Operation

`module_item-piles_get_items` accepts `actor_uuid`. It resolves the Actor in the
selected target and calls `game.itempiles.API.getActorItems(actor)`. Each item is
returned as plain JSON containing `id`, `uuid`, `name`, `type` and `quantity`.
Quantity comes from `game.itempiles.API.getItemQuantity(item)`.

`target_id` is resolved by the host before Python is invoked. The tool name keeps
the original hyphen in `item-piles`; Python's private import name is independent.

## Availability

The module must be active, the runtime must be ready, and the two public API
functions must exist. The API namespace is `game.itempiles.API`; this integration
does not assume every module exposes its API through `game.modules.get(id).api`.

Item Piles' own dependencies and system handling remain its responsibility. A
local `systems/<id>` adapter is not required for this independent read operation.

## Limits and verification

This first operation is read-only. Transfers, purchases, currencies and pile
creation need their own verified bindings, schemas and write classification.
They must use Item Piles' public operations rather than substitute generic
document writes for its behavior.

No live Foundry/module version combination has been verified in this change.
Empty version restrictions allow experimental runtime probes; they do not mean
universal support. Local tests cover dispatch, DTOs, readiness and provider
isolation. Update the upstream reference and tested matrix after a live test.
