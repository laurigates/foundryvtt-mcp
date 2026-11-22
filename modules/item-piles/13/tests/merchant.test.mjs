import assert from 'node:assert/strict';
import test from 'node:test';
import { operations } from '../src/merchant.mjs';
import { execute, fixture, plain } from './helpers.mjs';

const op = (id) => operations.find((entry) => entry.id === id);
const quote = (maxQuantity = 4) => ({ free: false, primary: true, quantity: 1, baseCost: 2, totalCost: 2,
  basePriceString: '2gp', priceString: '2gp', maxQuantity, basePrices: [], prices: [] });

test('inspection normalizes non-boolean invalid filters and uses module-defined costs and quantities', async () => {
  const world = fixture({ getCostOfItem: () => 7, canItemStack: () => true, isItemInvalid: () => 'excluded-type' });
  const result = plain(await execute(op('inspect_item'), { item_uuid: world.item.uuid }, world));
  assert.equal(result.invalid, true);
  assert.equal(result.invalid_reason, 'excluded-type');
  assert.equal(result.base_cost, 7);
  assert.equal(result.item.quantity, 4);
});

test('category output is plain localized text and rejects unexpected values', async () => {
  const world = fixture({ getItemCategories: () => ({ consumable: 'Consumables', potion: 'Potions' }) });
  assert.deepEqual(plain(await execute(op('get_item_categories'), {}, world)), { consumable: 'Consumables', potion: 'Potions' });
  world.api.getItemCategories = () => ({ invalid: {} });
  await assert.rejects(execute(op('get_item_categories'), {}, world), /categories/);
});

test('price quotes use actual Actor Documents and represent unlimited affordability explicitly', async () => {
  const world = fixture();
  let received;
  world.api.getPricesForItem = (item, options) => { received = { item, options }; return [quote(Infinity)]; };
  const result = plain(await execute(op('get_item_prices'), { item_uuid: world.item.uuid, buyer_uuid: world.buyer.uuid, quantity: 3 }, world));
  assert.equal(received.item, world.item);
  assert.equal(received.options.seller, world.seller);
  assert.equal(received.options.buyer, world.buyer);
  assert.equal(received.options.quantity, 3);
  assert.equal(result.affordability_checked, true);
  assert.equal(result.prices[0].max_quantity, null);
  assert.equal(result.prices[0].unlimited, true);
  assert.doesNotThrow(() => JSON.stringify(result));
});

test('quotes without a buyer do not report the upstream placeholder maxQuantity as checked affordability', async () => {
  const world = fixture({ getPricesForItem: () => [quote(0)] });
  const result = await execute(op('get_item_prices'), { item_uuid: world.item.uuid }, world);
  assert.equal(result.affordability_checked, false);
  assert.equal(result.prices[0].max_quantity, null);
  world.item.parent = null;
  await assert.rejects(execute(op('get_item_prices'), { item_uuid: world.item.uuid }, world), /seller_uuid/);
});

test('quotes distinguish purchase count from configured item units and preserve empty-path fallback', async () => {
  const world = fixture({ QUANTITY_FOR_PRICE_ATTRIBUTE: 'system.unitsPerPrice', getPricesForItem: () => [quote(20)] });
  world.item.system.unitsPerPrice = 5;
  const result = plain(await execute(op('get_item_prices'), { item_uuid: world.item.uuid, quantity: 2 }, world));
  assert.equal(result.units_per_purchase, 5);
  assert.equal(result.requested_units, 10);
  for (const path of ['', undefined, null, false, 'system.missing']) {
    world.api.QUANTITY_FOR_PRICE_ATTRIBUTE = path;
    const fallback = await execute(op('get_item_prices'), { item_uuid: world.item.uuid, quantity: 2 }, world);
    assert.equal(fallback.units_per_purchase, 1);
    assert.equal(fallback.requested_units, 2);
  }
});

test('quotes reject zero-unit, truncated and malformed unit conversions before requesting a price', async () => {
  let quotes = 0;
  const world = fixture({ QUANTITY_FOR_PRICE_ATTRIBUTE: 'system.unitsPerPrice', getPricesForItem: () => { quotes++; return [quote(20)]; } });
  for (const units of [0, -1, Infinity, NaN, '5', {}, 0.5]) {
    world.item.system.unitsPerPrice = units;
    await assert.rejects(execute(op('get_item_prices'), { item_uuid: world.item.uuid, quantity: 1 }, world));
  }
  world.item.system.unitsPerPrice = 1;
  await assert.rejects(execute(op('get_item_prices'), { item_uuid: world.item.uuid, quantity: 0.5 }, world), /units|integer/);
  world.item.system.unitsPerPrice = Number.MAX_SAFE_INTEGER;
  await assert.rejects(execute(op('get_item_prices'), { item_uuid: world.item.uuid, quantity: 2 }, world), /units|integer/);
  assert.equal(quotes, 0);
});

