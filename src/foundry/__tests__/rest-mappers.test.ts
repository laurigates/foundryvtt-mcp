/**
 * Contract tests for the REST bridge mappers (#310).
 *
 * The fixtures mirror the HTTP bodies the bridge server returns, read from
 * laurigates/foundryvtt-local-rest-api's `feat/v14-port` branch: the bridge
 * forwards a request to the module over Socket.IO and answers with whatever
 * the module's route handler passed to `res.json()` (`bridge-server/lib/
 * socket-client.js` `handleApiResponse`, `scripts/socket-handler.js`
 * `createSuccessResponse`). The document routes wrap their payload as
 * `{ success, data, ... }` (`scripts/routes/{actors,items,scenes,world,dice}.js`);
 * the diagnostics routes do not (`scripts/routes/diagnostics.js`).
 */

import { describe, expect, it } from 'vitest';
import {
  mapRestActor,
  mapRestActorSearch,
  mapRestCompendiumSearch,
  mapRestDiceRoll,
  mapRestItemSearch,
  mapRestScene,
  mapRestWorld,
  unwrapOptionalEnvelope,
  unwrapRestEnvelope,
} from '../rest-mappers.js';

// --- Fixtures: shapes produced by the module's formatters ------------------

/** `ActorsAPI.formatActorSummary` */
const actorSummary = {
  id: 'abcdefghijklmnop',
  name: 'Aria Thornwood',
  type: 'character',
  img: 'icons/aria.webp',
  level: 5,
  hp: { current: 31, max: 38 },
  ac: 16,
  cr: null,
  source: "Player's Handbook",
  isPC: true,
  folder: 'Party',
};

/** `ActorsAPI.formatActorDetail` (summary plus detail fields) */
const actorDetail = {
  ...actorSummary,
  abilities: {
    str: { value: 10, modifier: 0, save: 0, proficient: 0 },
    dex: { value: 16, modifier: 3, save: 6, proficient: 1 },
    wis: { value: 14, modifier: 2, save: null, proficient: false },
  },
  skills: {
    prc: { value: 1, proficient: 1, bonus: 0, passive: 15 },
  },
  items: [{ id: 'itemaaaaaaaaaaaa', name: 'Longbow', type: 'weapon', img: 'x', quantity: 1 }],
  spells: null,
  biography: '<p>A ranger.</p>',
  notes: '',
  token: { img: 'icons/aria.webp', scale: 1, disposition: 1 },
  ownership: { default: 0 },
  flags: {},
  effects: [],
};

/** `ItemsAPI.formatItemSummary`; actor-owned entries are spread copies without `id`. */
const itemSummaries = [
  {
    id: 'itembbbbbbbbbbbb',
    name: 'Longsword',
    type: 'weapon',
    img: 'icons/sword.webp',
    rarity: 'common',
    cost: { value: 15, denomination: 'gp' },
    weight: 3,
    quantity: 1,
    equipped: false,
    identified: true,
    attunement: 0,
    source: null,
    owner: null,
    folder: null,
  },
  {
    name: 'Potion of Healing',
    type: 'consumable',
    img: 'icons/potion.webp',
    rarity: 'common',
    cost: { value: 50, denomination: 'gp' },
    weight: 0.5,
    quantity: 2,
    equipped: false,
    identified: true,
    attunement: 0,
    source: null,
    owner: { id: 'abcdefghijklmnop', name: 'Aria Thornwood' },
    folder: null,
  },
];

/** `ScenesAPI.formatSceneDetail` (trimmed of the per-placeable arrays it also returns) */
const sceneDetail = {
  id: 'sceneaaaaaaaaaaa',
  name: 'Waterdeep Docks',
  navName: 'Docks',
  img: 'maps/docks.webp',
  thumb: 'maps/docks-thumb.webp',
  active: true,
  navigation: true,
  dimensions: { width: 4000, height: 3000, size: 100, distance: 5, units: 'ft' },
  tokenCount: 3,
  lightCount: 1,
  folder: null,
  background: { src: 'maps/docks.webp', offsetX: 10, offsetY: -5, scaleX: 1, scaleY: 1 },
  foreground: null,
  darkness: 0.25,
  globalLight: false,
  grid: { type: 1, size: 100, color: '#000000', alpha: 0.2, distance: 5, units: 'ft' },
  tokens: [],
  walls: [],
};

