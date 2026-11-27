/**
 * Transport parity: what Socket.IO and the REST bridge report for the same
 * document once both answers have been through the MCP's mappers.
 *
 * The contract tests (`__tests__/parity-contract.test.ts`) feed one dnd5e
 * scenario to both mappers; the live suite
 * (`tests/integration/parity.integration.test.ts`) does the same with a real
 * Foundry and bridge. Both use this normaliser and this gap list, so a gap
 * that opens or closes fails in either place with the same message.
 *
 * Nothing in the server imports this module; it is the reviewed record of the
 * difference between the transports.
 */

import type { FoundryActor, FoundryItem, FoundryWorld } from './types.js';

export type ParityValue = string | number | boolean | null;
/** A document flattened to dot-path leaves: `{ 'hp.value': 38, 'abilities.str.mod': 3 }`. */
export type ParityRecord = Readonly<Record<string, ParityValue>>;
export type ParityDocument = 'actor' | 'item' | 'world';

/** What to update when a parity test fails. Printed with every failure. */
export const PARITY_UPDATE_HINT =
  'Transport parity changed. Check the change is intended, then update together: ' +
  'the capability matrix (src/tools/__tests__/capability-matrix.test.ts), ' +
  'KNOWN_GAPS in src/foundry/parity.ts, docs/guides/capabilities.md, and, when a gap ' +
  'between Socket.IO and the REST bridge opened or closed, the transport ADR ' +
  '(docs/adrs/; ADR-001 is in docs/blueprint/adrs/).';

/**
 * Bookkeeping fields that are not data from either transport, so never compared.
 * - actor `derivedUnavailable`: the Socket.IO path's list of prepared values it
 *   could not compute; the contract test checks it against KNOWN_GAPS instead.
 * - world `playtime`/`created`/`modified`: neither transport has a source for
 *   them; both mappers fill a constant or the current time.
 */
export const PARITY_IGNORED: Readonly<Record<ParityDocument, readonly string[]>> = {
  actor: ['derivedUnavailable'],
  item: [],
  world: ['playtime', 'created', 'modified'],
};

function isIgnored(path: string, ignore: readonly string[]): boolean {
  return ignore.some((field) => path === field || path.startsWith(`${field}.`));
}

/** Flattens nested objects and arrays to dot-path leaves; `undefined` leaves are dropped. */
export function flattenForParity(value: unknown, ignore: readonly string[] = []): ParityRecord {
  const out: Record<string, ParityValue> = {};
  const walk = (node: unknown, path: string): void => {
    if (path !== '' && isIgnored(path, ignore)) {
      return;
    }
    if (node === undefined) {
      return;
    }
    if (node === null || typeof node !== 'object') {
      if (typeof node === 'string' || typeof node === 'number' || typeof node === 'boolean') {
        out[path] = node;
      } else if (node === null) {
        out[path] = null;
      }
      return;
    }
    for (const [key, child] of Object.entries(node)) {
      walk(child, path === '' ? key : `${path}.${key}`);
    }
  };
  walk(value, '');
  return out;
}

export const normaliseActor = (actor: FoundryActor): ParityRecord =>
  flattenForParity(actor, PARITY_IGNORED.actor);
export const normaliseItem = (item: FoundryItem): ParityRecord =>
  flattenForParity(item, PARITY_IGNORED.item);
export const normaliseWorld = (world: FoundryWorld): ParityRecord =>
  flattenForParity(world, PARITY_IGNORED.world);

/** Keyed collections whose keys are data, not field names (`abilities.str` → `abilities.*`). */
const KEYED_COLLECTIONS = new Set(['abilities', 'skills']);

/** The field a path belongs to: array indexes and collection keys become `*`. */
export function fieldPattern(path: string): string {
  const segments = path.split('.');
  return segments
    .map((segment, i) => {
      const parent = segments[i - 1];
      const keyed = parent !== undefined && KEYED_COLLECTIONS.has(parent);
      return /^\d+$/.test(segment) || keyed ? '*' : segment;
    })
    .join('.');
}

export interface ParityReport {
  /** Fields both transports report, with different values. */
  readonly mismatched: ReadonlyArray<{ field: string; socket: ParityValue; rest: ParityValue }>;
  /** Field patterns only the REST bridge reports, sorted. */
  readonly restOnly: readonly string[];
  /** Field patterns only Socket.IO reports, sorted. */
  readonly socketOnly: readonly string[];
}

export function compareParity(socket: ParityRecord, rest: ParityRecord): ParityReport {
  const mismatched: Array<{ field: string; socket: ParityValue; rest: ParityValue }> = [];
  const restOnly = new Set<string>();
  const socketOnly = new Set<string>();
  for (const [field, value] of Object.entries(socket)) {
    if (!(field in rest)) {
      socketOnly.add(fieldPattern(field));
    } else if (rest[field] !== value) {
      mismatched.push({ field, socket: value, rest: rest[field] ?? null });
    }
  }
  for (const field of Object.keys(rest)) {
    if (!(field in socket)) {
      restOnly.add(fieldPattern(field));
    }
  }
  return { mismatched, restOnly: [...restOnly].sort(), socketOnly: [...socketOnly].sort() };
}

