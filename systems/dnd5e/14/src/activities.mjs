import { activityInput, array, boolean, jsonObject, key, object, reference, rollOptions, rollResult, text, uuid, withJson } from './schema.mjs';

const activitySummary = object({ id: text, uuid: text, name: text, type: text, can_use: boolean,
  hidden: boolean, requires_concentration: boolean, activation: jsonObject, consumption: jsonObject,
  uses: jsonObject, target: jsonObject, range: jsonObject });

export const operations = [
  {
    id: 'get_activities', readOnly: true,
    description: 'List an owned or readable Item activities, exact IDs, types, resource consumption and use eligibility. Activity IDs select fixed operations; no function name is accepted.',
    inputSchema: object({ item_uuid: uuid }), outputSchema: withJson(array(activitySummary)),
    handler: async function (args, runtime) {
      const item = await runtime.item(args.item_uuid);
      return runtime.values(item.system?.activities).map(a => runtime.activitySummary(a));
    },
  },
  {
    id: 'get_activity', readOnly: true,
    description: 'Read one activity source and prepared targeting/consumption metadata without activating it.',
    inputSchema: object(activityInput), outputSchema: withJson(object({ item: reference, activity: activitySummary, source: jsonObject })),
    handler: async function (args, runtime) {
      const { item, activity } = await runtime.activity(args);
      runtime.method(activity, 'toObject');
      return { item: runtime.summary(item), activity: runtime.activitySummary(activity), source: runtime.json(activity.toObject()) };
    },
  },
  {
    id: 'activate_activity', readOnly: false,
    activityMethods: [{ type: 'utility', method: 'use' }],
    description: 'Activate a built-in attack/check/save/damage/heal/utility activity and its configured resource consumption without dialogs, templates or subsequent actions. Does not perform attack/damage or apply target effects. Slot-consuming spells require an explicit available slot at exactly their base level; upcasting, concentration and specialized/custom activity types are excluded.',
    inputSchema: object({ ...activityInput, chat_message: boolean, roll_mode: rollOptions.roll_mode,
      spell_slot: { type: 'string', pattern: '^(?:spell[1-9]|pact)$' } }, ['item_uuid', 'activity_id']),
    outputSchema: withJson(object({ actor_uuid: text, item_uuid: text, activity_id: text,
      observed_actor: jsonObject, reported_updates: jsonObject, message_uuid: { type: ['string', 'null'] },
      effects: array(reference), templates: array(reference) })),
    handler: async function (args, runtime) {
      const { actor, item, activity } = await runtime.activity(args, ['attack', 'check', 'save', 'damage', 'heal', 'utility'], 'use');
      runtime.ensureNoTargets();
      if (activity.requiresConcentration) runtime.fail('Concentration activity activation requires an explicit concentration workflow and is not exposed here');
      const usage = { create: false, subsequentActions: false, concentration: { begin: false, end: false } };
      if (activity.requiresSpellSlot && activity.consumption?.spellSlot && args.spell_slot === undefined) runtime.fail('A slot-consuming spell requires an explicit spell_slot');
      if (args.spell_slot !== undefined) {
        if (typeof args.spell_slot !== 'string' || !/^(?:spell[1-9]|pact)$/.test(args.spell_slot)) runtime.fail('Invalid spell slot');
        if (item.type !== 'spell' || !activity.requiresSpellSlot || !activity.consumption?.spellSlot) runtime.fail('The activity does not consume a spell slot');
        const slot = actor.system?.spells?.[args.spell_slot];
        if (!slot || !Number.isFinite(slot.level) || !Number.isFinite(item.system.level)) runtime.fail('The activity or actor does not support this spell slot');
        if (slot.level < item.system.level) runtime.fail('The spell slot level is below the spell level');
        if (slot.level > item.system.level) runtime.fail('Upcasting needs a preserved activation context and is outside this operation contract');
        if (!Number.isFinite(slot.value) || slot.value <= 0) runtime.fail('The selected spell slot has no available uses');
        usage.spell = { slot: args.spell_slot };
      }
      const message = runtime.messageConfig(args);
      const result = await runtime.invoke(activity, 'use', [usage, { configure: false }, message]);
      if (!result || typeof result !== 'object' || !result.updates || !Array.isArray(result.effects) || !Array.isArray(result.templates)) runtime.unknown('Activity use returned an invalid result');
      return { actor_uuid: actor.uuid, item_uuid: item.uuid, activity_id: activity.id,
        observed_actor: runtime.actorState(actor), reported_updates: runtime.json(result.updates),
        message_uuid: result.message?.uuid ?? null,
        effects: result.effects.map(e => runtime.summary(e)), templates: result.templates.map(t => runtime.summary(t)) };
    },
  },
  {
    id: 'roll_activity_attack', readOnly: false,
    activityMethods: [{ type: 'attack', method: 'rollAttack' }],
    description: 'Roll a built-in attack activity with explicit attack mode. May consume ammunition/thrown items and update last-used flags; does not activate other resources or apply damage. Runtime token targets must be empty.',
    inputSchema: object({ ...activityInput, ...rollOptions, ability: key,
      attack_mode: { type: 'string', enum: ['oneHanded', 'twoHanded', 'offhand', 'thrown', 'thrown-offhand', 'ranged'] },
      ammunition_id: { anyOf: [key, { type: 'null' }] },
    }, ['item_uuid', 'activity_id', 'attack_mode', 'ammunition_id']), outputSchema: rollResult,
    handler: async function (args, runtime) {
      const { actor, item, activity } = await runtime.activity(args, ['attack'], 'rollAttack');
      runtime.ensureNoTargets();
      if (!['oneHanded', 'twoHanded', 'offhand', 'thrown', 'thrown-offhand', 'ranged'].includes(args.attack_mode)) runtime.fail('Invalid attack mode');
      const modes = item.system?.attackModes ?? [];
      if (modes.length && !modes.some(mode => mode.value === args.attack_mode)) runtime.fail('The Item does not support this attack mode');
      const config = { ...runtime.rollConfig(args), attackMode: args.attack_mode, ammunition: false };
      if (args.ability !== undefined) config.ability = runtime.selection(runtime.config.abilities, args.ability, 'ability');
      if (args.ammunition_id !== null) {
        runtime.identifier(args.ammunition_id, 'ammunition ID');
        const ammunition = actor.items?.get(args.ammunition_id);
        if (!ammunition || !(ammunition.system?.quantity > 0) || !(item.system?.ammunitionOptions ?? []).some(a => a.value === args.ammunition_id)) runtime.fail('No eligible ammunition with positive quantity exists');
        runtime.permission(ammunition, true); config.ammunition = args.ammunition_id;
      } else if (args.attack_mode === 'ranged' && ((item.system?.ammunitionOptions ?? []).length || item.system?.properties?.has?.('amm'))) {
        runtime.fail('This ranged attack requires an explicit ammunition item');
      }
      if (item.type === 'weapon' && !(item.system?.quantity > 0)) runtime.fail('The weapon has no positive quantity');
      const result = await runtime.invoke(activity, 'rollAttack', [config, { configure: false }, runtime.messageConfig(args, { roll: true })]);
      return runtime.rollResult(result, actor, item, activity);
    },
  },
  {
    id: 'roll_activity_damage', readOnly: false,
    activityMethods: [{ type: 'damage', method: 'rollDamage' }],
    description: 'Roll standalone base-context damage/healing without applying it or consuming activation resources. Attack activities require explicit ability, attack_mode and ammunition_id (null for none); no prior UI/activation context is inferred. Upcasting or consumed-hit-die scaling is excluded. Chat and last damage-type flags may change.',
    inputSchema: object({ ...activityInput, critical: boolean, chat_message: boolean, roll_mode: rollOptions.roll_mode,
      ability: key, attack_mode: { type: 'string', enum: ['oneHanded', 'twoHanded', 'offhand', 'thrown', 'thrown-offhand', 'ranged'] },
      ammunition_id: { anyOf: [key, { type: 'null' }] },
    }, ['item_uuid', 'activity_id', 'critical']),
    outputSchema: rollResult,
    handler: async function (args, runtime) {
      const { actor, item, activity } = await runtime.activity(args, ['attack', 'damage', 'heal'], 'rollDamage');
      runtime.ensureNoTargets();
      if (typeof args.critical !== 'boolean') runtime.fail('critical must be explicit');
      if (item.flags?.dnd5e?.scaling || item.flags?.dnd5e?.consumed || runtime.values(activity.consumption?.targets).some(t => t.type === 'hitDice')) runtime.fail('This damage roll requires an activation context that is not supplied by this operation');
      const config = { isCritical: args.critical };
      if (activity.type === 'attack') {
        config.ability = runtime.selection(runtime.config.abilities, args.ability, 'attack ability');
        if (!['oneHanded', 'twoHanded', 'offhand', 'thrown', 'thrown-offhand', 'ranged'].includes(args.attack_mode)) runtime.fail('Attack damage requires an explicit attack_mode');
        if (item.system?.attackModes?.length && !item.system.attackModes.some(mode => mode.value === args.attack_mode)) runtime.fail('The Item does not support this attack mode');
        config.attackMode = args.attack_mode;
        if (args.ammunition_id === undefined) runtime.fail('Attack damage requires explicit ammunition_id, or null for none');
        config.ammunition = null;
        if (args.ammunition_id !== null) {
          runtime.identifier(args.ammunition_id, 'ammunition ID');
          const ammo = actor.items?.get(args.ammunition_id);
          if (!ammo || !(item.system?.ammunitionOptions ?? []).some(a => a.value === args.ammunition_id)) runtime.fail('The original ammunition Item is unavailable; its damage context cannot be reconstructed');
          runtime.permission(ammo, true); config.ammunition = ammo;
        } else if (args.attack_mode === 'ranged' && item.system?.properties?.has?.('amm')) runtime.fail('Ammunition damage context is required for this ranged weapon');
      } else if (args.ability !== undefined || args.attack_mode !== undefined || args.ammunition_id !== undefined) runtime.fail('Attack context applies only to attack activities');
      const result = await runtime.invoke(activity, 'rollDamage', [config, { configure: false }, runtime.messageConfig(args, { roll: true })]);
      return runtime.rollResult(result, actor, item, activity);
    },
  },
  {
    id: 'roll_activity_formula', readOnly: false,
    activityMethods: [{ type: 'utility', method: 'rollFormula' }],
    description: 'Roll the formula already stored on a built-in utility activity without a dialog. No caller-supplied formula or JavaScript is accepted; activation resources are not consumed.',
    inputSchema: object({ ...activityInput, chat_message: boolean, roll_mode: rollOptions.roll_mode }, ['item_uuid', 'activity_id']),
    outputSchema: rollResult,
    handler: async function (args, runtime) {
      const { actor, item, activity } = await runtime.activity(args, ['utility'], 'rollFormula');
      runtime.ensureNoTargets();
      if (!activity.roll?.formula) runtime.fail('The selected activity has no formula');
      if (item.flags?.dnd5e?.scaling || item.flags?.dnd5e?.consumed || runtime.values(activity.consumption?.targets).some(t => t.type === 'hitDice')) runtime.fail('This formula requires an activation context that is not supplied by this operation');
      const result = await runtime.invoke(activity, 'rollFormula', [{}, { configure: false }, runtime.messageConfig(args, { roll: true })]);
      return runtime.rollResult(result, actor, item, activity);
    },
  },
];
