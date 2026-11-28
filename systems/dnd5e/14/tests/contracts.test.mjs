import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { generatedFiles, generatePackage } from '../build.mjs';
import { operations, legacyOperation, metadata } from '../src/registry.mjs';
import { execute, fixture, plain } from './helpers.mjs';

test('generated output is reproducible, syntax-valid and keeps the legacy contract', async () => {
  assert.deepEqual([...generatedFiles()], [...generatedFiles()]);
  assert.deepEqual(await generatePackage({ mode: 'check' }), { operations: 25, files: 49 });
  const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url)));
  assert.deepEqual(manifest.operations.find(o => o.id === 'get_actor_data'), legacyOperation);
  assert.equal(manifest.operations.length, 25);
  assert.equal(manifest.foundryGeneration, 14);
  assert.equal(manifest.operations.filter(o => o.readOnly).length, 10);
  assert.equal(manifest.operations.filter(o => !o.readOnly).length, 15);
  assert.equal(metadata.upstream.reference, 'release-6.1.1@bc1b2c921e2f306dc5079f8de883ad64607118a6');
  assert.deepEqual(metadata.compatibility.tested, []);
});

for (const op of operations) {
  test(`${op.id}: probe checks readiness without invoking an actor/activity method`, async () => {
    const world = fixture();
    assert.deepEqual(plain(await execute(op.id, {}, world, true)), { ready: true });
    assert.deepEqual(world.calls, []);
  });
}

for (const [label, mutate] of [
  ['different system', w => { w.game.system.id = 'pf2e'; }],
  ['not ready', w => { w.game.ready = false; }],
  ['older system version', w => { w.game.system.version = '6.1.0'; }],
  ['newer uninspected system version', w => { w.game.system.version = '6.1.2'; }],
  ['Foundry 13', w => { w.game.release = { generation: 13, build: 350 }; w.game.version = '13.350'; }],
  ['below minimum build', w => { w.game.release.build = 366; w.game.version = '14.366'; }],
  ['uninspected Foundry 15', w => { w.game.release = { generation: 15, build: 400 }; w.game.version = '15.400'; }],
  ['unknown Foundry build', w => { w.game.release = { generation: 14 }; w.game.version = ''; }],
  ['no runtime user', w => { delete w.game.user; }],
  ['no system configuration', w => { delete w.CONFIG.DND5E; }],
]) {
  test(`version/readiness gate rejects ${label}`, async () => {
    const world = fixture(); mutate(world);
    assert.equal((await execute('get_actor_summary', {}, world, true)).ready, false);
    await assert.rejects(execute('get_actor_summary', { actor_uuid: world.actor.uuid }, world));
    assert.deepEqual(world.calls, []);
  });
}

test('current supported later build and version fallback are accepted', async () => {
  const world = fixture(); world.game.version = '14.400'; delete world.game.release;
  assert.equal((await execute('get_actor_summary', {}, world, true)).ready, true);
});

test('legacy raw Actor read remains capability-based without new configuration or user requirements', async () => {
  const actor = { documentName: 'Actor', id: 'a', uuid: 'Actor.a', name: 'A', type: 'npc', toObject: () => ({ system: { preserved: { value: 42 } } }) };
  const world = { game: { system: { id: 'dnd5e' } }, fromUuid: async () => actor };
  assert.deepEqual(plain(await execute('get_actor_data', { actor_uuid: actor.uuid }, world)), { id: 'a', uuid: 'Actor.a', name: 'A', type: 'npc', system: { preserved: { value: 42 } } });
});

test('method absence removes only the affected capability', async () => {
  const world = fixture(); world.CONFIG.Actor.documentClass.prototype.rollSkill = undefined;
  assert.equal((await execute('roll_skill', {}, world, true)).ready, false);
  assert.equal((await execute('roll_saving_throw', {}, world, true)).ready, true);
});

