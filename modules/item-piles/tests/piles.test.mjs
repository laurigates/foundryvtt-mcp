import assert from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { operations } from '../src/piles.mjs';
import { operations as inventoryOperations } from '../src/inventory.mjs';
import { createRuntime } from '../src/runtime.mjs';

const definitions = new Map(operations.map((operation) => [operation.id, operation]));
const plain = (value) => JSON.parse(JSON.stringify(value));
const merge = (target, patch) => {
  for (const [key, value] of Object.entries(patch)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) merge(target[key] ??= {}, value);
    else target[key] = plain(value);
  }
  return target;
};

function fixture(type = 'container') {
  const docs = new Map();
  const calls = [];
  const actor = (uuid, flags = {}) => {
    const value = { documentName: 'Actor', uuid, id: uuid.split('.').at(-1), name: 'Chest',
      pileData: { enabled: true, type, closed: true, locked: false, cols: 3, rows: 2,
        shareItemsEnabled: false, shareCurrenciesEnabled: true, splitAllEnabled: true, ...flags },
      prototypeToken: { actorLink: false }, testUserPermission: () => true };
    docs.set(uuid, value);
    return value;
  };
  const source = actor('Actor.source');
  const recipient = actor('Actor.recipient', { enabled: false });
  const scene = { documentName: 'Scene', uuid: 'Scene.scene', id: 'scene', tokens: new Map(), testUserPermission: () => true };
  docs.set(scene.uuid, scene);
  const token = (uuid, owner = source) => {
    const value = { documentName: 'Token', uuid, id: uuid.split('.').at(-1), actor: owner, parent: scene,
      name: 'Chest token', hidden: false, texture: { src: 'chest.webp', scaleX: 1, scaleY: 1 },
      testUserPermission: () => true,
      toObject() { return { name: this.name, hidden: this.hidden, texture: { ...this.texture } }; } };
    docs.set(uuid, value);
    scene.tokens.set(value.id, value);
    return value;
  };
  const sourceToken = token('Scene.scene.Token.source');
  const item = { documentName: 'Item', uuid: 'Item.item', id: 'item', name: 'Long spear', type: 'equipment',
    system: { quantity: 1 }, flags: { 'item-piles': { item: { x: 0, y: 0, width: 2, height: 1, flipped: false } } },
    testUserPermission: () => true,
    toObject() { return { _id: this.id, name: this.name, type: this.type, system: { ...this.system }, flags: plain(this.flags) }; } };
  docs.set(item.uuid, item);
  const flags = (value) => (value.actor ?? value).pileData;
  const record = (method, callback) => (...args) => { calls.push({ method, args }); return callback(...args); };
  const api = {
    ITEM_QUANTITY_ATTRIBUTE: 'system.quantity',
    canItemStack: () => true,
    getItemQuantity: (value) => value.system.quantity,
    getActorFlagData: (value) => plain(flags(value)),
    isValidItemPile: (value) => flags(value).enabled,
    isRegularItemPile: (value) => flags(value).enabled && flags(value).type === 'pile',
    isItemPileContainer: (value) => flags(value).enabled && flags(value).type === 'container',
    isItemPileLootable: (value) => flags(value).enabled && ['pile', 'container'].includes(flags(value).type),
    isItemPileMerchant: (value) => flags(value).enabled && flags(value).type === 'merchant',
    isItemPileVault: (value) => flags(value).enabled && flags(value).type === 'vault',
    isItemPileEmpty: () => false,
    isItemPileClosed: (value) => Boolean(flags(value).closed),
    isItemPileLocked: (value) => Boolean(flags(value).locked),
    createItemPile: record('createItemPile', (options) => {
      const created = options.createActor ? actor('Actor.created', { ...options.itemPileFlags, enabled: true }) : docs.get(options.actor);
      created.prototypeToken.actorLink = options.tokenOverrides.actorLink ?? created.prototypeToken.actorLink;
      const result = { actorUuid: created.uuid };
      if (options.position) {
        const owner = created.prototypeToken.actorLink ? created : actor('Scene.scene.Token.created.Actor.created', plain(created.pileData));
        const placed = token('Scene.scene.Token.created', owner);
        merge(owner.pileData, options.itemPileFlags);
        owner.pileData.enabled = true;
        merge(placed, options.tokenOverrides);
        result.tokenUuid = placed.uuid;
      }
      return result;
    }),
    turnTokensIntoItemPiles: record('turnTokensIntoItemPiles', (tokens, options) => {
      for (const target of tokens) { merge(flags(target), options.pileSettings); flags(target).enabled = true; merge(target, options.tokenSettings); }
      return tokens.map((value) => value.uuid);
    }),
    revertTokensFromItemPiles: record('revertTokensFromItemPiles', (tokens, options) => {
      for (const target of tokens) { flags(target).enabled = false; merge(target, options.tokenSettings); }
      return tokens.map((value) => value.uuid);
    }),
    updateItemPile: record('updateItemPile', (target, settings, options) => {
      merge(flags(target), settings);
      if (options.tokenSettings) merge(sourceToken, options.tokenSettings);
      return undefined;
    }),
    deleteItemPile: record('deleteItemPile', (target) => {
      docs.delete(target.uuid);
      scene.tokens.delete(target.id);
      return target;
    }),
    splitItemPileContents: record('splitItemPileContents', (_target, options) => ({
      pileDeltas: { itemDeltas: [], attributeDeltas: { 'system.gold': -2 } },
      actorDeltas: Object.fromEntries(options.targets.map((target) => [target.uuid, { itemDeltas: [], attributeDeltas: { 'system.gold': 2 } }])),
    })),
    getVaultGridData: () => ({ cols: 3, rows: 2, enabledCols: 3, enabledRows: 2, totalSpaces: 6, enabledSpaces: 6, freeSpaces: 5,
      items: [{ item, itemFlagData: plain(item.flags['item-piles'].item), quantity: 1 }],
      grid: [['Long spear', null], ['Long spear', null], [null, null]],
      freeCells: [{ x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 0 }, { x: 2, y: 1 }] }),
    canItemFitInVault: () => ({ x: 2, y: 0, flipped: true }),
    fitItemsIntoVault: record('fitItemsIntoVault', (items) => ({ updates: items.map((entry) => {
      const result = plain(entry);
      result.flags['item-piles'].item = { ...result.flags['item-piles'].item, x: 1, y: 0, flipped: false };
      return result;
    }), deletions: [] })),
  };
  for (const [action, state] of Object.entries({ open: { closed: false, locked: false }, close: { closed: true }, lock: { closed: true, locked: true }, unlock: { locked: false } })) {
    api[`${action}ItemPile`] = record(`${action}ItemPile`, (target) => { Object.assign(flags(target), state); });
  }
  const context = { game: { ready: true, release: { generation: 13 }, user: { isGM: true },
    modules: new Map([['item-piles', { active: true, version: '3.3.4' }], ['socketlib', { active: true }], ['lib-wrapper', { active: true }]]),
    itempiles: { API: api } }, fromUuid: async (uuid) => docs.get(uuid) ?? null };
  const run = async (id, args) => {
    const operation = definitions.get(id) ?? inventoryOperations.find((value) => value.id === id);
    return plain(await runInNewContext(`(async () => {
      const runtime = (${createRuntime.toString()})(${JSON.stringify({ readOnly: operation.readOnly, requiredMethods: operation.requiredMethods })});
      return (${operation.handler.toString()})(args, runtime);
    })()`, { ...context, args }));
  };
  return { run, api, calls, docs, context, source, sourceToken, recipient, scene, item, actor, token };
}

