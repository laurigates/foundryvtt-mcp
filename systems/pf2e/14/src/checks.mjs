import * as s from './schemas.mjs';

export const operations = [
  {
    id: 'roll_skill', readOnly: false, requirements: ['statistics'],
    description: 'Roll a prepared PF2e skill or lore through its live Statistic API, including predicates, stacking and degree of success. May publish chat and trigger rule hooks.',
    inputSchema: s.actorInput({ skill: s.slug, ...s.rollInput }, ['skill']), outputSchema: s.rollResult,
    handler: async (args, r) => {
      const a = await r.actor(args.actor_uuid); r.slug(args.skill, 'Skill');
      if (!Object.hasOwn(a.skills ?? {}, args.skill)) r.fail('This Actor has no skill or lore with that slug');
      return r.rollStatistic(a, r.resolveStatistic(a, args.skill), args);
    },
  },
  {
    id: 'roll_save', readOnly: false, requirements: ['statistics'],
    description: 'Roll fortitude, reflex or will with the live PF2e Statistic API. A supplied DC is numeric; contextual spell/origin options are not inferred.',
    inputSchema: s.actorInput({ save: { type: 'string', enum: ['fortitude', 'reflex', 'will'] }, ...s.rollInput }, ['save']), outputSchema: s.rollResult,
    handler: async (args, r) => {
      const a = await r.actor(args.actor_uuid);
      if (!['fortitude', 'reflex', 'will'].includes(args.save) || !a.saves?.[args.save]) r.fail('This Actor does not expose the selected saving throw');
      return r.rollStatistic(a, r.resolveStatistic(a, args.save), args);
    },
  },
  {
    id: 'roll_perception', readOnly: false, requirements: ['statistics'],
    description: 'Roll the prepared PF2e perception Statistic without opening its modifier dialog. This does not update encounter initiative.',
    inputSchema: s.actorInput(s.rollInput), outputSchema: s.rollResult,
    handler: async (args, r) => { const a = await r.actor(args.actor_uuid); return r.rollStatistic(a, r.resolveStatistic(a, 'perception'), args); },
  },
  {
    id: 'roll_statistic', readOnly: false, requirements: ['statistics'],
    description: 'Roll an exact existing PF2e statistic slug through its runtime method; no caller formula, arbitrary method or modifiers are evaluated.',
    inputSchema: s.actorInput({ statistic_slug: s.slug, ...s.rollInput }, ['statistic_slug']), outputSchema: s.rollResult,
    handler: async (args, r) => { const a = await r.actor(args.actor_uuid); return r.rollStatistic(a, r.resolveStatistic(a, args.statistic_slug), args); },
  },
  {
    id: 'roll_strike', readOnly: false, requirements: ['strikes', 'strikeRoll'],
    description: 'Roll one prepared PF2e strike/MAP variant against an explicit rendered target token. Requires disabled check dialogs for the paired user. May consume ammunition and consumable weapons; does not apply damage.',
    inputSchema: s.actorInput({ token_uuid: s.uuid, target_token_uuid: s.uuid, strike_index: s.integer,
      expected_item_uuid: s.uuid, attack_number: { type: 'integer', minimum: 1, maximum: 3, default: 1 },
      create_message: { type: 'boolean', default: true } }, ['token_uuid', 'target_token_uuid', 'strike_index', 'expected_item_uuid']),
    outputSchema: s.rollResult,
    handler: async (args, r) => {
      const a = await r.actor(args.actor_uuid);
      if (game.user.settings?.showCheckDialogs !== false) r.fail('Disable check dialogs for the paired runtime user before rolling strikes');
      const token = await r.activeToken(a, args.token_uuid, { required: true });
      const originTokens = a.getActiveTokens?.(true, true) ?? [];
      if (originTokens.length !== 1 || originTokens[0]?.uuid !== token.uuid) r.fail('Strike origin must be the Actor\'s only active token');
      const target = await fromUuid(args.target_token_uuid);
      if (!target || target.documentName !== 'Token' || !target.actor || !target.object || target.object.document !== target) r.fail('The target must be a rendered Token in the paired client scene');
      if (token.parent?.id !== target.parent?.id || !token.parent?.id) r.fail('Strike origin and target must be in the same active scene');
      r.permission(target.actor);
      r.integer(args.strike_index, 'Strike index');
      const strike = a.system.actions[args.strike_index];
      if (!strike || strike.item?.uuid !== args.expected_item_uuid || strike.ready === false || strike.visible === false) r.fail('Strike identity changed or the selected strike is not ready; read get_strikes again');
      const attack = r.integer(args.attack_number ?? 1, 'Attack number', { min: 1, max: 3 });
      const variant = strike.variants?.[attack - 1];
      if (typeof variant?.roll !== 'function') r.fail('The selected strike variant is unavailable');
      const capture = r.captureRoll();
      return r.write(a, async () => capture.result(await variant.roll({ target: target.object,
        consumeAmmo: true, createMessage: args.create_message ?? true, callback: capture.callback })));
    },
  },
];
