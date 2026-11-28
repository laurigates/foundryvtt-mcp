/**
 * Capability matrix tripwire: every MCP tool and resource x transport mode,
 * with whether it is offered and which source answers.
 *
 * TOOL_MATRIX and RESOURCE_MATRIX below are the reviewed record. The tests
 * compare them with what the code does now:
 * - tools: the availability gate (tools/availability.ts) and the source table
 *   (foundry/capabilities.ts);
 * - resources: nothing declares their sources, so each one is read through a
 *   real FoundryClient in each mode, with Socket.IO and the bridge mocked, and
 *   the cell records which transport the answer came from.
 *
 * A change on either side fails with the cells that differ. Update the matrix
 * here, docs/guides/capabilities.md and, if a Socket.IO / REST gap opened or
 * closed, the transport ADR (see PARITY_UPDATE_HINT in foundry/parity.ts).
 *
 * Modes: `socket` (Socket.IO only, the default), `rest` (the deprecated
 * REST-only mode), `dual` (Socket.IO primary plus the REST bridge).
 */

import axios from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TransportMode } from '../../foundry/transport.js';

vi.mock('axios');
vi.mock('socket.io-client');
vi.mock('../../foundry/auth.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../foundry/auth.js')>();
  return {
    authenticateFoundry: vi.fn(),
    sessionSocketOptions: actual.sessionSocketOptions,
    socketOrigin: actual.socketOrigin,
  };
});
vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../config/index.js', () => ({ config: { logLevel: 'info' } }));

const { checkToolAvailability } = await import('../availability.js');
const { getAllTools } = await import('../definitions.js');
const { getAllResources } = await import('../resources.js');
const { handleReadResource } = await import('../handlers/resources.js');
const { preferredSource, TOOL_CAPABILITIES } = await import('../../foundry/capabilities.js');
const { FoundryClient } = await import('../../foundry/client.js');
const { DiagnosticsClient } = await import('../../diagnostics/client.js');
const { parityMessage } = await import('../../foundry/parity.js');
const { io } = await import('socket.io-client');
const { authenticateFoundry } = await import('../../foundry/auth.js');

const MODES = ['socket', 'rest', 'dual'] as const satisfies readonly TransportMode[];
type Row = Readonly<Record<TransportMode, string>>;

/**
 * What answers each tool when every configured source is healthy.
 *
 * Cell grammar: `hidden` when tools/list leaves it out (even with
 * FOUNDRY_WRITE_ENABLED=true); otherwise the preferred source of the tool's
 * primary capability, then `+ <source> (<capability>)` for an augment answered
 * by another source, `(no <capability>)` for an augment the mode cannot serve,
 * and `[write opt-in]` when it also needs FOUNDRY_WRITE_ENABLED=true.
 * Fallbacks after a failed bridge call are not shown.
 */
const WORLD_SNAPSHOT: Row = { socket: 'socket', rest: 'hidden', dual: 'socket' };
const BRIDGE_ONLY: Row = { socket: 'hidden', rest: 'rest', dual: 'rest' };
const WRITE: Row = {
  socket: 'socket [write opt-in]',
  rest: 'hidden',
  dual: 'socket [write opt-in]',
};
const LOCAL: Row = { socket: 'local', rest: 'local', dual: 'local' };
const ACTOR_READ: Row = { socket: 'socket', rest: 'rest', dual: 'socket + rest (actor-derived)' };
const BASE_READ: Row = { socket: 'socket', rest: 'rest', dual: 'socket' };