test('pile family exposes exactly the eleven standalone public operations', () => {
  assert.deepEqual([...definitions.keys()], ['get_pile', 'create_pile', 'convert_tokens', 'revert_tokens', 'update_pile', 'delete_pile', 'split_pile', 'set_container_state', 'get_vault_grid', 'check_vault_fit', 'plan_vault_fit']);
  for (const operation of operations) {
    assert.equal(operation.inputSchema.type, 'object');
    assert.equal(operation.inputSchema.additionalProperties, false);
    assert.ok(operation.outputSchema && typeof operation.outputSchema === 'object');
    assert.ok(operation.requiredMethods.length > 0);
  }
});

test('get_pile sanitizes configuration and returns public state predicates', async () => {
  const f = fixture();
  Object.assign(f.source.pileData, { macro: 'dangerous macro', unknown: { script: 'not exposed' },
    vaultAccess: [{ uuid: f.recipient.uuid, view: true, organize: false, items: { deposit: true, withdraw: false, script: 'drop' }, currencies: { deposit: false, withdraw: true }, macro: 'drop' }] });
  const result = await f.run('get_pile', { actor_uuid: f.sourceToken.uuid });
  assert.equal(result.actor_uuid, f.source.uuid);
  assert.equal(result.states.container, true);
  assert.equal(result.states.closed, true);
  assert.equal(result.settings.enabled, true);
  assert.equal('macro' in result.settings, false);
  assert.equal('unknown' in result.settings, false);
  assert.equal('macro' in result.settings.vaultAccess[0], false);
  assert.equal('script' in result.settings.vaultAccess[0].items, false);
  assert.deepEqual(f.calls, []);
});

