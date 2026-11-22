# Complete Item Piles workflows

These recipes use the package installed in the repository and the real public
Item Piles 3.3.4 API. They are intended for a dedicated test scene and actors.
The accompanying [workflows.json](workflows.json) contains a valid input example
for every exposed operation, plus the ordered recipes below.

## Before starting

Use the setup in [the package README](../README.md#install-and-connect). Confirm
the selected target, world, Item Piles version, dependencies, GM execution runtime
and `writeEnabled: true`. Each call below has the routing argument
`"target_id": "item-piles-demo"`.

Prepare a Scene, one or two player Actors, an Item template such as a potion, and
an optional RollTable. Copy their UUIDs from Foundry. Read `get_currency_config`
before using the `gp` and `sp` examples: those denominations are examples for a
system that actually defines them, not hard-coded adapter assumptions.

The JSON is a set of **manual call recipes**, not a script runner. Its `id` is a
documentation label; `name` and `arguments` are the MCP call. There is no automatic
variable substitution. Replace each placeholder using real results before the
next call.

| Placeholder | Replace with |
|---|---|
| `Scene.DEMO` | Existing Scene UUID |
| `Actor.PLAYER`, `Actor.PLAYER_TWO` | Real player Actor UUIDs |
| `Item.TEMPLATE_POTION` | Real world/compendium Item UUID |
| `Actor.CHEST_EFFECTIVE`, other `*_EFFECTIVE` names | The corresponding creation result's **`actor_uuid`**, copied verbatim |
| `Scene.DEMO.Token.CHEST`, other token placeholders | The creation result's **`token_uuid`**, copied verbatim |
| `*_POTION_ID` | Embedded item ID read from that actor after adding/transferring |
| `Actor.MERCHANT_EFFECTIVE.Item.MERCHANT_POTION_ID` | The actual Item UUID returned by `get_items`, not a concatenated guess |
| `RollTable.LOOT` | Existing RollTable UUID |
| `system.REPLACE_NUMERIC_ATTRIBUTE` | A numeric path supported by the actual system |

For an unlinked token, `actor_uuid` is its synthetic Actor; `base_actor_uuid` is
the base Actor/template. Use the effective Actor for inventory calls. Added items
can merge with existing stacks or receive new IDs, so always obtain destination
item IDs from the resulting inventory.

## 1. Treasure chest: create, fill, lock, open and loot

The ordered recipe is `chest` in the JSON file.

1. Run `currency_configuration` and `inspect_template` to inspect the system and
   template. Resolve any invalid-item filter before adding it.
2. Run `create_chest`. It creates a container in the explicit scene at `(800,600)`
   with `deleteWhenEmpty: false`, initially open and unlocked. Save both effective
   Actor and Token UUIDs.
3. Run `fill_chest` using the effective Actor UUID. It adds four potion units
   without replacing existing inventory. Creation itself deliberately does not
   populate items, avoiding upstream asynchronous creation behavior.
4. Run `read_chest` and `inspect_chest`. Save the actual embedded potion ID.
5. Run `lock_chest`; expect `closed: true`, `locked: true`. Run `open_chest`;
   expect both false. These are explicit API actions with state verification.
6. Run `take_potion`, transferring one unit from the chest to the player.
7. Read both inventories again. With the stated initial test state, the chest
   retains three units and the player gains one; stacking may change the number
   of item documents.

The central mutation is:

```json
{
  "name": "module_item-piles_transfer_items",
  "arguments": {
    "target_id": "item-piles-demo",
    "source_uuid": "Actor.CHEST_EFFECTIVE",
    "target_uuid": "Actor.PLAYER",
    "items": [{"item_id":"CHEST_POTION_ID","quantity":1}],
    "interaction_id": "demo-chest-transfer"
  }
}
```

This is GM administration. Locking the chest controls the configured module/UI
state; it is not an authorization barrier for an already-authorized GM inventory
API call. The recipe opens it before transferring to model normal use explicitly.

## 2. Merchant: stock, quote, purchase and reconcile

The `merchant` recipe creates a finite-stock merchant and buys one item line.

1. Run `create_merchant`, save its effective Actor/Token IDs, then `stock_merchant`
   and `read_merchant`. The example seeds ten units of an existing template.
2. Use `fund_player` only for the dedicated test actor, then record its balance
   with `read_balances`. Choose an amount adequate for the actual item price.
3. `merchant_modifiers` shows the effective customer price modifiers.
   `set_customer_modifiers` demonstrates an explicit Actor override: buy `0.9`,
   sell `0.5`, with `relative: false`. The tool verifies the observed settings.
4. Run `quote_purchase` with the actual Item UUID, merchant seller and player
   buyer. Inspect the available `payment_index` values, `max_quantity` or
   `unlimited`, `units_per_purchase` and `requested_units`.
5. Run `buy_potion` with the selected embedded item ID and payment index.
6. Read both inventories and both currency balances. Compare the actual item-unit
   change and the payment/change reported by Item Piles.

```json
{
  "name": "module_item-piles_trade_items",
  "arguments": {
    "target_id": "item-piles-demo",
    "seller_uuid": "Actor.MERCHANT_EFFECTIVE",
    "buyer_uuid": "Actor.PLAYER",
    "item_id": "MERCHANT_POTION_ID",
    "quantity": 1,
    "payment_index": 0,
    "interaction_id": "demo-purchase"
  }
}
```

`quantity` is the number of purchases used by upstream pricing. For a system that
sells ten arrows per purchase, one purchase requests ten item units. The quote
exposes that distinction and the write checks stock using actual units. A request
that would be truncated to zero or fractional units is rejected.

The tool accepts exactly **one item line**. For several purchases, quote and
execute each line, then verify the updated state before the next one. This avoids
the inspected upstream multi-line aggregate-affordability defect. Quotes do not
reserve stock or hold a price across calls.

To sell to the merchant, reverse seller/buyer, select an item ID belonging to the
player, and obtain a new quote for that direction. Item Piles applies the relevant
merchant modifiers and item restrictions. For automatic replenishment, configure
the merchant's tables in Item Piles, then use `refresh_merchant`; its explicit
`remove_existing_items: false` keeps existing inventory.

## 3. Vault: capacity preview, deposit and withdrawal

The `vault` recipe creates a six-column, four-row vault and enables vault logging.
Its access entry refers to the player Actor; this configures the player UI,
while MCP mutation authorization remains GM-only.

1. Run `create_vault`, save effective IDs, and call `vault_grid`.
2. Run `vault_fit_one` for one concrete player Item, then `vault_fit_batch` for
   two units. A fit can indicate either a merge into an existing stack or a new
   grid position.
3. When the preview fits, execute `deposit_items` with the source actor's exact
   embedded ID and quantity two.
4. Read `read_vault_inventory` and `vault_grid`. Save the vault's actual item ID;
   it may differ from the player's ID.
5. Execute `withdraw_item` for one vault unit. Read both inventories and the grid
   again: in the baseline example, one of the deposited units remains in the vault.

The preview call is read-only:

```json
{
  "name": "module_item-piles_plan_vault_fit",
  "arguments": {
    "target_id": "item-piles-demo",
    "actor_uuid": "Actor.VAULT_EFFECTIVE",
    "items": [{"item_uuid":"Actor.PLAYER.Item.PLAYER_POTION_ID","quantity":2}]
  }
}
```

It returns `preview_only: true`. Nonstackable quantities expand to separate unit
placements; the preview limit is 100 placements. A fit is not a reservation or an
applicable document-update transaction. `free_spaces` counts actual free grid
cells; `upstream_free_spaces` retains the module's different item-count estimate.

Currency deposits/withdrawals use the currency tools. They do not require manual
grid edits. Read `get_currencies` for balances: an inventory/grid read alone does
not confirm the monetary state.

## 4. Loot: roll a table and split among explicit actors

The `loot` recipe enables `shareItemsEnabled`, `shareCurrenciesEnabled` and
`splitAllEnabled` explicitly.

1. Create the pile with `create_loot` and save its effective UUIDs.
2. Run `roll_loot` against an existing table. The example rolls twice, retaining
   inventory and leaving reset, normalization and chat disabled.
3. Read `read_loot` **and** `loot_balances`. Textual table results can add money;
   the returned item deltas do not confirm those currency effects.
4. Run `configure_sharing` if reusing an existing pile. At least one currency
   sharing flag must be enabled before splitting. This guard also applies to an
   apparently zero-balance actor because items can contain currency.
5. Run `split_loot` with the two explicit recipient Actor UUIDs.
6. Read the source and **both** recipients, including their currencies. Rounding
   and the module's sharing history can leave a remainder in the source.

```json
{
  "name": "module_item-piles_split_pile",
  "arguments": {
    "target_id": "item-piles-demo",
    "actor_uuid": "Actor.LOOT_EFFECTIVE",
    "recipient_uuids": ["Actor.PLAYER", "Actor.PLAYER_TWO"],
    "instigator_uuid": "Actor.PLAYER"
  }
}
```

The response must include deltas for exactly the resolved recipients. Upstream
commits source and recipients sequentially; a failed operation can leave a partial
distribution. The adapter never retries it automatically.

## 5. Currency, combining and token lifecycle

The `maintenance` recipe demonstrates the remaining administrative flow. Its
combine step needs two separate enabled source piles prepared with test inventory.

1. Read `currency_configuration`, then run `calculate_money` and `quote_payment`.
   These use registered primary denominations and do not modify state.
2. `transfer_money` sends three example gold units from player to vault. Read both
   balances afterwards. `transfer_all_money` is a separate example for moving
   every configured denomination, including secondaries.
3. Inspect both source piles, then run `combine_sources` into the chest. The
   adapter checks that eligible positive source balances have been drained, but
   cannot make upstream multi-actor writes atomic. Inspect destination and sources;
   some source tokens may be deleted according to their configuration.
4. Use `convert_existing_token` to turn a separate token into a pile. Revert it
   with `revert_existing_token`. Conversion/reversion can affect a shared Actor
   when the token is linked; the Actor and inventory are retained on reversion.
5. After moving the test chest's remaining contents somewhere appropriate, run
   `delete_empty_chest`. This deletes the selected Token, not its base Actor.

The JSON also supplies separate examples for setting, adding, removing and
transferring numeric system attributes. Replace the example path with a real
numeric field. `transfer_attribute_currencies` moves configured attribute-currency
balances present on both actors; it does not transfer every numeric system field.

## Interpreting a failed write

If the host or binding reports `outcome_unknown`, do not repeat the same mutation
as an automatic recovery step. Read the affected inventories, balances, token
presence and pile flags. A failure after a hook or timeout does not prove that no
changes occurred, and the audit `interaction_id` does not deduplicate calls.

If a read/probe fails because the target changed generation or disconnected,
inspect `get_target_status` and recover the configured target before deciding what
to do with the observed state. The server never redirects the operation to another
world. A local callback/protocol test is not a substitute for running this live
procedure against the exact installed versions and configuration.
