import assert from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { operations } from '../src/inventory.mjs';
import { createRuntime } from '../src/runtime.mjs';

const definitions = new Map(operations.map((operation) => [operation.id, operation]));
const plain = (value) => JSON.parse(JSON.stringify(value));

function fixture() {
  const calls = [];
  const item = (id, quantity, parent) => ({
    documentName: 'Item', id, uuid: parent ? `${parent.uuid}.Item.${id}` : `Item.${id}`,
    name: `Item ${id}`, type: 'equipment', system: { quantity }, parent,
    testUserPermission: () => true,
    toObject() { return { _id: this.id, name: this.name, type: this.type, system: { quantity: this.system.quantity } }; },
  });
  const actor = (id) => ({
    documentName: 'Actor', id, uuid: `Actor.${id}`, name: id,
    system: { currency: { gp: 8, sp: 5 } }, flags: { favor: { total: 3 } }, items: new Map(),
    testUserPermission: () => true,
  });
  const source = actor('source');
  const target = actor('target');
  const third = actor('third');
  const sword = item('sword', 5, source);
  source.items.set(sword.id, sword);
  const template = item('template', 99);
  const token = { documentName: 'Token', id: 'token', uuid: 'Scene.scene.Token.token', actor: source, testUserPermission: () => true };
  const documents = new Map([source, target, third, sword, template, token].map((entry) => [entry.uuid, entry]));
  const delta = [{ item: sword.toObject(), quantity: 2, type: 'item' }];
  const currencyResult = { itemDeltas: [], attributeDeltas: { 'system.currency.gp': 2, 'flags.favor.total': 1 } };
  const transferResult = { itemsTransferred: delta, attributesTransferred: { 'system.currency.gp': 2 } };
  const api = {
    ITEM_QUANTITY_ATTRIBUTE: 'system.quantity', ITEM_PRICE_ATTRIBUTE: 'system.price', CURRENCY_DECIMAL_DIGITS: 0.01,
    CURRENCIES: [
      { name: 'Gold', abbreviation: '{#}gp', type: 'attribute', exchangeRate: 1, primary: true, data: { path: 'system.currency.gp' } },
      { name: 'Silver', abbreviation: '{#}sp', type: 'attribute', exchangeRate: 0.1, data: { path: 'system.currency.sp' } },
      { name: 'Coins', abbreviation: '{#}coin', type: 'item', exchangeRate: 1, data: { uuid: template.uuid } },
    ],
    SECONDARY_CURRENCIES: [
      { name: 'Favor', abbreviation: '{#}favor', type: 'attribute', exchangeRate: 1, data: { path: 'flags.favor.total' } },
    ],
    getItemQuantity: (entry) => entry.system.quantity,
    getActorItems: (owner) => [...owner.items.values()],
    getActorCurrencies: (owner) => [
      { name: 'Gold', abbreviation: '{#}gp', type: 'attribute', quantity: owner.system.currency.gp,
        primary: true, exchangeRate: 1, id: 'system.currency.gp', path: 'system.currency.gp', data: { path: 'system.currency.gp' } },
      { name: 'Favor', abbreviation: '{#}favor', type: 'attribute', quantity: owner.flags.favor.total,
        secondary: true, id: 'flags.favor.total', data: { path: 'flags.favor.total' } },
    ],
    getPrimaryCurrency: () => api.CURRENCIES[0],
    getCurrenciesAbbreviations: () => ['gp', 'sp', 'coin', 'favor'],
    calculateCurrencies: () => '1gp',
    getPaymentData: () => ({ canBuy: true, finalPrices: [], maxQuantity: Infinity, item: sword }),
    isValidItemPile: () => true,
  };
  for (const name of ['addItems', 'removeItems', 'transferItems', 'transferAllItems']) api[name] = () => delta;
  for (const name of ['setAttributes', 'addAttributes', 'removeAttributes', 'transferAttributes']) api[name] = () => currencyResult.attributeDeltas;
  for (const name of ['updateCurrencies', 'addCurrencies', 'removeCurrencies', 'transferCurrencies', 'transferAllCurrencies']) api[name] = () => currencyResult;
  api.transferEverything = () => transferResult;
  api.combineItemPiles = (target, sources) => {
    for (const source of sources) {
      source.items.clear();
      source.system.currency.gp = 0;
      source.system.currency.sp = 0;
      source.flags.favor.total = 0;
    }
    return { ...transferResult, deletedTokens: { scene: ['token'] } };
  };
  for (const [name, method] of Object.entries(api)) {
    if (typeof method !== 'function') continue;
    api[name] = (...args) => { calls.push({ name, args }); return method(...args); };
  }
  const context = {
    game: {
      ready: true, release: { generation: 14 }, user: { id: 'gm', isGM: true },
      modules: new Map([
        ['item-piles', { active: true, version: '3.3.4' }],
        ['socketlib', { active: true }], ['lib-wrapper', { active: true }],
      ]),
      itempiles: { API: api },
    },
    fromUuid: async (uuid) => documents.get(uuid),
  };
  return { context, api, source, target, third, sword, template, token, documents, calls, delta, currencyResult };
}

