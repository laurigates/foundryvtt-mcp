import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture, invoke, manifest, packageRoot, plain } from './helpers.mjs';
import { generatePackage, generatedFiles } from '../build.mjs';

const args = { actor_uuid: 'Actor.hero' };

test('deterministic generated files and legacy operation remain installed', async () => {
  assert.deepEqual(await generatePackage(), { operations: 22, files: 45 });
  assert.equal(manifest.foundryGeneration, 14);
  assert.equal(manifest.operations.filter((o) => o.readOnly).length, 10);
  assert.equal(manifest.operations.filter((o) => !o.readOnly).length, 12);
  assert.equal(manifest.upstream.reference, 'pf2e-8.7.1@397f125aea87e6d6fa36e878c9c07d0e672826cf');
  for (const [path, content] of generatedFiles()) assert.equal(await readFile(join(packageRoot, path), 'utf8'), content);
  const world = fixture(); delete world.game.ready; delete world.game.user; world.game.system.version = '7.0.0';
  const value = plain(await invoke(world, 'get_actor_data', args));
  assert.deepEqual(value, { id: 'hero', uuid: 'Actor.hero', name: 'Hero', type: 'character',
    system: { details: { level: { value: 5 } }, custom: 'raw-source' } });
});

test('every operation has a ready side-effect-free probe in the supported fixture', async () => {
  const world = fixture();
  for (const operation of manifest.operations) assert.equal((await invoke(world, operation.id, {}, { probe: true })).ready, true, operation.id);
  assert.deepEqual(world.calls, []);
});

for (const [label, change] of [
  ['wrong system', (w) => { w.game.system.id = 'sf2e'; }],
  ['wrong version', (w) => { w.game.system.version = '8.7.2'; }],
  ['Foundry12', (w) => { w.game.release.generation = 12; }],
  ['Foundry13', (w) => { w.game.release.generation = 13; }],
  ['Foundry15', (w) => { w.game.release.generation = 15; }],
  ['old build', (w) => { w.game.release.build = 360; }],
  ['unknown version', (w) => { delete w.game.release; w.game.version = 'unknown'; }],
  ['unready world', (w) => { w.game.ready = false; }],
]) test(`new operation rejects ${label} before dispatch`, async () => {
  const world = fixture(); change(world);
  assert.equal((await invoke(world, 'roll_perception', {}, { probe: true })).ready, false);
  await assert.rejects(invoke(world, 'roll_perception', args), { code: 'pf2e_not_ready' });
  assert.deepEqual(world.calls, []);
});

test('build fallback parses full Foundry version and rejects missing build data', async () => {
  const world = fixture(); delete world.game.release;
  assert.equal((await invoke(world, 'get_actor_summary', args)).level, 5);
  world.game.version = '14';
  await assert.rejects(invoke(world, 'get_actor_summary', args), /build 361/);
});

test('read, write and target permissions are checked independently', async () => {
  const world = fixture(); world.game.user.isGM = false; world.actor.owner = false;
  assert.equal((await invoke(world, 'get_actor_summary', args)).level, 5);
  await assert.rejects(invoke(world, 'roll_perception', args), { code: 'pf2e_permission_denied' });
  world.actor.readable = false;
  await assert.rejects(invoke(world, 'get_actor_summary', args), { code: 'pf2e_permission_denied' });
  assert.deepEqual(world.calls, []);
});

test('wrong or absent Actor and missing capability never dispatch', async () => {
  const world = fixture();
  await assert.rejects(invoke(world, 'get_actor_summary', { actor_uuid: world.token.uuid }), /Actor/);
  await assert.rejects(invoke(world, 'get_actor_summary', { actor_uuid: 'Actor.absent' }), /Actor/);
  delete world.actor.getStatistic;
  assert.equal((await invoke(world, 'get_statistics', {}, { probe: true })).ready, false);
  await assert.rejects(invoke(world, 'roll_perception', args), /capabilities/);
});

