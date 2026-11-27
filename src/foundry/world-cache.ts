/**
 * @fileoverview Applies FoundryVTT `modifyDocument` broadcasts to the cached world state.
 *
 * `worldData` is loaded once at connect time (ADR-004) and was, until #205, never
 * updated afterwards — so a write followed by a read returned pre-write data, and
 * changes made by other users (a player moving a token, the GM editing in the
 * Foundry UI) were invisible for the life of the connection.
 *
 * FoundryVTT broadcasts every accepted document mutation to connected clients on
 * the `modifyDocument` event. This module turns one such broadcast into an
 * in-place edit of the cached snapshot.
 *
 * **Idempotent by construction.** `create` upserts by `_id` rather than pushing,
 * and `delete` tolerates an id that is already gone. So it does not matter
 * whether FoundryVTT echoes a client's own writes back to it — applying the same
 * broadcast twice lands on the same state as applying it once.
 */

import { z } from 'zod';
import type { WorldActor, WorldCombat, WorldData, WorldScene } from './types.js';

/** A `modifyDocument` broadcast, once validated. */
export interface DocumentBroadcast {
  /** Document name — "Actor", "JournalEntry", "Token", … */
  type: string;
  action: 'create' | 'update' | 'delete';
  /** Created/updated document data, or deleted ids. */
  result: unknown[];
  /** Present for embedded documents: "Actor.<id>", "Scene.<id>", … */
  parentUuid?: string;
}

/**
 * Document name → the `WorldData` collection holding it.
 *
 * Types absent here (Setting, Adventure, …) are not cached, so broadcasts about
 * them are ignored rather than mishandled.
 */
const TOP_LEVEL_COLLECTIONS: Record<string, keyof WorldData> = {
  Actor: 'actors',
  Item: 'items',
  Scene: 'scenes',
  JournalEntry: 'journal',
  Combat: 'combats',
  ChatMessage: 'messages',
  User: 'users',
  Folder: 'folders',
  Macro: 'macros',
  Playlist: 'playlists',
  RollTable: 'tables',
  Cards: 'cards',
};

/** Parent document name → embedded document name → the parent's array field. */
const EMBEDDED_COLLECTIONS: Record<string, Record<string, string>> = {
  Actor: { Item: 'items', ActiveEffect: 'effects' },
  Scene: { Token: 'tokens', AmbientLight: 'lights', Wall: 'walls', Drawing: 'drawings' },
  JournalEntry: { JournalEntryPage: 'pages' },
  Combat: { Combatant: 'combatants' },
  Item: { ActiveEffect: 'effects' },
};

/** Unhandled events may affect cached data and require a fresh snapshot. */
export type DocumentBroadcastStatus = 'applied' | 'irrelevant' | 'unhandled';

interface BroadcastApplication {
  changed: boolean;
  unhandled: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validates a raw socket payload as a `modifyDocument` broadcast.
 *
 * Returns `null` for anything unrecognized — a payload shape we do not model is
 * dropped rather than guessed at, leaving the cache untouched (and stale) rather
 * than corrupted.
 */
export function parseDocumentBroadcast(payload: unknown): DocumentBroadcast | null {
  if (!isRecord(payload)) {
    return null;
  }

  const { type, action, result, operation } = payload;
  if (typeof type !== 'string' || !type) {
    return null;
  }
  if (action !== 'create' && action !== 'update' && action !== 'delete') {
    return null;
  }
  if (!Array.isArray(result)) {
    return null;
  }
  // A rejected operation is broadcast to nobody, but be explicit about it.
  if (payload.error) {
    return null;
  }

  const broadcast: DocumentBroadcast = { type, action, result };

  const parentUuid = isRecord(operation) ? operation.parentUuid : undefined;
  if (
    parentUuid !== undefined &&
    parentUuid !== null &&
    (typeof parentUuid !== 'string' || !parentUuid.trim())
  ) {
    return null;
  }
  if (typeof parentUuid === 'string' && parentUuid) {
    broadcast.parentUuid = parentUuid;
  }
  return broadcast;
}

/**
 * Validates a raw `modifyDocumentBatch` socket payload (FoundryVTT v14, #232).
 *
 * From v14 the server delivers a write that had server-side side effects (for
 * example, creating an active Combat deactivates the previously active one) to
 * other clients as a `modifyDocumentBatch` event carrying `{ results: [...] }`:
 * one entry per side effect plus the primary change, each shaped like a
 * single `modifyDocument` broadcast. Writes without side effects still arrive
 * on `modifyDocument`.
 *
 * Each entry goes through {@link parseDocumentBroadcast}; malformed entries are
 * dropped individually, and an unrecognized payload yields `[]`.
 */
export function parseDocumentBroadcastBatch(payload: unknown): DocumentBroadcast[] {
  if (!isRecord(payload) || !Array.isArray(payload.results)) {
    return [];
  }
  const broadcasts: DocumentBroadcast[] = [];
  for (const entry of payload.results) {
    const parsed = parseDocumentBroadcast(entry);
    if (parsed) {
      broadcasts.push(parsed);
    }
  }
  return broadcasts;
}

/**
 * Keys that must never be copied out of a broadcast payload.
 *
 * Broadcast data arrives off the network from whatever FoundryVTT relays, so it
 * is untrusted input; writing these would reach `Object.prototype` and poison
 * every object in the process. ADR-010 already mandates hard-failing these in
 * mutation patches — the same rule applies on the way back in.
 */
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Copies own, safe keys out of an untrusted object.
 *
 * Applied to created documents before they enter the cache, so a hostile
 * payload cannot smuggle a `__proto__` key in through the create path either.
 */
function sanitize(doc: Record<string, unknown>): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(doc)) {
    if (FORBIDDEN_KEYS.has(key)) {
      continue;
    }
    clean[key] = value;
  }
  return clean;
}