test('read permission is OBSERVER and writes require OWNER', async () => {
  const world = fixture(); world.game.user.isGM = false;
  await execute('get_actor_summary', { actor_uuid: world.actor.uuid }, world);
  await execute('roll_skill', { actor_uuid: world.actor.uuid, skill: 'ath', chat_message: true }, world);
  assert.ok(world.calls.some(c => c[0] === 'permission' && c[2] === 'OBSERVER'));
  assert.ok(world.calls.some(c => c[0] === 'permission' && c[2] === 'OWNER'));
  world.setPermission(false); world.calls.length = 0;
  await assert.rejects(execute('roll_skill', { actor_uuid: world.actor.uuid, skill: 'ath' }, world), /OWNER permission/);
  assert.equal(world.calls.some(c => c[0] === 'rollSkill'), false);
});

test('compendium Actor mutation is rejected even for a GM', async () => {
  const world = fixture(); world.actor.pack = 'dnd5e.heroes';
  await assert.rejects(execute('roll_skill', { actor_uuid: world.actor.uuid, skill: 'ath' }, world), /compendium/);
});

test('prepared Actor data differs from source and serializes sets/document references', async () => {
  const world = fixture();
  const summary = plain(await execute('get_actor_summary', { actor_uuid: world.actor.uuid }, world));
  assert.equal(summary.prepared.skills.ath.total, 5);
  assert.deepEqual(summary.prepared.traits.di.value, ['poison']);
  const result = plain(await execute('get_roll_data', { actor_uuid: world.actor.uuid }, world));
  assert.equal(result.linkedActor.uuid, world.actor.uuid);
  assert.equal(result.linkedActor.documentName, 'Actor');
  assert.deepEqual(result.statuses, ['blinded']);
  assert.equal(JSON.stringify(result).includes('testUserPermission'), false);
});

test('inventory, Item, activity and effect reads return actual document selections', async () => {
  const world = fixture();
  const effects = { id: 'e', uuid: 'Actor.hero.ActiveEffect.e', name: 'Light', type: 'base', disabled: false, isSuppressed: true,
    statuses: new Set(['blinded']), toObject: () => ({ disabled: false, duration: { seconds: 30 } }) };
  world.actor.effects.set('e', effects);
  assert.equal((await execute('get_actor_items', { actor_uuid: world.actor.uuid }, world)).length, 1);
  assert.equal((await execute('get_actor_items', { actor_uuid: world.actor.uuid, item_type: 'spell' }, world)).length, 0);
  assert.equal((await execute('get_item_data', { item_uuid: world.item.uuid }, world)).source.system.quantity, 1);
  assert.equal((await execute('get_activities', { item_uuid: world.item.uuid }, world)).length, 4);
  assert.equal((await execute('get_activity', { item_uuid: world.item.uuid, activity_id: '1attack' }, world)).activity.type, 'attack');
  assert.equal((await execute('get_effects', { actor_uuid: world.actor.uuid }, world))[0].suppressed, true);
  assert.deepEqual(plain((await execute('get_system_config', {}, world)).active_modules), [{ id: 'fixture-addon', version: '1.0.0' }]);
});

test('skill method is dispatched on the actor instance, preserving an installed wrapper', async () => {
  const world = fixture();
  const original = world.actor.rollSkill.bind(world.actor);
  world.actor.rollSkill = async function (...params) { world.calls.push(['module-wrapper']); return original(...params); };
  const result = await execute('roll_skill', { actor_uuid: world.actor.uuid, skill: 'ath', ability: 'con', advantage: true, dc: 15, chat_message: true, roll_mode: 'gm' }, world);
  assert.equal(result.rolls[0].total, 14);
  assert.equal(world.calls[0][0], 'module-wrapper');
  const call = world.calls.find(c => c[0] === 'rollSkill');
  assert.deepEqual(plain(call.slice(1)), [{ advantage: true, target: 15, skill: 'ath', ability: 'con' }, { configure: false }, { create: true, rollMode: 'gm' }]);
});

for (const [id, args, method] of [
  ['roll_ability_check', { ability: 'str' }, 'rollAbilityCheck'],
  ['roll_saving_throw', { ability: 'con' }, 'rollSavingThrow'],
  ['roll_tool_check', { tool: 'smith', ability: 'str' }, 'rollToolCheck'],
  ['roll_concentration', { dc: 14 }, 'rollConcentration'],
  ['roll_hit_die', { denomination: 'd8' }, 'rollHitDie'],
]) {
  test(`${id} calls the inspected three-argument API with dialogs/chat disabled by default`, async () => {
    const world = fixture();
    const result = await execute(id, { actor_uuid: world.actor.uuid, ...args }, world);
    const call = world.calls.find(c => c[0] === method);
    assert.deepEqual(plain(call[2]), { configure: false });
    assert.deepEqual(plain(call[3]), { create: false });
    assert.equal(result.actor_uuid, world.actor.uuid);
    assert.equal(result.rolls.length, 1);
  });
}