/** `WorldAPI.formatWorldInfo` (trimmed) */
const worldInfo = {
  id: 'waterdeep',
  title: 'Waterdeep: Dragon Heist',
  description: 'A city adventure',
  system: 'dnd5e',
  coreVersion: '14.369',
  systemVersion: '6.0.6',
  version: null,
  gameSystem: { id: 'dnd5e', title: 'D&D Fifth Edition', version: '6.0.6' },
  foundryVersion: '14.369',
  statistics: { actors: { total: 12, byType: { character: 4 } } },
  modules: [{ id: 'foundryvtt-local-rest-api', title: 'Foundry Local REST API', version: '2.0.0' }],
  compendiums: [],
};

/** `DiceAPI.formatRollResult` */
const diceResult = {
  formula: '1d20+5',
  evaluatedFormula: '1d20 + 5',
  total: 19,
  terms: [
    {
      type: 'die',
      faces: 20,
      number: 1,
      results: [{ result: 14, active: true, discarded: false, exploded: false, rerolled: false }],
      total: 14,
      expression: '1d20',
      modifiers: [],
    },
    { type: 'operator', operator: '+' },
    { type: 'number', number: 5, total: 5 },
  ],
  dice: [],
  reason: 'Perception',
  timestamp: '2026-11-24T10:00:00.000Z',
  options: {},
  breakdown: [{ dice: '1d20', results: [14], total: 14 }],
  critical: { success: false, failure: false, naturalRolls: [14] },
};

const ok = (data: unknown, extra: Record<string, unknown> = {}) => ({
  success: true,
  data,
  ...extra,
});

// --- Envelope ---------------------------------------------------------------

describe('unwrapRestEnvelope', () => {
  it('returns data from a success envelope', () => {
    expect(unwrapRestEnvelope(ok({ a: 1 }), '/api/world')).toEqual({ a: 1 });
  });

  it('reports the module message for success: false', () => {
    expect(() =>
      unwrapRestEnvelope(
        { success: false, error: 'Actor not found', message: 'Actor with ID x does not exist' },
        '/api/actors/x',
      ),
    ).toThrow(/\/api\/actors\/x.*Actor with ID x does not exist/);
  });

  it.each([
    ['a bare object (the pre-envelope shape)', { id: 'w', title: 'World' }],
    ['an HTML page', '<html>Foundry</html>'],
    ['null', null],
    ['an array', []],
  ])('rejects %s with a clear error', (_label, body) => {
    expect(() => unwrapRestEnvelope(body, '/api/world')).toThrow(
      /REST bridge \/api\/world returned an unexpected response shape/,
    );
  });
});

describe('unwrapOptionalEnvelope (diagnostics routes answer unwrapped)', () => {
  it('passes a raw diagnostics body through', () => {
    const raw = { logs: [], total: 0, bufferSize: 0, maxBufferSize: 1000 };
    expect(unwrapOptionalEnvelope(raw, '/api/diagnostics/logs')).toBe(raw);
  });

  it('unwraps an envelope if the module ever adds one', () => {
    expect(unwrapOptionalEnvelope(ok({ logs: [] }), '/api/diagnostics/logs')).toEqual({ logs: [] });
  });

  it('raises the module error for success: false', () => {
    expect(() =>
      unwrapOptionalEnvelope(
        { success: false, error: 'Unauthorized', message: 'Valid API key required' },
        '/api/diagnostics/health',
      ),
    ).toThrow(/Valid API key required/);
  });
});

// --- Actors -----------------------------------------------------------------