test('reads normalize prepared system data without invoking writes', async () => {
  const world = fixture(); world.addCondition('frightened', 2);
  assert.equal((await invoke(world, 'get_actor_summary', args)).armor_class, 22);
  assert.equal((await invoke(world, 'get_statistics', args)).statistics.length, 7);
  assert.equal((await invoke(world, 'get_statistic', { ...args, statistic_slug: 'sailing-lore' })).statistic.modifier, 7);
  assert.equal((await invoke(world, 'get_conditions', args)).conditions[0].value, 2);
  assert.equal((await invoke(world, 'get_inventory', args)).bulk.light_units, 10);
  assert.equal((await invoke(world, 'get_currency', args)).copper_value, 1000);
  assert.equal((await invoke(world, 'get_resource', { ...args, resource_slug: 'focus' })).resource.max, 3);
  assert.equal((await invoke(world, 'get_strikes', args)).strikes[0].item_uuid, world.item.uuid);
  assert.equal((await invoke(world, 'get_spellcasting', args)).entries[0].spells[0].rank, 1);
  assert.deepEqual(world.calls, []);
});

test('unidentified inventory values are hidden from non-GM observers', async () => {
  const world = fixture(); world.game.user.isGM = false; world.item.isIdentified = false;
  const value = await invoke(world, 'get_inventory', args);
  assert.equal(value.items[0].name, 'Unidentified item'); assert.equal(value.items[0].asset_value, null);
});

for (const [name, extra, statistic] of [
  ['roll_skill', { skill: 'sailing-lore' }, 'sailing-lore'], ['roll_save', { save: 'will' }, 'will'],
  ['roll_perception', {}, 'perception'], ['roll_statistic', { statistic_slug: 'custom-check' }, 'custom-check'],
]) test(`${name} delegates once to the live instance with the inspected headless options`, async () => {
  const world = fixture();
  const original = world.stats[statistic].roll;
  let wrapped = 0;
  world.stats[statistic].roll = async function(options) { wrapped++; return original.call(this, options); };
  const result = plain(await invoke(world, name, { ...args, ...extra, dc: 20, token_uuid: world.token.uuid, create_message: false, message_mode: 'self' }));
  assert.equal(wrapped, 1); assert.equal(result.total, 24); assert.equal(result.degree_of_success, 2);
  assert.equal(world.calls[0].method, `statistic:${statistic}`);
  assert.equal(world.calls[0].params.skipDialog, true); assert.equal(world.calls[0].params.createMessage, false);
  assert.deepEqual(plain(world.calls[0].params.dc), { value: 20 });
  assert.equal(world.calls[0].params.token, world.token);
});

test('ambient targets, ambiguous actor tokens and unavailable statistics fail before rolling', async () => {
  const world = fixture(); world.game.user.targets.add(world.target.object);
  await assert.rejects(invoke(world, 'roll_perception', args), /Clear/);
  world.game.user.targets.clear(); world.actor.getActiveTokens = () => [world.token, world.target];
  await assert.rejects(invoke(world, 'roll_perception', args), /Specify token_uuid/);
  await assert.rejects(invoke(world, 'roll_skill', { ...args, skill: 'missing' }), /no skill/);
  await assert.rejects(invoke(world, 'roll_statistic', { ...args, statistic_slug: 'constructor' }), /safe/);
  assert.deepEqual(world.calls, []);
});

test('secret-check visibility chosen by PF2e is respected in MCP results', async () => {
  const world = fixture(); world.game.user.isGM = false; world.setBlind(true);
  const result = plain(await invoke(world, 'roll_perception', args));
  assert.equal(result.hidden, true); assert.equal(result.total, null); assert.equal(result.formula, null);
  assert.equal(result.natural, null); assert.equal(result.degree_of_success, null); assert.equal(result.message_mode, 'blind');
  assert.equal(world.calls.length, 1);
});

for (const mode of ['public', 'gm', 'self']) test(`non-GM receives a visible ${mode} check once`, async () => {
  const world = fixture(); world.game.user.isGM = false;
  const result = plain(await invoke(world, 'roll_perception', { ...args, message_mode: mode }));
  assert.equal(result.hidden, false); assert.equal(result.total, 24); assert.equal(result.formula, '1d20+7');
  assert.equal(result.natural, 17); assert.equal(result.degree_of_success, 2); assert.equal(result.message_mode, mode);
  assert.equal(result.message_uuid, 'ChatMessage.message'); assert.equal(world.calls.length, 1);
});