test('death save preflight and observed counters', async () => {
  const world = fixture();
  await assert.rejects(execute('roll_death_save', { actor_uuid: world.actor.uuid }, world), /zero HP/);
  world.actor.system.attributes.hp.value = 0;
  const result = await execute('roll_death_save', { actor_uuid: world.actor.uuid }, world);
  assert.equal(result.observed_actor.death.success, 1);
});

for (const [id, args, pattern] of [
  ['roll_skill', { skill: 'unknown' }, /Unknown skill/],
  ['roll_ability_check', { ability: 'constructor' }, /Invalid/],
  ['roll_saving_throw', { ability: 'str', dc: Infinity }, /finite/],
  ['roll_tool_check', { tool: 'unknown' }, /Unknown tool/],
  ['roll_hit_die', { denomination: 'd20' }, /No matching/],
]) {
  test(`${id} rejects invalid preflight before dispatch`, async () => {
    const world = fixture();
    await assert.rejects(execute(id, { actor_uuid: world.actor.uuid, ...args }, world), pattern);
    assert.deepEqual(world.calls, []);
  });
}

for (const response of [null, undefined, false, [], [{ total: Infinity, formula: '1d20' }]]) {
  test(`unconfirmed roll result ${JSON.stringify(response)} is outcome_unknown without retry`, async () => {
    const world = fixture(); let count = 0;
    world.actor.rollSkill = async () => { count++; return response; };
    await assert.rejects(execute('roll_skill', { actor_uuid: world.actor.uuid, skill: 'ath' }, world), /outcome_unknown/);
    assert.equal(count, 1);
  });
}

test('post-dispatch exceptions report uncertainty and preserve already changed state', async () => {
  const world = fixture(); let count = 0;
  world.actor.applyDamage = async () => { count++; world.actor.system.attributes.hp.value = 1; throw new Error('post hook failed'); };
  await assert.rejects(execute('apply_damage', { actor_uuid: world.actor.uuid, damages: [{ type: 'fire', value: 7 }] }, world), /outcome_unknown/);
  assert.equal(count, 1); assert.equal(world.actor.system.attributes.hp.value, 1);
});

test('damage preview preserves typed entries, set properties and array summary totals', async () => {
  const world = fixture();
  const result = plain(await execute('calculate_damage', { actor_uuid: world.actor.uuid,
    damages: [{ type: 'poison', value: 5 }, { type: 'fire', value: 4, properties: ['mgc'] }], multiplier: 0.5 }, world));
  assert.equal(result.amount, 2); assert.deepEqual(result.entries[1].properties, ['mgc']);
  assert.equal(world.actor.system.attributes.hp.value, 12);
  assert.equal(world.calls.some(c => c[0] === 'applyDamage'), false);
});

test('damage apply reports observed HP and does not manufacture success when a hook leaves HP unchanged', async () => {
  const world = fixture();
  let result = await execute('apply_damage', { actor_uuid: world.actor.uuid, damages: [{ type: 'fire', value: 4 }] }, world);
  assert.equal(result.before.hp.value, 12); assert.equal(result.after.hp.value, 8); assert.equal(result.hp_changed, true);
  world.actor.applyDamage = async () => world.actor;
  result = await execute('apply_damage', { actor_uuid: world.actor.uuid, damages: [{ type: 'poison', value: 4 }] }, world);
  assert.equal(result.hp_changed, false);
});

test('unknown types and malformed damage properties never reach actor damage calculation', async () => {
  const world = fixture();
  for (const damages of [[{ type: 'unknown', value: 1 }], [{ type: 'fire', value: -1 }], [{ type: 'fire', value: 1, properties: ['eval'] }]]) {
    await assert.rejects(execute('calculate_damage', { actor_uuid: world.actor.uuid, damages }, world));
  }
  assert.deepEqual(world.calls, []);
});