async function invoke(fixture, id, args) {
  const operation = definitions.get(id);
  assert.ok(operation, `Missing operation ${id}`);
  // This is the same serialization boundary as generated runtime bindings:
  // neither the factory nor the handler can accidentally capture module state.
  return runInNewContext(`(async () => {
    const runtime = (${createRuntime.toString()})(${JSON.stringify({
      readOnly: operation.readOnly, requiredMethods: operation.requiredMethods, legacy: id === 'get_items',
    })});
    return (${operation.handler.toString()})(args, runtime);
  })()`, { ...fixture.context, args });
}

const mutations = new Set([
  'addItems', 'removeItems', 'transferItems', 'transferAllItems', 'setAttributes', 'addAttributes',
  'removeAttributes', 'transferAttributes', 'updateCurrencies', 'addCurrencies', 'removeCurrencies',
  'transferCurrencies', 'transferAllCurrencies', 'transferEverything', 'combineItemPiles',
]);
const writes = (fixture) => fixture.calls.filter((call) => mutations.has(call.name));

test('inventory registry preserves the exact legacy input and item projection', async () => {
  assert.equal(operations.length, 21);
  assert.equal(new Set(operations.map((operation) => operation.id)).size, 21);
  const operation = definitions.get('get_items');
  assert.deepEqual(operation.inputSchema, {
    type: 'object', properties: { actor_uuid: {
      type: 'string', minLength: 1, pattern: '^\\S+$', description: 'Actor UUID in the selected target world.',
    } }, required: ['actor_uuid'], additionalProperties: false,
  });
  const f = fixture();
  f.context.game.modules.get('item-piles').version = 'older-version';
  f.context.game.modules.delete('socketlib');
  f.context.game.release.generation = 12;
  const result = await invoke(f, 'get_items', { actor_uuid: f.source.uuid });
  assert.deepEqual(plain(result), [{ id: 'sword', uuid: f.sword.uuid, name: 'Item sword', type: 'equipment', quantity: 5 }]);
  await assert.rejects(invoke(f, 'get_items', { actor_uuid: f.token.uuid }), /Actor/);
  assert.deepEqual(writes(f), []);
});

test('currency reads project documents without leaking live state and preserve absent exchange rates', async () => {
  const f = fixture();
  const result = await invoke(f, 'get_currencies', { actor_uuid: f.source.uuid, get_all: true, secondary: false });
  assert.deepEqual(plain(result), [
    { id: 'system.currency.gp', name: 'Gold', abbreviation: '{#}gp', type: 'attribute', quantity: 8,
      primary: true, secondary: false, exchangeRate: 1, path: 'system.currency.gp', item: null },
    { id: 'flags.favor.total', name: 'Favor', abbreviation: '{#}favor', type: 'attribute', quantity: 3,
      primary: false, secondary: true, exchangeRate: null, path: 'flags.favor.total', item: null },
  ]);
  const call = f.calls.find((entry) => entry.name === 'getActorCurrencies');
  assert.equal(call.args[0], f.source);
  assert.deepEqual(plain(call.args[1]), { getAll: true, secondary: false });
  result[0].quantity = 200;
  assert.equal(f.source.system.currency.gp, 8);
  const config = plain(await invoke(f, 'get_currency_config', { actor_uuid: f.source.uuid }));
  assert.deepEqual(config.currencies, f.api.CURRENCIES);
  assert.equal(config.primaryCurrency.primary, true);
  assert.equal(config.quantityAttribute, 'system.quantity');
  assert.deepEqual(config.abbreviations, ['gp', 'sp', 'coin', 'favor']);
});

