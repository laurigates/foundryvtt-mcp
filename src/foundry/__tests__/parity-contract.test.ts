/**
 * Socket.IO vs REST bridge data parity, offline.
 *
 * One dnd5e 5.x scenario (a level-5 fighter, a world longsword, the world
 * itself) is written twice:
 * - as Socket.IO delivers it: `worldData` source documents, no prepared values;
 * - as the REST bridge answers for the same documents after a GM browser ran
 *   prepareData: the module's formatters on laurigates/foundryvtt-local-rest-api
 *   `feat/v14-port` (ce49b9c), scripts/routes/actors.js (formatActorDetail,
 *   formatAbilities), items.js (formatItemSummary) and world.js
 *   (formatWorldInfo), inside the `{ success, data }` envelope.
 *
 * Both go through the MCP's own mappers (client.ts for Socket.IO,
 * rest-mappers.ts for REST). Shared fields must agree, and the fields only one
 * side reports must equal KNOWN_GAPS in parity.ts exactly, so a gap that closes
 * or opens fails here. tests/integration/parity.integration.test.ts runs the
 * same comparison against a live Foundry and bridge.
 */

import { describe, expect, it, vi } from 'vitest';
import type { WorldActor, WorldData, WorldItem } from '../types.js';

vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { overlayDerivedValues, worldActorToFoundry, worldInfoToFoundry, worldItemToFoundry } =
  await import('../client.js');
const { mapRestActor, mapRestItemSearch, mapRestWorld } = await import('../rest-mappers.js');
const {
  compareParity,
  gapDrift,
  KNOWN_GAPS,
  mismatchLines,
  normaliseActor,
  normaliseItem,
  normaliseWorld,
  parityMessage,
} = await import('../parity.js');

const ACTOR_ID = 'parityFighter001';
const ITEM_ID = 'parityLongsword1';
const ACTOR_IMG = 'icons/svg/mystery-man.svg';
const ITEM_IMG = 'icons/weapons/swords/sword-guard-steel.webp';
const BIOGRAPHY = '<p>A sellsword from the northern passes.</p>';

/** dnd5e 5.x source ability: the score and proficiency, no `mod` and no save total. */
function sourceAbility(value: number, proficient: 0 | 1) {
  return {
    value,
    proficient,
    max: null,
    bonuses: { check: '', save: '' },
    check: { roll: { min: null, max: null, mode: 0 } },
    save: { roll: { min: null, max: null, mode: 0 } },
  };
}

/** The character as Socket.IO delivers it in `worldData.actors`. */
const SOCKET_ACTOR: WorldActor = {
  _id: ACTOR_ID,
  name: 'Brakka Ironhand',
  type: 'character',
  img: ACTOR_IMG,
  system: {
    abilities: {
      str: sourceAbility(16, 1),
      dex: sourceAbility(14, 0),
      con: sourceAbility(15, 1),
      int: sourceAbility(8, 0),
      wis: sourceAbility(12, 0),
      cha: sourceAbility(10, 0),
    },
    attributes: {
      ac: { calc: 'default', flat: null },
      // dnd5e 4+ characters keep hp.max null; prepareData computes 44 (#309).
      hp: { value: 38, max: null, temp: 0, tempmax: 0, bonuses: { level: '', overall: '' } },
    },
    details: { biography: { value: BIOGRAPHY, public: '' }, xp: { value: 6500 } },
  },
  items: [
    {
      _id: 'parityClassItem1',
      name: 'Fighter',
      type: 'class',
      system: { levels: 5, hd: { denomination: 'd10', spent: 0 } },
    },
    {
      _id: 'parityChainMail1',
      name: 'Chain Mail',
      type: 'equipment',
      system: { type: { value: 'heavy' }, armor: { value: 16 }, equipped: true },
    },
    {
      _id: 'parityShield0001',
      name: 'Shield',
      type: 'equipment',
      system: { type: { value: 'shield' }, armor: { value: 2 }, equipped: true },
    },
  ],
};