test('read operations enforce document observation permission', async () => {
  const f = fixture('vault');
  f.context.game.user.isGM = false;
  f.source.testUserPermission = () => false;
  for (const id of ['get_pile', 'get_vault_grid', 'check_vault_fit', 'plan_vault_fit']) {
    await assert.rejects(f.run(id, { actor_uuid: f.source.uuid, item_uuid: f.item.uuid, items: [{ item_uuid: f.item.uuid, quantity: 1 }] }), /OBSERVER/);
  }
  assert.deepEqual(f.calls, []);
});

test('get_pile preserves finite existing dimensions and custom types outside the editing allowlist', async () => {
  const f = fixture('custom-vault');
  Object.assign(f.source.pileData, { cols: 200, displayQuantity: 'legacy-display-policy' });
  const result = await f.run('get_pile', { actor_uuid: f.source.uuid });
  assert.equal(result.settings.type, 'custom-vault');
  assert.equal(result.settings.cols, 200);
  assert.equal(result.settings.displayQuantity, 'legacy-display-policy');
  const schema = definitions.get('get_pile').outputSchema.properties.settings.properties;
  assert.equal(schema.type.enum, undefined);
  assert.equal(schema.cols.maximum, undefined);
});

test('create_pile resolves an explicit Scene and leaves item insertion to a separate operation', async () => {
  const f = fixture();
  const result = await f.run('create_pile', { scene_uuid: f.scene.uuid, name: 'Treasury', position: { x: 0, y: 100 }, settings: { type: 'vault', cols: 4, rows: 3 } });
  assert.equal(result.actor_uuid, 'Scene.scene.Token.created.Actor.created');
  assert.equal(result.base_actor_uuid, 'Actor.created');
  assert.equal(result.token_uuid, 'Scene.scene.Token.created');
  assert.equal(result.created_actor, true);
  const options = f.calls[0].args[0];
  assert.equal(options.sceneId, 'scene');
  assert.equal(options.createActor, true);
  assert.equal(options.actor, 'Treasury');
  assert.equal('items' in options, false);
  assert.deepEqual(plain(options.position), { x: 0, y: 100 });
});

test('actor-only creation uses a linked prototype and verifies the new pile', async () => {
  const f = fixture();
  const result = await f.run('create_pile', { scene_uuid: f.scene.uuid, settings: { type: 'merchant' } });
  assert.equal(result.token_uuid, null);
  assert.equal(result.actor_uuid, result.base_actor_uuid);
  assert.equal(f.calls[0].args[0].tokenOverrides.actorLink, true);
  assert.equal(f.docs.get(result.actor_uuid).pileData.type, 'merchant');
});

test('create then add_items targets an unlinked token Actor without changing its base Actor inventory', async () => {
  const f = fixture();
  const result = await f.run('create_pile', { scene_uuid: f.scene.uuid, position: { x: 20, y: 40 } });
  const base = f.docs.get(result.base_actor_uuid);
  const effective = f.docs.get(result.token_uuid).actor;
  assert.notEqual(effective, base);
  assert.equal(result.actor_uuid, effective.uuid);
  let target;
  f.api.addItems = (actor, entries) => {
    target = actor;
    actor.inventoryQuantity = entries[0].quantity;
    return [{ item: { ...entries[0].item, system: { quantity: entries[0].quantity } }, quantity: entries[0].quantity }];
  };
  const deltas = await f.run('add_items', { actor_uuid: result.actor_uuid, items: [{ item_uuid: f.item.uuid, quantity: 3 }] });
  assert.equal(target, effective);
  assert.equal(effective.inventoryQuantity, 3);
  assert.equal(base.inventoryQuantity, undefined);
  assert.equal(deltas[0].quantity, 3);
});

