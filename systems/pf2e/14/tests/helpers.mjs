import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Script, createContext } from 'node:vm';

export const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
export const manifest = JSON.parse(await readFile(join(packageRoot, 'manifest.json'), 'utf8'));
export const plain = (x) => JSON.parse(JSON.stringify(x));

export async function invoke(world, operation, args = {}, { probe = false } = {}) {
  const entry = manifest.operations.find((x) => x.id === operation);
  const source = await readFile(join(packageRoot, probe ? entry.probe : entry.binding), 'utf8');
  return await new Script(`(async () => {\n${source}\n})()`).runInContext(createContext({
    game: world.game, fromUuid: async (uuid) => world.documents.get(uuid), args,
  }), { timeout: 1000 });
}

export function fixture() {
  const calls = []; const documents = new Map();
  const game = { ready: true, system: { id: 'pf2e', version: '8.7.1' }, release: { generation: 14, build: 361 },
    version: '14.361', user: { id: 'runtime', isGM: true, settings: { showCheckDialogs: false }, targets: new Set() },
    actors: { contents: [] }, pf2e: {} };
  const world = { game, calls, documents, blind: false };
  const roll = async (method, params) => {
    calls.push({ method, params });
    const value = { total: 24, formula: '1d20+7', naturalResult: 17, degreeOfSuccess: 2, options: { degreeOfSuccess: 2 } };
    const mode = world.blind ? 'blind' : (params.messageMode ?? 'public');
    const message = { id: params.createMessage === false ? null : 'message',
      uuid: params.createMessage === false ? null : 'ChatMessage.message', flags: { pf2e: { context: { messageMode: mode } } } };
    await params.callback?.(value, 'success', message, null); return value;
  };
  const makeStatistic = (slug, type = 'skill-check') => ({ slug, label: slug, attribute: 'dex', rank: 2, proficient: true,
    check: { mod: 7, breakdown: '+5 proficiency, +2 dex', type }, dc: { value: 17, breakdown: '10 + 7' }, domains: [slug],
    async roll(params) { return roll(`statistic:${this.slug}`, params); } });
  const skills = { acrobatics: makeStatistic('acrobatics'), athletics: makeStatistic('athletics'),
    'sailing-lore': makeStatistic('sailing-lore') };
  const saves = Object.fromEntries(['fortitude', 'reflex', 'will'].map((slug) => [slug, makeStatistic(slug, 'saving-throw')]));
  const stats = { ...skills, ...saves, perception: makeStatistic('perception', 'perception-check'), 'custom-check': makeStatistic('custom-check') };
  const conditionValues = { frightened: 1, sickened: 1, prone: null, blinded: null };
  const addCondition = (slug, value = conditionValues[slug]) => {
    const c = { id: `condition-${slug}`, uuid: `Actor.hero.Item.condition-${slug}`, name: slug, type: 'condition', slug,
      value, active: true, isLocked: false, inMemoryOnly: false, _source: { system: { value: { value } } } };
    actor.conditions.contents.push(c); return c;
  };
  game.pf2e.ConditionManager = { getCondition: (slug) => {
    if (!Object.hasOwn(conditionValues, slug)) throw new Error('Unknown condition');
    return { slug, value: conditionValues[slug] };
  } };
  const resources = { focus: { slug: 'focus', label: 'Focus', value: 1, max: 3 },
    'hero-points': { slug: 'hero-points', label: 'Hero Points', value: 1, max: 3 },
    investiture: { slug: 'investiture', label: 'Investiture', value: 1, max: 10 } };
  const coins = { pp: 0, gp: 10, sp: 0, cp: 0 };
  const copper = () => coins.pp * 1000 + coins.gp * 100 + coins.sp * 10 + coins.cp;
  const actor = { id: 'hero', uuid: 'Actor.hero', name: 'Hero', type: 'character', documentName: 'Actor',
    readable: true, owner: true, level: 5, abilities: { dex: { mod: 2 } }, hitPoints: { value: 30, max: 50, temp: 0 },
    armorClass: { value: 22 }, traits: new Set(['humanoid']), statuses: new Set(), skills, saves,
    system: { actions: [], attributes: { speed: { value: 25 } }, resources: { focus: { value: 1, max: 3 } } },
    conditions: { contents: [] }, itemTypes: { condition: [] },
    testUserPermission(_user, permission) { return permission === 'OWNER' ? this.owner : this.readable; },
    toObject: () => ({ system: { details: { level: { value: 5 } }, custom: 'raw-source' } }),
    getStatistic: (slug) => stats[slug] ?? null,
    getResource: (slug) => resources[slug] ? { ...resources[slug] } : null,
    async updateResource(slug, value, options) { calls.push({ method: 'updateResource', slug, value, options }); resources[slug].value = value; },
    hasCondition: (slug) => actor.conditions.contents.some((c) => c.slug === slug && c.active),
    async toggleCondition(slug, options) {
      calls.push({ method: 'toggleCondition', slug, options });
      if (options.active && !this.hasCondition(slug)) addCondition(slug);
      if (!options.active) this.conditions.contents.splice(0, this.conditions.contents.length, ...this.conditions.contents.filter((c) => c.slug !== slug));
    },
    async increaseCondition(input, options) {
      calls.push({ method: 'increaseCondition', input, options });
      const c = typeof input === 'string' ? addCondition(input, Math.min(options.value, options.max)) : input;
      if (typeof input !== 'string') c.value = Math.min(c.value + options.value, options.max);
      c._source.system.value.value = c.value; return c;
    },
    async decreaseCondition(c, options) {
      calls.push({ method: 'decreaseCondition', condition: c, options });
      if (options.forceRemove || c.value === null || c.value <= 1) this.conditions.contents.splice(this.conditions.contents.indexOf(c), 1);
      else { c.value--; c._source.system.value.value = c.value; }
    },
    async recharge(options) {
      calls.push({ method: 'recharge', options });
      return { actorUpdates: {}, itemUpdates: [], itemCreates: [], itemDeletes: [],
        affected: { frequencies: true, spellSlots: options.duration === 'day', resources: ['focus'] } };
    },
  };
  actor.itemTypes.condition = actor.conditions.contents;
  actor.items = { get contents() { return actor.conditions.contents; },
    get(id) { return this.contents.find((item) => item.id === id); },
    has(id) { return this.contents.some((item) => item.id === id); } };
  const item = { id: 'sword', uuid: 'Actor.hero.Item.sword', name: 'Sword', type: 'weapon', quantity: 1,
    isIdentified: true, isEquipped: true, isInvested: false, container: null,
    bulk: { toLightUnits: () => 10 }, assetValue: { toObject: () => ({ gp: 1 }) } };
  actor.inventory = { contents: [item], bulk: { value: { toLightUnits: () => 10 }, encumberedAfter: 7, max: 12,
    isEncumbered: false, isOverMax: false },
    get currency() { return { toObject: () => ({ ...coins }), copperValue: copper() }; },
    async addCurrency(value, options) { calls.push({ method: 'addCurrency', coins: value, options }); for (const [key, amount] of Object.entries(value)) coins[key] += amount; },
    async removeCurrency(value, options) {
      calls.push({ method: 'removeCurrency', coins: value, options });
      const total = (value.pp ?? 0) * 1000 + (value.gp ?? 0) * 100 + (value.sp ?? 0) * 10 + (value.cp ?? 0);
      if (total > copper()) return false;
      const after = copper() - total; Object.assign(coins, { pp: 0, gp: 0, sp: 0, cp: after }); return true;
    } };
  actor.spellcasting = { contents: [{ id: 'arcane', name: 'Arcane', category: 'prepared', tradition: 'arcane', attribute: 'int',
    statistic: makeStatistic('arcane'), system: { slots: { slot1: { value: 1, max: 2 } } },
    spells: { contents: [{ id: 'spell', uuid: 'Actor.hero.Item.spell', name: 'Spell', type: 'spell', rank: 1,
      system: { location: { value: 'arcane' } } }] } }] };
  actor.system.actions.push({ label: 'Sword', slug: 'sword', item, ready: true, visible: true, totalModifier: 10, altUsages: [],
    variants: [0, 1, 2].map((index) => ({ label: String(10 - index * 5), async roll(params) { return roll(`strike:${index}`, params); } })) });
  const scene = { id: 'scene' };
  const token = { id: 'heroToken', uuid: 'Scene.scene.Token.heroToken', documentName: 'Token', actor, parent: scene };
  token.object = { document: token };
  const targetActor = { id: 'target', uuid: 'Actor.target', documentName: 'Actor', readable: true,
    testUserPermission() { return this.readable; } };
  const target = { id: 'targetToken', uuid: 'Scene.scene.Token.targetToken', documentName: 'Token', actor: targetActor, parent: scene };
  target.object = { document: target };
  actor.getActiveTokens = () => [token];
  game.actors.contents.push(actor);
  for (const doc of [actor, token, target, targetActor]) documents.set(doc.uuid, doc);
  return { ...world, actor, item, token, target, targetActor, stats, resources, coins, addCondition,
    setBlind: (value) => { world.blind = value; } };
}
