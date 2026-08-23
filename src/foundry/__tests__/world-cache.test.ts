import { afterEach, describe, expect, it } from 'vitest';
import type { WorldData } from '../types.js';
import {
  applyDocumentBroadcast,
  applyUserActivity,
  type DocumentBroadcast,
  parseDocumentBroadcast,
  parseUserActivity,
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

// Broadcast payloads are untrusted network input, so a hostile one must not be
// able to reach Object.prototype. JSON.parse is used to build the payloads
// because an object literal's `__proto__` sets the prototype instead of
// creating an own key — which would not reproduce the attack.
describe('applyDocumentBroadcast — prototype pollution', () => {
  afterEach(() => {
    // Fail loudly rather than leaking a poisoned prototype into later tests.
    delete (Object.prototype as Record<string, unknown>).polluted;
  });

  it('does not pollute Object.prototype through a nested update patch', () => {
    const world = buildWorldData();
    applyDocumentBroadcast(world, broadcast());
    applyDocumentBroadcast(world, {
      type: 'JournalEntry',
      action: 'update',
      result: [JSON.parse(`{"_id": "${JOURNAL_ID}", "__proto__": {"polluted": "yes"}}`) as unknown],
    });

    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('does not pollute Object.prototype through a create payload', () => {
    const world = buildWorldData();
    applyDocumentBroadcast(world, {
      type: 'JournalEntry',
      action: 'create',
      result: [
        JSON.parse(`{"_id": "newjournal000000", "__proto__": {"polluted": "yes"}}`) as unknown,
      ],
    });

    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(world.journal).toHaveLength(1);
  });

  it('drops constructor and prototype keys while keeping the rest of the patch', () => {
    const world = buildWorldData();
    applyDocumentBroadcast(world, broadcast());
    applyDocumentBroadcast(world, {
      type: 'JournalEntry',
      action: 'update',
      result: [
        JSON.parse(
          `{"_id": "${JOURNAL_ID}", "constructor": "x", "prototype": "y", "name": "Renamed"}`,
        ) as unknown,
      ],
    });

    const entry = world.journal[0] as unknown as Record<string, unknown>;
    expect(entry.name).toBe('Renamed');
    expect(Object.hasOwn(entry, 'prototype')).toBe(false);
    expect(Object.hasOwn(entry, 'constructor')).toBe(false);
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

/**
 * Issue #218 — `activeUsers` is a top-level `WorldData` field, not a document
 * collection, so `modifyDocument` never touches it. FoundryVTT signals presence
 * on the separate `userActivity` event instead.
 */
describe('parseUserActivity', () => {
  const USER_ID = 'user0000user0001';

  it('parses a logout broadcast', () => {
    expect(parseUserActivity(USER_ID, { active: false })).toEqual({
      userId: USER_ID,
      active: false,
    });
  });

  it('parses a login broadcast', () => {
    expect(parseUserActivity(USER_ID, { active: true })).toEqual({
      userId: USER_ID,
      active: true,
    });
  });

  it('treats an activity ping with no `active` flag as present, like Foundry does', () => {
    expect(parseUserActivity(USER_ID, { cursor: { x: 10, y: 20 } })).toEqual({
      userId: USER_ID,
      active: true,
    });
    expect(parseUserActivity(USER_ID, undefined)).toEqual({ userId: USER_ID, active: true });
  });

  it.each([
    ['a non-string user id', 42, { active: true }],
    ['an empty user id', '', { active: true }],
    ['a non-object activity payload', 'user0000user0001', 'nope'],
    ['a non-boolean active flag', 'user0000user0001', { active: 'yes' }],
  ])('rejects %s', (_label, userId, activityData) => {
    expect(parseUserActivity(userId, activityData)).toBeNull();
  });
});

describe('applyUserActivity', () => {
  const USER_ID = 'user0000user0001';
  const OTHER_ID = 'user0000user0002';

  it('adds a user that just logged in', () => {
    const worldData = buildWorldData();
    worldData.activeUsers = [OTHER_ID];

    expect(applyUserActivity(worldData, { userId: USER_ID, active: true })).toBe(true);
    expect(worldData.activeUsers).toEqual([OTHER_ID, USER_ID]);
  });

  it('removes a user that just logged out', () => {
    const worldData = buildWorldData();
    worldData.activeUsers = [OTHER_ID, USER_ID];

    expect(applyUserActivity(worldData, { userId: USER_ID, active: false })).toBe(true);
    expect(worldData.activeUsers).toEqual([OTHER_ID]);
  });

  it('is idempotent — an activity ping from an already-active user changes nothing', () => {
    const worldData = buildWorldData();
    worldData.activeUsers = [USER_ID];

    expect(applyUserActivity(worldData, { userId: USER_ID, active: true })).toBe(false);
    expect(worldData.activeUsers).toEqual([USER_ID]);
  });

  it('is idempotent for a logout of a user that is already absent', () => {
    const worldData = buildWorldData();
    worldData.activeUsers = [OTHER_ID];

    expect(applyUserActivity(worldData, { userId: USER_ID, active: false })).toBe(false);
    expect(worldData.activeUsers).toEqual([OTHER_ID]);
  });
});