/**
 * Why a field is reported by one transport only, which is also what closing
 * the gap would take:
 * - `prepared`: the game system computes it in `prepareData`, which runs only
 *   in a browser client; Socket.IO carries source data.
 * - `socket-mapper`: the Socket.IO source data has it; the MCP's Socket.IO
 *   mapper (client.ts) does not read it.
 * - `rest-route`: the module's route does not send it.
 * - `rest-default`: the module sends a default where the source value is empty.
 */
export type GapCause = 'prepared' | 'socket-mapper' | 'rest-route' | 'rest-default';

export interface KnownGap {
  readonly cause: GapCause;
  readonly note: string;
}

export interface KnownGaps {
  readonly restOnly: Readonly<Record<string, KnownGap>>;
  readonly socketOnly: Readonly<Record<string, KnownGap>>;
}

const ITEM_FIELD_NOT_MAPPED: KnownGap = {
  cause: 'socket-mapper',
  note: 'in the Socket.IO source data; worldItemToFoundry reads only description and rarity',
};

const WORLD_MODULES_NOT_MAPPED: KnownGap = {
  cause: 'socket-mapper',
  note: 'worldData.modules holds the module list; worldInfoToFoundry does not map it',
};

/**
 * The reviewed list of fields one transport reports and the other does not,
 * for the dnd5e scenario in parity-contract.test.ts. Bridge contract read from
 * laurigates/foundryvtt-local-rest-api `feat/v14-port` (ce49b9c),
 * scripts/routes/{actors,items,world}.js.
 */
export const KNOWN_GAPS: Readonly<Record<ParityDocument, KnownGaps>> = {
  actor: {
    restOnly: {
      'hp.max': {
        cause: 'prepared',
        note: 'dnd5e 4+ stores a character hp.max as null and computes it from class hit dice (#309)',
      },
      'ac.value': {
        cause: 'prepared',
        note: 'source data holds the AC calc settings; the value is exact from them only for calc "flat" (#308)',
      },
      'abilities.*.save': {
        cause: 'prepared',
        note: 'save totals (modifier, proficiency, bonuses) exist only after prepareData',
      },
    },
    socketOnly: {
      'hp.temp': {
        cause: 'rest-route',
        note: 'formatActorSummary sends hp {current, max}, no temp',
      },
      'attributes.prof': {
        cause: 'rest-route',
        note: 'the module sends no proficiency bonus; Socket.IO derives it from class levels (#308)',
      },
    },
  },
  item: {
    restOnly: {
      'price.value': ITEM_FIELD_NOT_MAPPED,
      'price.denomination': ITEM_FIELD_NOT_MAPPED,
      weight: ITEM_FIELD_NOT_MAPPED,
      quantity: ITEM_FIELD_NOT_MAPPED,
      equipped: ITEM_FIELD_NOT_MAPPED,
      identified: ITEM_FIELD_NOT_MAPPED,
      rarity: {
        cause: 'rest-default',
        note: 'formatItemSummary reports "common" for an empty system.rarity; Socket.IO omits the empty value',
      },
    },
    socketOnly: {
      description: {
        cause: 'rest-route',
        note: 'GET /api/items (formatItemSummary) sends no description; only GET /api/items/:id does',
      },
    },
  },
  world: {
    restOnly: {
      'modules.*.id': WORLD_MODULES_NOT_MAPPED,
      'modules.*.title': WORLD_MODULES_NOT_MAPPED,
      'modules.*.active': WORLD_MODULES_NOT_MAPPED,
    },
    socketOnly: {},
  },
};

/**
 * Differences between the observed gaps and KNOWN_GAPS, one line each; empty
 * when they match exactly. A known gap that was not observed has closed; an
 * observed gap that is not known has opened.
 */
export function gapDrift(
  document: ParityDocument,
  observed: { readonly restOnly: readonly string[]; readonly socketOnly: readonly string[] },
): string[] {
  const known = KNOWN_GAPS[document];
  const lines: string[] = [];
  const sides = [
    ['restOnly', 'REST-only', 'Socket.IO', known.restOnly, observed.restOnly],
    ['socketOnly', 'Socket.IO-only', 'the REST bridge', known.socketOnly, observed.socketOnly],
  ] as const;
  for (const [, label, other, knownSide, observedSide] of sides) {
    const seen = new Set(observedSide);
    for (const [field, gap] of Object.entries(knownSide)) {
      if (!seen.has(field)) {
        lines.push(
          `${document}.${field}: known ${label} gap (${gap.cause}) closed: ${other} now reports it, or it is gone from both`,
        );
      }
    }
    for (const field of observedSide) {
      if (!(field in knownSide)) {
        lines.push(`${document}.${field}: new ${label} field: ${other} does not report it`);
      }
    }
  }
  return lines;
}

/** One line per shared field whose values differ. */
export function mismatchLines(document: ParityDocument, report: ParityReport): string[] {
  return report.mismatched.map(
    ({ field, socket, rest }) =>
      `${document}.${field}: Socket.IO ${JSON.stringify(socket)} vs REST ${JSON.stringify(rest)}`,
  );
}

/** The failure message: what changed, then what to update. */
export function parityMessage(lines: readonly string[]): string {
  return `${lines.join('\n')}\n${PARITY_UPDATE_HINT}`;
}