test('quotes and calculations accept structured amounts and preserve upstream subtraction default', async () => {
  const f = fixture();
  const amount = [{ abbreviation: 'gp', quantity: 5 }];
  assert.deepEqual(plain(await invoke(f, 'calculate_currencies', { currencies: amount, other_currencies: [{ abbreviation: 'sp', quantity: 3 }] })), { currencies: '1gp' });
  let call = f.calls.find((entry) => entry.name === 'calculateCurrencies');
  assert.deepEqual(plain(call.args), ['5gp', '3sp', true]);
  await invoke(f, 'calculate_currencies', { currencies: amount, multiplier: 0 });
  call = f.calls.filter((entry) => entry.name === 'calculateCurrencies').at(-1);
  assert.deepEqual(plain(call.args), ['5gp', 0, true]);
  await assert.rejects(invoke(f, 'calculate_currencies', { currencies: amount, multiplier: 2, other_currencies: amount }), /exactly one/);
  const before = f.calls.filter((entry) => entry.name === 'calculateCurrencies').length;
  await assert.rejects(invoke(f, 'calculate_currencies', { currencies: [{ abbreviation: 'favor', quantity: 2 }], multiplier: 2 }), /secondary/);
  await assert.rejects(invoke(f, 'calculate_currencies', { currencies: amount, other_currencies: [{ abbreviation: 'favor', quantity: 1 }] }), /secondary/);
  assert.equal(f.calls.filter((entry) => entry.name === 'calculateCurrencies').length, before);
  const quote = plain(await invoke(f, 'get_payment_data', { currencies: amount, actor_uuid: f.source.uuid, quantity: 2 }));
  assert.equal(quote.maxQuantity, null);
  assert.equal(quote.item.uuid, f.sword.uuid);
  call = f.calls.find((entry) => entry.name === 'getPaymentData');
  assert.equal(call.args[0], '5gp');
  assert.equal(call.args[1].target, f.source);
  assert.equal(call.args[1].quantity, 2);
});

test('item writes use resolved documents, exact IDs and one API invocation', async () => {
  const f = fixture();
  const added = plain(await invoke(f, 'add_items', { actor_uuid: f.target.uuid,
    items: [{ item_uuid: f.template.uuid, quantity: 2 }], remove_existing_items: true, interaction_id: 'request-1' }));
  let call = writes(f)[0];
  assert.equal(call.name, 'addItems');
  assert.equal(call.args[0], f.target);
  assert.deepEqual(plain(call.args[1]), [{ item: f.template.toObject(), quantity: 2 }]);
  assert.deepEqual(plain(call.args[2]), { removeExistingActorItems: true, skipVaultLogging: false, interactionId: 'request-1' });
  assert.deepEqual(added, [{ item: { id: 'sword', uuid: '', name: 'Item sword', type: 'equipment', quantity: 5 }, quantity: 2, type: 'item' }]);
  await invoke(f, 'transfer_items', { source_uuid: f.token.uuid, target_uuid: f.target.uuid,
    items: [{ item_id: 'sword', quantity: 2 }], skip_vault_logging: true });
  call = writes(f)[1];
  assert.equal(call.args[0], f.source);
  assert.equal(call.args[1], f.target);
  assert.deepEqual(plain(call.args[2]), [{ _id: 'sword', quantity: 2 }]);
  assert.deepEqual(plain(call.args[3]), { skipVaultLogging: true, interactionId: false });
  assert.equal(writes(f).length, 2);
});

