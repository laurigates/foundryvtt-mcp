import { describe, expect, it } from 'vitest';
import type { WorldData } from '../types.js';
import {
  applyDocumentBroadcast,
  type DocumentBroadcast,
  parseDocumentBroadcast,
} from '../world-cache.js';

const ACTOR_ID = 'aaaaaaaaaaaaaaaa';
const ITEM_ID = 'bbbbbbbbbbbbbbbb';
const JOURNAL_ID = 'cccccccccccccccc';
const SCENE_ID = 'dddddddddddddddd';
const TOKEN_ID = 'eeeeeeeeeeeeeeee';
const COMBAT_ID = 'ffffffffffffffff';

/** Minimal WorldData with just the collections the tests touch. */
const buildWorldData = (): WorldData =>
  ({
    userId: 'user0000user0000',
    release: {},
    world: {},
    system: {},
    modules: [],
    demoMode: false,
    actors: [
      {
        _id: ACTOR_ID,
        name: 'Vex',
        type: 'character',
        system: { attributes: { hp: { value: 30, max: 40 } } },
        items: [{ _id: ITEM_ID, name: 'Longsword', type: 'weapon', system: {} }],
      },
    ],
    scenes: [
      { _id: SCENE_ID, name: 'Terris', active: true, tokens: [{ _id: TOKEN_ID, x: 0, y: 0 }] },
    ],
    items: [],
    journal: [],
    messages: [],
    combats: [{ _id: COMBAT_ID, active: true, round: 1, turn: 0, started: true, combatants: [] }],
    users: [],
    activeUsers: [],
    settings: [],
    folders: [],
    macros: [],
    playlists: [],
    tables: [],
    cards: [],
    packs: [],
  }) as unknown as WorldData;

const broadcast = (over: Partial<DocumentBroadcast> = {}): DocumentBroadcast => ({
  type: 'JournalEntry',
  action: 'create',
  result: [{ _id: JOURNAL_ID, name: 'Session 11 Recap' }],
  ...over,
});

describe('parseDocumentBroadcast', () => {
  it('parses a top-level broadcast', () => {
    expect(
      parseDocumentBroadcast({
        type: 'JournalEntry',
        action: 'create',
        result: [{ _id: JOURNAL_ID }],
      }),
    ).toEqual({ type: 'JournalEntry', action: 'create', result: [{ _id: JOURNAL_ID }] });
  });

  it('carries parentUuid through for embedded documents', () => {
    const parsed = parseDocumentBroadcast({
      type: 'Item',
      action: 'create',
      result: [{ _id: ITEM_ID }],
      operation: { parentUuid: `Actor.${ACTOR_ID}` },
    });
    expect(parsed?.parentUuid).toBe(`Actor.${ACTOR_ID}`);
  });

  it.each([
    ['not an object', 'nope'],
    ['missing type', { action: 'create', result: [] }],
    ['unknown action', { type: 'Actor', action: 'frobnicate', result: [] }],
    ['non-array result', { type: 'Actor', action: 'create', result: 'x' }],
    ['an error payload', { type: 'Actor', action: 'create', result: [], error: { message: 'no' } }],
  ])('rejects %s', (_label, payload) => {
    expect(parseDocumentBroadcast(payload)).toBeNull();
  });
});

