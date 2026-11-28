import { z } from 'zod';
import type { WorldData } from '../foundry/types.js';

const record = z.record(z.string(), z.unknown());
const effect = z.looseObject({
  _id: z.string(),
  name: z.string(),
  img: z.string().optional(),
  statuses: z.array(z.string()).optional(),
  disabled: z.boolean().optional(),
});
const item = z.looseObject({
  _id: z.string(),
  name: z.string(),
  type: z.string(),
  system: record,
  img: z.string().optional(),
  effects: z.array(effect).optional(),
});
const actor = z.looseObject({
  _id: z.string(),
  name: z.string(),
  type: z.string(),
  system: record,
  img: z.string().optional(),
  items: z.array(item).optional(),
  effects: z.array(effect).optional(),
});
const scene = z.looseObject({
  _id: z.string(),
  name: z.string(),
  active: z.boolean(),
  navigation: z.boolean().default(false),
  width: z.number(),
  height: z.number(),
  padding: z.number().default(0),
  darkness: z.number().default(0),
  globalLight: z.boolean().default(false),
  tokens: z.array(record).optional(),
});
const journal = z.looseObject({ _id: z.string(), name: z.string() });
const user = z.looseObject({
  _id: z.string(),
  name: z.string(),
  role: z.number(),
  color: z.string().default(''),
});
const message = z.looseObject({
  _id: z.string(),
  type: z.number().default(0),
  user: z.string(),
  timestamp: z.number(),
  content: z.string(),
});
const combat = z.looseObject({
  _id: z.string(),
  active: z.boolean(),
  round: z.number(),
  turn: z.number().nullable(),
  combatants: z.array(
    z.looseObject({
      _id: z.string(),
      name: z.string(),
      initiative: z.number().nullable(),
      hidden: z.boolean().default(false),
      defeated: z.boolean().default(false),
    }),
  ),
});
const SnapshotSchema = z.looseObject({
  userId: z.string(),
  release: record,
  world: record,
  system: record,
  modules: z.array(record),
  demoMode: z.boolean().default(false),
  actors: z.array(actor),
  items: z.array(item),
  scenes: z.array(scene),
  journal: z.array(journal),
  messages: z.array(message),
  combats: z.array(combat),
  users: z.array(user),
  activeUsers: z.array(z.string()),
  settings: z.array(z.unknown()),
  folders: z.array(record),
  macros: z.array(record),
  playlists: z.array(record),
  tables: z.array(record),
  cards: z.array(record),
  packs: z.array(record),
});

export function parseSnapshot(value: unknown): {
  snapshot: WorldData;
  ready: boolean;
  origin: string;
} {
  const parsed = z
    .object({ snapshot: SnapshotSchema, ready: z.boolean(), origin: z.string() })
    .parse(value);
  // The payload is validated above. JSON cannot contain explicit undefined;
  // this bridges Zod's optional-property inference to exactOptionalPropertyTypes.
  return { snapshot: parsed.snapshot as WorldData, ready: parsed.ready, origin: parsed.origin };
}

/** Fixed binding owned by the provider. Only visible runtime documents are serialized. */
export const SNAPSHOT_SCRIPT = `
if (typeof game === 'undefined' || !game.ready) throw new Error('Foundry runtime is not ready');
const docs = collection => Array.from(collection?.contents ?? []).map(document => document.toObject(false));
return {
  ready: game.ready === true,
  origin: globalThis.location?.origin ?? '',
  snapshot: {
    userId: game.user?.id ?? '',
    world: { id: game.world.id, title: game.world.title, description: game.world.description ?? '' },
    system: { id: game.system.id, version: game.system.version },
    release: { version: game.version },
    modules: Array.from(game.modules.values()).map(m => ({ id:m.id, title:m.title, version:m.version, active:m.active })),
    demoMode: false,
    actors: docs(game.actors), items: docs(game.items), scenes: docs(game.scenes),
    journal: docs(game.journal), messages: docs(game.messages), combats: docs(game.combats),
    users: docs(game.users).map(({ password, ...user }) => user),
    activeUsers: Array.from(game.users.values()).filter(user => user.active).map(user => user.id),
    folders: docs(game.folders), macros: docs(game.macros), playlists: docs(game.playlists),
    tables: docs(game.tables), cards: docs(game.cards), settings: [], packs: []
  }
};`;