/**
 * Recursively merges `patch` into `target`, matching FoundryVTT's own update
 * semantics: keys merge, `null` deletes, arrays replace wholesale.
 *
 * Prototype-polluting keys are dropped rather than merged (see
 * {@link FORBIDDEN_KEYS}).
 */
function mergePatch(target: Record<string, unknown>, patch: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(patch)) {
    if (FORBIDDEN_KEYS.has(key)) {
      continue;
    }
    if (value === null) {
      delete target[key];
      continue;
    }
    if (isRecord(value) && isRecord(target[key])) {
      mergePatch(target[key] as Record<string, unknown>, value);
      continue;
    }
    target[key] = value;
  }
}

/**
 * Applies one broadcast to a document array in place.
 *
 * Tracks partial application too: one valid entry cannot hide an unhandled entry.
 */
function applyToCollection(
  collection: Array<Record<string, unknown>>,
  action: DocumentBroadcast['action'],
  result: unknown[],
): BroadcastApplication {
  let changed = false;
  let unhandled = false;

  if (action === 'delete') {
    // `result` is an array of deleted document ids.
    for (const id of result) {
      if (typeof id !== 'string' || !id) {
        unhandled = true;
        continue;
      }
      const index = collection.findIndex((doc) => doc._id === id);
      if (index !== -1) {
        collection.splice(index, 1);
        changed = true;
      }
    }
    return { changed, unhandled };
  }

  for (const doc of result) {
    if (!isRecord(doc) || typeof doc._id !== 'string' || !doc._id) {
      unhandled = true;
      continue;
    }
    const existing = collection.find((d) => d._id === doc._id);

    if (action === 'create') {
      // Upsert, not push — re-applying a create must not duplicate the document.
      if (existing) {
        mergePatch(existing, doc);
      } else {
        collection.push(sanitize(doc));
      }
      changed = true;
      continue;
    }

    // update: FoundryVTT broadcasts the diff, so merge rather than replace.
    if (existing) {
      mergePatch(existing, doc);
      changed = true;
    } else {
      // A diff cannot reconstruct a document missing from this snapshot.
      unhandled = true;
    }
  }

  return { changed, unhandled };
}

/**
 * Resolves the parent document a broadcast targets.
 *
 * Handles the simple `<Type>.<id>` form. The synthetic-token-actor form
 * (`Scene.<sid>.Token.<tid>.Actor.<aid>`, used for unlinked tokens) is **not**
 * resolved: that actor is a per-token delta rather than a document in any cached
 * collection, so those broadcasts require `refresh_world_data` and are reported
 * as unhandled to the owning provider.
 */
function resolveParent(
  worldData: WorldData,
  parentUuid: string,
): { parentType: string; parent: Record<string, unknown> } | null {
  const segments = parentUuid.split('.');
  if (segments.length !== 2) {
    return null;
  }

  const parentType = segments[0];
  const parentId = segments[1];
  if (!parentType || !parentId) {
    return null;
  }

  const collectionKey = TOP_LEVEL_COLLECTIONS[parentType];
  if (!collectionKey) {
    return null;
  }

  const collection = worldData[collectionKey];
  if (!Array.isArray(collection)) {
    return null;
  }

  const parent = (collection as Array<WorldActor | WorldScene | WorldCombat>).find(
    (doc) => doc._id === parentId,
  );
  if (!parent) {
    return null;
  }

  return { parentType, parent: parent as unknown as Record<string, unknown> };
}

/**
 * Applies a validated broadcast to the cached world state, in place.
 *
 * Reports changes separately from unhandled data so partial batches preserve
 * the historical boolean API without concealing a freshness gap.
 */
