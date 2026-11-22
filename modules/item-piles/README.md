# Item Piles integration

This package exposes **40 fixed MCP operations: 13 reads and 27 writes** for
inventories, currencies, loot piles, containers, merchants, tables and vaults.
It is a worked example of a substantial **module integration**: module-specific
behavior lives here, while providers, target routing, Python transport and write
policy remain in the shared host. Its scope is these data-oriented workflows;
it does not expose every upstream method, UI interaction or optional extension.
See the [coverage boundaries](UPSTREAM.md#deliberately-separate-surfaces).

| Metadata | Value |
|---|---|
| Upstream module ID | `item-piles` |
| Adapter version / update | `0.2.0` / `2026-11-22` |
| Status | **Experimental** |
| Upstream repository | [fantasycalendar/FoundryVTT-ItemPiles](https://github.com/fantasycalendar/FoundryVTT-ItemPiles) |
| Upstream source version / kind | **Release [3.3.4](https://github.com/fantasycalendar/FoundryVTT-ItemPiles/releases/tag/3.3.4)** |
| Upstream source commit | [`85ab971406623fb1c5d01eb1f093fe4855ede6e4`](https://github.com/fantasycalendar/FoundryVTT-ItemPiles/commit/85ab971406623fb1c5d01eb1f093fe4855ede6e4) |
| Upstream release date | `2026-07-18` |
| Source inspected on | `2026-11-22` |
| Latest reference checked on | `2026-11-22`; latest release **3.3.4**, same as the inspected baseline |
| Project Foundry scope | **13 or later**, including 13; narrower operation gates below still apply |
| New-operation runtime gate | Item Piles **3.3.4**, Foundry generation **13 or 14**, required public methods and active dependencies |
| Actually tested live combinations | **None**; `compatibility.tested: []`, `upstream.verifiedAt: null` |

Release **3.3.4** is the upstream code to keep this adapter synchronized with;
**0.2.0** is this repository's adapter version. Reference selection follows the
[release → tag → commit policy](../../docs/guides/writing-integrations.md#upstream-source-references).
Foundry 12 and earlier are outside the project's support and maintenance scope,
even if the legacy `get_items` capability probe succeeds. The minimum of 13 is a
support policy; it does not add a shared runtime guard or validate future versions.

Source inspection and local tests do not establish live Foundry, game-system or
relay compatibility. [UPSTREAM.md](UPSTREAM.md) records the exact primary sources,
implemented boundaries and observed upstream behavior.
See the [module bridge catalog](../../docs/bridges/modules.md) for other packages
and their source/version records.

## Install and connect

### 1. Install the Foundry module

Install **Item Piles 3.3.4** in Foundry using its versioned release manifest:

```text
https://github.com/fantasycalendar/FoundryVTT-ItemPiles/releases/download/3.3.4/module.json
```

Enable `item-piles`, `socketlib` and `lib-wrapper` in the intended world. Complete
Item Piles' setup for the game system, including currencies, item quantity/price
paths and pile actor type. This adapter uses the module's system integration;
it does not guess D&D-specific fields or require a corresponding `systems/` adapter.

The official source manifest lists Foundry 13–14 and those two dependencies. Its
development `100.0.0` version is a placeholder, not the release number. Check the
[3.3.4 release](https://github.com/fantasycalendar/FoundryVTT-ItemPiles/releases/tag/3.3.4)
when identifying the installed version.

### 2. Install this MCP branch

```bash
git clone --branch feat/multiworld-provider-overhaul https://github.com/p4535992/foundryvtt-mcp.git
cd foundryvtt-mcp
npm install
npm run check:item-piles
npm run build
```

Use Node.js 18+ and Python 3.10+. This branch includes the adapter; it does not
publish a new npm release or install a Foundry world. The generated bindings,
probes, manifest and Python adapter ship in the package. No additional Python
dependencies are required by the adapter.

### 3. Configure an execution-capable target

Use `rest-api` or `composite`. Standalone `socketio` and historical `legacy-rest`
targets do not provide the runtime execution capability required by these
bindings. The paired runtime must permit the relay's execution endpoint.

Copy [examples/targets.example.json](examples/targets.example.json), replace its
world/origin/relay/client placeholders and set `FOUNDRY_TARGETS_FILE` to the copy's
absolute path. The example names the target `item-piles-demo` and sets
`writeEnabled: true` for the administrative examples. Credentials are references
to environment variables, not secrets stored in the JSON file.

```dotenv
FOUNDRY_TARGETS_FILE=/absolute/path/item-piles-targets.local.json
FOUNDRY_DEMO_USERNAME=Your Foundry GM user
FOUNDRY_DEMO_PASSWORD=your-world-user-password
FOUNDRY_DEMO_RELAY_API_KEY=your-relay-key
```

Point the MCP client at `node /absolute/path/foundryvtt-mcp/dist/index.js` with
those variables. Both connections must be available for a composite target. The
shared [provider guide](../../docs/guides/providers-and-targets.md) also covers
single-target environment configuration and other provider arrangements.

**The execution runtime must be a GM for writes.** The native connection and
paired runtime can use different accounts, so a native GM login alone does not
satisfy this condition. Item Piles' public mutation APIs delegate to a GM and do
not generally enforce the player UI's ownership, distance or vault rules. This
is an administrative interface. Non-GM reads require OBSERVER permission on each
requested document.

### 4. Check discovery

Call `list_targets`, then `get_target_status` and `list_modules` with
`{"target_id":"item-piles-demo"}`. Check identity, module version and operation
availability. Each operation probes its required methods separately. New
operations require the exact inspected 3.3.4 contract; the original `get_items`
remains capability-based on older versions.

## First call and response

The public name preserves the upstream hyphen: `module_item-piles_<operation>`.

```json
{
  "name": "module_item-piles_get_items",
  "arguments": {
    "target_id": "item-piles-demo",
    "actor_uuid": "Actor.REPLACE_WITH_ACTOR_ID"
  }
}
```

The operation result retains the original array contract:

```json
[
  {
    "id": "potion",
    "uuid": "Actor.REPLACE_WITH_ACTOR_ID.Item.potion",
    "name": "Potion",
    "type": "consumable",
    "quantity": 3
  }
]
```

The host wraps it in structured MCP output with `target_id`, `world_id`,
`session_generation` and `result`. `target_id` selects a configured connection and
is removed before Python/binding validation. With multiple configured targets it
is mandatory. `target_uuid`, in contrast, identifies a destination inside that
selected world.

Most new actor operations accept Actor or Token UUIDs and resolve the actual
Actor. Legacy `get_items` still requires an Actor UUID. Selection `item_id` values
are exact embedded IDs on the source Actor, not names or UUIDs. Templates use
`item_uuid`, including readable compendium Item UUIDs.

## Complete workflows

[examples/workflows.md](examples/workflows.md) explains five end-to-end flows:

1. Create and fill a treasure chest, lock/open it, then transfer loot.
2. Create a merchant, quote a purchase, trade one item line and inspect both sides.
3. Create a vault, preview capacity, deposit and withdraw, then inspect the grid.
4. Populate loot from a RollTable, configure sharing and split it among explicit actors.
5. Calculate/transfer currency, combine piles, revert a token and delete a pile token.

[examples/workflows.json](examples/workflows.json) contains the corresponding MCP
call recipes. They are examples, not an automatic workflow engine. Replace the
placeholder IDs using preceding results. An added or merged item can receive a
different ID on its destination.

`create_pile` deliberately omits initial items. It returns the effective inventory
`actor_uuid`, the `base_actor_uuid` and an optional `token_uuid`. For an unlinked
token, its effective Actor differs from the base Actor. Use **`result.actor_uuid`
for subsequent inventory calls** and `result.token_uuid` for token-specific work.
Then call `add_items` and read the resulting inventory.

## Operation catalog

All names below have the `module_item-piles_` prefix. The manifest contains the
complete machine-readable schemas.

| Family | Reads | Writes |
|---|---|---|
| Inventory | `get_items`, `inspect_item`, `get_item_categories` | `add_items`, `remove_items`, `transfer_items`, `transfer_all_items` |
| Currency and attributes | `get_currencies`, `get_currency_config`, `calculate_currencies`, `get_payment_data` | `update_currencies`, `add_currencies`, `remove_currencies`, `transfer_currencies`, `transfer_all_currencies`, `set_attributes`, `add_attributes`, `remove_attributes`, `transfer_attributes`, `transfer_all_attributes` |
| Pile lifecycle/sharing | `get_pile` | `create_pile`, `convert_tokens`, `revert_tokens`, `update_pile`, `delete_pile`, `split_pile`, `transfer_everything`, `combine_piles` |
| Containers | State included in `get_pile` | `set_container_state` |
| Merchants/tables | `get_item_prices`, `get_merchant_modifiers` | `update_merchant_modifiers`, `trade_items`, `refresh_merchant_inventory`, `roll_item_table` |
| Vaults | `get_vault_grid`, `check_vault_fit`, `plan_vault_fit` | Inventory/currency transfers perform deposits/withdrawals; `update_pile` configures the vault |

### Input conventions

| Input | Contract |
|---|---|
| Items for adding/planning | `[{"item_uuid":"Item.ID","quantity":2}]`; existing templates, no raw item data |
| Items for removal/transfer | `[{"item_id":"EMBEDDED_ID","quantity":2}]`; positive finite quantities, no duplicate IDs or overdrawing |
| Currencies | `[{"abbreviation":"gp","quantity":5}]`; discover the actual denominations with `get_currency_config` |
| Attributes | `{"system.some.numeric.path":2}`; safe numeric `system.*` paths |
| Pile settings | Allowlisted data for pile/container/merchant/vault/sharing; no arbitrary macros or extension flags |
| Container action | `open`, `close`, `lock`, `unlock`; opening also unlocks, locking also closes |
| Trade | One `item_id`, positive purchase `quantity`, optional zero-based `payment_index`; usable for buying from or selling to a merchant |
| Merchant refresh | Explicit `remove_existing_items`; true clears existing stock before replenishment |
| Roll table | Exact `table_uuid`, integer `rolls` from 1–100, optional recipient `actor_uuid`; reset/normalize/chat/replace default to false |
| Interaction ID | Optional hook/log context, **not** an idempotency key |

Configuration includes appearance, container state, sharing, merchant price
modifiers/infinite stock/opening times and vault dimensions/access/logging.
Merchant table definitions and custom item prices can be configured in Item Piles'
own UI; MCP uses those definitions through the public refresh, roll and trade APIs.

## Important execution semantics

- **No automatic retry after an uncertain write.** False/missing/malformed mutation
  results, failed postconditions and exceptions after invocation become
  `outcome_unknown`. Read the affected state before deciding on another call.
- **No distributed transaction guarantee.** Multi-actor changes can be partial.
  `combine_piles` checks drained source inventories but cannot undo upstream effects.
  Empty piles may be deleted according to their configured behavior.
- **Quotes and capacity previews do not reserve resources.** Vault plans are not
  document update instructions; use the inventory transfer tools for the actual move.
- **Currency boundaries follow inspected 3.3.4 behavior.** Calculation, payment
  quotes, removal and partial transfer accept primary denominations only. Setting
  totals accepts attribute currencies only. Inputs are numeric amounts, never dice
  or formulas. [UPSTREAM.md](UPSTREAM.md#currency-input) explains the source defects.
- **Deltas are not final balances.** Transfer/trade deltas describe the destination
  side. Read both actors for balances. Raw delta items without a stable UUID use
  `uuid: ""`.
- **Outputs are JSON DTOs.** Live Documents become summaries. Nested non-finite
  numbers become null; quote DTOs include an explicit `unlimited` flag. Item and
  currency quantities themselves must be finite.
- **Player UI operations remain separate.** This package does not open trade
  dialogs, render interfaces for other users, register pile types, change global
  system integration settings or invoke private vault-access helpers.

## Verification and development

From the repository root:

```bash
npm run generate:item-piles
npm run check:item-piles
npm run test:item-piles
npm run test:python
npm test
npm run build
npm run smoke:integrations
npm run smoke:pack
```

Package Node tests use `node:test` and isolated VM fixtures without extra test
dependencies. They exercise real generated scripts, gates, API mapping, DTOs,
failed/partial outcomes, target isolation and the legacy contract. Python tests
exercise the actual worker and callback protocol. The installed smoke loads the
adapter from another working directory and uses a local fake provider for
representative reads/writes.

Full project checks also require the declared development dependencies. Offline
tests do not contact Foundry. For live verification, use dedicated test actors and
a scene, run the documented workflows, verify both sides of each transfer, hook
cancellation and vault capacity, then record exact Foundry/module/system/relay
versions. Keep the adapter experimental and the live matrix empty until that has
actually been done.

### Package layout and reuse

| Path | Responsibility |
|---|---|
| `src/runtime.mjs` | Self-contained readiness, permission, resolution, data and outcome helpers |
| `src/inventory.mjs`, `src/piles.mjs`, `src/merchant.mjs` | Fixed handlers and schemas grouped by domain |
| `src/registry.mjs` | Deterministic operation registry and package metadata |
| `build.mjs` | Generates standalone scripts/manifest; `--check` detects drift and orphans without writing |
| `get_items.js`, `probe.js` | Preserved legacy file paths, now generated |
| `bindings/`, `probes/`, `manifest.json` | Checked-in runtime artifacts, no runtime bundler or user-selected API method |
| `adapter.py` | Manifest allowlist and one authorized `context.invoke` callback |
| `tests/`, `examples/`, `UPSTREAM.md` | Contracts, usage recipes and upstream evidence |

Edit the source modules, generate, review the output and run the checks. Build and
test verify generation rather than silently rewriting it. The adapter never
receives credentials or chooses a provider. This pattern can be reused for another
substantial module or system without adding module-specific provider branches.

## Compatibility with adapter 0.1.0

The `module_item-piles_get_items` name, `actor_uuid` input, five-field item DTO and
original binding/probe paths are retained. New tools are additive and gated
individually. Reads enforce document permissions and finite JSON data. Core tools,
provider selection and target-routing contracts are not renamed.