test('rests use public methods, disable global side effects and confirm planned updates', async () => {
  const world = fixture();
  const result = await execute('long_rest', { actor_uuid: world.actor.uuid, new_day: true }, world);
  assert.equal(result.after.hp.value, 20); assert.equal(result.observed_planned_updates, true);
  assert.deepEqual(plain(world.calls[0][1]), { dialog: false, chat: false, newDay: true, advanceTime: false, advanceBastionTurn: false, autoHD: false });
  const short = await execute('short_rest', { actor_uuid: world.actor.uuid, new_day: false }, world);
  assert.equal(short.rest_type, 'short');
});

test('rest hook returning an unapplied plan cannot be reported as confirmed', async () => {
  const world = fixture(); let calls = 0;
  world.actor.longRest = async () => { calls++; return { updateData: { 'system.attributes.hp.value': 20 }, updateItems: [], deleteItems: [] }; };
  await assert.rejects(execute('long_rest', { actor_uuid: world.actor.uuid, new_day: true }, world), /outcome_unknown/);
  assert.equal(calls, 1);
});

test('conditions use explicit state, avoid accidental level increment, and verify removal despite false return', async () => {
  const world = fixture();
  await assert.rejects(execute('set_condition', { actor_uuid: world.actor.uuid, condition: 'exhaustion', active: false }, world), /Levelled/);
  assert.equal(world.calls.length, 0);
  let result = await execute('set_condition', { actor_uuid: world.actor.uuid, condition: 'blinded', active: true }, world);
  assert.equal(result.changed, true);
  result = await execute('set_condition', { actor_uuid: world.actor.uuid, condition: 'blinded', active: true }, world);
  assert.equal(result.changed, false);
  result = await execute('set_condition', { actor_uuid: world.actor.uuid, condition: 'blinded', active: false }, world);
  assert.equal(result.active, false);
});

test('condition hook veto is not treated as a successful change', async () => {
  const world = fixture(); world.actor.toggleStatusEffect = async () => true;
  await assert.rejects(execute('set_condition', { actor_uuid: world.actor.uuid, condition: 'blinded', active: true }, world), /outcome_unknown/);
});

test('activity activation is resource-only with explicit headless configuration', async () => {
  const world = fixture();
  const result = await execute('activate_activity', { item_uuid: world.item.uuid, activity_id: world.utility.id }, world);
  assert.equal(result.activity_id, world.utility.id);
  const call = world.calls.find(c => c[0] === 'use');
  assert.deepEqual(plain(call.slice(1)), [{ create: false, subsequentActions: false, concentration: { begin: false, end: false } }, { configure: false }, { create: false }]);
  assert.equal(world.calls.some(c => c[0] === 'rollFormula'), false);
});

test('concentration/custom activities and implicit browser targets are rejected before activation', async () => {
  const world = fixture();
  world.utility.requiresConcentration = true;
  await assert.rejects(execute('activate_activity', { item_uuid: world.item.uuid, activity_id: world.utility.id }, world), /Concentration/);
  world.utility.requiresConcentration = false; world.utility.type = 'summon';
  await assert.rejects(execute('activate_activity', { item_uuid: world.item.uuid, activity_id: world.utility.id }, world), /outside/);
  world.utility.type = 'utility'; world.game.user.targets.add({ uuid: 'Scene.x.Token.target' });
  await assert.rejects(execute('activate_activity', { item_uuid: world.item.uuid, activity_id: world.utility.id }, world), /target selection/);
  assert.deepEqual(world.calls, []);
});

test('attack roll selects a real activity and explicit hand mode, never an arbitrary method', async () => {
  const world = fixture();
  const result = await execute('roll_activity_attack', { item_uuid: world.item.uuid, activity_id: world.attack.id, attack_mode: 'oneHanded', ammunition_id: null }, world);
  assert.equal(result.rolls[0].total, 14);
  const call = world.calls.find(c => c[0] === 'rollAttack');
  assert.deepEqual(plain(call[1]), { attackMode: 'oneHanded', ammunition: false });
  assert.deepEqual(plain(call[2]), { configure: false });
});