test('merchant modifiers resolve the optional actor and verify merchant type', async () => {
  const world = fixture({ isItemPileMerchant: () => true });
  let options;
  world.api.getMerchantPriceModifiers = (merchant, value) => { assert.equal(merchant, world.seller); options = value; return { buyPriceModifier: 1.2, sellPriceModifier: 0.4 }; };
  assert.deepEqual(plain(await execute(op('get_merchant_modifiers'), { merchant_uuid: world.seller.uuid, actor_uuid: world.buyer.uuid, absolute: true }, world)),
    { buyPriceModifier: 1.2, sellPriceModifier: 0.4 });
  assert.equal(options.actor, world.buyer);
  assert.equal(options.absolute, true);
  world.api.isItemPileMerchant = () => false;
  await assert.rejects(execute(op('get_merchant_modifiers'), { merchant_uuid: world.seller.uuid }, world), /merchant/);
});

test('relative merchant modifier updates pass both amounts and verify observed values even without an upstream return', async () => {
  const flags = { buyPriceModifier: 1, sellPriceModifier: 0.5, actorPriceModifiers: [] };
  const world = fixture({ isItemPileMerchant: () => true, getActorFlagData: () => flags });
  let count = 0;
  world.api.updateMerchantPriceModifiers = (merchant, entries) => {
    count++;
    assert.deepEqual(plain(entries), [{ actorUuid: world.buyer.uuid, buyPriceModifier: -0.1, sellPriceModifier: 0.1, relative: true, override: true }]);
    flags.actorPriceModifiers = [{ actorUuid: world.buyer.uuid, buyPriceModifier: 0.9, sellPriceModifier: 0.6, override: true }];
  };
  const result = await execute(op('update_merchant_modifiers'), { merchant_uuid: world.seller.uuid, modifiers: [
    { actor_uuid: world.buyer.uuid, buy_price_modifier: -0.1, sell_price_modifier: 0.1, relative: true, override: true },
  ] }, world);
  assert.equal(result.modifiers[0].buy_price_modifier, 0.9);
  assert.equal(count, 1);
});

test('unobserved modifier updates are uncertain and never repeated', async () => {
  let calls = 0;
  const world = fixture({ isItemPileMerchant: () => true, getActorFlagData: () => ({}), updateMerchantPriceModifiers: () => { calls++; } });
  await assert.rejects(execute(op('update_merchant_modifiers'), { merchant_uuid: world.seller.uuid, modifiers: [
    { actor_uuid: world.buyer.uuid, buy_price_modifier: 1, sell_price_modifier: 0.5 },
  ] }, world), { code: 'outcome_unknown' });
  assert.equal(calls, 1);
});

function tradeFixture() {
  const world = fixture({ getPricesForItem: () => [quote(4)], getActorFlagData: () => ({}), isItemPileMerchant: () => false });
  const calls = [];
  world.api.tradeItems = (seller, buyer, items, options) => {
    calls.push({ seller, buyer, items, options });
    return { itemDeltas: [{ item: world.item, quantity: 2 }], attributeDeltas: { 'system.currency.gp': -4 }, itemPrices: { canBuy: true } };
  };
  const args = { seller_uuid: world.seller.uuid, buyer_uuid: world.buyer.uuid, item_id: world.item.id, quantity: 2, payment_index: 0, interaction_id: 'audit-only' };
  return { world, calls, args };
}

test('trade sends one exact item line once and returns buyer-side transaction deltas', async () => {
  const { world, calls, args } = tradeFixture();
  const result = plain(await execute(op('trade_items'), args, world));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].seller, world.seller);
  assert.equal(calls[0].buyer, world.buyer);
  assert.deepEqual(plain(calls[0].items), [{ item: 'potion', quantity: 2, paymentIndex: 0 }]);
  assert.deepEqual(plain(calls[0].options), { interactionId: 'audit-only' });
  assert.equal(result.itemDeltas[0].quantity, 2);
  assert.equal(result.attributeDeltas['system.currency.gp'], -4);
});

test('trade rejects aliases for the same actor, item names, excessive stock, and unaffordable choices before dispatch', async () => {
  const { world, calls, args } = tradeFixture();
  for (const change of [{ buyer_uuid: world.token.uuid }, { item_id: 'Potion' }, { quantity: 5 }, { payment_index: 2 }, { quantity: 0 }]) {
    await assert.rejects(execute(op('trade_items'), { ...args, ...change }, world));
  }
  world.api.getPricesForItem = () => [quote(1)];
  await assert.rejects(execute(op('trade_items'), args, world), /afford/);
  assert.equal(calls.length, 0);
});