test('creation from an existing linked Actor retains the common inventory and base UUID', async () => {
  const f = fixture();
  f.source.prototypeToken.actorLink = true;
  const result = await f.run('create_pile', { scene_uuid: f.scene.uuid, actor_uuid: f.source.uuid, position: { x: 0, y: 0 } });
  assert.equal(result.actor_uuid, f.source.uuid);
  assert.equal(result.base_actor_uuid, f.source.uuid);
  assert.equal(result.created_actor, false);
  assert.equal(f.calls[0].args[0].createActor, false);
});

test('create rejects absent Scene, items, unsupported settings and no-op existing-Actor creation before dispatch', async () => {
  for (const args of [
    {}, { scene_uuid: 'Actor.source' }, { scene_uuid: 'Scene.scene', items: [] },
    { scene_uuid: 'Scene.scene', settings: { macro: 'Macro.malicious' } },
    { scene_uuid: 'Scene.scene', settings: { enabled: false } },
    { scene_uuid: 'Scene.scene', actor_uuid: 'Actor.source' },
    { scene_uuid: 'Scene.scene', token_settings: { actorId: 'other' } },
  ]) {
    const f = fixture();
    await assert.rejects(f.run('create_pile', args));
    assert.deepEqual(f.calls, []);
  }
});

test('creation malformed results and unresolved postconditions are uncertain without retry', async () => {
  for (const response of [false, {}, { actorUuid: 'Actor.missing' }, { actorUuid: 'Actor.source' }]) {
    const f = fixture();
    let count = 0;
    f.api.createItemPile = async () => { count++; return response; };
    await assert.rejects(f.run('create_pile', { scene_uuid: f.scene.uuid, position: { x: 1, y: 2 } }), /outcome_unknown/);
    assert.equal(count, 1);
  }
});

test('convert and revert pass TokenDocuments and confirm the observed enabled state', async () => {
  const f = fixture();
  const converted = await f.run('convert_tokens', { token_uuids: [f.sourceToken.uuid], settings: { type: 'merchant', buyPriceModifier: 2 } });
  assert.equal(f.calls[0].args[0][0], f.sourceToken);
  assert.deepEqual(converted, { token_uuids: [f.sourceToken.uuid], enabled: true });
  assert.equal(f.source.pileData.buyPriceModifier, 2);
  const reverted = await f.run('revert_tokens', { token_uuids: [f.sourceToken.uuid], token_settings: { hidden: true } });
  assert.deepEqual(reverted, { token_uuids: [f.sourceToken.uuid], enabled: false });
  assert.equal(f.sourceToken.hidden, true);
});

test('conversion rejects duplicate tokens and unknown configuration before dispatch', async () => {
  const f = fixture();
  await assert.rejects(f.run('convert_tokens', { token_uuids: [f.sourceToken.uuid, f.sourceToken.uuid] }), /unique|duplicate/i);
  await assert.rejects(f.run('convert_tokens', { token_uuids: [f.sourceToken.uuid], settings: { macro: 'Macro.bad' } }), /setting|configuration|unsupported/i);
  await assert.rejects(f.run('revert_tokens', { token_uuids: [f.sourceToken.uuid], token_settings: { flags: { script: 'bad' } } }), /setting|configuration|unsupported/i);
  assert.deepEqual(f.calls, []);
});

test('conversion and reversion do not treat missing results or stale poststate as confirmation', async () => {
  for (const [id, method, enabled] of [['convert_tokens', 'turnTokensIntoItemPiles', false], ['revert_tokens', 'revertTokensFromItemPiles', true]]) {
    const f = fixture();
    f.source.pileData.enabled = enabled;
    let count = 0;
    f.api[method] = () => { count++; return [f.sourceToken.uuid]; };
    await assert.rejects(f.run(id, { token_uuids: [f.sourceToken.uuid] }), /outcome_unknown/);
    assert.equal(count, 1);
  }
});