const TOOL_MATRIX: Readonly<Record<string, Row>> = {
  // Foundry's Roll engine via the bridge; the local roller without one.
  roll_dice: { socket: 'local', rest: 'rest', dual: 'rest' },
  // Base actor data from the snapshot, prepared AC / max HP / saves from the bridge.
  search_actors: ACTOR_READ,
  get_actor_details: ACTOR_READ,
  search_items: BASE_READ,
  get_scene_info: BASE_READ,
  generate_npc: LOCAL,
  generate_loot: LOCAL,
  lookup_rule: LOCAL,
  diagnose_errors: LOCAL,
  get_health_status: {
    socket: 'socket (no system-health)',
    rest: 'rest',
    dual: 'socket + rest (system-health)',
  },

  get_combat_state: WORLD_SNAPSHOT,
  get_chat_messages: WORLD_SNAPSHOT,
  get_users: WORLD_SNAPSHOT,
  search_journals: WORLD_SNAPSHOT,
  get_journal: WORLD_SNAPSHOT,
  search_world: WORLD_SNAPSHOT,
  get_world_summary: WORLD_SNAPSHOT,
  refresh_world_data: WORLD_SNAPSHOT,

  search_compendium: BRIDGE_ONLY,
  get_recent_logs: BRIDGE_ONLY,
  search_logs: BRIDGE_ONLY,
  get_system_health: BRIDGE_ONLY,

  update_actor_attributes: WRITE,
  create_actor_item: WRITE,
  update_actor_item: WRITE,
  delete_actor_item: WRITE,
  create_journal_entry: WRITE,
  start_combat: WRITE,
  next_turn: WRITE,
  end_combat: WRITE,
  set_initiative: WRITE,
  move_token: WRITE,
  apply_status_effect: WRITE,
};

/**
 * What answers each resource, observed. `socket` means the snapshot's data is
 * in the answer, `rest GET <route>` that the bridge was asked for that route,
 * and `none` that neither answered: the resource is listed in every mode and
 * then returns an empty list or an unavailable message.
 */
const RESOURCE_MATRIX: Readonly<Record<string, Row>> = {
  // In dual mode the bridge identity is re-verified around every REST call, so a
  // cell that uses the bridge also asks `GET /api/world` (ADR-0011).
  'foundry://actors': {
    socket: 'socket',
    rest: 'rest GET /api/actors',
    dual: 'socket + rest GET /api/world + rest GET /api/actors',
  },
  'foundry://items': { socket: 'socket', rest: 'rest GET /api/items', dual: 'socket' },
  'foundry://scenes': { socket: 'socket', rest: 'none', dual: 'socket' },
  'foundry://scenes/current': {
    socket: 'socket',
    rest: 'rest GET /api/scenes/current',
    dual: 'socket',
  },
  'foundry://journals': { socket: 'socket', rest: 'none', dual: 'socket' },
  'foundry://users': { socket: 'socket', rest: 'none', dual: 'socket' },
  'foundry://combat': { socket: 'socket', rest: 'none', dual: 'socket' },
  'foundry://world/settings': { socket: 'socket', rest: 'rest GET /api/world', dual: 'socket' },
  'foundry://system/diagnostics': {
    socket: 'none',
    rest: 'rest GET /api/diagnostics/health',
    dual: 'rest GET /api/world + rest GET /api/diagnostics/health',
  },
};

/** One line per cell or row that differs between the reviewed matrix and the code. */
function matrixDrift(
  kind: 'tool' | 'resource',
  reviewed: Readonly<Record<string, Row>>,
  observed: Readonly<Record<string, Row>>,
): string[] {
  const lines: string[] = [];
  for (const name of Object.keys(observed)) {
    if (!(name in reviewed)) {
      lines.push(
        `${kind} ${name}: new, not in the matrix (code: ${JSON.stringify(observed[name])})`,
      );
    }
  }
  for (const [name, row] of Object.entries(reviewed)) {
    const actual = observed[name];
    if (actual === undefined) {
      lines.push(`${kind} ${name}: in the matrix but no longer registered`);
      continue;
    }
    for (const mode of MODES) {
      if (row[mode] !== actual[mode]) {
        lines.push(
          `${kind} ${name} x ${mode}: matrix says "${row[mode]}", code says "${actual[mode]}"`,
        );
      }
    }
  }
  return lines;
}

// --- Tools: computed from the gate and the source table --------------------