/**
 * `GET /api/actors/:id` for the same character after prepareData: level 5
 * (class levels), max HP 44 (d10: 10 + 4 x 6, plus 5 x CON +2), AC 18 (chain
 * mail 16 + shield 2), save totals = modifier + proficiency 3 where proficient.
 */
const REST_ACTOR_BODY = {
  success: true,
  data: {
    id: ACTOR_ID,
    name: 'Brakka Ironhand',
    type: 'character',
    img: ACTOR_IMG,
    level: 5,
    hp: { current: 38, max: 44 },
    ac: 18,
    cr: null,
    source: null,
    isPC: true,
    folder: null,
    abilities: {
      str: { value: 16, modifier: 3, save: 6, proficient: 1 },
      dex: { value: 14, modifier: 2, save: 2, proficient: false },
      con: { value: 15, modifier: 2, save: 5, proficient: 1 },
      int: { value: 8, modifier: -1, save: -1, proficient: false },
      wis: { value: 12, modifier: 1, save: 1, proficient: false },
      cha: { value: 10, modifier: 0, save: 0, proficient: false },
    },
    skills: {},
    items: [
      { id: 'parityClassItem1', name: 'Fighter', type: 'class', img: ACTOR_IMG, quantity: 1 },
      {
        id: 'parityChainMail1',
        name: 'Chain Mail',
        type: 'equipment',
        img: ACTOR_IMG,
        quantity: 1,
      },
      { id: 'parityShield0001', name: 'Shield', type: 'equipment', img: ACTOR_IMG, quantity: 1 },
    ],
    spells: null,
    biography: BIOGRAPHY,
    notes: '',
    token: { img: ACTOR_IMG, scale: 1, disposition: 0 },
    ownership: { default: 0 },
    flags: {},
    effects: [],
  },
};

/** A mundane world item as Socket.IO delivers it in `worldData.items`. */
const SOCKET_ITEM: WorldItem = {
  _id: ITEM_ID,
  name: 'Longsword',
  type: 'weapon',
  img: ITEM_IMG,
  system: {
    description: { value: '<p>A versatile steel blade.</p>', chat: '' },
    rarity: '',
    price: { value: 15, denomination: 'gp' },
    weight: { value: 3, units: 'lb' },
    quantity: 1,
    equipped: false,
    identified: true,
    attunement: '',
    source: { book: 'SRD 5.2', page: '', custom: '', license: 'CC-BY-4.0' },
  },
};

/** `GET /api/items?query=Longsword` for the same item. */
const REST_ITEMS_BODY = {
  success: true,
  data: [
    {
      id: ITEM_ID,
      name: 'Longsword',
      type: 'weapon',
      img: ITEM_IMG,
      rarity: 'common',
      cost: { value: 15, denomination: 'gp' },
      weight: 3,
      quantity: 1,
      equipped: false,
      identified: true,
      attunement: 0,
      source: 'SRD 5.2',
      owner: null,
      folder: null,
    },
  ],
  total: 1,
  query: { query: 'Longsword', limit: 10 },
};

const MODULE = { id: 'foundryvtt-local-rest-api', title: 'Foundry Local REST API' };

/** The world, system and release parts of `worldData` (release modelled as the other client fixtures do). */
const SOCKET_WORLD: WorldData = {
  userId: 'parityGamemaster',
  world: {
    id: 'parity-world',
    title: 'Parity World',
    description: '<p>Fixture world</p>',
    system: 'dnd5e',
    coreVersion: '14.369',
    systemVersion: '5.1.10',
  },
  system: { id: 'dnd5e', title: 'Dungeons & Dragons Fifth Edition', version: '5.1.10' },
  release: { generation: 14, build: 369, version: '14.369' },
  modules: [{ ...MODULE, active: true }],
  actors: [SOCKET_ACTOR],
  items: [SOCKET_ITEM],
  scenes: [],
  journal: [],
  messages: [],
  combats: [],
  users: [],
  activeUsers: [],
  macros: [],
  playlists: [],
  tables: [],
  folders: [],
} as unknown as WorldData;