function applyBroadcast(
  worldData: WorldData,
  broadcast: DocumentBroadcast,
): BroadcastApplication {
  const { type, action, result, parentUuid } = broadcast;
  if (result.length === 0) {
    return { changed: false, unhandled: false };
  }

  if (parentUuid) {
    const resolved = resolveParent(worldData, parentUuid);
    if (!resolved) {
      // Unknown root types are not cached; an unresolved cached parent (also a
      // synthetic token actor) means this snapshot may have missed a mutation.
      const parentType = parentUuid.split('.')[0] ?? '';
      return { changed: false, unhandled: Object.hasOwn(TOP_LEVEL_COLLECTIONS, parentType) };
    }

    const field = EMBEDDED_COLLECTIONS[resolved.parentType]?.[type];
    if (!field) {
      return { changed: false, unhandled: true };
    }

    // The field is optional on several world types (an actor with no effects
    // omits `effects` entirely), so materialize it before a create.
    if (!Array.isArray(resolved.parent[field])) {
      if (resolved.parent[field] !== undefined && resolved.parent[field] !== null) {
        return { changed: false, unhandled: true };
      }
      if (action !== 'create') {
        return { changed: false, unhandled: action !== 'delete' };
      }
      resolved.parent[field] = [];
    }

    return applyToCollection(
      resolved.parent[field] as Array<Record<string, unknown>>,
      action,
      result,
    );
  }

  const collectionKey = TOP_LEVEL_COLLECTIONS[type];
  if (!collectionKey) {
    const embedded = Object.values(EMBEDDED_COLLECTIONS).some((types) =>
      Object.hasOwn(types, type),
    );
    return { changed: false, unhandled: embedded };
  }

  const collection = worldData[collectionKey];
  if (!Array.isArray(collection)) {
    return { changed: false, unhandled: true };
  }

  return applyToCollection(collection as Array<Record<string, unknown>>, action, result);
}

/**
 * Applies an event and distinguishes irrelevant traffic from a cache gap.
 * `unhandled` takes precedence when only part of a result could be applied.
 */
export function applyDocumentBroadcastWithStatus(
  worldData: WorldData,
  broadcast: DocumentBroadcast,
): DocumentBroadcastStatus {
  const result = applyBroadcast(worldData, broadcast);
  return result.unhandled ? 'unhandled' : result.changed ? 'applied' : 'irrelevant';
}

/** Compatibility API: whether any cached document changed. */
export function applyDocumentBroadcast(
  worldData: WorldData,
  broadcast: DocumentBroadcast,
): boolean {
  return applyBroadcast(worldData, broadcast).changed;
}

// ============================================================================
// User presence (`userActivity`) — #218
// ============================================================================

/** A validated `userActivity` broadcast: who, and whether they are present. */
export interface UserActivity {
  userId: string;
  active: boolean;
}

/**
 * FoundryVTT's `userActivity` payload, as far as presence is concerned.
 *
 * The event carries a grab-bag of ephemeral state (cursor position, ruler,
 * targets, active scene). Only `active` matters here; everything else is
 * accepted and ignored. The flag is absent on ordinary activity pings — Foundry
 * itself treats "no flag" as "present", so the parser defaults to `true`.
 */
const UserActivityDataSchema = z.object({ active: z.boolean().optional() });

/**
 * Validates a raw `userActivity` socket payload (#218).
 *
 * This is untrusted network data, so it is schema-checked rather than cast.
 * Returns `null` for anything unrecognized, leaving presence as it was.
 */
export function parseUserActivity(userId: unknown, activityData: unknown): UserActivity | null {
  if (typeof userId !== 'string' || !userId) {
    return null;
  }
  if (activityData === undefined || activityData === null) {
    return { userId, active: true };
  }

  const parsed = UserActivityDataSchema.safeParse(activityData);
  if (!parsed.success) {
    return null;
  }
  return { userId, active: parsed.data.active ?? true };
}

/**
 * Applies a presence change to `worldData.activeUsers`, in place.
 *
 * `activeUsers` is a top-level `WorldData` field rather than a document
 * collection, which is exactly why `modifyDocument` broadcasts never reached it
 * and presence stayed frozen at the connect-time snapshot (#218).
 *
 * @returns true if the active-user list changed
 */
export function applyUserActivity(worldData: WorldData, activity: UserActivity): boolean {
  if (!Array.isArray(worldData.activeUsers)) {
    worldData.activeUsers = [];
  }

  const index = worldData.activeUsers.indexOf(activity.userId);

  if (activity.active) {
    if (index !== -1) {
      return false;
    }
    worldData.activeUsers.push(activity.userId);
    return true;
  }

  if (index === -1) {
    return false;
  }
  worldData.activeUsers.splice(index, 1);
  return true;
}