test('trade validates actual item units instead of purchase count, without truncating fractional units', async () => {
  // Upstream 85ab971 pile-utilities.js getPaymentData computes buyerReceive as
  // floor(quantity * QUANTITY_FOR_PRICE_ATTRIBUTE). Its stock check does not
  // protect a well-funded buyer, so validate actual units before tradeItems.
  const { world, calls, args } = tradeFixture();
  world.api.QUANTITY_FOR_PRICE_ATTRIBUTE = 'system.unitsPerPrice';
  world.item.system.unitsPerPrice = 10;
  world.item.system.quantity = 5;
  await assert.rejects(execute(op('trade_items'), { ...args, quantity: 1 }, world), /stock/);
  world.item.system.unitsPerPrice = 1;
  await assert.rejects(execute(op('trade_items'), { ...args, quantity: 0.5 }, world), /units|integer/);
  world.item.system.unitsPerPrice = 1.5;
  await assert.rejects(execute(op('trade_items'), { ...args, quantity: 1 }, world), /units|integer/);
  assert.equal(calls.length, 0);
  world.item.system.unitsPerPrice = 3;
  world.item.system.quantity = 6;
  world.api.getPricesForItem = () => [quote(2)];
  await execute(op('trade_items'), { ...args, quantity: 2 }, world);
  assert.equal(calls[0].items[0].quantity, 2, 'Affordability and public API arguments stay in purchase units');
  assert.equal(calls.length, 1);
  world.item.system.unitsPerPrice = 0.5;
  world.item.system.quantity = 1;
  await execute(op('trade_items'), { ...args, quantity: 2 }, world);
  assert.equal(calls.length, 2, 'A fractional factor is valid when the requested item units are integral');
});

test('trade allows configured infinite merchant stock but still checks payment affordability', async () => {
  const { world, calls, args } = tradeFixture();
  world.api.isItemPileMerchant = () => true;
  world.item.flags = { 'item-piles': { item: { infiniteQuantity: 'yes' } } };
  world.api.getPricesForItem = () => [quote(Infinity)];
  await execute(op('trade_items'), { ...args, quantity: 100 }, world);
  assert.equal(calls[0].items[0].quantity, 100);
  world.api.getPricesForItem = () => [quote(1)];
  await assert.rejects(execute(op('trade_items'), args, world), /afford/);
  assert.equal(calls.length, 1);
});

test('trade false and malformed replies produce outcome_unknown after only one invocation', async () => {
  for (const response of [false, { itemDeltas: [], attributeDeltas: {} },
    { itemDeltas: [], attributeDeltas: {}, itemPrices: [] },
    { itemDeltas: [], attributeDeltas: {}, itemPrices: { canBuy: false } }]) {
    const { world, args } = tradeFixture();
    let calls = 0;
    world.api.tradeItems = () => { calls++; return response; };
    await assert.rejects(execute(op('trade_items'), args, world), { code: 'outcome_unknown' });
    assert.equal(calls, 1);
  }
});

test('merchant refresh requires an explicit replacement policy and preserves false', async () => {
  const world = fixture({ isItemPileMerchant: () => true });
  let options;
  world.api.refreshMerchantInventory = (actor, value) => { options = value; return []; };
  await assert.rejects(execute(op('refresh_merchant_inventory'), { merchant_uuid: world.seller.uuid }, world), /explicitly/);
  assert.equal(options, undefined);
  await execute(op('refresh_merchant_inventory'), { merchant_uuid: world.seller.uuid, remove_existing_items: false }, world);
  assert.deepEqual(plain(options), { removeExistingActorItems: false });
});

test('roll-table calls keep side effects explicit and pass exact table UUID and Actor', async () => {
  const world = fixture();
  let call;
  world.api.rollItemTable = (table, options) => { call = { table, options }; return [{ item: world.item, quantity: 1 }]; };
  await execute(op('roll_item_table'), { table_uuid: world.table.uuid, actor_uuid: world.buyer.uuid, rolls: 2 }, world);
  assert.equal(call.table, world.table.uuid);
  assert.equal(call.options.targetActor, world.buyer);
  assert.equal(call.options.timesToRoll, 2);
  assert.equal(call.options.resetTable, false);
  assert.equal(call.options.normalizeTable, false);
  assert.equal(call.options.displayChat, false);
  assert.equal(call.options.removeExistingActorItems, false);
});

test('roll tables reject compendium resets and missing recipients before sending', async () => {
  let count = 0;
  const world = fixture({ rollItemTable: () => { count++; return []; } });
  const table = { ...world.table, uuid: 'Compendium.test.loot.RollTable.one' };
  world.documents.set(table.uuid, table);
  await assert.rejects(execute(op('roll_item_table'), { table_uuid: table.uuid, rolls: 1, reset_table: true }, world), /Compendium/);
  await assert.rejects(execute(op('roll_item_table'), { table_uuid: world.table.uuid, rolls: 1, remove_existing_items: true }, world), /actor_uuid/);
  world.game.user.isGM = false;
  await assert.rejects(execute(op('roll_item_table'), { table_uuid: world.table.uuid, rolls: 1 }, world), /GM/);
  assert.equal(count, 0);
});