test('item validation rejects overdrafts, duplicates and same-Actor aliases before mutation', async () => {
  const f = fixture();
  const base = { source_uuid: f.source.uuid, target_uuid: f.target.uuid };
  for (const items of [
    [{ item_id: 'sword', quantity: 6 }], [{ item_id: 'missing', quantity: 1 }],
    [{ item_id: 'sword', quantity: 0 }], [{ item_id: 'sword', quantity: NaN }],
    [{ item_id: 'sword', quantity: 1 }, { item_id: 'sword', quantity: 1 }],
  ]) await assert.rejects(invoke(f, 'transfer_items', { ...base, items }));
  await assert.rejects(invoke(f, 'transfer_items', { ...base, target_uuid: f.token.uuid, items: [{ item_id: 'sword', quantity: 1 }] }), /different/);
  await assert.rejects(invoke(f, 'add_items', { actor_uuid: f.target.uuid,
    items: [{ item_uuid: f.template.uuid, quantity: 1 }, { item_uuid: f.template.uuid, quantity: 1 }] }), /Duplicate/);
  assert.deepEqual(writes(f), []);
});

test('remaining inventory APIs receive their public argument shape and preserve mutation deltas', async () => {
  const cases = [
    ['remove_items', 'removeItems', { actor_uuid: 'Actor.source', items: [{ item_id: 'sword', quantity: 2 }] },
      (result, call) => { assert.equal(result[0].quantity, 2); assert.deepEqual(plain(call.args[1]), [{ _id: 'sword', quantity: 2 }]); }],
    ['transfer_all_items', 'transferAllItems', { source_uuid: 'Actor.source', target_uuid: 'Actor.target', item_filters: [{ path: 'type', filter: 'spell' }] },
      (result, call) => { assert.equal(result[0].item.id, 'sword'); assert.deepEqual(plain(call.args[2]), { itemFilters: [{ path: 'type', filter: 'spell' }], skipVaultLogging: false, interactionId: false }); }],
    ['add_attributes', 'addAttributes', { actor_uuid: 'Actor.source', attributes: { 'system.currency.gp': 2 } },
      (result, call) => { assert.equal(result['system.currency.gp'], 2); assert.deepEqual(plain(call.args[1]), { 'system.currency.gp': 2 }); }],
    ['add_currencies', 'addCurrencies', { actor_uuid: 'Actor.source', currencies: [{ abbreviation: 'gp', quantity: 2 }] },
      (result, call) => { assert.equal(result.attributeDeltas['system.currency.gp'], 2); assert.equal(call.args[1], '2gp'); }],
    ['remove_currencies', 'removeCurrencies', { actor_uuid: 'Actor.source', currencies: [{ abbreviation: 'gp', quantity: 2 }], change: false },
      (result, call) => { assert.equal(result.attributeDeltas['system.currency.gp'], 2); assert.deepEqual(plain(call.args[2]), { change: false, interactionId: false }); }],
    ['transfer_all_currencies', 'transferAllCurrencies', { source_uuid: 'Actor.source', target_uuid: 'Actor.target', interaction_id: 'all' },
      (result, call) => { assert.equal(result.attributeDeltas['flags.favor.total'], 1); assert.deepEqual(plain(call.args[2]), { interactionId: 'all' }); }],
  ];
  for (const [id, method, args, verify] of cases) {
    const f = fixture();
    const result = await invoke(f, id, args);
    assert.equal(writes(f).length, 1, id);
    const call = writes(f)[0];
    assert.equal(call.name, method, id);
    assert.equal(call.args[0], f.source, id);
    verify(result, call);
    let attempts = 0;
    f.api[method] = () => { attempts++; return false; };
    await assert.rejects(invoke(f, id, args), (error) => error.code === 'outcome_unknown', id);
    assert.equal(attempts, 1, `${id} must not retry`);
  }
});

test('explicit attribute mutations validate safe numeric paths and available stock', async () => {
  const f = fixture();
  const result = plain(await invoke(f, 'transfer_attributes', { source_uuid: f.source.uuid, target_uuid: f.target.uuid,
    attributes: { 'system.currency.gp': 2 }, skip_vault_logging: true }));
  assert.equal(result['flags.favor.total'], 1, 'Custom currency output paths must remain readable');
  assert.deepEqual(plain(writes(f)[0].args[2]), { 'system.currency.gp': 2 });
  const before = writes(f).length;
  for (const attributes of [
    { 'system.currency.gp': 9 }, { 'system.currency.gp': -2 }, { 'system.currency.gp': 0 },
    { 'flags.favor.total': 1 }, { 'system.constructor.value': 1 }, { 'system.unknown': 1 },
  ]) await assert.rejects(invoke(f, 'remove_attributes', { actor_uuid: f.source.uuid, attributes }));
  assert.equal(writes(f).length, before);
  await invoke(f, 'set_attributes', { actor_uuid: f.source.uuid, attributes: { 'system.currency.gp': 0 } });
  assert.deepEqual(plain(writes(f).at(-1).args[1]), { 'system.currency.gp': 0 });
});