describe('mapRestActor', () => {
  it('maps id, hp {current,max}, ac and level into the MCP actor', () => {
    const actor = mapRestActor(ok(actorDetail), '/api/actors/abcdefghijklmnop');
    expect(actor._id).toBe('abcdefghijklmnop');
    expect(actor.name).toBe('Aria Thornwood');
    expect(actor.type).toBe('character');
    expect(actor.img).toBe('icons/aria.webp');
    expect(actor.hp).toEqual({ value: 31, max: 38 });
    expect(actor.ac).toEqual({ value: 16 });
    expect(actor.level).toBe(5);
    expect(actor.derivedUnavailable).toBeUndefined();
  });

  it('maps abilities: modifier becomes mod, a numeric save total is kept', () => {
    const actor = mapRestActor(ok(actorDetail), '/api/actors/abcdefghijklmnop');
    expect(actor.abilities).toEqual({
      str: { value: 10, mod: 0, save: 0 },
      dex: { value: 16, mod: 3, save: 6 },
      wis: { value: 14, mod: 2 },
    });
  });

  it('keeps the biography text', () => {
    const actor = mapRestActor(ok(actorDetail), '/api/actors/abcdefghijklmnop');
    expect(actor.biography).toBe('<p>A ranger.</p>');
  });

  it('omits fields the module reports as null (0 HP stays 0)', () => {
    const actor = mapRestActor(
      ok({ ...actorSummary, hp: { current: 0, max: null }, ac: null, level: null }),
      '/api/actors/abcdefghijklmnop',
    );
    expect(actor.hp).toEqual({ value: 0 });
    expect(actor.ac).toBeUndefined();
    expect(actor.level).toBeUndefined();
  });

  it('rejects an actor without an id', () => {
    const { id: _id, ...noId } = actorSummary;
    expect(() => mapRestActor(ok(noId), '/api/actors/x')).toThrow(/unexpected response shape/);
  });

  it('rejects the pre-#310 shape (hp.value at the top level, no envelope)', () => {
    expect(() =>
      mapRestActor(
        { _id: 'abcdefghijklmnop', name: 'A', type: 'npc', hp: { value: 3 } },
        '/api/actors/x',
      ),
    ).toThrow(/unexpected response shape/);
  });
});

describe('mapRestActorSearch', () => {
  it('maps every summary and carries total and limit', () => {
    const result = mapRestActorSearch(
      ok([actorSummary], { total: 1, query: { query: 'aria', limit: 10 } }),
      10,
    );
    expect(result).toEqual({
      actors: [
        {
          _id: 'abcdefghijklmnop',
          name: 'Aria Thornwood',
          type: 'character',
          img: 'icons/aria.webp',
          hp: { value: 31, max: 38 },
          ac: { value: 16 },
          level: 5,
        },
      ],
      total: 1,
      page: 1,
      limit: 10,
    });
  });

  it('rejects a data field that is not an array', () => {
    expect(() => mapRestActorSearch(ok({ actors: [] }, { total: 0 }), 10)).toThrow(
      /unexpected response shape/,
    );
  });
});

// --- Items ------------------------------------------------------------------

describe('mapRestItemSearch', () => {
  it('maps id, cost and the scalar fields', () => {
    const result = mapRestItemSearch(ok(itemSummaries, { total: 2 }), 10);
    expect(result.total).toBe(2);
    expect(result.limit).toBe(10);
    expect(result.items[0]).toEqual({
      _id: 'itembbbbbbbbbbbb',
      name: 'Longsword',
      type: 'weapon',
      img: 'icons/sword.webp',
      rarity: 'common',
      price: { value: 15, denomination: 'gp' },
      weight: 3,
      quantity: 1,
      equipped: false,
      identified: true,
    });
  });

  it('keeps an actor-owned entry the module sends without an id, with an empty _id', () => {
    const result = mapRestItemSearch(ok(itemSummaries, { total: 2 }), 10);
    expect(result.items[1]?._id).toBe('');
    expect(result.items[1]?.name).toBe('Potion of Healing');
  });
});

// --- Scenes -----------------------------------------------------------------