/** `GET /api/world` (formatWorldInfo, the fields the mapper reads plus a few it ignores). */
const REST_WORLD_BODY = {
  success: true,
  data: {
    id: 'parity-world',
    title: 'Parity World',
    description: '<p>Fixture world</p>',
    system: 'dnd5e',
    coreVersion: '14.369',
    systemVersion: '5.1.10',
    version: null,
    authors: [],
    gameSystem: { id: 'dnd5e', title: 'Dungeons & Dragons Fifth Edition', version: '5.1.10' },
    foundryVersion: '14.369',
    modules: [{ ...MODULE, version: '2.0.0', author: null }],
  },
};

const socketActor = worldActorToFoundry(SOCKET_ACTOR);
const restActor = mapRestActor(REST_ACTOR_BODY, `/api/actors/${ACTOR_ID}`);

describe('actor parity: dnd5e character', () => {
  const report = compareParity(normaliseActor(socketActor), normaliseActor(restActor));

  it('agrees on every field both transports report (name, type, HP value, level, abilities, ...)', () => {
    const lines = mismatchLines('actor', report);
    expect(lines, parityMessage(lines)).toEqual([]);
  });

  it('reports only the KNOWN_GAPS fields on one side (AC, max HP and save totals REST-only)', () => {
    const lines = gapDrift('actor', report);
    expect(lines, parityMessage(lines)).toEqual([]);
  });

  it('labels as unavailable only fields that are known REST-only prepared values', () => {
    // derivedUnavailable is the Socket.IO path's own record of the prepared
    // values it could not compute (#308); each must be a known `prepared` gap.
    const field = { ac: 'ac.value', hpMax: 'hp.max' } as const;
    const lines = (socketActor.derivedUnavailable ?? [])
      .map((label) => field[label])
      .filter((path) => KNOWN_GAPS.actor.restOnly[path]?.cause !== 'prepared')
      .map(
        (path) =>
          `actor.${path}: Socket.IO labels it unavailable but it is not a known prepared gap`,
      );
    expect(lines, parityMessage(lines)).toEqual([]);
    expect(socketActor.derivedUnavailable).toEqual(['hpMax', 'ac']);
  });

  it('dual mode fills every REST-only field from the bridge and keeps the Socket.IO-only ones', () => {
    const dual = overlayDerivedValues(socketActor, restActor);
    const versusRest = compareParity(normaliseActor(dual), normaliseActor(restActor));
    const lines = [
      ...mismatchLines('actor', versusRest),
      ...versusRest.restOnly.map(
        (field) =>
          `actor.${field}: REST-only, and dual mode does not overlay it (overlayDerivedValues)`,
      ),
    ];
    expect(lines, parityMessage(lines)).toEqual([]);
    expect(versusRest.socketOnly).toEqual(Object.keys(KNOWN_GAPS.actor.socketOnly).sort());
    expect(dual.derivedUnavailable).toBeUndefined();
  });
});

describe('item parity: world weapon', () => {
  const socketItem = worldItemToFoundry(SOCKET_ITEM);
  const [restItem] = mapRestItemSearch(REST_ITEMS_BODY, 10).items;
  const report = compareParity(normaliseItem(socketItem), normaliseItem(restItem ?? socketItem));

  it('maps the REST body to exactly one item', () => {
    expect(restItem?._id).toBe(ITEM_ID);
  });

  it('agrees on every field both transports report (id, name, type, img)', () => {
    const lines = mismatchLines('item', report);
    expect(lines, parityMessage(lines)).toEqual([]);
  });

  it('reports only the KNOWN_GAPS fields on one side', () => {
    const lines = gapDrift('item', report);
    expect(lines, parityMessage(lines)).toEqual([]);
  });
});

describe('world info parity', () => {
  const report = compareParity(
    normaliseWorld(worldInfoToFoundry(SOCKET_WORLD)),
    normaliseWorld(mapRestWorld(REST_WORLD_BODY)),
  );

  it('agrees on every field both transports report (id, title, system, versions)', () => {
    const lines = mismatchLines('world', report);
    expect(lines, parityMessage(lines)).toEqual([]);
  });

  it('reports only the KNOWN_GAPS fields on one side', () => {
    const lines = gapDrift('world', report);
    expect(lines, parityMessage(lines)).toEqual([]);
  });
});