function toolCell(name: string, mode: TransportMode): string {
  if (checkToolAvailability(name, { transport: mode, writeEnabled: true }).status !== 'available') {
    return 'hidden';
  }
  const [primary, ...augments] = TOOL_CAPABILITIES[name] ?? [];
  const answer = primary === undefined ? undefined : preferredSource(primary, mode);
  let cell = answer ?? 'none';
  for (const augment of augments) {
    const source = preferredSource(augment, mode);
    if (source === undefined) {
      cell += ` (no ${augment})`;
    } else if (source !== answer) {
      cell += ` + ${source} (${augment})`;
    }
  }
  if (
    checkToolAvailability(name, { transport: mode, writeEnabled: false }).status !== 'available'
  ) {
    cell += ' [write opt-in]';
  }
  return cell;
}

describe('capability matrix: tools', () => {
  it('matches the availability gate and the source table for every tool in every mode', () => {
    const observed = Object.fromEntries(
      getAllTools().map((tool) => [
        tool.name,
        {
          socket: toolCell(tool.name, 'socket'),
          rest: toolCell(tool.name, 'rest'),
          dual: toolCell(tool.name, 'dual'),
        },
      ]),
    );
    const lines = matrixDrift('tool', TOOL_MATRIX, observed);
    expect(lines, parityMessage(lines)).toEqual([]);
  });
});

// --- Resources: observed through a FoundryClient per mode ------------------

const FOUNDRY_URL = 'http://foundry.example:30000';
const BRIDGE_URL = 'http://bridge.example:3030';
const SOCKET_MARK = 'SOCKET-SENTINEL';
const ACTOR_ID = 'matrixActor00001';

const WORLD_DATA = {
  userId: 'matrixGamemaster',
  world: { id: 'matrix-world', title: `${SOCKET_MARK} world` },
  system: { id: 'dnd5e', version: '5.1.10' },
  release: { version: '14.369' },
  modules: [],
  actors: [{ _id: ACTOR_ID, name: `${SOCKET_MARK} actor`, type: 'npc', system: {} }],
  items: [{ _id: 'matrixItem000001', name: `${SOCKET_MARK} item`, type: 'loot', system: {} }],
  scenes: [
    {
      _id: 'matrixScene00001',
      name: `${SOCKET_MARK} scene`,
      active: true,
      navigation: true,
      width: 4000,
      height: 3000,
      padding: 0.25,
      globalLight: false,
      darkness: 0,
    },
  ],
  journal: [{ _id: 'matrixJournal001', name: `${SOCKET_MARK} journal`, pages: [] }],
  messages: [],
  combats: [
    {
      _id: 'matrixCombat0001',
      active: true,
      round: 1,
      turn: 0,
      combatants: [{ _id: 'matrixCombatant1', name: `${SOCKET_MARK} combatant`, initiative: 12 }],
    },
  ],
  users: [{ _id: 'matrixGamemaster', name: `${SOCKET_MARK} user`, role: 4, color: '#000000' }],
  activeUsers: ['matrixGamemaster'],
  macros: [],
  playlists: [],
  tables: [],
  folders: [],
};

const ok = (data: unknown, extra: Record<string, unknown> = {}) => ({
  data: { success: true, data, ...extra },
});

/** What the bridge answers per route; anything else is an unexpected route (an error). */
const BRIDGE_ROUTES: Readonly<Record<string, () => unknown>> = {
  '/api/world': () => ok({ id: 'matrix-world', title: 'REST world', system: 'dnd5e' }),
  '/api/actors': () =>
    ok([{ id: ACTOR_ID, name: 'REST actor', type: 'npc', hp: { current: 5, max: 9 }, ac: 13 }], {
      total: 1,
    }),
  '/api/items': () =>
    ok([{ id: 'matrixItem000001', name: 'REST item', type: 'loot' }], { total: 1 }),
  '/api/scenes/current': () =>
    ok({
      id: 'matrixScene00001',
      name: 'REST scene',
      active: true,
      navigation: true,
      dimensions: { width: 4000, height: 3000 },
    }),
  '/api/diagnostics/health': () => ({
    data: {
      timestamp: '2026-11-24T00:00:00.000Z',
      server: {
        foundryVersion: '14.369',
        systemVersion: '5.1.10',
        worldId: 'matrix-world',
        uptime: 1,
      },
      users: { total: 1, active: 1, gm: 1 },
      modules: { total: 1, active: 1 },
      performance: {
        memory: { rss: 1, heapTotal: 1, heapUsed: 1, external: 1, arrayBuffers: 1 },
        connectedClients: 1,
      },
      logs: { bufferSize: 0, recentErrors: 0, recentWarnings: 0, errorRate: 0 },
      status: 'healthy',
    },
  }),
};

