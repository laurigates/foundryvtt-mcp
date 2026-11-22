# Item Piles upstream contract and implementation notes

## Reference inspected

| Field | Value |
|---|---|
| Official project | [fantasycalendar/FoundryVTT-ItemPiles](https://github.com/fantasycalendar/FoundryVTT-ItemPiles) |
| Release | [3.3.4](https://github.com/fantasycalendar/FoundryVTT-ItemPiles/releases/tag/3.3.4), published 2026-07-18 |
| Commit | [`85ab971406623fb1c5d01eb1f093fe4855ede6e4`](https://github.com/fantasycalendar/FoundryVTT-ItemPiles/commit/85ab971406623fb1c5d01eb1f093fe4855ede6e4) |
| Source inspection | 2026-11-22 |
| Latest reference check | 2026-11-22: release 3.3.4 remains the latest published release and matches the inspected baseline |
| Adapter | 0.2.0, experimental |
| Live verification | None; `compatibility.tested` remains empty and `upstream.verifiedAt` remains null |

The release and resolved commit are the synchronization reference for the
upstream module code. The adapter has its own version and update history.
Selection follows the [release → tag → commit policy](../../docs/guides/writing-integrations.md#upstream-source-references).

The tag and default branch pointed to the same commit when inspected. All links
below pin the commit rather than following a moving branch. The source manifest
contains the development placeholder `version: "100.0.0"`; it is not the released
module version. The source compatibility metadata declares minimum Foundry 13,
verified 14 and maximum 14, and requires `socketlib` and `lib-wrapper`.

Primary sources:

- [Public API implementation](https://github.com/fantasycalendar/FoundryVTT-ItemPiles/blob/85ab971406623fb1c5d01eb1f093fe4855ede6e4/src/API/api.js).
- [Private implementation used to verify public outcomes](https://github.com/fantasycalendar/FoundryVTT-ItemPiles/blob/85ab971406623fb1c5d01eb1f093fe4855ede6e4/src/API/private-api.js).
- [Currency, pricing, pile and vault helpers](https://github.com/fantasycalendar/FoundryVTT-ItemPiles/blob/85ab971406623fb1c5d01eb1f093fe4855ede6e4/src/helpers/pile-utilities.js).
- [Transaction implementation](https://github.com/fantasycalendar/FoundryVTT-ItemPiles/blob/85ab971406623fb1c5d01eb1f093fe4855ede6e4/src/helpers/transaction.js).
- [Socket execution and errors](https://github.com/fantasycalendar/FoundryVTT-ItemPiles/blob/85ab971406623fb1c5d01eb1f093fe4855ede6e4/src/socket.js).
- [Configuration constants](https://github.com/fantasycalendar/FoundryVTT-ItemPiles/blob/85ab971406623fb1c5d01eb1f093fe4855ede6e4/src/constants/constants.js),
  [source manifest](https://github.com/fantasycalendar/FoundryVTT-ItemPiles/blob/85ab971406623fb1c5d01eb1f093fe4855ede6e4/module.json),
  [API documentation](https://github.com/fantasycalendar/FoundryVTT-ItemPiles/blob/85ab971406623fb1c5d01eb1f093fe4855ede6e4/docs/api.md).

Only public `game.itempiles.API` methods are called by this adapter. Private source
was inspected to understand results and failure modes; it is neither imported nor
called. The upstream MIT project remains a separate Foundry module, installed and
maintained through Foundry. This repository contains the MCP integration.

## Decisions derived from the implementation

### Permission boundary

Public mutation APIs delegate through `executeAsGM`. Inventory and administrative
methods do not generally enforce the ownership, distance, container or vault-access
checks used by the UI. A paired non-GM client must not acquire arbitrary GM writes
merely by passing an Actor UUID.

The adapter therefore requires both the target's `writeEnabled` setting and a GM
execution runtime for every mutation. Non-GM reads require OBSERVER permission on
each requested document. This is an administration/integration interface, not a
replacement for the player-facing looting UI. `getVaultAccess` is private and is
not exposed as though it were a public permission API.

### Uncertain results and side effects

`executeAsGM` can return `false` when there is no GM, during its cooldown, after a
pre-hook veto, or after an exception from an already-dispatched request. Hooks and
configured macros can also fail after document changes. A `false` return therefore
cannot establish rollback. The adapter reports `outcome_unknown` after an
unconfirmed mutation and does not retry it.

The upstream two-second warning/cooldown timer does not cancel the pending request.
Our provider/worker timeout likewise cannot undo a remote execution. Check the
affected actors and token state before deciding on a further operation.

`interaction_id` is passed to upstream hooks/logs. It is not an idempotency key.
Transfers can commit the source before the destination and are not distributed
transactions. Returned deltas describe the upstream transaction response, not a
fresh independent inventory snapshot.

### Creation and container state

The implemented `createItemPile` arguments include `actor` and `folders`; older
documentation still names `pileActorName` and `folder`. The real result is an
object containing `actorUuid` and optionally `tokenUuid`, not the documented
single string.

Creation with an unlinked token can schedule item creation asynchronously after
the creation result. Actor-only creation has a separate linked-token condition
for initial items. `create_pile` consequently creates the pile without initial
items; the documented workflow then calls `add_items` and reads the inventory.
The scene is explicit because the upstream default `game.user.viewedScene` may be
absent in a runtime without a viewed scene.

The upstream toggle methods can return a boolean based on the old state even
when a pre-hook vetoes the change. `set_container_state` uses explicit
`open`/`close`/`lock`/`unlock` actions and checks the observed state. Pile updates,
conversion and deletion likewise verify their relevant postcondition. Deletion
is token-only, matching `deleteItemPile`; it is not Actor document deletion.

The upstream creation result names the base Actor, even for an unlinked Token.
Our result separates `base_actor_uuid` from `actor_uuid`, which identifies the
Token's effective inventory Actor. Follow-up inventory calls therefore do not
accidentally modify the shared template instead of the newly placed pile.

The split implementation prepares currency removal before checking whether
currency sharing is enabled for the recipient credits. `split_pile` requires
`shareCurrenciesEnabled` or `splitAllEnabled` before dispatch, even with zero
visible Actor balance: currencies inside Items are not fully observable through
the public API. Item sharing still follows its separate `shareItemsEnabled` flag.

### Item and attribute operations

`getActorItems` excludes configured item currencies and filtered item types.
`get_currencies` is the complementary currency inventory. Quantities always come
from `getItemQuantity`, not a hard-coded D&D field.

Adding items resolves real Item UUIDs and clones their data. Existing-item removal
and transfer require exact embedded IDs and positive quantities, reject duplicates,
and check stock before dispatch. No ambiguous name lookup is exposed. Caller-supplied
attribute changes are restricted to safe numeric `system.*` paths; the bridge does
not accept arbitrary ownership, executable configuration or prototype paths.

In 3.3.4, private `transferAllAttributes` constructs an array of path strings, while
the transaction helper expects `{path, quantity}` entries. `transfer_all_attributes`
therefore reads the configured attribute-currency balances and invokes the public
`transferAttributes` with an explicit map. It transfers only paths present on both
actors, and emits the ordinary transfer-attribute hooks rather than the broken
transfer-all-attribute hook sequence.

### Currency input

The upstream string parser evaluates formulas and dice, and several mutation paths
parse the string once during preflight and again on the GM. MCP inputs instead use
arrays of `{abbreviation, quantity}`. The adapter builds canonical numeric literal
strings using registered abbreviations, preserves explicit zero for setting totals,
and rejects duplicate/unknown denominations and non-finite amounts.

The inspected parser embeds currency identifiers into a regular expression without
escaping and skips currencies without a truthy exchange rate. The adapter rejects
ambiguous, numeric-prefixed or regex-sensitive configured abbreviations and selected denominations
without a positive finite exchange rate. Such currencies remain visible in
`get_currencies`; configured attribute transfers and `transfer_all_currencies` do
not use that string parser.

Further 3.3.4-specific boundaries:

- `transferCurrencies` passes secondary prices during public preflight but omits
  them in its private payment calculation. `transfer_currencies` accepts primary
  denominations only. `transfer_all_currencies` retains the upstream all-currency
  operation, including secondaries.
- `calculateCurrencies` indexes the second parsed list by the first list's index
  when handling secondary currencies, although parsing returns only denominations
  present in the input. `calculate_currencies` is restricted to primary currencies.
- `getPaymentData` and the remove-currency payment path include parsed secondary
  amounts in both the base-currency cost and secondary-price data. Their wrappers
  therefore also accept primary denominations only; adding and setting eligible
  currencies use separate direct-update paths.
- `updateCurrencies` sends an item-backed currency quantity of one to a transaction
  path that does not honor the desired total. `update_currencies` accepts only
  attribute-backed denominations. Adding/removing currencies has separate public
  implementations and remains available.
- `change:false` in remove/transfer is an upstream preflight restriction; the
  private execution still computes payment and change. It does not lock balances
  between preflight and commit.

### Merchants and tables

The public multi-line `tradeItems` checks affordability per line. The private path
calculates aggregate `canBuy` but does not enforce it before committing. The MCP
`trade_items` contract therefore accepts exactly one item line. It verifies stock,
the chosen payment index and affordability before dispatching the public trade.
Configured infinite merchant stock is respected; price affordability and stock
are separate concepts. Quotes are not reservations and can change before execution.

Some systems sell packs using `QUANTITY_FOR_PRICE_ATTRIBUTE`. The adapter exposes
`units_per_purchase` and `requested_units`, checks the actual unit count against
stock, and rejects a request whose conversion would produce zero/fractional units
or overflow. `quantity` in the trade payload remains the purchase count used to
calculate prices. A response with `itemPrices.canBuy !== true` is uncertain even
when upstream returns deltas, since the private trade path does not enforce that
flag before commit.

Prices can include `Infinity`, including free or unlimited affordability. Quote
DTOs expose `max_quantity: null` and an explicit `unlimited` flag. General nested
API data is converted to JSON, with non-finite numbers represented as null and
Foundry Documents replaced by references. Item and currency amounts themselves
must remain finite. `isItemInvalid` can return a filter value rather than a boolean;
`inspect_item` exposes both a normalized boolean and the reason.

`refreshMerchantInventory` defaults to clearing existing items upstream. Our tool
requires `remove_existing_items` explicitly. `rollItemTable` is classified as a
write even without a recipient: it can modify drawn/reset state and emit chat.
It takes an exact RollTable UUID and an integer roll count, with reset, normalization,
chat and inventory replacement all defaulting to false.

Textual roll-table results can also credit currencies. The upstream return value
contains item deltas only, and a false currency-update result is not consistently
propagated by the table implementation. A successful item response therefore does
not confirm all monetary effects; workflows explicitly read `get_currencies`
after rolling into an Actor.

### Combined piles and vaults

The private combine path uses `Promise.allSettled` for source commits without
checking every result before crediting the target. `combine_piles` checks that
eligible positive source inventory/currency balances have been drained after the
response and treats an unverified result as uncertain. This detects a remaining
source balance; it cannot undo or make the upstream transaction atomic. The tool
does not expose the upstream `targetItemPileFlags` argument, which the public
method validates but does not forward.

`canItemFitInVault` returns different values: false, an existing item ID, a position
object, or true for a non-vault. The adapter requires a real vault and normalizes
these results. `fitItemsIntoVault` calculates a plan; it does not save changes.
`plan_vault_fit` is read-only and its update/delete arrays are explicitly previews.
Actual deposits and withdrawals use `transfer_items` or other public inventory APIs.

The upstream `getVaultGridData.freeSpaces` subtracts the number of items, rather
than their occupied grid cells. Our `free_spaces` uses `freeCells.length`, while
`upstream_free_spaces` retains the reported value for comparison.

## Deliberately separate surfaces

This adapter covers data-oriented inventory, currency, pile/container, merchant,
loot and vault workflows. It does not claim to expose every upstream method:

| Upstream surface | Treatment |
|---|---|
| `setCurrencies`, other global setters, `addSystemIntegration` | Configure the actual game system in Item Piles; not world-global MCP configuration tools |
| `registerItemPileType` | Extension API; no runtime code/flags registration from MCP arguments |
| `requestTrade`, `spectateTrade`, `giveItem` | Interactive player dialogs, not headless data transactions |
| `renderItemPileInterface`, `unrenderItemPileInterface`, `showItemPileConfig`, `updateTokenHud`, `rattleItemPile` | UI/effect operations are not exposed |
| `toggleItemPileClosed`, `toggleItemPileLocked` | Replaced by explicit state-setting actions |
| `getPaymentDataFromString` | Deprecated alias; use `get_payment_data` |
| `getCurrenciesFromString`, `getStringFromCurrencies` | No free-form formula/parser tool; structured currency input is normalized locally |
| `findSimilarItem` | Internal matching remains Item Piles' responsibility; mutating tool inputs use exact IDs |
| `isItemPileBanker`, `isItemPileAuctioneer` | Optional `item_piles_bankers` and `item_piles_auctioneer` extension checks and workflows are outside this adapter's scope |
| Private helper APIs, including vault access | Never invoked |

## Compatibility and verification policy

New operations are gated by the exact inspected Item Piles version, supported
Foundry generation, active dependencies and the specific public methods they use.
The original `get_items` tool retains capability-based discovery on older versions.
The package's exact-version filter arrays remain empty so the old read operation
can still load; operation probes enforce the new boundary.

Local tests exercise the real generated JavaScript with controlled Foundry/API
fixtures, JSON Schema contracts, real Python dispatch and error propagation. They
cannot establish compatibility with a live game system, installed Item Piles
configuration, custom macros or a real relay. Record a tested Foundry/module/system
combination only after the smoke procedure in the README has been performed.
