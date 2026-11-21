import type { WorldActor, WorldData, WorldItem, WorldJournal, WorldScene } from './types.js';

/** The matched field and a short, plain-text excerpt for content matches. */
export interface WorldSearchMatch {
  field: string;
  excerpt: string;
}

export interface WorldSearchResults {
  actors: WorldActor[];
  items: WorldItem[];
  scenes: WorldScene[];
  journals: WorldJournal[];
  matchDetails: {
    actors: Record<string, WorldSearchMatch>;
    items: Record<string, WorldSearchMatch>;
    scenes: Record<string, WorldSearchMatch>;
    journals: Record<string, WorldSearchMatch>;
  };
}

type SearchField = { name: string; value: string };
const EXCERPT_BEFORE = 45;
const EXCERPT_AFTER = 85;
const MAX_NESTED_DEPTH = 6;

/** Decode common HTML entities so WYSIWYG journal content is searchable as text. */
function decodeEntity(entity: string): string {
  const key = entity.toLowerCase();
  const named: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
  };
  if (Object.hasOwn(named, key)) {
    return named[key] ?? entity;
  }
  if (!key.startsWith('#')) {
    return `&${entity};`;
  }
  const hex = key.startsWith('#x');
  const point = Number.parseInt(key.slice(hex ? 2 : 1), hex ? 16 : 10);
  if (
    !Number.isInteger(point) ||
    point < 1 ||
    point > 0x10ffff ||
    (point >= 0xd800 && point <= 0xdfff)
  ) {
    return `&${entity};`;
  }
  return String.fromCodePoint(point);
}

/** Convert rich-text HTML into readable text while excluding markup. */
function plainText(value: string): string {
  return value
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<\s*br\s*\/?>/gi, ' ')
    .replace(/<\/?\s*(?:p|div|li|ul|ol|h[1-6]|tr|td|th|section|article|blockquote)\b[^>]*>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#(?:x[0-9a-f]+|\d+)|[a-z]+);/gi, (_, entity: string) => decodeEntity(entity))
    .replace(/\s+/g, ' ')
    .trim();
}

function normalized(value: string): string {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
}

function nestedValue(value: unknown, parts: readonly string[]): unknown {
  let next = value;
  for (const part of parts) {
    if (typeof next !== 'object' || next === null || Array.isArray(next)) {
      return undefined;
    }
    next = (next as Record<string, unknown>)[part];
  }
  return next;
}

/** Traverse selected narrative fields, not all system mechanics or arbitrary metadata. */
function addNestedText(fields: SearchField[], value: unknown, field: string, depth = 0): void {
  if (typeof value === 'string') {
    if (value.trim()) {
      fields.push({ name: field, value });
    }
    return;
  }
  if (depth >= MAX_NESTED_DEPTH || !value || typeof value !== 'object') {
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item: unknown, index: number) => {
      addNestedText(fields, item, `${field}[${index}]`, depth + 1);
    });
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (['__proto__', 'constructor', 'prototype', 'src', 'img', 'uuid'].includes(key)) {
      continue;
    }
    addNestedText(fields, child, `${field}.${key}`, depth + 1);
  }
}

function addPaths(fields: SearchField[], document: unknown, paths: readonly string[]): void {
  for (const path of paths) {
    addNestedText(fields, nestedValue(document, path.split('.')), path);
  }
}

function actorFields(actor: WorldActor): SearchField[] {
  const fields: SearchField[] = [{ name: 'name', value: actor.name }];
  addPaths(fields, actor, [
    'system.details.biography',
    'system.details.description',
    'system.details.background',
    'system.details.appearance',
    'system.details.notes',
    'system.details.publicNotes',
    'system.description',
    'system.biography',
    'system.background',
    'system.notes',
  ]);
  return fields;
}

function itemFields(item: WorldItem): SearchField[] {
  const fields: SearchField[] = [{ name: 'name', value: item.name }];
  addPaths(fields, item, [
    'system.description',
    'system.details.description',
    'system.details.notes',
    'system.details.flavorText',
    'system.flavor',
    'system.notes',
  ]);
  return fields;
}

