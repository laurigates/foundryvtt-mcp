import assert from 'node:assert/strict';
import test from 'node:test';
import { fixture, plain, runtime } from './helpers.mjs';

test('new operations require the inspected version and a known supported Foundry generation', () => {
  const world = fixture();
  world.game.modules.get('item-piles').version = '3.3.5';
  assert.throws(() => runtime(world), /3\.3\.4/);
  world.game.modules.get('item-piles').version = '3.3.4';
  world.game.release.generation = 14;
  assert.throws(() => runtime(world), /generation 13/);
  delete world.game.release;
  assert.throws(() => runtime(world), /generation 13/);
  world.game.version = '13.350';
  assert.doesNotThrow(() => runtime(world));
});

test('legacy inventory remains capability-based on older installations', () => {
  const world = fixture();
  world.game.modules.get('item-piles').version = '2.8.0';
  world.game.release.generation = 12;
  world.game.modules.delete('socketlib');
  assert.doesNotThrow(() => runtime(world, { legacy: true, requiredMethods: ['getItemQuantity'] }));
});

test('dependencies, API methods, and GM rights are checked before a mutation', () => {
  const world = fixture();
  world.game.modules.get('socketlib').active = false;
  assert.throws(() => runtime(world), /socketlib/);
  world.game.modules.get('socketlib').active = true;
  assert.throws(() => runtime(world, { requiredMethods: ['addItems'] }), /addItems/);
  world.game.user.isGM = false;
  assert.throws(() => runtime(world, { readOnly: false }), { code: 'item_piles_permission_denied' });
});

test('document resolution checks type, permission, and Token Actor identity', async () => {
  const world = fixture();
  const api = runtime(world);
  assert.equal(await api.actor(world.token.uuid), world.seller);
  assert.equal(await api.item(world.item.uuid), world.item);
  await assert.rejects(api.token(world.seller.uuid), /Token/);
  await assert.rejects(api.actor('Actor.missing'), /resolve/);
  world.game.user.isGM = false;
  world.seller.testUserPermission = () => false;
  await assert.rejects(api.actor(world.seller.uuid), { code: 'item_piles_permission_denied' });
});

test('same UUID is resolved only in the current runtime', async () => {
  const first = fixture();
  const second = fixture();
  second.seller.name = 'Different world';
  assert.equal((await runtime(first).actor(first.seller.uuid)).name, 'seller');
  assert.equal((await runtime(second).actor(first.seller.uuid)).name, 'Different world');
});

test('currency amounts become canonical literal strings without re-evaluated formulas', () => {
  const api = runtime(fixture());
  assert.equal(api.currencyString([{ abbreviation: '{#}GP', quantity: 5 }, { abbreviation: 'sp', quantity: 0.00000001 }]), '5gp 0.00000001sp');
  assert.equal(api.currencyString([{ abbreviation: 'gp', quantity: 0 }], { allowZero: true }), '0gp');
  for (const quantity of [0, -1, Infinity, NaN, '1d6']) assert.throws(() => api.currencyString([{ abbreviation: 'gp', quantity }]));
  assert.throws(() => api.currencyString([{ abbreviation: 'gp', quantity: 1 }, { abbreviation: 'GP', quantity: 2 }]), /Duplicate/);
  assert.throws(() => api.currencyString([{ abbreviation: 'gold', quantity: 1 }]), /Unknown/);
});

test('currency safeguards reject secondary transfer, item-backed setting, and parser metacharacters', () => {
  const world = fixture();
  const api = runtime(world);
  assert.throws(() => api.currencyString([{ abbreviation: 'favor', quantity: 1 }], { allowSecondary: false }), /secondary/);
  world.api.CURRENCIES.push({ abbreviation: '{#}gem', type: 'item', exchangeRate: 1 });
  assert.throws(() => api.currencyString([{ abbreviation: 'gem', quantity: 1 }], { allowItem: false }), /item-backed/);
  world.api.CURRENCIES.push({ abbreviation: '{#}g.p.', type: 'attribute', exchangeRate: 1 });
  assert.throws(() => api.currencyString([{ abbreviation: 'gp', quantity: 1 }]), /literal parser/);
});