test('update accepts undefined only after verifying requested pile and token fields', async () => {
  const f = fixture();
  const result = await f.run('update_pile', { actor_uuid: f.sourceToken.uuid, settings: { openTimes: { enabled: true, status: 'closed' }, locked: true }, token_settings: { hidden: true } });
  assert.equal(result.actor_uuid, f.source.uuid);
  assert.equal(result.updated_settings.locked, true);
  assert.equal(f.sourceToken.hidden, true);
  assert.equal(f.calls.length, 1);
});

test('update postread failure and unobserved changes are reported as unknown outcomes', async () => {
  for (const failRead of [false, true]) {
    const f = fixture();
    let called = false;
    f.api.updateItemPile = () => { called = true; };
    f.api.getActorFlagData = () => { if (called && failRead) throw new Error('disconnected'); return plain(f.source.pileData); };
    await assert.rejects(f.run('update_pile', { actor_uuid: f.source.uuid, settings: { locked: true } }), /outcome_unknown/);
    assert.equal(called, true);
  }
});

test('delete_pile is token-only and verifies removal from its Scene', async () => {
  const f = fixture();
  await assert.rejects(f.run('delete_pile', { token_uuid: f.source.uuid }), /Token/);
  const result = await f.run('delete_pile', { token_uuid: f.sourceToken.uuid });
  assert.deepEqual(result, { token_uuid: f.sourceToken.uuid, deleted: true });
  assert.equal(f.docs.has(f.source.uuid), true);
  assert.equal(f.scene.tokens.has(f.sourceToken.id), false);
  assert.equal(f.calls.length, 1);
});

test('delete does not confirm a returned Document if the Scene still contains the token', async () => {
  const f = fixture();
  f.api.deleteItemPile = (target) => target;
  await assert.rejects(f.run('delete_pile', { token_uuid: f.sourceToken.uuid }), /outcome_unknown/);
});

test('split requires explicit distinct recipient Actors and preserves serializable deltas', async () => {
  const f = fixture();
  for (const recipient_uuids of [[], [f.source.uuid], [f.recipient.uuid, f.recipient.uuid]]) {
    await assert.rejects(f.run('split_pile', { actor_uuid: f.source.uuid, recipient_uuids }));
  }
  assert.deepEqual(f.calls, []);
  const result = await f.run('split_pile', { actor_uuid: f.source.uuid, recipient_uuids: [f.recipient.uuid] });
  assert.equal(f.calls[0].args[1].targets[0], f.recipient);
  assert.equal(result.pile_deltas.attributeDeltas['system.gold'], -2);
  assert.equal(result.actor_deltas[f.recipient.uuid].attributeDeltas['system.gold'], 2);
});

test('split malformed confirmation is an unknown outcome with no retry', async () => {
  const f = fixture();
  let count = 0;
  f.api.splitItemPileContents = () => { count++; return { pileDeltas: {}, actorDeltas: {} }; };
  await assert.rejects(f.run('split_pile', { actor_uuid: f.source.uuid, recipient_uuids: [f.recipient.uuid] }), /outcome_unknown/);
  assert.equal(count, 1);
});

test('split rejects disabled currency sharing before dispatch at positive and zero Actor balances', async () => {
  assert.ok(definitions.get('split_pile').requiredMethods.includes('getActorFlagData'));
  for (const balance of [10, 0]) {
    const f = fixture();
    Object.assign(f.source.pileData, { shareItemsEnabled: true, shareCurrenciesEnabled: false, splitAllEnabled: false });
    f.source.system = { gold: balance };
    // A zero Actor balance cannot establish that embedded Items have no currency.
    f.source.items = new Map([['purse', { id: 'purse', system: { gold: 5 } }]]);
    await assert.rejects(f.run('split_pile', { actor_uuid: f.source.uuid, recipient_uuids: [f.recipient.uuid] }),
      (error) => /shareCurrenciesEnabled|splitAllEnabled/.test(error.message) && error.code !== 'outcome_unknown');
    assert.equal(f.source.system.gold, balance);
    assert.equal(f.source.items.get('purse').system.gold, 5);
    assert.deepEqual(f.calls, []);
  }
});

