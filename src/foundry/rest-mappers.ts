/**
 * Explicit mapping from REST bridge responses to the MCP's Foundry types (#310).
 *
 * The contract was read from laurigates/foundryvtt-local-rest-api's
 * `feat/v14-port` branch. The bridge server forwards each request to the
 * module (running in a GM browser) and answers with the body the module's
 * route handler produced:
 *
 * - Document routes (`/api/actors`, `/api/items`, `/api/scenes`, `/api/world`,
 *   `/api/dice/roll`) and `/api/compendium/search` wrap it as
 *   `{ success: true, data, ... }`, or `{ success: false, error, message }`,
 *   and use the module's own field names (`id`, `hp.current`, `ac` as a
 *   number, `abilities.*.modifier`).
 * - Diagnostics routes wrap it as `{ success: true, data: { logs, total, ... } }`
 *   on `feat/v14-port`; the module's `main` answers them unwrapped, so
 *   {@link unwrapOptionalEnvelope} accepts both. Through the bridge, their
 *   errors arrive like every other route's: HTTP 4xx/5xx with
 *   `{ success: false, error, message }` (a module failure the bridge cannot
 *   classify is 500 "Failed to communicate with FoundryVTT server").
 *
 * Every body is validated with Zod; a shape that does not match is rejected
 * with {@link RestShapeError} naming the route, rather than read as missing
 * fields. Extra fields pass through validation and are ignored.
 */

import { z } from 'zod';
import type {
  ActorSearchResult,
  CompendiumSearchEntry,
  CompendiumSearchResult,
  DiceRoll,
  FoundryActor,
  FoundryItem,
  FoundryScene,
  FoundryWorld,
  ItemSearchResult,
} from './types.js';

/** A REST bridge body that does not have the shape its route promises. */
export class RestShapeError extends Error {
  override name = 'RestShapeError';
}

/** The bridge (or the module behind it) answered `success: false`. */
export class RestRequestError extends Error {
  override name = 'RestRequestError';
}

function shapeError(route: string, detail: string): RestShapeError {
  return new RestShapeError(
    `REST bridge ${route} returned an unexpected response shape: ${detail}`,
  );
}

function describeIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 3)
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('; ');
}

function parseWith<T extends z.ZodType>(schema: T, value: unknown, route: string): z.infer<T> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw shapeError(route, describeIssues(parsed.error));
  }
  return parsed.data;
}

// --- Envelope ---------------------------------------------------------------

const FailureEnvelopeSchema = z.looseObject({
  success: z.literal(false),
  error: z.unknown().optional(),
  message: z.unknown().optional(),
});

const SuccessEnvelopeSchema = z.looseObject({
  success: z.literal(true),
  data: z.unknown(),
});

