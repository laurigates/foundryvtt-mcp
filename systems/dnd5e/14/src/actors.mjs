import { actorInput, array, boolean, damageInput, jsonObject, key, number, object, reference, rollOptions, rollResult, text, uuid, withJson } from './schema.mjs';

const actorSummary = withJson(object({ actor: reference, prepared: jsonObject, statuses: array(text) }));
const observed = withJson(object({ actor_uuid: text, before: jsonObject, after: jsonObject, hp_changed: boolean }));
const restResult = withJson(object({ actor_uuid: text, rest_type: { enum: ['short', 'long'] }, new_day: boolean,
  before: jsonObject, after: jsonObject, reported_deltas: jsonObject, observed_planned_updates: boolean,
  message_uuid: { type: ['string', 'null'] } }));
const rollInput = (extra = {}, required = []) => object({ ...actorInput, ...rollOptions, ...extra }, ['actor_uuid', ...required]);

export const operations = [
  {
    id: 'get_actor_summary', readOnly: true,
    description: 'Read prepared D&D5e actor statistics, abilities, skills, spells, currencies and traits after system/module preparation.',
    inputSchema: object(actorInput), outputSchema: actorSummary,
    handler: async function (args, runtime) {
      const actor = await runtime.actor(args.actor_uuid);
      const prepared = {};
      for (const field of ['abilities', 'skills', 'tools', 'attributes', 'details', 'spells', 'currency', 'resources', 'traits', 'conditions', 'bonuses']) prepared[field] = actor.system?.[field] ?? {};
      return { actor: runtime.summary(actor), prepared: runtime.json(prepared), statuses: Array.from(actor.statuses ?? []) };
    },
  },
  {
    id: 'get_actor_items', readOnly: true,
    description: 'Read the selected actor inventory and spell items, their prepared system data and activity IDs. No Item Piles transaction semantics are implied.',
    inputSchema: object({ ...actorInput, item_type: key }, ['actor_uuid']),
    outputSchema: withJson(array(object({ item: reference, system: jsonObject, activity_ids: array(text) }))),
    handler: async function (args, runtime) {
      const actor = await runtime.actor(args.actor_uuid);
      if (args.item_type !== undefined) runtime.identifier(args.item_type, 'item type');
      return runtime.values(actor.items).filter(item => args.item_type === undefined || item.type === args.item_type).map(item => {
        runtime.permission(item, false);
        return { item: runtime.summary(item), system: runtime.json(item.system ?? {}), activity_ids: runtime.values(item.system?.activities).map(a => a.id) };
      });
    },
  },
  {
    id: 'get_item_data', readOnly: true,
    description: 'Read a D&D5e Item source plus prepared system data without opening its sheet or triggering use.',
    inputSchema: object({ item_uuid: uuid }),
    outputSchema: withJson(object({ item: reference, source: jsonObject, prepared: jsonObject })),
    handler: async function (args, runtime) {
      const item = await runtime.item(args.item_uuid); runtime.method(item, 'toObject');
      return { item: runtime.summary(item), source: runtime.json(item.toObject()), prepared: runtime.json(item.system ?? {}) };
    },
  },
  {
    id: 'get_effects', readOnly: true,
    description: 'Read actor and embedded-item ActiveEffects with suppression, disabled state and statuses; does not alter effect definitions.',
    inputSchema: object(actorInput),
    outputSchema: withJson(array(object({ effect: reference, parent_uuid: { type: ['string', 'null'] }, disabled: boolean, suppressed: boolean, statuses: array(text), data: jsonObject }))),
    handler: async function (args, runtime) {
      const actor = await runtime.actor(args.actor_uuid);
      const documents = [actor, ...runtime.values(actor.items)];
      return documents.flatMap(parent => runtime.values(parent.effects).map(effect => ({
        effect: runtime.summary(effect), parent_uuid: parent.uuid ?? null, disabled: effect.disabled === true,
        suppressed: effect.isSuppressed === true, statuses: Array.from(effect.statuses ?? []),
        data: runtime.json(typeof effect.toObject === 'function' ? effect.toObject() : {}),
      })));
    },
  },
  {
    id: 'get_roll_data', readOnly: true, actorMethods: ['getRollData'],
    description: 'Read the actor system roll data through its actual getRollData method. Document references become summaries; no formula is evaluated.',
    inputSchema: object(actorInput), outputSchema: withJson(jsonObject),
    handler: async function (args, runtime) {
      const actor = await runtime.actor(args.actor_uuid); runtime.method(actor, 'getRollData');
      return runtime.json(actor.getRollData({ deterministic: true }));
    },
  },
  {
    id: 'get_system_config', readOnly: true,
    description: 'Read selected runtime D&D5e ability, skill, tool, currency, damage and condition definitions, plus active module IDs and versions. Not the complete system configuration.',
    inputSchema: object({}),
    outputSchema: withJson(object({ system_id: { const: 'dnd5e' }, system_version: text, foundry_version: text, definitions: jsonObject,
      active_modules: array(object({ id: text, version: text })) })),
    handler: async function (args, runtime) {
      const definitions = {};
      for (const key of ['abilities', 'skills', 'tools', 'currencies', 'damageTypes', 'healingTypes', 'conditionTypes', 'itemProperties']) definitions[key] = runtime.config[key] ?? {};
      return { system_id: 'dnd5e', system_version: runtime.game.system.version,
        foundry_version: String(runtime.game.version ?? runtime.game.release?.version ?? ''), definitions: runtime.json(definitions),
        active_modules: runtime.values(runtime.game.modules).filter(m => m.active).map(m => ({ id: String(m.id ?? ''), version: String(m.version ?? '') })).sort((a, b) => a.id.localeCompare(b.id)),
      };
    },
  },
  {
    id: 'calculate_damage', readOnly: true, actorMethods: ['calculateDamage'],
    description: 'Calculate typed damage/healing using the actor system resistances, immunities, vulnerabilities and modifiers. A preview, not a reservation or HP update; calculation hooks run.',
    inputSchema: object(damageInput, ['actor_uuid', 'damages']),
    outputSchema: withJson(object({ entries: array(jsonObject), amount: number, temporary_hp: number, temporary_max_hp: number })),
    handler: async function (args, runtime) {
      const actor = await runtime.actor(args.actor_uuid); runtime.method(actor, 'calculateDamage');
      return runtime.damageSummary(actor.calculateDamage(runtime.damage(args.damages), runtime.damageOptions(args)));
    },
  },
  {
    id: 'roll_ability_check', readOnly: false, actorMethods: ['rollAbilityCheck'],
    description: 'Roll a system ability check with prepared bonuses and hooks, with the configuration dialog disabled. Chat is opt-in.',
    inputSchema: rollInput({ ability: key }, ['ability']), outputSchema: rollResult,
    handler: async function (args, runtime) {
      const actor = await runtime.actor(args.actor_uuid);
      const ability = runtime.selection(runtime.config.abilities, args.ability, 'ability');
      return runtime.rollActor(actor, 'rollAbilityCheck', args, { ability });
    },
  },
  {
    id: 'roll_saving_throw', readOnly: false, actorMethods: ['rollSavingThrow'],
    description: 'Roll a system saving throw through Actor.rollSavingThrow. Does not guess a saving throw from a generic d20 roll.',
    inputSchema: rollInput({ ability: key }, ['ability']), outputSchema: rollResult,
    handler: async function (args, runtime) {
      const actor = await runtime.actor(args.actor_uuid);
      const ability = runtime.selection(runtime.config.abilities, args.ability, 'ability');
      return runtime.rollActor(actor, 'rollSavingThrow', args, { ability });
    },
  },
  {
    id: 'roll_skill', readOnly: false, actorMethods: ['rollSkill'],
    description: 'Roll a configured D&D5e skill using its actual actor method, including installed wrappers. Unknown skills are rejected instead of falling back to an ability check.',
    inputSchema: rollInput({ skill: key, ability: key }, ['skill']), outputSchema: rollResult,
    handler: async function (args, runtime) {
      const actor = await runtime.actor(args.actor_uuid);
      const config = { skill: runtime.selection(runtime.config.skills, args.skill, 'skill') };
      if (!actor.system?.skills?.[config.skill]) runtime.fail('The actor does not have this skill');
      if (args.ability !== undefined) config.ability = runtime.selection(runtime.config.abilities, args.ability, 'ability');
      return runtime.rollActor(actor, 'rollSkill', args, config);
    },
  },
  {
    id: 'roll_tool_check', readOnly: false, actorMethods: ['rollToolCheck'],
    description: 'Roll a configured actor tool proficiency through the D&D5e tool-check API without opening a dialog.',
    inputSchema: rollInput({ tool: key, ability: key }, ['tool']), outputSchema: rollResult,
    handler: async function (args, runtime) {
      const actor = await runtime.actor(args.actor_uuid);
      const tool = runtime.selection(runtime.config.tools, args.tool, 'tool');
      const config = { tool };
      if (args.ability !== undefined) config.ability = runtime.selection(runtime.config.abilities, args.ability, 'ability');
      return runtime.rollActor(actor, 'rollToolCheck', args, config);
    },
  },
  {
    id: 'roll_death_save', readOnly: false, actorMethods: ['rollDeathSave'],
    description: 'Roll a death saving throw; D&D5e can update death counters and HP. Returns the roll and observed actor state, including hook-dependent changes.',
    inputSchema: rollInput(), outputSchema: rollResult,
    handler: async function (args, runtime) {
      const actor = await runtime.actor(args.actor_uuid);
      const hp = actor.system?.attributes?.hp, death = actor.system?.attributes?.death;
      if (!hp || !death || hp.value > 0 || death.failure >= 3 || death.success >= 3) runtime.fail('A death save requires zero HP and unfinished death counters');
      if (args.dc !== undefined && args.dc !== 10) runtime.fail('Death saves use the system DC of 10');
      return runtime.rollActor(actor, 'rollDeathSave', args);
    },
  },
  {
    id: 'roll_concentration', readOnly: false, actorMethods: ['rollConcentration'],
    description: 'Roll a system concentration saving throw at an explicit DC. The API and installed hooks determine effects; the bridge does not independently end concentration.',
    inputSchema: object({ ...actorInput, ...rollOptions }, ['actor_uuid', 'dc']), outputSchema: rollResult,
    handler: async function (args, runtime) {
      const actor = await runtime.actor(args.actor_uuid);
      if (!actor.system?.attributes?.concentration) runtime.fail('This actor does not support concentration');
      return runtime.rollActor(actor, 'rollConcentration', args);
    },
  },
  {
    id: 'roll_hit_die', readOnly: false, actorMethods: ['rollHitDie'],
    description: 'Spend one hit die of an explicit denomination and apply system healing. Returns observed HP/hit-die state because hooks can prevent individual updates.',
    inputSchema: object({ ...actorInput, denomination: { type: 'string', enum: ['d4', 'd6', 'd8', 'd10', 'd12', 'd20'] }, chat_message: boolean,
      roll_mode: rollOptions.roll_mode }, ['actor_uuid', 'denomination']), outputSchema: rollResult,
    handler: async function (args, runtime) {
      const actor = await runtime.actor(args.actor_uuid);
      if (!['d4', 'd6', 'd8', 'd10', 'd12', 'd20'].includes(args.denomination)) runtime.fail('Invalid hit-die denomination');
      const hd = actor.system?.attributes?.hd;
      if (actor.system?.isNPC) {
        if (String(hd?.denomination) !== args.denomination.slice(1) || !(hd.value > 0)) runtime.fail('No matching NPC hit die is available');
      } else if (!runtime.values(hd?.classes).some(c => c.system?.hd?.denomination === args.denomination && c.system.hd.value > 0)) runtime.fail('No matching class hit die is available');
      return runtime.rollActor(actor, 'rollHitDie', args, { denomination: args.denomination, modifyHitDice: true, modifyHitPoints: true });
    },
  },
  {
    id: 'apply_damage', readOnly: false, actorMethods: ['applyDamage'],
    description: 'Apply typed damage/healing through Actor.applyDamage, preserving system rules and module hooks. Reports before/after HP and whether HP changed; a hook veto or immunity can legitimately leave it unchanged.',
    inputSchema: object(damageInput, ['actor_uuid', 'damages']), outputSchema: observed,
    handler: async function (args, runtime) {
      const actor = await runtime.actor(args.actor_uuid);
      if (!actor.system?.attributes?.hp) runtime.fail('The actor has no HP pool');
      const damages = runtime.damage(args.damages), options = runtime.damageOptions(args);
      const before = runtime.actorState(actor);
      const result = await runtime.invoke(actor, 'applyDamage', [damages, options]);
      if (result !== actor && result?.uuid !== actor.uuid) runtime.unknown('Damage application returned an unexpected actor');
      const after = runtime.actorState(actor);
      return { actor_uuid: actor.uuid, before, after, hp_changed: JSON.stringify(before.hp) !== JSON.stringify(after.hp) };
    },
  },
  {
    id: 'short_rest', readOnly: false, actorMethods: ['shortRest'],
    description: 'Perform a system short rest without dialogs, automatic hit-die spending, world-time advancement or bastion turns. new_day is explicit; planned actor/item updates are checked against observed state.',
    inputSchema: object({ ...actorInput, new_day: boolean, chat_message: boolean }, ['actor_uuid', 'new_day']), outputSchema: restResult,
    handler: async function (args, runtime) { return runtime.rest(await runtime.actor(args.actor_uuid), 'shortRest', args); },
  },
  {
    id: 'long_rest', readOnly: false, actorMethods: ['longRest'],
    description: 'Perform a system long rest without dialogs, world-time advancement or bastion turns. The system decides recovery; new_day is explicit and observed planned actor/item updates are checked.',
    inputSchema: object({ ...actorInput, new_day: boolean, chat_message: boolean }, ['actor_uuid', 'new_day']), outputSchema: restResult,
    handler: async function (args, runtime) { return runtime.rest(await runtime.actor(args.actor_uuid), 'longRest', args); },
  },
  {
    id: 'set_condition', readOnly: false, actorMethods: ['toggleStatusEffect'],
    description: 'Set an explicit non-levelled D&D5e condition active/inactive through the actual system override and verify observed status. Levelled conditions such as exhaustion are rejected.',
    inputSchema: object({ ...actorInput, condition: key, active: boolean }),
    outputSchema: object({ actor_uuid: text, condition: text, active: boolean, changed: boolean }),
    handler: async function (args, runtime) {
      const actor = await runtime.actor(args.actor_uuid);
      const condition = runtime.selection(runtime.config.conditionTypes, args.condition, 'condition');
      if (Number.isFinite(runtime.config.conditionTypes[condition]?.levels)) runtime.fail('Levelled conditions require a separate contract');
      if (typeof args.active !== 'boolean') runtime.fail('active must be explicit');
      const before = actor.statuses?.has(condition) === true;
      if (before === args.active) return { actor_uuid: actor.uuid, condition, active: before, changed: false };
      runtime.method(actor, 'toggleStatusEffect');
      try { await actor.toggleStatusEffect(condition, { active: args.active }); }
      catch (error) { runtime.unknown(`Condition change failed after dispatch (${String(error?.message ?? error).slice(0, 300)})`); }
      const after = actor.statuses?.has(condition) === true;
      if (after !== args.active) runtime.unknown('The requested condition state was not observed');
      return { actor_uuid: actor.uuid, condition, active: after, changed: true };
    },
  },
];
