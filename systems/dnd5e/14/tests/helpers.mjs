import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

export const plain = value => JSON.parse(JSON.stringify(value));
export function fixture() {
  const calls = [];
  let permitted = true;
  const evaluated = (total = 14) => ({ formula: '1d20 + 3', total, result: '11 + 3', options: {}, dice: [], isCritical: false,
    isFumble: false, parent: null, toJSON() { return { formula: this.formula, total: this.total, options: this.options }; } });
  class Actor {
    documentName = 'Actor'; id = 'hero'; uuid = 'Actor.hero'; name = 'Hero'; type = 'character'; isOwner = true;
    items = new Map(); effects = new Map(); statuses = new Set();
    system = { abilities: { str: { mod: 3, value: 16 }, con: { mod: 2, value: 14 } },
      skills: { ath: { ability: 'str', total: 5 } }, tools: { smith: { ability: 'str' } },
      attributes: { hp: { value: 12, max: 20, effectiveMax: 20, temp: 2 }, death: { success: 0, failure: 0 }, concentration: { ability: 'con' },
        hd: { value: 2, classes: [{ system: { hd: { denomination: 'd8', value: 2, spent: 0 } } }] } },
      spells: { spell1: { value: 2, max: 3, level: 1 } }, currency: { gp: 10 }, traits: { di: { value: new Set(['poison']) } }, conditions: {} };
    testUserPermission(user, level) { calls.push(['permission', this.uuid, level]); return permitted; }
    toObject() { return { _id: this.id, type: this.type, system: { custom: { preserved: true }, attributes: { hp: { ...this.system.attributes.hp } } } }; }
    getRollData() { calls.push(['getRollData', this.uuid]); return { str: { mod: 3 }, flags: {}, linkedActor: this, statuses: new Set(['blinded']) }; }
    async rollAbilityCheck(...args) { calls.push(['rollAbilityCheck', ...args]); return [evaluated()]; }
    async rollSavingThrow(...args) { calls.push(['rollSavingThrow', ...args]); return [evaluated()]; }
    async rollSkill(...args) { calls.push(['rollSkill', ...args]); return [evaluated()]; }
    async rollToolCheck(...args) { calls.push(['rollToolCheck', ...args]); return [evaluated()]; }
    async rollConcentration(...args) { calls.push(['rollConcentration', ...args]); return [evaluated()]; }
    async rollDeathSave(...args) { calls.push(['rollDeathSave', ...args]); this.system.attributes.death.success += 1; return [evaluated()]; }
    async rollHitDie(...args) { calls.push(['rollHitDie', ...args]); this.system.attributes.hp.value += 3; this.system.attributes.hd.value -= 1; return [evaluated(3)]; }
    calculateDamage(entries, options) {
      calls.push(['calculateDamage', entries, options]);
      const result = entries.map(d => ({ ...d, value: d.type === 'poison' ? 0 : d.type === 'healing' ? -d.value : d.value }));
      result.amount = result.reduce((n, d) => n + d.value * options.multiplier, 0); result.temp = 0; result.tempMax = 0;
      return result;
    }
    async applyDamage(entries, options) { calls.push(['applyDamage', entries, options]); this.system.attributes.hp.value -= entries[0].value; return this; }
    async shortRest(config) { calls.push(['shortRest', config]); return { type: 'short', updateData: {}, updateItems: [], deleteItems: [], deltas: { hitPoints: 0, hitDice: 0 } }; }
    async longRest(config) {
      calls.push(['longRest', config]); this.system.attributes.hp.value = 20;
      return { type: 'long', updateData: { 'system.attributes.hp.value': 20 }, updateItems: [], deleteItems: [], deltas: { hitPoints: 8, hitDice: 0 } };
    }
    async toggleStatusEffect(id, options) {
      calls.push(['toggleStatusEffect', id, options]);
      if (options.active) this.statuses.add(id); else this.statuses.delete(id);
      return options.active ? { documentName: 'ActiveEffect', uuid: 'Actor.hero.ActiveEffect.condition', id: 'condition' } : false;
    }
  }
  const actor = new Actor();
  const item = { documentName: 'Item', id: 'weapon', uuid: 'Actor.hero.Item.weapon', name: 'Sword', type: 'weapon', parent: actor,
    canUse: true, isEmbedded: true, isOwner: true, effects: new Map(),
    system: { quantity: 1, attackModes: [{ value: 'oneHanded' }, { value: 'ranged' }, { value: 'thrown' }], ammunitionOptions: [], activities: new Map() },
    testUserPermission(user, level) { calls.push(['permission', this.uuid, level]); return permitted; },
    toObject() { return { _id: this.id, name: this.name, type: this.type, system: { quantity: this.system.quantity } }; },
  };
  class Activity {
    documentName = 'Activity'; id = '1attack'; type = 'attack'; name = 'Strike'; canUse = true; isHidden = false;
    requiresConcentration = false; requiresSpellSlot = false; activation = { type: 'action' };
    consumption = { targets: [] }; target = {}; range = {}; uses = {}; roll = { formula: '1d6', prompt: true };
    constructor(type, id) { this.type = type; this.id = id; this.item = item; this.actor = actor; this.uuid = `${item.uuid}.Activity.${id}`; }
    toObject() { return { _id: this.id, type: this.type, activation: this.activation, consumption: this.consumption }; }
    async use(...args) { calls.push(['use', ...args]); return { updates: { actor: {}, item: [], create: [], delete: [] }, effects: [], templates: [] }; }
    async rollAttack(...args) { calls.push(['rollAttack', ...args]); return [evaluated()]; }
    async rollDamage(...args) { calls.push(['rollDamage', ...args]); return [evaluated(8)]; }
    async rollFormula(...args) { calls.push(['rollFormula', ...args]); return [evaluated(4)]; }
  }
  const attack = new Activity('attack', '1attack');
  const damage = new Activity('damage', 'damage');
  const utility = new Activity('utility', 'utility');
  const heal = new Activity('heal', 'heal');
  for (const a of [attack, damage, utility, heal]) item.system.activities.set(a.id, a);
  actor.items.set(item.id, item);
  const docs = new Map([actor, item].map(d => [d.uuid, d]));
  const game = { ready: true, version: '14.367', release: { generation: 14, build: 367 }, system: { id: 'dnd5e', version: '6.1.1' },
    user: { id: 'gm', isGM: true, targets: new Set() }, modules: new Map([['fixture-addon', { id: 'fixture-addon', active: true, version: '1.0.0' }]]) };
  const CONFIG = { Actor: { documentClass: Actor }, DND5E: { abilities: { str: { label: 'Strength' }, con: { label: 'Constitution' } },
    skills: { ath: { label: 'Athletics' } }, tools: { smith: { label: 'Smith' } }, currencies: { gp: { label: 'Gold' } },
    damageTypes: { fire: {}, poison: {}, slashing: {} }, healingTypes: { healing: {}, temphp: {} }, itemProperties: { mgc: {}, sil: {} },
    conditionTypes: { blinded: {}, exhaustion: { levels: 6 } },
    activityTypes: Object.fromEntries(['attack', 'damage', 'heal', 'utility', 'check', 'save'].map(type => [type, { documentClass: Activity }])) },
    statusEffects: { blinded: { id: 'blinded' }, exhaustion: { id: 'exhaustion' } } };
  const fromUuid = async uuid => docs.get(uuid) ?? null;
  return { actor, item, attack, damage, utility, heal, game, CONFIG, fromUuid, docs, calls, evaluated, setPermission: value => { permitted = value; } };
}

export async function execute(id, args, world, probe = false) {
  const file = id === 'get_actor_data' ? (probe ? 'probe.js' : 'get_actor_data.js') : `${probe ? 'probes' : 'bindings'}/${id}.js`;
  const source = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
  return runInNewContext(`(async () => {\n${source}\n})()`, { game: world.game, CONFIG: world.CONFIG,
    fromUuid: world.fromUuid, args: structuredClone(args) });
}