describe('mapRestScene', () => {
  it('maps id, dimensions, background offsets and lighting', () => {
    expect(mapRestScene(ok(sceneDetail), '/api/scenes/current')).toEqual({
      _id: 'sceneaaaaaaaaaaa',
      name: 'Waterdeep Docks',
      active: true,
      navigation: true,
      img: 'maps/docks.webp',
      width: 4000,
      height: 3000,
      padding: 0,
      shiftX: 10,
      shiftY: -5,
      globalLight: false,
      darkness: 0.25,
    });
  });

  it('reports "No active scene" for the module answer data: null', () => {
    expect(() =>
      mapRestScene(ok(null, { message: 'No active scene' }), '/api/scenes/current'),
    ).toThrow('No active scene');
  });
});

// --- World ------------------------------------------------------------------

describe('mapRestWorld', () => {
  it('maps the world fields the MCP world type carries', () => {
    const world = mapRestWorld(ok(worldInfo));
    expect(world).toMatchObject({
      id: 'waterdeep',
      title: 'Waterdeep: Dragon Heist',
      description: 'A city adventure',
      system: 'dnd5e',
      coreVersion: '14.369',
      systemVersion: '6.0.6',
      playtime: 0,
      modules: [{ id: 'foundryvtt-local-rest-api', title: 'Foundry Local REST API', active: true }],
    });
  });

  it('falls back to gameSystem and foundryVersion when the world fields are absent', () => {
    const { system: _s, coreVersion: _c, systemVersion: _v, ...rest } = worldInfo;
    const world = mapRestWorld(ok(rest));
    expect(world.system).toBe('dnd5e');
    expect(world.coreVersion).toBe('14.369');
    expect(world.systemVersion).toBe('6.0.6');
  });

  it('rejects a world without an id or title', () => {
    expect(() => mapRestWorld(ok({ description: 'x' }))).toThrow(/unexpected response shape/);
  });
});

// --- Dice -------------------------------------------------------------------

describe('mapRestDiceRoll', () => {
  it('maps total and the per-die breakdown, marked as a server roll', () => {
    const roll = mapRestDiceRoll(ok(diceResult), '1d20+5', 'Perception');
    expect(roll.total).toBe(19);
    expect(roll.formula).toBe('1d20+5');
    expect(roll.breakdown).toBe('1d20: 14');
    expect(roll.source).toBe('server');
    expect(roll.reason).toBe('Perception');
  });

  it('falls back to the formula when no die was rolled', () => {
    const roll = mapRestDiceRoll(ok({ ...diceResult, breakdown: undefined }), '3+4');
    expect(roll.breakdown).toBe('3+4');
    expect(roll.reason).toBeUndefined();
  });

  it('rejects a roll without a numeric total', () => {
    expect(() => mapRestDiceRoll(ok({ ...diceResult, total: 'x' }), '1d20')).toThrow(
      /unexpected response shape/,
    );
  });

  it('rejects the old top-level {total, terms} body', () => {
    expect(() => mapRestDiceRoll({ total: 4, terms: [] }, '1d4')).toThrow(
      /unexpected response shape/,
    );
  });
});

// --- Compendium -------------------------------------------------------------

describe('mapRestCompendiumSearch', () => {
  const entry = {
    compendiumId: 'dnd5e.spells',
    itemId: 'spellaaaaaaaaaaa',
    name: 'Fireball',
    type: 'spell',
    system: { level: 3, school: 'evo' },
  };

  it('maps the entries and the total, paging from the offset', () => {
    const result = mapRestCompendiumSearch(ok([entry], { total: 3 }), { limit: 1, offset: 0 });
    expect(result.results).toEqual([entry]);
    expect(result.total).toBe(3);
    expect(result.page).toBe(1);
    expect(result.restAvailable).toBe(true);
    expect(result.nextCursor).not.toBeNull();
  });

  it('ends paging on the last page', () => {
    const result = mapRestCompendiumSearch(ok([entry], { total: 1 }), { limit: 20, offset: 0 });
    expect(result.nextCursor).toBeNull();
  });

  it('rejects an entry without a compendium id', () => {
    const { compendiumId: _c, ...bad } = entry;
    expect(() => mapRestCompendiumSearch(ok([bad]), { limit: 20, offset: 0 })).toThrow(
      /unexpected response shape/,
    );
  });
});