test('attack preflight rejects zero quantity or unavailable ammunition', async () => {
  const world = fixture(); const args = { item_uuid: world.item.uuid, activity_id: world.attack.id, attack_mode: 'ranged', ammunition_id: 'missing' };
  await assert.rejects(execute('roll_activity_attack', args, world), /ammunition/);
  world.item.system.quantity = 0;
  await assert.rejects(execute('roll_activity_attack', { ...args, attack_mode: 'oneHanded', ammunition_id: null }, world), /quantity/);
  assert.deepEqual(world.calls, []);
});

test('a ranged ammunition weapon cannot bypass consumption when no ammunition choices exist', async () => {
  const world = fixture(); world.item.system.properties = new Set(['amm']);
  await assert.rejects(execute('roll_activity_attack', { item_uuid: world.item.uuid, activity_id: world.attack.id,
    attack_mode: 'ranged', ammunition_id: null }, world), /requires an explicit ammunition/);
  assert.deepEqual(world.calls, []);
});

test('activity damage and stored utility formula use separate methods without resource activation', async () => {
  const world = fixture();
  const result = await execute('roll_activity_damage', { item_uuid: world.item.uuid, activity_id: world.damage.id, critical: true }, world);
  assert.equal(result.rolls[0].total, 8);
  assert.deepEqual(plain(world.calls.find(c => c[0] === 'rollDamage')[1]), { isCritical: true });
  await execute('roll_activity_formula', { item_uuid: world.item.uuid, activity_id: world.utility.id }, world);
  assert.equal(world.calls.filter(c => c[0] === 'rollFormula').length, 1);
  assert.equal(world.calls.filter(c => c[0] === 'use').length, 0);
});

for (const mode of ['public', 'gm', 'blind', 'self']) {
  test(`Foundry 14 message mode ${mode} is forwarded using the D&D5e rollMode argument`, async () => {
    const world = fixture();
    await execute('roll_skill', { actor_uuid: world.actor.uuid, skill: 'ath', chat_message: true, roll_mode: mode }, world);
    assert.equal(world.calls.find(c => c[0] === 'rollSkill')[3].rollMode, mode);
  });
}

for (const mode of ['publicroll', 'gmroll', 'blindroll', 'selfroll']) {
  test(`obsolete mode ${mode} is rejected before rolling`, async () => {
    const world = fixture();
    await assert.rejects(execute('roll_skill', { actor_uuid: world.actor.uuid, skill: 'ath', roll_mode: mode }, world), /Foundry 14/);
    assert.deepEqual(world.calls, []);
  });
}

test('non-GM local-only roll cannot bypass actual ChatMessage visibility', async () => {
  const world = fixture(); world.game.user.isGM = false;
  await assert.rejects(execute('roll_skill', { actor_uuid: world.actor.uuid, skill: 'ath' }, world), /chat_message=true/);
  assert.equal(world.calls.some(c => c[0] === 'rollSkill'), false);
});

for (const [label, parent] of [
  ['forced blind', { uuid: 'ChatMessage.hidden', isContentVisible: false, blind: true }],
  ['private message invisible', { uuid: 'ChatMessage.hidden', isContentVisible: false }],
  ['wrapper suppressing chat', null],
  ['unknown visibility', { uuid: 'ChatMessage.hidden' }],
]) {
  test(`${label} redacts non-GM dice and formula even when public was requested`, async () => {
    const world = fixture(); world.game.user.isGM = false;
    world.actor.rollSkill = async () => [{ ...world.evaluated(917), formula: '1d20 + SECRET_BONUS', parent }];
    const result = plain(await execute('roll_skill', { actor_uuid: world.actor.uuid, skill: 'ath', chat_message: true, roll_mode: 'public' }, world));
    assert.equal(result.rolls_redacted, true); assert.deepEqual(result.rolls, []);
    assert.equal(JSON.stringify(result).includes('917'), false);
    assert.equal(JSON.stringify(result).includes('SECRET_BONUS'), false);
  });
}

test('visible non-GM chat allows results; GM can read blind results', async () => {
  const world = fixture(); world.game.user.isGM = false;
  world.actor.rollSkill = async () => [{ ...world.evaluated(17), parent: { uuid: 'ChatMessage.visible', isContentVisible: true, blind: false } }];
  let result = await execute('roll_skill', { actor_uuid: world.actor.uuid, skill: 'ath', chat_message: true }, world);
  assert.equal(result.rolls_redacted, false); assert.equal(result.rolls[0].total, 17);
  world.game.user.isGM = true;
  world.actor.rollSkill = async () => [{ ...world.evaluated(17), parent: { uuid: 'ChatMessage.blind', isContentVisible: false, blind: true } }];
  result = await execute('roll_skill', { actor_uuid: world.actor.uuid, skill: 'ath', chat_message: true }, world);
  assert.equal(result.rolls[0].total, 17);
});