for (const [label, message, expectedMode] of [
  ['actual blind message overrides public context and visible flag',
    { blind: true, isContentVisible: true, flags: { pf2e: { context: { messageMode: 'public' } } } }, 'blind'],
  ['inaccessible content overrides public context',
    { blind: false, isContentVisible: false, flags: { pf2e: { context: { messageMode: 'public' } } } }, null],
  ['blind PF2e context remains hidden despite a visible non-blind message',
    { blind: false, isContentVisible: true, flags: { pf2e: { context: { messageMode: 'blind' } } } }, 'blind'],
  ['missing actual visibility cannot be inferred from public context',
    { blind: false, flags: { pf2e: { context: { messageMode: 'public' } } } }, null],
  ['missing message leaves visibility unconfirmed', null, null],
  ['missing PF2e context leaves effective mode unconfirmed',
    { blind: false, isContentVisible: true }, null],
  ['unknown PF2e context cannot authorize disclosure',
    { blind: false, isContentVisible: true, flags: { pf2e: { context: { messageMode: 'custom-private' } } } }, null],
]) test(`non-GM redaction: ${label}`, async () => {
  const world = fixture(); world.game.user.isGM = false; let calls = 0;
  world.stats.perception.roll = async (params) => {
    calls++;
    const roll = { total: 24, formula: '1d20+7', naturalResult: 17, degreeOfSuccess: 2 };
    await params.callback(roll, 'success', message && { id: 'message', uuid: 'ChatMessage.message', ...message }, null);
    return roll;
  };
  const result = plain(await invoke(world, 'roll_perception', args));
  assert.equal(result.hidden, true); assert.equal(result.total, null); assert.equal(result.formula, null);
  assert.equal(result.natural, null); assert.equal(result.degree_of_success, null); assert.equal(result.message_mode, expectedMode);
  assert.equal(calls, 1);
});

test('non-GM check without a created message redacts unconfirmed visibility without retrying', async () => {
  const world = fixture(); world.game.user.isGM = false;
  const result = plain(await invoke(world, 'roll_perception', { ...args, create_message: false, message_mode: 'self' }));
  assert.equal(result.hidden, true); assert.equal(result.total, null); assert.equal(result.formula, null);
  assert.equal(result.natural, null); assert.equal(result.degree_of_success, null); assert.equal(result.message_mode, null);
  assert.equal(result.message_uuid, null); assert.equal(world.calls.length, 1);
});

test('GM receives blind check values despite visibility flags without retrying', async () => {
  const world = fixture(); let calls = 0;
  world.stats.perception.roll = async (params) => {
    calls++;
    const roll = { total: 24, formula: '1d20+7', naturalResult: 17, degreeOfSuccess: 2 };
    await params.callback(roll, 'success', { id: 'message', uuid: 'ChatMessage.message', blind: true,
      isContentVisible: false, flags: { pf2e: { context: { messageMode: 'public' } } } }, null);
    return roll;
  };
  const result = plain(await invoke(world, 'roll_perception', args));
  assert.equal(result.hidden, false); assert.equal(result.total, 24); assert.equal(result.formula, '1d20+7');
  assert.equal(result.natural, 17); assert.equal(result.degree_of_success, 2); assert.equal(result.message_mode, 'blind');
  assert.equal(calls, 1);
});

test('roll exceptions and null results are uncertain and never retried', async () => {
  for (const result of [null, { total: Infinity }]) {
    const world = fixture(); let calls = 0;
    world.stats.perception.roll = async () => { calls++; return result; };
    await assert.rejects(invoke(world, 'roll_perception', args), { code: 'outcome_unknown' }); assert.equal(calls, 1);
  }
  const world = fixture(); let calls = 0;
  world.stats.perception.roll = async () => { calls++; throw new Error('hook failed after chat'); };
  await assert.rejects(invoke(world, 'roll_perception', args), { code: 'outcome_unknown' }); assert.equal(calls, 1);
});