test('item selections reject overdraw and duplicates before upstream execution', () => {
  const world = fixture();
  const api = runtime(world);
  assert.deepEqual(plain(api.itemSelections(world.seller, [{ item_id: 'potion', quantity: 2 }])), [{ _id: 'potion', quantity: 2 }]);
  assert.throws(() => api.itemSelections(world.seller, [{ item_id: 'potion', quantity: 5 }]), /stock/);
  assert.throws(() => api.itemSelections(world.seller, [{ item_id: 'potion', quantity: 1 }, { item_id: 'potion', quantity: 1 }]), /unique/);
  assert.throws(() => api.itemSelections(world.seller, [{ item_id: 'Potion', quantity: 1 }]), /does not contain/);
});

test('numeric currency prefixes cannot be mistaken for part of an amount', () => {
  const world = fixture();
  world.api.CURRENCIES = [{ abbreviation: '{#}1', type: 'attribute', exchangeRate: 1 }];
  assert.throws(() => runtime(world).currencyString([{ abbreviation: '1', quantity: 12 }]), /cannot start with a number/);
  world.api.CURRENCIES[0].abbreviation = '{#}1gp';
  assert.throws(() => runtime(world).currencyString([{ abbreviation: '1gp', quantity: 12 }]), /cannot start with a number/);
});

test('item templates are cloned and configured quantity paths are respected', async () => {
  const world = fixture();
  const api = runtime(world);
  const [entry] = await api.itemsFromRefs([{ item_uuid: world.item.uuid, quantity: 2 }]);
  entry.item.name = 'Copy';
  assert.equal(world.item.name, 'Potion');
  world.api.ITEM_QUANTITY_ATTRIBUTE = 'system.stack.count';
  const data = api.itemDataWithQuantity(entry.item, 7);
  assert.equal(data.system.stack.count, 7);
  assert.equal(world.item.system.stack, undefined);
  await assert.rejects(api.itemsFromRefs([{ item_uuid: world.item.uuid, quantity: 0 }]), /positive/);
});

test('attribute input is restricted to safe numeric system paths while output preserves custom currency paths', () => {
  const api = runtime(fixture());
  assert.deepEqual(plain(api.attributes({ 'system.hp.value': -2 })), { 'system.hp.value': -2 });
  assert.throws(() => api.attributes({ 'ownership.default': 3 }), /system path/);
  assert.throws(() => api.attributes({ 'system.__proto__.value': 3 }), /system path/);
  assert.throws(() => api.attributes({ 'system.hp.value': NaN }), /finite/);
  assert.deepEqual(plain(api.attributes({ 'flags.custom.coins': 3 }, { input: false })), { 'flags.custom.coins': 3 });
});

test('DTO conversion replaces Documents, contains non-finite values, and rejects cycles', () => {
  const world = fixture();
  const api = runtime(world);
  assert.deepEqual(plain(api.json({ item: world.item, unlimited: Infinity })), {
    item: { documentName: 'Item', id: 'potion', uuid: world.item.uuid, name: 'Potion', type: 'consumable' }, unlimited: null,
  });
  const cycle = {}; cycle.self = cycle;
  assert.throws(() => api.json(cycle), /circular/);
  assert.throws(() => api.assertData(JSON.parse('{"system.__proto__.x":1}')), /Unsafe/);
  assert.throws(() => api.assertData({ callback() {} }), /JSON data/);
});

test('false, exceptions, and malformed post-send results remain uncertain and are never retried', async () => {
  const api = runtime(fixture(), { readOnly: false });
  for (const action of [() => false, () => undefined, () => { throw new Error('after commit'); }, () => api.itemDeltas({ invalid: true })]) {
    let calls = 0;
    await assert.rejects(api.write(() => { calls++; return action(); }), { code: 'outcome_unknown' });
    assert.equal(calls, 1);
  }
  assert.equal(await api.write(() => undefined, { allowUndefined: true }), undefined);
  assert.deepEqual(await api.write(() => []), []);
});
