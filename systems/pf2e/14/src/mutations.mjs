import * as s from './schemas.mjs';

export const operations = [
  {
    id: 'set_condition', readOnly: false, requirements: ['conditions', 'setCondition'],
    description: 'Set an explicit PF2e condition presence through Actor.toggleCondition({active}); never blindly toggle. Persistent damage editors and locked/temporary grants are excluded.',
    inputSchema: s.actorInput({ condition_slug: s.slug, active: s.flag }, ['condition_slug', 'active']), outputSchema: s.conditions,
    handler: async (args, r) => {
      const a = await r.actor(args.actor_uuid); r.conditionSlug(args.condition_slug);
      if (typeof args.active !== 'boolean') r.fail('active must be an explicit boolean');
      const before = a.hasCondition(args.condition_slug);
      if (before === args.active) return { actor_uuid: a.uuid, conditions: r.conditions(a) };
      const existing = a.conditions.contents.filter((c) => c.slug === args.condition_slug && c.active);
      if (existing.some((c) => c.isLocked || c.inMemoryOnly)) r.fail('Change the granting effect instead of a locked or temporary condition');
      return r.write(a, async () => {
        await a.toggleCondition(args.condition_slug, { active: args.active });
        if (a.hasCondition(args.condition_slug) !== args.active) r.unknown('The requested condition presence was not observed');
        return { actor_uuid: a.uuid, conditions: r.conditions(a) };
      });
    },
  },
  {
    id: 'increase_condition', readOnly: false, requirements: ['conditions', 'increaseCondition'],
    description: 'Increase a valued PF2e condition using the system condition API and verify the resulting value. Rejects locked or temporary conditions.',
    inputSchema: s.actorInput({ condition_slug: s.slug, amount: { type: 'integer', minimum: 1, maximum: 100, default: 1 },
      maximum: { type: 'integer', minimum: 1, maximum: 100, default: 100 } }, ['condition_slug']), outputSchema: s.conditions,
    handler: async (args, r) => {
      const a = await r.actor(args.actor_uuid); const template = r.conditionSlug(args.condition_slug);
      if (typeof template.value !== 'number') r.fail('Use set_condition for an unvalued condition');
      const amount = r.integer(args.amount ?? 1, 'Condition increment', { min: 1, max: 100 });
      const maximum = r.integer(args.maximum ?? 100, 'Condition maximum', { min: 1, max: 100 });
      const active = a.conditions.contents.filter((c) => c.slug === args.condition_slug && c.active);
      if (active.length > 1) r.fail('The condition has multiple active sources; resolve them in Foundry first');
      const existing = active[0];
      if (existing?.isLocked || existing?.inMemoryOnly) r.fail('The condition is locked or temporary');
      const before = existing?._source?.system?.value?.value ?? 0;
      r.integer(before, 'Existing condition value', { max: 100 });
      if (maximum < before) r.fail('maximum cannot decrease the current condition value');
      const expected = Math.min(before + amount, maximum);
      return r.write(a, async () => {
        await a.increaseCondition(existing ?? args.condition_slug, { value: amount, max: maximum });
        const after = a.conditions.contents.find((c) => c.slug === args.condition_slug && c.active);
        if (after?.value !== expected || after?._source?.system?.value?.value !== expected) r.unknown('The increased condition source value was not observed');
        return { actor_uuid: a.uuid, conditions: r.conditions(a) };
      });
    },
  },
  {
    id: 'decrease_condition', readOnly: false, requirements: ['conditions', 'decreaseCondition'],
    description: 'Decrease one valued PF2e condition step or remove an explicit condition through the system API. Verifies the observed remaining condition.',
    inputSchema: s.actorInput({ condition_slug: s.slug, force_remove: { type: 'boolean', default: false } }, ['condition_slug']), outputSchema: s.conditions,
    handler: async (args, r) => {
      const a = await r.actor(args.actor_uuid); r.conditionSlug(args.condition_slug);
      const active = a.conditions.contents.filter((c) => c.slug === args.condition_slug && c.active);
      if (active.length > 1) r.fail('The condition has multiple active sources; resolve them in Foundry first');
      const existing = active[0];
      if (!existing) return { actor_uuid: a.uuid, conditions: r.conditions(a) };
      if (existing.isLocked || existing.inMemoryOnly) r.fail('The condition is locked or temporary');
      const before = existing._source?.system?.value?.value ?? null;
      const remove = args.force_remove === true || before === null || before <= 1;
      return r.write(a, async () => {
        await a.decreaseCondition(existing, { forceRemove: args.force_remove ?? false });
        const after = a.conditions.contents.find((c) => c.slug === args.condition_slug && c.active);
        const observed = remove ? !after && !a.items.has(existing.id)
          : after?.value === before - 1 && after?._source?.system?.value?.value === before - 1;
        if (!observed) r.unknown('The decreased condition source state was not observed');
        return { actor_uuid: a.uuid, conditions: r.conditions(a) };
      });
    },
  },
  {
    id: 'set_resource', readOnly: false, requirements: ['resources', 'setResource'],
    description: 'Set an existing PF2e numeric resource through updateResource; validates bounds and checks the observed value. Investiture is read-only.',
    inputSchema: s.actorInput({ resource_slug: s.slug, value: s.integer }, ['resource_slug', 'value']), outputSchema: s.resourceResult,
    handler: async (args, r) => {
      const a = await r.actor(args.actor_uuid); const before = r.resource(a, args.resource_slug);
      if (before.slug === 'investiture') r.fail('Investiture is derived from invested items and cannot be set');
      const value = r.integer(args.value, 'Resource value', { max: before.max });
      return r.write(a, async () => {
        await a.updateResource(args.resource_slug, value, { render: false });
        const after = r.resource(a, args.resource_slug);
        if (after.value !== value) r.unknown('The resource update was not observed');
        return { actor_uuid: a.uuid, resource: after };
      });
    },
  },
  {
    id: 'add_currency', readOnly: false, requirements: ['inventory', 'addCurrency'],
    description: 'Add positive PF2e pp/gp/sp/cp amounts through inventory.addCurrency and verify the copper-value change. Item currency is managed by PF2e.',
    inputSchema: s.actorInput({ coins: s.coinInput }, ['coins']), outputSchema: s.currencyResult,
    handler: async (args, r) => {
      const a = await r.actor(args.actor_uuid); const { coins, total } = r.coinInput(args.coins); const before = r.currency(a);
      r.integer(before.copper_value + total, 'Resulting copper value');
      return r.write(a, async () => {
        await a.inventory.addCurrency(coins, { combineStacks: true });
        const after = r.currency(a);
        if (after.copper_value !== before.copper_value + total) r.unknown('The requested currency addition was not observed');
        return { actor_uuid: a.uuid, ...after };
      });
    },
  },
  {
    id: 'remove_currency', readOnly: false, requirements: ['inventory', 'removeCurrency'],
    description: 'Remove PF2e currency through inventory.removeCurrency, optionally making change. Checks funds and verifies the resulting total; compound updates are not atomic.',
    inputSchema: s.actorInput({ coins: s.coinInput, by_value: { type: 'boolean', default: true } }, ['coins']), outputSchema: s.currencyResult,
    handler: async (args, r) => {
      const a = await r.actor(args.actor_uuid); const { coins, total } = r.coinInput(args.coins); const before = r.currency(a);
      if (before.copper_value < total) r.fail('The Actor has insufficient currency');
      if (args.by_value === false && Object.entries(coins).some(([key, value]) => (before.denominations[key] ?? 0) < value)) r.fail('The Actor lacks the requested exact denominations');
      return r.write(a, async () => {
        const accepted = await a.inventory.removeCurrency(coins, { byValue: args.by_value ?? true });
        const after = r.currency(a);
        if (accepted !== true || after.copper_value !== before.copper_value - total) r.unknown('The requested currency removal was not confirmed');
        return { actor_uuid: a.uuid, ...after };
      });
    },
  },
  {
    id: 'recharge', readOnly: false, requirements: ['recharge'],
    description: 'Recharge PF2e frequencies/resources for turn, round or daily preparation via Actor.recharge({commit:true}). Daily preparation can restore spell slots; this is not a full rest or healing operation.',
    inputSchema: s.actorInput({ duration: { type: 'string', enum: ['turn', 'round', 'day'] } }, ['duration']),
    outputSchema: s.object({ actor_uuid: s.text, duration: s.text, affected: s.object({ frequencies: s.flag, spell_slots: s.flag, resources: s.array(s.text) }) }),
    handler: async (args, r) => {
      const a = await r.actor(args.actor_uuid);
      if (!['turn', 'round', 'day'].includes(args.duration)) r.fail('Recharge duration must be turn, round or day');
      if (!Array.isArray(a.items?.contents) || typeof a.items.get !== 'function' || typeof a.items.has !== 'function'
        || typeof a.toObject !== 'function') r.fail('Recharge requires source-document verification support');
      const beforeItemIds = new Set(a.items.contents.map((item) => item.id));
      return r.write(a, async () => {
        const result = await a.recharge({ duration: args.duration, commit: true });
        const affected = result?.affected;
        if (typeof affected?.frequencies !== 'boolean' || typeof affected?.spellSlots !== 'boolean'
          || !Array.isArray(affected?.resources) || affected.resources.some((x) => typeof x !== 'string')) r.unknown('PF2e recharge returned an invalid confirmation');
        r.verifyRecharge(a, result, beforeItemIds);
        return { actor_uuid: a.uuid, duration: args.duration,
          affected: { frequencies: affected.frequencies, spell_slots: affected.spellSlots, resources: [...affected.resources] } };
      });
    },
  },
];