test('strike uses an explicit rendered target and current MAP variant while preserving ammo consumption', async () => {
  const world = fixture();
  const result = await invoke(world, 'roll_strike', { ...args, token_uuid: world.token.uuid,
    target_token_uuid: world.target.uuid, strike_index: 0, expected_item_uuid: world.item.uuid, attack_number: 2 });
  assert.equal(result.total, 24); assert.equal(world.calls[0].method, 'strike:1');
  assert.equal(world.calls[0].params.target, world.target.object); assert.equal(world.calls[0].params.consumeAmmo, true);
});

test('strike readiness excludes dialogs; stale selections and missing canvas objects reject before execution', async () => {
  const world = fixture(); const input = { ...args, token_uuid: world.token.uuid, target_token_uuid: world.target.uuid,
    strike_index: 0, expected_item_uuid: world.item.uuid };
  world.game.user.settings.showCheckDialogs = true;
  assert.equal((await invoke(world, 'roll_strike', {}, { probe: true })).ready, false);
  world.game.user.settings.showCheckDialogs = false;
  await assert.rejects(invoke(world, 'roll_strike', { ...input, expected_item_uuid: 'Actor.hero.Item.other' }), /identity/);
  delete world.target.object;
  await assert.rejects(invoke(world, 'roll_strike', input), /rendered/);
  assert.deepEqual(world.calls, []);
});

test('explicit condition presence is idempotent and checked after the system API', async () => {
  const world = fixture();
  await invoke(world, 'set_condition', { ...args, condition_slug: 'prone', active: true });
  await invoke(world, 'set_condition', { ...args, condition_slug: 'prone', active: true });
  assert.equal(world.calls.length, 1); assert.deepEqual(plain(world.calls[0].options), { active: true });
  await invoke(world, 'set_condition', { ...args, condition_slug: 'prone', active: false });
  assert.equal(world.actor.hasCondition('prone'), false);
  world.actor.toggleCondition = async () => {};
  await assert.rejects(invoke(world, 'set_condition', { ...args, condition_slug: 'prone', active: true }), { code: 'outcome_unknown' });
});

test('valued condition changes use exact existing documents and reject temporary grants or persistent editors', async () => {
  const world = fixture(); const c = world.addCondition('frightened', 2);
  await invoke(world, 'increase_condition', { ...args, condition_slug: 'frightened', amount: 2, maximum: 5 });
  assert.equal(c.value, 4); assert.equal(world.calls[0].input, c);
  await invoke(world, 'decrease_condition', { ...args, condition_slug: 'frightened' }); assert.equal(c.value, 3);
  c.isLocked = true;
  await assert.rejects(invoke(world, 'decrease_condition', { ...args, condition_slug: 'frightened' }), /locked/);
  await assert.rejects(invoke(world, 'increase_condition', { ...args, condition_slug: 'prone' }), /unvalued/);
  await assert.rejects(invoke(world, 'set_condition', { ...args, condition_slug: 'persistent-damage', active: true }), /interactive/);
  assert.equal(world.calls.length, 2);
});

test('resources use updateResource, respect bounds and verify effects', async () => {
  const world = fixture();
  const value = await invoke(world, 'set_resource', { ...args, resource_slug: 'focus', value: 3 });
  assert.equal(value.resource.value, 3); assert.equal(world.calls[0].method, 'updateResource');
  await assert.rejects(invoke(world, 'set_resource', { ...args, resource_slug: 'focus', value: 4 }), /integer/);
  await assert.rejects(invoke(world, 'set_resource', { ...args, resource_slug: 'investiture', value: 4 }), /derived/);
  world.actor.updateResource = async () => {};
  await assert.rejects(invoke(world, 'set_resource', { ...args, resource_slug: 'focus', value: 1 }), { code: 'outcome_unknown' });
});

test('currency operations use native inventory API, make change and check the resulting copper balance', async () => {
  const world = fixture();
  assert.equal((await invoke(world, 'add_currency', { ...args, coins: { gp: 2, sp: 1 } })).copper_value, 1210);
  assert.equal((await invoke(world, 'remove_currency', { ...args, coins: { cp: 1 } })).copper_value, 1209);
  assert.deepEqual(plain(world.calls[0].coins), { gp: 2, sp: 1 });
  assert.deepEqual(plain(world.calls[1].options), { byValue: true });
});