function sceneFields(scene: WorldScene): SearchField[] {
  const fields: SearchField[] = [{ name: 'name', value: scene.name }];
  addPaths(fields, scene, ['description']);
  for (const [field, collection] of [
    ['drawings', scene.drawings],
    ['notes', scene.notes],
    ['tokens', scene.tokens],
  ] as const) {
    if (!Array.isArray(collection)) {
      continue;
    }
    collection.forEach((entry, index) => {
      const keys = field === 'tokens' ? ['name'] : ['text', 'label', 'name'];
      for (const key of keys) {
        addNestedText(fields, nestedValue(entry, [key]), `${field}[${index}].${key}`);
      }
    });
  }
  return fields;
}

function journalFields(journal: WorldJournal): SearchField[] {
  const fields: SearchField[] = [{ name: 'name', value: journal.name }];
  addPaths(fields, journal, ['content']); // Legacy world payloads.
  journal.pages?.forEach((page, index) => {
    addNestedText(fields, page.name, `pages[${index}].name`);
    addNestedText(fields, page.text?.content, `pages[${index}].text.content`);
  });
  return fields;
}

/**
 * Fold a string the same way {@link normalized} does, while recording, for every
 * folded character, the span it came from in the original string. NFKD and
 * case-folding change length for characters such as …, ½ and ligatures, so a
 * position in the folded string cannot be used to slice the original directly.
 */
function foldWithMap(value: string): { text: string; starts: number[]; ends: number[] } {
  const starts: number[] = [];
  const ends: number[] = [];
  let text = '';
  let index = 0;
  for (const source of value) {
    const folded = source.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
    for (let k = 0; k < folded.length; k += 1) {
      starts.push(index);
      ends.push(index + source.length);
    }
    text += folded;
    index += source.length;
  }
  return { text, starts, ends };
}

function excerpt(value: string, matchStart: number, matchEnd: number): string {
  const from = Math.max(0, matchStart - EXCERPT_BEFORE);
  const to = Math.min(value.length, matchEnd + EXCERPT_AFTER);
  return (from ? '…' : '') + value.slice(from, to) + (to < value.length ? '…' : '');
}

function findMatch(fields: SearchField[], query: string): WorldSearchMatch | null {
  for (const field of fields) {
    const text = plainText(field.value);
    // Decide the match with the cheap whole-string fold. This is the same
    // normalization applied to the query (so case- and accent-insensitive, and it
    // lowercases the whole string at once, which the per-code-point fold below
    // cannot do for the Greek final sigma). Only fields that actually contain the
    // query pay for the index map, so a miss costs one indexOf, not two arrays per
    // character.
    const at = normalized(text).indexOf(query);
    if (at < 0) {
      continue;
    }
    if (field.name === 'name') {
      return { field: field.name, excerpt: '' };
    }
    const { starts, ends } = foldWithMap(text);
    const matchStart = starts[at];
    const matchEnd = ends[at + query.length - 1];
    if (matchStart !== undefined && matchEnd !== undefined) {
      return { field: field.name, excerpt: excerpt(text, matchStart, matchEnd) };
    }
  }
  return null;
}

function filterDocuments<T extends { _id: string; name: string }>(
  documents: T[],
  buildFields: (document: T) => SearchField[],
  query: string,
): { documents: T[]; details: Record<string, WorldSearchMatch> } {
  const matched: T[] = [];
  const details: Record<string, WorldSearchMatch> = {};
  for (const document of documents) {
    const match = findMatch(buildFields(document), query);
    if (match) {
      matched.push(document);
      details[document._id] = match;
    }
  }
  return { documents: matched, details };
}

/** Search world names and available narrative text in the Socket.IO snapshot. */
export function searchWorldDocuments(
  worldData: WorldData | null,
  query: string,
): WorldSearchResults {
  const empty: WorldSearchResults = {
    actors: [],
    items: [],
    scenes: [],
    journals: [],
    matchDetails: { actors: {}, items: {}, scenes: {}, journals: {} },
  };
  // A blank query, or one that folds to nothing once markup is stripped (e.g. "<b>"),
  // returns no documents by design: it is not treated as match-all.
  const term = normalized(plainText(query)).trim();
  if (!worldData || !term) {
    return empty;
  }

  const actors = filterDocuments(worldData.actors, actorFields, term);
  const items = filterDocuments(worldData.items, itemFields, term);
  const scenes = filterDocuments(worldData.scenes, sceneFields, term);
  const journals = filterDocuments(worldData.journal, journalFields, term);
  return {
    actors: actors.documents,
    items: items.documents,
    scenes: scenes.documents,
    journals: journals.documents,
    matchDetails: {
      actors: actors.details,
      items: items.details,
      scenes: scenes.details,
      journals: journals.details,
    },
  };
}