function spellFixture() {
  const world = fixture(); world.item.type = 'spell'; world.item.system.level = 1;
  world.utility.requiresSpellSlot = true; world.utility.consumption.spellSlot = true;
  return world;
}

test('spell resource activation requires an available same-level explicit slot', async () => {
  const world = spellFixture();
  await execute('activate_activity', { item_uuid: world.item.uuid, activity_id: world.utility.id, spell_slot: 'spell1' }, world);
  assert.deepEqual(plain(world.calls.find(c => c[0] === 'use')[1].spell), { slot: 'spell1' });
});

for (const [label, configure, slot, error] of [
  ['missing explicit slot', () => {}, undefined, /explicit spell_slot/],
  ['nonexistent slot', () => {}, 'spell2', /does not support/],
  ['empty slot', w => { w.actor.system.spells.spell1.value = 0; }, 'spell1', /no available uses/],
  ['undercast', w => { w.item.system.level = 9; }, 'spell1', /below the spell level/],
  ['upcast', w => { w.actor.system.spells.spell2 = { level: 2, value: 1 }; }, 'spell2', /Upcasting/],
  ['higher-level pact slot', w => { w.actor.system.spells.pact = { level: 3, value: 1 }; }, 'pact', /Upcasting/],
]) {
  test(`${label} is rejected before resource activation`, async () => {
    const world = spellFixture(); configure(world);
    await assert.rejects(execute('activate_activity', { item_uuid: world.item.uuid, activity_id: world.utility.id, ...(slot ? { spell_slot: slot } : {}) }, world), error);
    assert.deepEqual(world.calls, []);
  });
}

test('attack damage requires explicit context and forwards the real ammunition Item', async () => {
  const world = fixture();
  const args = { item_uuid: world.item.uuid, activity_id: world.attack.id, critical: false };
  await assert.rejects(execute('roll_activity_damage', args, world), /attack ability/);
  const ammo = { ...world.item, id: 'ammo', uuid: `${world.actor.uuid}.Item.ammo`, system: { quantity: 1 } };
  world.actor.items.set('ammo', ammo); world.item.system.ammunitionOptions = [{ value: 'ammo' }];
  await execute('roll_activity_damage', { ...args, ability: 'str', attack_mode: 'ranged', ammunition_id: 'ammo' }, world);
  const call = world.calls.find(c => c[0] === 'rollDamage');
  assert.equal(call[1].ammunition, ammo); assert.equal(call[1].attackMode, 'ranged'); assert.equal(call[1].ability, 'str');
});

test('deleted ammunition and scaled/consumed contexts cannot silently become base damage', async () => {
  const world = fixture();
  await assert.rejects(execute('roll_activity_damage', { item_uuid: world.item.uuid, activity_id: world.attack.id, critical: false,
    ability: 'str', attack_mode: 'ranged', ammunition_id: 'deleted' }, world), /unavailable/);
  world.item.flags = { dnd5e: { scaling: 2 } };
  await assert.rejects(execute('roll_activity_damage', { item_uuid: world.item.uuid, activity_id: world.damage.id, critical: false }, world), /activation context/);
  await assert.rejects(execute('roll_activity_formula', { item_uuid: world.item.uuid, activity_id: world.utility.id }, world), /activation context/);
  assert.deepEqual(world.calls, []);
});

test('reported usage plans preserve embedded Item _id while dropping private internals', async () => {
  const world = fixture();
  world.utility.use = async () => ({ updates: { actor: {}, item: [{ _id: 'weapon', 'system.uses.spent': 1, _source: { secret: true } }] }, effects: [], templates: [] });
  const result = await execute('activate_activity', { item_uuid: world.item.uuid, activity_id: world.utility.id }, world);
  assert.equal(result.reported_updates.item[0]._id, 'weapon');
  assert.equal('_source' in result.reported_updates.item[0], false);
});