test('transfer_all_attributes builds a numeric public transfer and skips empty or unsupported targets', async () => {
  const f = fixture();
  f.api.transferAllAttributes = () => { throw new Error('Broken upstream method must never be called'); };
  await invoke(f, 'transfer_all_attributes', { source_uuid: f.source.uuid, target_uuid: f.target.uuid });
  assert.equal(writes(f).length, 1);
  assert.equal(writes(f)[0].name, 'transferAttributes');
  assert.deepEqual(plain(writes(f)[0].args[2]), { 'system.currency.gp': 8, 'flags.favor.total': 3 });
  delete f.target.system.currency.gp;
  delete f.target.flags.favor.total;
  assert.deepEqual(plain(await invoke(f, 'transfer_all_attributes', { source_uuid: f.source.uuid, target_uuid: f.target.uuid })), {});
  assert.equal(writes(f).length, 1);
});

test('currency writes canonicalize amounts, retain explicit zero and reject unsupported upstream cases before dispatch', async () => {
  const f = fixture();
  const result = plain(await invoke(f, 'update_currencies', { actor_uuid: f.source.uuid,
    currencies: [{ abbreviation: '{#}gp', quantity: 0 }] }));
  assert.equal(writes(f)[0].args[1], '0gp');
  assert.deepEqual(result, f.currencyResult);
  await invoke(f, 'transfer_currencies', { source_uuid: f.source.uuid, target_uuid: f.target.uuid,
    currencies: [{ abbreviation: 'gp', quantity: 1e-7 }], change: false, interaction_id: 'transfer-1' });
  assert.equal(writes(f)[1].args[2], '0.0000001gp');
  assert.deepEqual(plain(writes(f)[1].args[3]), { change: false, interactionId: 'transfer-1' });
  const before = writes(f).length;
  for (const currencies of [
    [{ abbreviation: 'gp', quantity: '1d6' }], [{ abbreviation: 'unknown', quantity: 1 }],
    [{ abbreviation: 'gp', quantity: Infinity }], [{ abbreviation: 'gp', quantity: 0 }],
    [{ abbreviation: 'gp', quantity: 1 }, { abbreviation: '{#}gp', quantity: 1 }],
  ]) await assert.rejects(invoke(f, 'add_currencies', { actor_uuid: f.source.uuid, currencies }));
  await assert.rejects(invoke(f, 'update_currencies', { actor_uuid: f.source.uuid, currencies: [{ abbreviation: 'coin', quantity: 3 }] }), /item-backed/);
  await assert.rejects(invoke(f, 'transfer_currencies', { source_uuid: f.source.uuid, target_uuid: f.target.uuid,
    currencies: [{ abbreviation: 'favor', quantity: 1 }] }), /secondary/);
  assert.equal(writes(f).length, before);
});

test('payment and removal never send secondary denominations to the unsafe 3.3.4 parser', async () => {
  // Upstream 85ab971: pile-utilities.js getPriceFromString adds secondary
  // quantities to overallCost; API.getPaymentData/removeCurrencies also pass
  // them as secondaryPrices. Guard this API boundary instead of vendoring the
  // upstream parser or treating a successful quote as evidence of a fair debit.
  for (const currencies of [
    [{ abbreviation: 'favor', quantity: 5 }],
    [{ abbreviation: 'gp', quantity: 1 }, { abbreviation: 'favor', quantity: 5 }],
  ]) {
    const f = fixture();
    let upstreamCalls = 0;
    f.api.getPaymentData = f.api.removeCurrencies = () => {
      upstreamCalls++;
      throw new Error('The unsafe secondary-price parser must not receive this request');
    };
    await assert.rejects(invoke(f, 'get_payment_data', { actor_uuid: f.source.uuid, currencies }), /secondary/);
    await assert.rejects(invoke(f, 'remove_currencies', { actor_uuid: f.source.uuid, currencies }), /secondary/);
    assert.equal(upstreamCalls, 0);
    assert.deepEqual(writes(f), []);
  }
});

