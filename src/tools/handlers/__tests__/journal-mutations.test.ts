import { McpError } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it, vi } from 'vitest';
import { FoundryClient } from '../../../foundry/client.js';
import type { WorldJournal } from '../../../foundry/types.js';
import { handleCreateJournalEntry } from '../journal-mutations.js';

const VALID_FOLDER_ID = 'abcdefABCDEF0123';

const sampleJournal: WorldJournal = {
  _id: '0123456789abcdef',
  name: 'Session 11 Recap',
  pages: [
    {
      _id: 'fedcba9876543210',
      name: 'Summary',
      type: 'text',
      text: { content: '<p>The party arrived in Terris.</p>', format: 1 },
    },
  ],
};

const createMockClient = (overrides: Partial<FoundryClient> = {}): FoundryClient => {
  return {
    createJournalEntry: vi.fn(async () => sampleJournal),
    ...overrides,
  } as unknown as FoundryClient;
};

describe('journal mutation handlers', () => {
  describe('handleCreateJournalEntry', () => {
    it('creates a journal entry with a single page', async () => {
      const mockClient = createMockClient();
      const result = await handleCreateJournalEntry(
        {
          name: 'Session 11 Recap',
          pages: [{ name: 'Summary', content: '<p>The party arrived in Terris.</p>' }],
        },
        mockClient,
      );

      expect(result.content[0].type).toBe('text');
      expect(result.content[0].text).toContain('Journal Entry Created');
      expect(result.content[0].text).toContain('Session 11 Recap');
      expect(mockClient.createJournalEntry).toHaveBeenCalledWith(
        'Session 11 Recap',
        [{ name: 'Summary', content: '<p>The party arrived in Terris.</p>' }],
        undefined,
        undefined,
      );
    });

    it('defaults to GM-only visibility and says so in the response', async () => {
      const mockClient = createMockClient();
      const result = await handleCreateJournalEntry(
        { name: 'Session 11 Recap', pages: [{ name: 'Summary', content: 'text' }] },
        mockClient,
      );
      expect(result.content[0].text).toContain('**Visible to:** GM only');
    });

    it('passes visibility through and reports player-readable', async () => {
      const mockClient = createMockClient();
      const result = await handleCreateJournalEntry(
        {
          name: 'Session 11 Recap',
          pages: [{ name: 'Summary', content: 'text' }],
          visibility: 'observer',
        },
        mockClient,
      );
      expect(mockClient.createJournalEntry).toHaveBeenCalledWith(
        'Session 11 Recap',
        [{ name: 'Summary', content: 'text' }],
        undefined,
        'observer',
      );
      expect(result.content[0].text).toContain('all players (read-only)');
    });

    it('rejects an unknown visibility with InvalidParams', async () => {
      const mockClient = createMockClient();
      await expect(
        handleCreateJournalEntry(
          {
            name: 'Session 11 Recap',
            pages: [{ name: 'Summary', content: 'text' }],
            visibility: 'everyone' as unknown as 'observer',
          },
          mockClient,
        ),
      ).rejects.toThrow(McpError);
    });

    it('passes an optional folder id through', async () => {
      const mockClient = createMockClient();
      await handleCreateJournalEntry(
        {
          name: 'Session 11 Recap',
          pages: [{ name: 'Summary', content: 'text' }],
          folder: VALID_FOLDER_ID,
        },
        mockClient,
      );

      expect(mockClient.createJournalEntry).toHaveBeenCalledWith(
        'Session 11 Recap',
        [{ name: 'Summary', content: 'text' }],
        VALID_FOLDER_ID,
        undefined,
      );
    });

    it('rejects an empty name with InvalidParams', async () => {
      const mockClient = createMockClient();
      await expect(
        handleCreateJournalEntry(
          { name: '', pages: [{ name: 'Summary', content: 'text' }] },
          mockClient,
        ),
      ).rejects.toThrow(McpError);
    });

    it('rejects an empty pages array with InvalidParams', async () => {
      const mockClient = createMockClient();
      await expect(
        handleCreateJournalEntry({ name: 'Session 11 Recap', pages: [] }, mockClient),
      ).rejects.toThrow(McpError);
    });

    it('rejects a page missing content with InvalidParams', async () => {
      const mockClient = createMockClient();
      await expect(
        handleCreateJournalEntry(
          {
            name: 'Session 11 Recap',
            pages: [{ name: 'Summary' } as unknown as { name: string; content: string }],
          },
          mockClient,
        ),
      ).rejects.toThrow(McpError);
    });

    it('propagates a client error', async () => {
      const mockClient = createMockClient({
        createJournalEntry: vi.fn(async () => {
          throw new Error('FoundryVTT rejected create JournalEntry: some failure');
        }),
      });
      await expect(
        handleCreateJournalEntry(
          { name: 'Session 11 Recap', pages: [{ name: 'Summary', content: 'text' }] },
          mockClient,
        ),
      ).rejects.toThrow(McpError);
    });

    it('surfaces the write-disabled guard error', async () => {
      const mockClient = createMockClient({
        createJournalEntry: vi.fn(async () => {
          throw new Error(
            'Write operations are disabled. Set FOUNDRY_WRITE_ENABLED=true to allow game-state mutation.',
          );
        }),
      });
      await expect(
        handleCreateJournalEntry(
          { name: 'Session 11 Recap', pages: [{ name: 'Summary', content: 'text' }] },
          mockClient,
        ),
      ).rejects.toThrow('FOUNDRY_WRITE_ENABLED');
    });
  });
});

