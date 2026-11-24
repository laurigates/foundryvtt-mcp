/**
 * Live Socket.IO vs REST bridge parity: the same actors and world read over
 * both transports, compared with the normaliser and KNOWN_GAPS that
 * src/foundry/__tests__/parity-contract.test.ts checks offline.
 *
 * Run against the local harness (Foundry on :30000, bridge on :3030), only
 * this file:
 *
 *   FOUNDRY_URL=http://localhost:30000 bun run test:integration tests/integration/parity.integration.test.ts
 *
 * The rest of the configuration comes from the shell environment:
 * FOUNDRY_USERNAME (or FOUNDRY_USER_ID) and FOUNDRY_PASSWORD for a harness
 * world user, FOUNDRY_API_KEY for the bridge, and FOUNDRY_REST_URL (e.g.
 * http://localhost:3030). The suite skips, and names what is missing, unless
 * all of them are set and both URLs point at this machine (localhost,
 * 127.0.0.1 or [::1]), so it never logs in to a remote server.
 *
 * It only reads: one Socket.IO login (dual mode) and REST GETs, no writes.
 * FOUNDRY_URL reaches this file through global-setup.ts (`shellFoundryUrl`),
 * because vitest.integration.config.ts overrides it in the worker env.
 */

import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { FoundryClient, worldActorToFoundry, worldInfoToFoundry } from '../../src/foundry/client.js';
import {
  compareParity,
  gapDrift,
  mismatchLines,
  normaliseActor,
  normaliseWorld,
  type ParityReport,
  parityMessage,
} from '../../src/foundry/parity.js';
import type { FoundryActor } from '../../src/foundry/types.js';

/** Characters compared; dnd5e characters are where the prepared-value gaps live. */
const MAX_ACTORS = 5;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

function isLocal(url: string | undefined): boolean {
  if (!url) {
    return false;
  }
  try {
    return LOCAL_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

const env = process.env;
const foundryUrl = inject('shellFoundryUrl') || undefined;
const missing = [
  ...(isLocal(foundryUrl) ? [] : ['FOUNDRY_URL (a local URL)']),
  ...(env.FOUNDRY_USERNAME || env.FOUNDRY_USER_ID ? [] : ['FOUNDRY_USERNAME or FOUNDRY_USER_ID']),
  ...(env.FOUNDRY_PASSWORD ? [] : ['FOUNDRY_PASSWORD']),
  ...(env.FOUNDRY_API_KEY ? [] : ['FOUNDRY_API_KEY']),
  ...(isLocal(env.FOUNDRY_REST_URL) ? [] : ['FOUNDRY_REST_URL (a local URL)']),
];
const title = `Socket.IO vs REST bridge parity (live)${
  missing.length > 0 ? `, skipped: needs ${missing.join(', ')}` : ''
}`;

describe.skipIf(missing.length > 0)(title, () => {
  /** Socket.IO primary with the bridge: its raw snapshot is the Socket.IO answer. */
  let dual: FoundryClient;
  /** REST-only mode against the bridge: the REST answer, with no Socket.IO login. */
  let rest: FoundryClient;
  const compared: Array<{ id: string; socket: FoundryActor; rest: FoundryActor; dual: FoundryActor }> =
    [];

  beforeAll(async () => {
    const timeout = 15000;
    dual = new FoundryClient({
      baseUrl: foundryUrl as string,
      restUrl: env.FOUNDRY_REST_URL,
      apiKey: env.FOUNDRY_API_KEY,
      username: env.FOUNDRY_USERNAME,
      userId: env.FOUNDRY_USER_ID,
      password: env.FOUNDRY_PASSWORD,
      timeout,
    });
    rest = new FoundryClient({
      baseUrl: env.FOUNDRY_REST_URL as string,
      apiKey: env.FOUNDRY_API_KEY,
      timeout,
    });
    expect(dual.getTransportMode()).toBe('dual');
    expect(rest.getTransportMode()).toBe('rest');
    await dual.connect();
    await rest.connect();
    expect(dual.getConnectionReport().rest.reachable, 'the bridge did not answer the dual client').toBe(
      true,
    );

    const characters = (dual.getWorldData()?.actors ?? [])
      .filter((actor) => actor.type === 'character')
      .slice(0, MAX_ACTORS);
    for (const raw of characters) {
      compared.push({
        id: raw._id,
        socket: worldActorToFoundry(raw),
        rest: await rest.getActor(raw._id),
        dual: await dual.getActor(raw._id),
      });
    }
  });

  afterAll(async () => {
    await dual?.disconnect();
    await rest?.disconnect();
  });

  it('finds character actors to compare', () => {
    expect(compared.length, 'the world has no character actors').toBeGreaterThan(0);
  });

  it('agrees on every actor field both transports report', () => {
    const lines = compared.flatMap(({ id, socket, rest: viaRest }) =>
      mismatchLines('actor', compareParity(normaliseActor(socket), normaliseActor(viaRest))).map(
        (line) => `${id}: ${line}`,
      ),
    );
    expect(lines, parityMessage(lines)).toEqual([]);
  });

  it('reports exactly the KNOWN_GAPS actor fields on one side, across the compared actors', () => {
    const reports: ParityReport[] = compared.map(({ socket, rest: viaRest }) =>
      compareParity(normaliseActor(socket), normaliseActor(viaRest)),
    );
    const union = {
      restOnly: [...new Set(reports.flatMap((report) => report.restOnly))].sort(),
      socketOnly: [...new Set(reports.flatMap((report) => report.socketOnly))].sort(),
    };
    const lines = gapDrift('actor', union);
    const note =
      lines.length > 0
        ? [`(compared ${compared.map(({ id }) => id).join(', ')}; a closed gap may also mean no compared actor exercises that field)`]
        : [];
    expect(lines, parityMessage([...lines, ...note])).toEqual([]);
  });

  it('dual mode fills every REST-only actor field from the bridge', () => {
    const lines = compared.flatMap(({ id, rest: viaRest, dual: viaDual }) => {
      const report = compareParity(normaliseActor(viaDual), normaliseActor(viaRest));
      return [
        ...mismatchLines('actor', report),
        ...report.restOnly.map((field) => `actor.${field}: REST-only, and dual mode does not overlay it`),
      ].map((line) => `${id}: ${line}`);
    });
    expect(lines, parityMessage(lines)).toEqual([]);
  });

  it('agrees on world info and reports exactly the KNOWN_GAPS world fields on one side', async () => {
    const worldData = dual.getWorldData();
    expect(worldData).not.toBeNull();
    const report = compareParity(
      normaliseWorld(worldInfoToFoundry(worldData as NonNullable<typeof worldData>)),
      normaliseWorld(await rest.getWorldInfo()),
    );
    const lines = [...mismatchLines('world', report), ...gapDrift('world', report)];
    expect(lines, parityMessage(lines)).toEqual([]);
  });
});