test('complete transfers preserve delta shapes, validate distinct sources and normalize deleted tokens', async () => {
  const f = fixture();
  const moved = plain(await invoke(f, 'transfer_everything', { source_uuid: f.source.uuid, target_uuid: f.target.uuid }));
  assert.equal(moved.itemsTransferred[0].quantity, 2);
  assert.deepEqual(moved.attributesTransferred, { 'system.currency.gp': 2 });
  const combined = plain(await invoke(f, 'combine_piles', { target_uuid: f.target.uuid, source_uuids: [f.source.uuid, f.third.uuid] }));
  assert.deepEqual(combined.deletedTokens, { scene: ['token'] });
  assert.deepEqual(Array.from(writes(f).at(-1).args[1]), [f.source, f.third]);
  const before = writes(f).length;
  await assert.rejects(invoke(f, 'combine_piles', { target_uuid: f.target.uuid, source_uuids: [f.source.uuid, f.token.uuid] }), /Duplicate|different/);
  await assert.rejects(invoke(f, 'combine_piles', { target_uuid: f.target.uuid, source_uuids: [f.target.uuid] }), /different/);
  assert.equal(writes(f).length, before);
});

test('every inventory mutation is GM-only before any API call or UUID resolution', async () => {
  for (const operation of operations.filter((entry) => !entry.readOnly)) {
    const f = fixture();
    f.context.game.user.isGM = false;
    f.context.fromUuid = () => { throw new Error('Resolution must not start'); };
    await assert.rejects(invoke(f, operation.id, {}), (error) => error.code === 'item_piles_permission_denied');
    assert.deepEqual(f.calls, [], operation.id);
  }
});

test('combine_piles rejects apparent success when an upstream source commit left stock behind', async () => {
  const f = fixture();
  let invocations = 0;
  f.api.combineItemPiles = () => {
    invocations++;
    return { itemsTransferred: f.delta, attributesTransferred: {}, deletedTokens: {} };
  };
  await assert.rejects(invoke(f, 'combine_piles', { target_uuid: f.target.uuid, source_uuids: [f.source.uuid] }),
    (error) => error.code === 'outcome_unknown' && /still has positive/.test(error.message));
  assert.equal(invocations, 1);
  assert.equal(Object.hasOwn(definitions.get('combine_piles').inputSchema.properties, 'item_filters'), false);
  assert.equal(f.source.items.get('sword'), f.sword);
  f.source.items.clear();
  await assert.rejects(invoke(f, 'combine_piles', { target_uuid: f.target.uuid, source_uuids: [f.source.uuid] }),
    (error) => error.code === 'outcome_unknown' && /still has positive/.test(error.message));
  assert.equal(invocations, 2, 'Each explicit call is attempted once, including a currency-only residue');
});

test('ambiguous and malformed post-invocation results are outcome_unknown without retries', async () => {
  for (const outcome of [false, undefined, null, { malformed: true }, new Error('Remote hook failed after commit')]) {
    const f = fixture();
    let invocations = 0;
    f.api.transferItems = () => { invocations++; if (outcome instanceof Error) throw outcome; return outcome; };
    await assert.rejects(invoke(f, 'transfer_items', { source_uuid: f.source.uuid, target_uuid: f.target.uuid,
      items: [{ item_id: 'sword', quantity: 2 }] }), (error) => error.code === 'outcome_unknown' && /not retried/.test(error.message));
    assert.equal(invocations, 1);
  }
  const f = fixture();
  f.api.transferEverything = () => ({ itemsTransferred: [], attributesTransferred: 'not a map' });
  await assert.rejects(invoke(f, 'transfer_everything', { source_uuid: f.source.uuid, target_uuid: f.target.uuid }), (error) => error.code === 'outcome_unknown');
});