// ----------------------------------------------------------------------------
// Client-level: exercises the real createJournalEntry over a mocked Socket.IO
// socket (modifyDocument protocol).
// ----------------------------------------------------------------------------
describe('FoundryClient journal mutations (modifyDocument)', () => {
  type SocketEmitMock = (event: string, payload: unknown, cb: (response: unknown) => void) => void;

  const buildClient = (opts: { writeEnabled?: boolean; connected?: boolean } = {}) => {
    const client = new FoundryClient({
      baseUrl: 'http://localhost:30000',
      writeEnabled: opts.writeEnabled ?? true,
    });
    const emit = vi.fn(((_event, payload, cb) => {
      const op = (payload as { operation?: { data?: unknown[] } }).operation;
      const echoed = op?.data?.[0];
      cb({ result: echoed ? [echoed] : [] });
    }) as SocketEmitMock);
    if (opts.connected !== false) {
      (client as unknown as { socket: { connected: boolean; emit: SocketEmitMock } }).socket = {
        connected: true,
        emit,
      };
    }
    return client;
  };

  const lastRequest = (client: FoundryClient) => {
    const emitMock = (client as unknown as { socket: { emit: ReturnType<typeof vi.fn> } }).socket
      .emit;
    return emitMock.mock.calls[0];
  };

  it('creates a top-level JournalEntry modifyDocument request with no parentUuid', async () => {
    const client = buildClient();
    await client.createJournalEntry('Session 11 Recap', [
      { name: 'Summary', content: '<p>The party arrived in Terris.</p>' },
    ]);
    const [event, body] = lastRequest(client);
    expect(event).toBe('modifyDocument');
    expect(body).toMatchObject({
      type: 'JournalEntry',
      action: 'create',
      operation: {
        data: [
          {
            name: 'Session 11 Recap',
            pages: [
              {
                name: 'Summary',
                type: 'text',
                text: { content: '<p>The party arrived in Terris.</p>', format: 1 },
                sort: 100000,
              },
            ],
          },
        ],
        broadcast: true,
        pack: null,
      },
    });
    expect(body.operation.parentUuid).toBeUndefined();
  });

  it('maps multiple pages in order', async () => {
    const client = buildClient();
    await client.createJournalEntry('Session 11 Recap', [
      { name: 'Summary', content: 'a' },
      { name: 'NPCs', content: 'b' },
    ]);
    const [, body] = lastRequest(client);
    expect(body.operation.data[0].pages).toHaveLength(2);
    expect(body.operation.data[0].pages[0].name).toBe('Summary');
    expect(body.operation.data[0].pages[1].name).toBe('NPCs');
  });

  it('assigns ascending sort values so pages render in the supplied order', async () => {
    const client = buildClient();
    await client.createJournalEntry('Session 11 Recap', [
      { name: 'Summary', content: 'a' },
      { name: 'NPCs', content: 'b' },
      { name: 'Loot', content: 'c' },
    ]);
    const [, body] = lastRequest(client);
    expect(body.operation.data[0].pages.map((p: { sort: number }) => p.sort)).toEqual([
      100000, 200000, 300000,
    ]);
  });

  it('includes folder when provided', async () => {
    const client = buildClient();
    await client.createJournalEntry(
      'Session 11 Recap',
      [{ name: 'Summary', content: 'a' }],
      VALID_FOLDER_ID,
    );
    const [, body] = lastRequest(client);
    expect(body.operation.data[0].folder).toBe(VALID_FOLDER_ID);
  });

  it('omits ownership entirely when no visibility is given, leaving Foundry to default it', async () => {
    const client = buildClient();
    await client.createJournalEntry('Session 11 Recap', [{ name: 'Summary', content: 'a' }]);
    const [, body] = lastRequest(client);
    expect(body.operation.data[0].ownership).toBeUndefined();
  });

  it.each([
    ['observer', 2],
    ['owner', 3],
    ['gm-only', 0],
  ] as const)('maps visibility %s to ownership.default %i', async (visibility, level) => {
    const client = buildClient();
    await client.createJournalEntry(
      'Session 11 Recap',
      [{ name: 'Summary', content: 'a' }],
      undefined,
      visibility,
    );
    const [, body] = lastRequest(client);
    expect(body.operation.data[0].ownership).toEqual({ default: level });
  });

  it('rejects an unknown visibility before emitting', async () => {
    const client = buildClient();
    await expect(
      client.createJournalEntry(
        'Session 11 Recap',
        [{ name: 'Summary', content: 'a' }],
        undefined,
        'everyone' as unknown as 'observer',
      ),
    ).rejects.toThrow(/Invalid visibility/);
  });

  it('rejects an empty pages array before emitting', async () => {
    const client = buildClient();
    await expect(client.createJournalEntry('Session 11 Recap', [])).rejects.toThrow(
      /at least one page/,
    );
  });

  it('rejects a malformed folder id before emitting', async () => {
    const client = buildClient();
    await expect(
      client.createJournalEntry('Session 11 Recap', [{ name: 'Summary', content: 'a' }], 'short'),
    ).rejects.toThrow(/Invalid folder/);
  });

  it('rejects writes when FOUNDRY_WRITE_ENABLED is false', async () => {
    const client = buildClient({ writeEnabled: false });
    await expect(
      client.createJournalEntry('Session 11 Recap', [{ name: 'Summary', content: 'a' }]),
    ).rejects.toThrow(/FOUNDRY_WRITE_ENABLED/);
  });

  it('rejects writes when the socket is not connected', async () => {
    const client = buildClient({ connected: false });
    await expect(
      client.createJournalEntry('Session 11 Recap', [{ name: 'Summary', content: 'a' }]),
    ).rejects.toThrow(/Socket\.IO connection/);
  });
});