test('split permits either currency sharing flag without silently enabling item sharing', async () => {
  for (const [shareCurrenciesEnabled, splitAllEnabled] of [[true, false], [false, true], [true, true]]) {
    const f = fixture();
    Object.assign(f.source.pileData, { shareItemsEnabled: false, shareCurrenciesEnabled, splitAllEnabled });
    const result = await f.run('split_pile', { actor_uuid: f.source.uuid, recipient_uuids: [f.recipient.uuid] });
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].method, 'splitItemPileContents');
    assert.equal(f.source.pileData.shareItemsEnabled, false);
    assert.equal(result.actor_deltas[f.recipient.uuid].attributeDeltas['system.gold'], 2);
  }
});

test('split maps Token recipients to their Actor UUID and rejects duplicate Actor aliases before dispatch', async () => {
  const f = fixture();
  const token = f.token('Scene.scene.Token.recipient', f.recipient);
  await assert.rejects(f.run('split_pile', { actor_uuid: f.source.uuid, recipient_uuids: [f.recipient.uuid, token.uuid] }), /distinct/);
  assert.deepEqual(f.calls, []);
  const result = await f.run('split_pile', { actor_uuid: f.source.uuid, recipient_uuids: [token.uuid] });
  assert.deepEqual(result.recipient_uuids, [f.recipient.uuid]);
  assert.deepEqual(Object.keys(result.actor_deltas), [f.recipient.uuid]);
});

test('split requires exactly the resolved recipient UUIDs in its confirmed delta map', async () => {
  const f = fixture();
  let count = 0;
  f.api.splitItemPileContents = () => { count++; return { pileDeltas: {}, actorDeltas: { [f.recipient.uuid]: {}, 'Actor.unrequested': {} } }; };
  await assert.rejects(f.run('split_pile', { actor_uuid: f.source.uuid, recipient_uuids: [f.recipient.uuid] }), /outcome_unknown/);
  assert.equal(count, 1);
});

for (const [action, initial, expected] of [
  ['open', { closed: true, locked: true }, { closed: false, locked: false }],
  ['close', { closed: false, locked: false }, { closed: true, locked: false }],
  ['lock', { closed: false, locked: false }, { closed: true, locked: true }],
  ['unlock', { closed: true, locked: true }, { closed: true, locked: false }],
]) {
  test(`container ${action} uses the explicit public method and verifies both state flags`, async () => {
    const f = fixture();
    Object.assign(f.source.pileData, initial);
    const result = await f.run('set_container_state', { actor_uuid: f.source.uuid, action });
    assert.equal(result.closed, expected.closed);
    assert.equal(result.locked, expected.locked);
    assert.equal(f.calls[0].method, `${action}ItemPile`);
    assert.equal(f.calls.length, 1);
  });
}

test('container false and unverified undefined never become success or trigger a retry', async () => {
  for (const response of [false, undefined]) {
    const f = fixture();
    let count = 0;
    f.api.openItemPile = () => { count++; return response; };
    await assert.rejects(f.run('set_container_state', { actor_uuid: f.source.uuid, action: 'open' }), /outcome_unknown/);
    assert.equal(count, 1);
  }
});

test('vault grid preserves real free cells separately from the upstream item-count estimate', async () => {
  const f = fixture('vault');
  const result = await f.run('get_vault_grid', { actor_uuid: f.source.uuid });
  assert.equal(result.free_spaces, 4);
  assert.equal(result.free_cells.length, 4);
  assert.equal(result.upstream_free_spaces, 5);
  assert.equal(result.items[0].item.id, 'item');
  assert.equal(result.items[0].placement.width, 2);
  assert.equal(result.grid[0][0], 'Long spear');
  assert.equal(JSON.stringify(result).includes('testUserPermission'), false);
});

test('vault fit distinguishes an empty placement, stack match and lack of space', async () => {
  const f = fixture('vault');
  let result = await f.run('check_vault_fit', { actor_uuid: f.source.uuid, item_uuid: f.item.uuid });
  assert.deepEqual(result.position, { x: 2, y: 0, flipped: true });
  assert.equal(result.merge_item_id, null);
  f.api.canItemFitInVault = () => 'existing-stack';
  result = await f.run('check_vault_fit', { actor_uuid: f.source.uuid, item_uuid: f.item.uuid });
  assert.equal(result.fits, true);
  assert.equal(result.merge_item_id, 'existing-stack');
  assert.equal(result.position, null);
  f.api.canItemFitInVault = () => false;
  result = await f.run('check_vault_fit', { actor_uuid: f.source.uuid, item_uuid: f.item.uuid });
  assert.equal(result.fits, false);
});