test('currency rejects invalid input and insufficient exact denominations before upstream calls', async () => {
  const world = fixture();
  for (const coins of [{}, { cp: -1 }, { cp: 0.5 }, { cp: 0 }, { credits: 1 }, { gp: Number.MAX_SAFE_INTEGER }]) {
    await assert.rejects(invoke(world, 'add_currency', { ...args, coins }));
  }
  await assert.rejects(invoke(world, 'remove_currency', { ...args, coins: { cp: 1 }, by_value: false }), /exact denominations/);
  await assert.rejects(invoke(world, 'remove_currency', { ...args, coins: { gp: 11 } }), /insufficient/);
  assert.deepEqual(world.calls, []);
});

test('currency partial/no-op updates report uncertainty, not successful rollback', async () => {
  const world = fixture(); let calls = 0;
  world.actor.inventory.addCurrency = async () => { calls++; };
  await assert.rejects(invoke(world, 'add_currency', { ...args, coins: { gp: 1 } }), { code: 'outcome_unknown' });
  assert.equal(calls, 1);
});

test('daily recharge passes explicit commit semantics without claiming a full rest', async () => {
  const world = fixture(); const result = await invoke(world, 'recharge', { ...args, duration: 'day' });
  assert.equal(result.affected.spell_slots, true); assert.deepEqual(plain(world.calls[0].options), { duration: 'day', commit: true });
  world.actor.recharge = async () => undefined;
  await assert.rejects(invoke(world, 'recharge', { ...args, duration: 'turn' }), { code: 'outcome_unknown' });
});

test('same Actor UUID resolves independently in different runtime worlds', async () => {
  const a = fixture(), b = fixture(); b.actor.name = 'Other world';
  assert.equal((await invoke(a, 'get_actor_summary', args)).actor.name, 'Hero');
  assert.equal((await invoke(b, 'get_actor_summary', args)).actor.name, 'Other world');
});

test('recharge rejects unapplied plans even if prepared values look updated', async () => {
  for (const patch of [
    { actorUpdates: { 'system.resources.focus.value': 3 } },
    { itemUpdates: [{ _id: 'absent', system: { frequency: { value: 1 } } }] },
    { itemCreates: [{ name: 'New resource', type: 'equipment' }] },
    { itemDeletes: ['condition-frightened'] },
  ]) {
    const world = fixture(); world.addCondition('frightened', 1);
    world.actor.system.resources.focus.value = 3;
    world.actor.recharge = async () => ({ actorUpdates: {}, itemUpdates: [], itemCreates: [], itemDeletes: [],
      affected: { frequencies: true, spellSlots: true, resources: [] }, ...patch });
    await assert.rejects(invoke(world, 'recharge', { ...args, duration: 'day' }), { code: 'outcome_unknown' });
  }
});

test('recharge confirms nested/dotted source updates and newly created/deleted items', async () => {
  const world = fixture(); const stored = [{ id: 'old', toObject: () => ({ _id: 'old', name: 'Old item' }) }];
  world.actor.items = { get contents() { return stored; }, get: (id) => stored.find((item) => item.id === id), has: (id) => stored.some((item) => item.id === id) };
  world.actor.recharge = async () => {
    world.actor.toObject = () => ({ system: { resources: { focus: { value: 3 } } } });
    stored.splice(0, 1, { id: 'new', toObject: () => ({ _id: 'new', name: 'Resource', type: 'equipment', system: { quantity: 1 } }) });
    return { actorUpdates: { 'system.resources.focus.value': 3 }, itemUpdates: [], itemDeletes: ['old'],
      itemCreates: [{ name: 'Resource', type: 'equipment', system: { quantity: 1 } }],
      affected: { frequencies: true, spellSlots: true, resources: ['focus'] } };
  };
  assert.equal((await invoke(world, 'recharge', { ...args, duration: 'day' })).affected.spell_slots, true);
});