describe('applyDocumentBroadcast — top-level documents', () => {
  it('adds a created journal entry to the cache', () => {
    const world = buildWorldData();
    expect(applyDocumentBroadcast(world, broadcast())).toBe(true);
    expect(world.journal).toHaveLength(1);
    expect(world.journal[0].name).toBe('Session 11 Recap');
  });

  it('is idempotent, so an echoed create does not duplicate', () => {
    const world = buildWorldData();
    applyDocumentBroadcast(world, broadcast());
    applyDocumentBroadcast(world, broadcast());
    expect(world.journal).toHaveLength(1);
  });

  it('merges an update rather than replacing the document', () => {
    const world = buildWorldData();
    applyDocumentBroadcast(world, broadcast());
    applyDocumentBroadcast(
      world,
      broadcast({ action: 'update', result: [{ _id: JOURNAL_ID, folder: 'folder0000000000' }] }),
    );
    expect(world.journal[0].name).toBe('Session 11 Recap');
    expect(world.journal[0].folder).toBe('folder0000000000');
  });

  it('removes a deleted document by id', () => {
    const world = buildWorldData();
    applyDocumentBroadcast(world, broadcast());
    expect(
      applyDocumentBroadcast(world, broadcast({ action: 'delete', result: [JOURNAL_ID] })),
    ).toBe(true);
    expect(world.journal).toHaveLength(0);
  });

  it('tolerates deleting an id that is already gone', () => {
    const world = buildWorldData();
    expect(
      applyDocumentBroadcast(world, broadcast({ action: 'delete', result: [JOURNAL_ID] })),
    ).toBe(false);
  });

  it('merges nested update paths without clobbering siblings', () => {
    const world = buildWorldData();
    applyDocumentBroadcast(world, {
      type: 'Actor',
      action: 'update',
      result: [{ _id: ACTOR_ID, system: { attributes: { hp: { value: 12 } } } }],
    });
    const hp = (world.actors[0].system.attributes as { hp: { value: number; max: number } }).hp;
    expect(hp.value).toBe(12);
    expect(hp.max).toBe(40);
  });

  it('ignores an update for a document not in the cache', () => {
    const world = buildWorldData();
    expect(
      applyDocumentBroadcast(world, broadcast({ action: 'update', result: [{ _id: 'zzzz' }] })),
    ).toBe(false);
  });

  it('ignores document types the cache does not model', () => {
    const world = buildWorldData();
    expect(applyDocumentBroadcast(world, broadcast({ type: 'Setting' }))).toBe(false);
  });
});

describe('applyDocumentBroadcast — embedded documents', () => {
  it("adds an item to its parent actor's items", () => {
    const world = buildWorldData();
    const applied = applyDocumentBroadcast(world, {
      type: 'Item',
      action: 'create',
      result: [{ _id: 'newitem000000000', name: 'Potion', type: 'consumable' }],
      parentUuid: `Actor.${ACTOR_ID}`,
    });
    expect(applied).toBe(true);
    expect(world.actors[0].items).toHaveLength(2);
  });

  it("removes a deleted item from its parent actor's items", () => {
    const world = buildWorldData();
    applyDocumentBroadcast(world, {
      type: 'Item',
      action: 'delete',
      result: [ITEM_ID],
      parentUuid: `Actor.${ACTOR_ID}`,
    });
    expect(world.actors[0].items).toHaveLength(0);
  });

  it('materializes an absent embedded array on create', () => {
    const world = buildWorldData();
    const applied = applyDocumentBroadcast(world, {
      type: 'ActiveEffect',
      action: 'create',
      result: [{ _id: 'effect0000000000', name: 'Prone', statuses: ['prone'] }],
      parentUuid: `Actor.${ACTOR_ID}`,
    });
    expect(applied).toBe(true);
    expect(world.actors[0].effects).toHaveLength(1);
  });

  it("applies a token move to the parent scene's tokens", () => {
    const world = buildWorldData();
    applyDocumentBroadcast(world, {
      type: 'Token',
      action: 'update',
      result: [{ _id: TOKEN_ID, x: 500, y: 750 }],
      parentUuid: `Scene.${SCENE_ID}`,
    });
    expect(world.scenes[0].tokens?.[0]).toMatchObject({ x: 500, y: 750 });
  });

  it('adds a combatant to its parent combat', () => {
    const world = buildWorldData();
    applyDocumentBroadcast(world, {
      type: 'Combatant',
      action: 'create',
      result: [{ _id: 'combatant000000a', name: 'Goblin', initiative: 14 }],
      parentUuid: `Combat.${COMBAT_ID}`,
    });
    expect(world.combats[0].combatants).toHaveLength(1);
  });

  it('ignores a broadcast whose parent is not in the cache', () => {
    const world = buildWorldData();
    expect(
      applyDocumentBroadcast(world, {
        type: 'Item',
        action: 'create',
        result: [{ _id: ITEM_ID }],
        parentUuid: 'Actor.doesnotexist00',
      }),
    ).toBe(false);
  });

  it('ignores synthetic token-actor UUIDs, which are not cached documents', () => {
    const world = buildWorldData();
    expect(
      applyDocumentBroadcast(world, {
        type: 'ActiveEffect',
        action: 'create',
        result: [{ _id: 'effect0000000000' }],
        parentUuid: `Scene.${SCENE_ID}.Token.${TOKEN_ID}.Actor.${ACTOR_ID}`,
      }),
    ).toBe(false);
  });
});