test('vault planner sets the public system quantity path on cloned item data and remains a preview', async () => {
  const f = fixture('vault');
  const result = await f.run('plan_vault_fit', { actor_uuid: f.source.uuid, items: [{ item_uuid: f.item.uuid, quantity: 7 }] });
  assert.equal(f.calls[0].args[0][0].system.quantity, 7);
  assert.equal('item' in f.calls[0].args[0][0], false);
  assert.equal(f.calls[0].args.length, 2);
  assert.equal(f.item.system.quantity, 1);
  assert.equal(result.fits, true);
  assert.equal(result.preview_only, true);
  assert.equal(result.placements[0].item.quantity, 7);
  assert.equal(result.placements[0].position.x, 1);
  assert.deepEqual(result.merged_source_item_ids, []);
});

test('vault planner reports merge-only and no-space plans without applying updates or deletions', async () => {
  const f = fixture('vault');
  f.api.fitItemsIntoVault = () => ({ updates: [], deletions: ['item'] });
  let result = await f.run('plan_vault_fit', { actor_uuid: f.source.uuid, items: [{ item_uuid: f.item.uuid, quantity: 2 }] });
  assert.deepEqual(result.merged_source_item_ids, ['item']);
  assert.deepEqual(result.placements, []);
  f.api.fitItemsIntoVault = () => false;
  result = await f.run('plan_vault_fit', { actor_uuid: f.source.uuid, items: [{ item_uuid: f.item.uuid, quantity: 2 }] });
  assert.equal(result.fits, false);
  assert.equal(f.docs.has(f.item.uuid), true);
  assert.deepEqual(f.calls, []);
});

test('vault planner expands nonstackable quantities into distinct one-unit placements', async () => {
  const f = fixture('vault');
  f.api.canItemStack = () => false;
  const result = await f.run('plan_vault_fit', { actor_uuid: f.source.uuid, items: [{ item_uuid: f.item.uuid, quantity: 3 }] });
  const passed = f.calls[0].args[0];
  assert.equal(passed.length, 3);
  assert.notEqual(passed[0], passed[1]);
  assert.deepEqual(plain(passed.map((entry) => entry.system.quantity)), [1, 1, 1]);
  assert.equal(result.placements.length, 3);
  assert.equal(f.item.system.quantity, 1);
});

test('nonstackable preview rejects fractional quantities and oversized expansion before calling the planner', async () => {
  const f = fixture('vault');
  f.api.canItemStack = () => false;
  for (const quantity of [1.5, 101, Number.MAX_SAFE_INTEGER]) {
    await assert.rejects(f.run('plan_vault_fit', { actor_uuid: f.source.uuid, items: [{ item_uuid: f.item.uuid, quantity }] }), /integers|100/);
  }
  assert.deepEqual(f.calls, []);
});

test('vault helpers reject ordinary Actors and nonfinite requested quantities before calculations', async () => {
  const f = fixture();
  for (const id of ['get_vault_grid', 'check_vault_fit', 'plan_vault_fit']) {
    await assert.rejects(f.run(id, { actor_uuid: f.source.uuid, item_uuid: f.item.uuid, items: [{ item_uuid: f.item.uuid, quantity: 1 }] }), /vault/i);
  }
  f.source.pileData.type = 'vault';
  for (const quantity of [0, -1, Infinity, NaN]) {
    await assert.rejects(f.run('plan_vault_fit', { actor_uuid: f.source.uuid, items: [{ item_uuid: f.item.uuid, quantity }] }), /positive|finite/i);
  }
  assert.deepEqual(f.calls, []);
});

test('every mutation is GM-only before any document resolution or public API call', async () => {
  const f = fixture();
  f.context.game.user.isGM = false;
  for (const operation of operations.filter((value) => !value.readOnly)) {
    await assert.rejects(f.run(operation.id, {}), /GM/);
  }
  assert.deepEqual(f.calls, []);
});
