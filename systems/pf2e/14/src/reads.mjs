import * as s from './schemas.mjs';

export const operations = [
  {
    id: 'get_actor_summary', readOnly: true, requirements: [],
    description: 'Read PF2e prepared Actor level, abilities, HP, armor class, traits, movement and resources. Does not recalculate rules outside PF2e.',
    inputSchema: s.actorInput(),
    outputSchema: s.object({ actor: s.actor, level: s.number, abilities: s.nullableData, hit_points: s.nullableData,
      armor_class: s.number, traits: s.array(s.text), movement: s.nullableData, resources: s.data, statuses: s.array(s.text) }),
    handler: async (args, r) => {
      const a = await r.actor(args.actor_uuid);
      return { actor: r.summary(a), level: r.number(a.level), abilities: r.json(a.abilities ?? null),
        hit_points: r.json(a.hitPoints ?? null), armor_class: r.number(a.armorClass?.value),
        traits: Array.from(a.traits ?? []).map(r.text), movement: r.json(a.system?.attributes?.speed ?? null),
        resources: r.json(a.system?.resources ?? {}), statuses: Array.from(a.statuses ?? []).map(r.text) };
    },
  },
  {
    id: 'get_statistics', readOnly: true, requirements: ['statistics'],
    description: 'List PF2e prepared skills, lore, saves and perception with modifiers and DCs; contextual roll results may differ.',
    inputSchema: s.actorInput(), outputSchema: s.object({ actor_uuid: s.text, statistics: s.array(s.statistic) }),
    handler: async (args, r) => {
      const a = await r.actor(args.actor_uuid);
      const names = new Set([...Object.keys(a.skills ?? {}), ...Object.keys(a.saves ?? {}), 'perception']);
      const statistics = Array.from(names).sort().map((name) => a.getStatistic(name)).filter(Boolean).map(r.statistic);
      return { actor_uuid: a.uuid, statistics };
    },
  },
  {
    id: 'get_statistic', readOnly: true, requirements: ['statistics'],
    description: 'Read a PF2e statistic by its exact slug, including lore and system-prepared custom statistics.',
    inputSchema: s.actorInput({ statistic_slug: s.slug }, ['statistic_slug']),
    outputSchema: s.object({ actor_uuid: s.text, statistic: s.statistic }),
    handler: async (args, r) => {
      const a = await r.actor(args.actor_uuid);
      return { actor_uuid: a.uuid, statistic: r.statistic(r.resolveStatistic(a, args.statistic_slug)) };
    },
  },
  {
    id: 'get_conditions', readOnly: true, requirements: ['conditions'],
    description: 'Read PF2e conditions including value, active/overridden state, locked grants and temporary conditions.',
    inputSchema: s.actorInput(), outputSchema: s.conditions,
    handler: async (args, r) => { const a = await r.actor(args.actor_uuid); return { actor_uuid: a.uuid, conditions: r.conditions(a) }; },
  },
  {
    id: 'get_inventory', readOnly: true, requirements: ['inventory'],
    description: 'Read PF2e physical inventory and system-computed bulk. Unidentified item names and values are hidden from non-GMs.',
    inputSchema: s.actorInput(),
    outputSchema: s.object({ actor_uuid: s.text, items: s.array(s.object({ id: s.text, uuid: s.text, name: s.text,
      type: s.text, quantity: s.number, identified: s.flag, container_id: s.nullableText, equipped: s.flag,
      invested: s.flag, bulk_light_units: s.number, asset_value: s.nullableData })),
      bulk: s.object({ light_units: s.number, encumbered_after: s.number, max: s.number, encumbered: s.flag, over_max: s.flag }) }),
    handler: async (args, r) => {
      const a = await r.actor(args.actor_uuid); const bulk = a.inventory.bulk;
      const items = a.inventory.contents.map((item) => {
        const identified = item.isIdentified !== false;
        const visible = game.user.isGM === true || identified;
        return { ...r.summary(item), name: visible ? r.text(item.name) : 'Unidentified item',
          quantity: r.number(item.quantity), identified, container_id: item.container?.id ?? null,
          equipped: item.isEquipped === true, invested: item.isInvested === true,
          bulk_light_units: r.number(item.bulk?.toLightUnits?.()),
          asset_value: visible ? r.json(item.assetValue?.toObject?.() ?? null) : null };
      });
      return { actor_uuid: a.uuid, items, bulk: { light_units: r.number(bulk?.value?.toLightUnits?.()),
        encumbered_after: r.number(bulk?.encumberedAfter), max: r.number(bulk?.max),
        encumbered: bulk?.isEncumbered === true, over_max: bulk?.isOverMax === true } };
    },
  },
  {
    id: 'get_currency', readOnly: true, requirements: ['inventory'],
    description: 'Read PF2e inventory.currency denomination amounts and system-computed copper value.',
    inputSchema: s.actorInput(), outputSchema: s.currencyResult,
    handler: async (args, r) => { const a = await r.actor(args.actor_uuid); return { actor_uuid: a.uuid, ...r.currency(a) }; },
  },
  {
    id: 'get_resource', readOnly: true, requirements: ['resources'],
    description: 'Read an existing numeric PF2e resource by exact slug, such as focus or hero-points.',
    inputSchema: s.actorInput({ resource_slug: s.slug }, ['resource_slug']), outputSchema: s.resourceResult,
    handler: async (args, r) => { const a = await r.actor(args.actor_uuid); return { actor_uuid: a.uuid, resource: r.resource(a, args.resource_slug) }; },
  },
  {
    id: 'get_strikes', readOnly: true, requirements: ['strikes'],
    description: 'List prepared PF2e strikes and MAP variants. Re-read before rolling; index plus exact item UUID protects against reordered actions.',
    inputSchema: s.actorInput(), outputSchema: s.object({ actor_uuid: s.text, strikes: s.array(s.strike) }),
    handler: async (args, r) => { const a = await r.actor(args.actor_uuid); return { actor_uuid: a.uuid, strikes: r.strikes(a) }; },
  },
  {
    id: 'get_spellcasting', readOnly: true, requirements: ['spellcasting'],
    description: 'Read PF2e spellcasting entries, prepared slot data and associated spells. Does not cast spells or consume slots.',
    inputSchema: s.actorInput(),
    outputSchema: s.object({ actor_uuid: s.text, entries: s.array(s.object({ id: s.text, name: s.text,
      category: s.text, tradition: s.nullableText, attribute: s.nullableText, statistic: { anyOf: [s.statistic, { type: 'null' }] },
      slots: s.data, spells: s.array(s.object({ ...s.actor.properties, rank: s.number, location: s.nullableData })) })) }),
    handler: async (args, r) => {
      const a = await r.actor(args.actor_uuid);
      const entries = a.spellcasting.contents.map((entry) => ({ id: r.text(entry.id), name: r.text(entry.name),
        category: r.text(entry.category), tradition: entry.tradition ?? null, attribute: entry.attribute ?? null,
        statistic: entry.statistic ? r.statistic(entry.statistic) : null, slots: r.json(entry.system?.slots ?? {}),
        spells: (entry.spells?.contents ?? []).map((spell) => ({ ...r.summary(spell), rank: r.number(spell.rank),
          location: r.json(spell.system?.location ?? null) })) }));
      return { actor_uuid: a.uuid, entries };
    },
  },
];