function mockAxiosInstance() {
  return {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
  };
}

function buildSocket() {
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  const socket = {
    connected: true,
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      listeners.set(event, [...(listeners.get(event) ?? []), handler]);
      return socket;
    }),
    once: vi.fn(),
    off: vi.fn(() => socket),
    emit: vi.fn((event: string, ack?: (payload: unknown) => void) => {
      if (event === 'world' && typeof ack === 'function') {
        ack(structuredClone(WORLD_DATA));
      }
      return socket;
    }),
    disconnect: vi.fn(() => socket),
  };
  const fire = (event: string, ...args: unknown[]) => {
    for (const handler of listeners.get(event) ?? []) {
      handler(...args);
    }
  };
  return { socket, listeners, fire };
}

describe('capability matrix: resources', () => {
  let rest: ReturnType<typeof mockAxiosInstance>;
  let routes: string[];

  beforeEach(() => {
    vi.clearAllMocks();
    const http = mockAxiosInstance();
    rest = mockAxiosInstance();
    routes = [];
    vi.mocked(axios).create = vi.fn((cfg?: { baseURL?: string }) =>
      cfg?.baseURL === BRIDGE_URL ? rest : http,
    ) as never;
    rest.get.mockImplementation(async (url: string) => {
      routes.push(url);
      const answer = BRIDGE_ROUTES[url];
      if (!answer) {
        throw new Error(`unexpected bridge GET ${url}`);
      }
      return answer();
    });
    vi.mocked(authenticateFoundry).mockResolvedValue({
      session: 'matrix-session',
      userId: 'matrixGamemaster',
    });
  });

  async function connectedClient(mode: TransportMode) {
    const settings = {
      socket: { baseUrl: FOUNDRY_URL, username: 'gm', password: 'pw' },
      rest: { baseUrl: BRIDGE_URL, apiKey: 'key' },
      dual: {
        baseUrl: FOUNDRY_URL,
        restUrl: BRIDGE_URL,
        apiKey: 'key',
        username: 'gm',
        password: 'pw',
      },
    }[mode];
    const client = new FoundryClient({ ...settings, retryAttempts: 0, retryDelay: 1 });
    expect(client.getTransportMode()).toBe(mode);
    if (mode === 'rest') {
      await client.connect();
      return client;
    }
    const harness = buildSocket();
    vi.mocked(io).mockReturnValue(harness.socket as never);
    const connecting = client.connect();
    await vi.waitFor(() => expect(harness.listeners.get('session')?.length).toBe(1));
    harness.fire('session', { userId: 'matrixGamemaster' });
    await connecting;
    return client;
  }

  async function resourceRow(
    clients: Record<TransportMode, InstanceType<typeof FoundryClient>>,
    uri: string,
  ): Promise<Row> {
    const row: Partial<Record<TransportMode, string>> = {};
    for (const mode of MODES) {
      const client = clients[mode];
      routes.length = 0;
      const result = await handleReadResource(uri, client, new DiagnosticsClient(client));
      const text = result.contents.map((content) => content.text).join('\n');
      const sources = [
        ...(text.includes(SOCKET_MARK) ? ['socket'] : []),
        ...[...new Set(routes)].map((route) => `rest GET ${route}`),
      ];
      row[mode] = sources.length > 0 ? sources.join(' + ') : 'none';
    }
    return row as Row;
  }

  it('matches what answers every resource in every mode', async () => {
    const clients = {
      socket: await connectedClient('socket'),
      rest: await connectedClient('rest'),
      dual: await connectedClient('dual'),
    };
    const observed: Record<string, Row> = {};
    for (const resource of getAllResources()) {
      observed[resource.uri] = await resourceRow(clients, resource.uri);
    }
    const lines = matrixDrift('resource', RESOURCE_MATRIX, observed);
    expect(lines, parityMessage(lines)).toEqual([]);
  });
});