function failureMessage(body: z.infer<typeof FailureEnvelopeSchema>): string {
  if (typeof body.message === 'string' && body.message !== '') {
    return body.message;
  }
  return typeof body.error === 'string' ? body.error : 'request failed';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function describeBody(body: unknown): string {
  if (body === null) {
    return 'null';
  }
  if (Array.isArray(body)) {
    return 'an array';
  }
  return isRecord(body) ? 'an object without that envelope' : `a ${typeof body}`;
}

/**
 * Returns `data` from a `{ success: true, data }` body. Throws
 * {@link RestRequestError} for `success: false` and {@link RestShapeError} for
 * anything else, including the bare objects the MCP used to accept.
 */
export function unwrapRestEnvelope(body: unknown, route: string): unknown {
  const failure = FailureEnvelopeSchema.safeParse(body);
  if (failure.success) {
    throw new RestRequestError(`REST bridge ${route} failed: ${failureMessage(failure.data)}`);
  }
  const success = SuccessEnvelopeSchema.safeParse(body);
  if (success.success && 'data' in success.data) {
    return success.data.data;
  }
  throw shapeError(route, `expected {success, data}, got ${describeBody(body)}`);
}

/**
 * For the diagnostics routes, which the module's `main` answers unwrapped and
 * `feat/v14-port` wraps: unwraps an envelope when one is present, and passes
 * any other body through for the caller's own schema to validate.
 */
export function unwrapOptionalEnvelope(body: unknown, route: string): unknown {
  if (isRecord(body) && typeof body.success === 'boolean') {
    return unwrapRestEnvelope(body, route);
  }
  return body;
}

// --- Shared field helpers ---------------------------------------------------

const nullishNumber = z.number().nullish();
const nullishString = z.string().nullish();

/** Copies `value` to `target[key]` only when it is present (exactOptionalPropertyTypes). */
function setIfPresent<T extends object, K extends keyof T>(
  target: T,
  key: K,
  value: T[K] | null | undefined,
): void {
  if (value !== null && value !== undefined) {
    target[key] = value;
  }
}

// --- Actors -----------------------------------------------------------------

/** `ActorsAPI.formatActorSummary` */
const RestActorSummarySchema = z.looseObject({
  id: z.string().min(1),
  name: z.string(),
  type: z.string(),
  img: nullishString,
  level: nullishNumber,
  hp: z.looseObject({ current: nullishNumber, max: nullishNumber }).nullish(),
  ac: nullishNumber,
});

/** `ActorsAPI.formatAbilities` entry; dnd5e keeps `proficient` as a number. */
const RestAbilitySchema = z.looseObject({
  value: z.number(),
  modifier: z.number(),
  save: nullishNumber,
});

/** `ActorsAPI.formatActorDetail` (summary plus detail fields). */
const RestActorDetailSchema = RestActorSummarySchema.extend({
  abilities: z.record(z.string(), RestAbilitySchema).nullish(),
  biography: nullishString,
});

type RestActorDetail = z.infer<typeof RestActorDetailSchema>;

function toFoundryActor(rest: RestActorDetail): FoundryActor {
  const actor: FoundryActor = { _id: rest.id, name: rest.name, type: rest.type };
  setIfPresent(actor, 'img', rest.img);
  if (rest.hp) {
    const hp: NonNullable<FoundryActor['hp']> = {};
    setIfPresent(hp, 'value', rest.hp.current);
    setIfPresent(hp, 'max', rest.hp.max);
    actor.hp = hp;
  }
  if (typeof rest.ac === 'number') {
    actor.ac = { value: rest.ac };
  }
  setIfPresent(actor, 'level', rest.level);
  if (rest.abilities) {
    const abilities: NonNullable<FoundryActor['abilities']> = {};
    for (const [key, ability] of Object.entries(rest.abilities)) {
      const entry: { value: number; mod: number; save?: number } = {
        value: ability.value,
        mod: ability.modifier,
      };
      setIfPresent(entry, 'save', ability.save);
      abilities[key] = entry;
    }
    actor.abilities = abilities;
  }
  if (rest.biography) {
    actor.biography = rest.biography;
  }
  return actor;
}

/** `GET /api/actors/:id` → {@link FoundryActor}. */
export function mapRestActor(body: unknown, route: string): FoundryActor {
  const data = unwrapRestEnvelope(body, route);
  return toFoundryActor(parseWith(RestActorDetailSchema, data, route));
}

const RestSearchExtrasSchema = z.looseObject({ total: z.number().optional() });

/** `GET /api/actors` → {@link ActorSearchResult}. */
export function mapRestActorSearch(body: unknown, limit: number): ActorSearchResult {
  const route = '/api/actors';
  const data = parseWith(z.array(RestActorSummarySchema), unwrapRestEnvelope(body, route), route);
  const { total } = parseWith(RestSearchExtrasSchema, body, route);
  return { actors: data.map(toFoundryActor), total: total ?? data.length, page: 1, limit };
}

// --- Items ------------------------------------------------------------------

/**
 * `ItemsAPI.formatItemSummary`. Actor-owned items are spread copies of the
 * document, which lose the `id` getter, so the module sends them without an
 * id; those map to an empty `_id`.
 */
const RestItemSummarySchema = z.looseObject({
  id: nullishString,
  name: z.string(),
  type: z.string(),
  img: nullishString,
  rarity: nullishString,
  cost: z.looseObject({ value: z.number(), denomination: z.string() }).nullish(),
  weight: nullishNumber,
  quantity: nullishNumber,
  equipped: z.boolean().nullish(),
  identified: z.boolean().nullish(),
});

/** `GET /api/items` → {@link ItemSearchResult}. */
export function mapRestItemSearch(body: unknown, limit: number): ItemSearchResult {
  const route = '/api/items';
  const data = parseWith(z.array(RestItemSummarySchema), unwrapRestEnvelope(body, route), route);
  const { total } = parseWith(RestSearchExtrasSchema, body, route);
  const items = data.map((rest) => {
    const item: FoundryItem = { _id: rest.id ?? '', name: rest.name, type: rest.type };
    setIfPresent(item, 'img', rest.img);
    setIfPresent(item, 'rarity', rest.rarity);
    if (rest.cost) {
      item.price = { value: rest.cost.value, denomination: rest.cost.denomination };
    }
    setIfPresent(item, 'weight', rest.weight);
    setIfPresent(item, 'quantity', rest.quantity);
    setIfPresent(item, 'equipped', rest.equipped);
    setIfPresent(item, 'identified', rest.identified);
    return item;
  });
  return { items, total: total ?? items.length, page: 1, limit };
}

// --- Scenes -----------------------------------------------------------------

/** `ScenesAPI.formatSceneDetail` */
const RestSceneSchema = z.looseObject({
  id: z.string().min(1),
  name: z.string(),
  active: z.boolean(),
  navigation: z.boolean(),
  img: nullishString,
  dimensions: z.looseObject({ width: z.number(), height: z.number() }),
  background: z.looseObject({ offsetX: nullishNumber, offsetY: nullishNumber }).nullish(),
  darkness: nullishNumber,
  globalLight: z.boolean().nullish(),
});

/**
 * `GET /api/scenes/current` or `/api/scenes/:id` → {@link FoundryScene}. The
 * module answers `data: null` when no scene is active. It does not report
 * scene padding, so `padding` is 0.
 */
export function mapRestScene(body: unknown, route: string): FoundryScene {
  const data = unwrapRestEnvelope(body, route);
  if (data === null) {
    throw new Error('No active scene');
  }
  const rest = parseWith(RestSceneSchema, data, route);
  const scene: FoundryScene = {
    _id: rest.id,
    name: rest.name,
    active: rest.active,
    navigation: rest.navigation,
    width: rest.dimensions.width,
    height: rest.dimensions.height,
    padding: 0,
    shiftX: rest.background?.offsetX ?? 0,
    shiftY: rest.background?.offsetY ?? 0,
    globalLight: rest.globalLight ?? false,
    darkness: rest.darkness ?? 0,
  };
  setIfPresent(scene, 'img', rest.img);
  return scene;
}

// --- World ------------------------------------------------------------------

/** `WorldAPI.formatWorldInfo` */
const RestWorldSchema = z.looseObject({
  id: z.string().min(1),
  title: z.string(),
  description: nullishString,
  system: z.unknown().optional(),
  coreVersion: nullishString,
  systemVersion: nullishString,
  foundryVersion: nullishString,
  gameSystem: z.looseObject({ id: nullishString, version: nullishString }).nullish(),
  modules: z.array(z.looseObject({ id: z.string(), title: nullishString })).nullish(),
});

/** `GET /api/world` → {@link FoundryWorld}. */
export function mapRestWorld(body: unknown): FoundryWorld {
  const route = '/api/world';
  const rest = parseWith(RestWorldSchema, unwrapRestEnvelope(body, route), route);
  const now = new Date().toISOString();
  const world: FoundryWorld = {
    id: rest.id,
    title: rest.title,
    description: rest.description ?? '',
    system:
      (typeof rest.system === 'string' ? rest.system : undefined) ??
      rest.gameSystem?.id ??
      'unknown',
    coreVersion: rest.coreVersion ?? rest.foundryVersion ?? 'unknown',
    systemVersion: rest.systemVersion ?? rest.gameSystem?.version ?? 'unknown',
    // Neither transport has a genuine source for these (see getWorldInfo).
    playtime: 0,
    created: now,
    modified: now,
  };
  if (rest.modules) {
    world.modules = rest.modules.map((module) => ({
      id: module.id,
      title: module.title ?? module.id,
      active: true,
    }));
  }
  return world;
}

// --- Dice -------------------------------------------------------------------

/** `DiceAPI.formatRollResult` */
const RestDiceSchema = z.looseObject({
  total: z.number(),
  breakdown: z.array(z.looseObject({ dice: z.string(), results: z.array(z.number()) })).nullish(),
});

/** `POST /api/dice/roll` → {@link DiceRoll} with `source: 'server'`. */
export function mapRestDiceRoll(body: unknown, formula: string, reason?: string): DiceRoll {
  const route = '/api/dice/roll';
  const rest = parseWith(RestDiceSchema, unwrapRestEnvelope(body, route), route);
  const breakdown =
    rest.breakdown?.map((die) => `${die.dice}: ${die.results.join(', ')}`).join(' + ') || formula;
  const roll: DiceRoll = {
    formula,
    total: rest.total,
    breakdown,
    timestamp: new Date().toISOString(),
    source: 'server',
  };
  if (reason) {
    roll.reason = reason;
  }
  return roll;
}

// --- Compendium -------------------------------------------------------------

/** Encodes a result offset as the opaque `nextCursor` handed to callers. */
export function encodeCursor(offset: number): string {
  return Buffer.from(String(offset), 'utf8').toString('base64');
}

/** Reads a cursor back into an offset; 0 when absent or malformed. */
export function decodeCursor(cursor: string | undefined): number {
  if (!cursor) {
    return 0;
  }
  const decoded = Number.parseInt(Buffer.from(cursor, 'base64').toString('utf8'), 10);
  return Number.isFinite(decoded) && decoded >= 0 ? decoded : 0;
}

const RestCompendiumEntrySchema = z.looseObject({
  compendiumId: z.string().min(1),
  itemId: z.string().min(1),
  name: z.string(),
  type: z.string(),
  img: z.string().optional(),
  system: z
    .looseObject({
      level: z.number().optional(),
      school: z.string().optional(),
      source: z
        .looseObject({ rules: z.string().optional(), custom: z.string().optional() })
        .optional(),
    })
    .optional(),
});

function toCompendiumEntry(rest: z.infer<typeof RestCompendiumEntrySchema>): CompendiumSearchEntry {
  const entry: CompendiumSearchEntry = {
    compendiumId: rest.compendiumId,
    itemId: rest.itemId,
    name: rest.name,
    type: rest.type,
  };
  setIfPresent(entry, 'img', rest.img);
  if (rest.system) {
    const system: NonNullable<CompendiumSearchEntry['system']> = {};
    setIfPresent(system, 'level', rest.system.level);
    setIfPresent(system, 'school', rest.system.school);
    if (rest.system.source) {
      const source: NonNullable<NonNullable<CompendiumSearchEntry['system']>['source']> = {};
      setIfPresent(source, 'rules', rest.system.source.rules);
      setIfPresent(source, 'custom', rest.system.source.custom);
      system.source = source;
    }
    entry.system = system;
  }
  return entry;
}

/**
 * `GET /api/compendium/search` → {@link CompendiumSearchResult}.
 *
 * The module (`scripts/routes/compendium.js`, `CompendiumAPI.searchCompendium`)
 * answers `{ success, data, total, query }`: `data` is the page at `offset`,
 * `total` counts every match. Each entry comes from `formatCompendiumEntry`:
 * `{ compendiumId, itemId, name, type, img?, system?: { level?, school?,
 * source?: { rules?, book?, custom? } } }`, absent fields omitted rather than
 * null. `source.book` is accepted and not carried over.
 */
export function mapRestCompendiumSearch(
  body: unknown,
  paging: { limit: number; offset: number },
): CompendiumSearchResult {
  const route = '/api/compendium/search';
  const entries = parseWith(
    z.array(RestCompendiumEntrySchema),
    unwrapRestEnvelope(body, route),
    route,
  );
  const results = entries.map(toCompendiumEntry);
  const { total: reported } = parseWith(RestSearchExtrasSchema, body, route);
  const total = reported ?? results.length;
  const nextOffset = paging.offset + results.length;
  return {
    results,
    total,
    page: Math.floor(paging.offset / paging.limit) + 1,
    limit: paging.limit,
    restAvailable: true,
    nextCursor: nextOffset < total ? encodeCursor(nextOffset) : null,
  };
}
