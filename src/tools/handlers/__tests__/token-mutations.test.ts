import { McpError } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it, vi } from 'vitest';
import { FoundryClient } from '../../../foundry/client.js';
import type { WorldActor, WorldEffect, WorldScene } from '../../../foundry/types.js';
import { handleApplyStatusEffect, handleMoveToken } from '../token-mutations.js';

const SCENE_ID = 'ssssssssssssssss'; // 16 alphanumeric chars
const TOKEN_ID = 'tttttttttttttttt';
const ACTOR_ID = 'aaaaaaaaaaaaaaaa';
const EFFECT_ID = 'eeeeeeeeeeeeeeee';

/** Builds a minimal WorldScene carrying one token. */
const makeScene = (token: Record<string, unknown>): WorldScene =>
  ({
    _id: SCENE_ID,
    name: 'Test Scene',
    active: true,
    navigation: true,
    width: 1000,
    height: 1000,
    padding: 0.25,
    darkness: 0,
    globalLight: true,
    tokens: [token],
  }) as WorldScene;

describe('Token mutation handlers', () => {
  const createMockClient = (opts: {
    located?: { scene: WorldScene; token: Record<string, unknown> } | null;
    actor?: WorldActor | undefined;
    moveToken?: (sceneId: string, tokenId: string, x: number, y: number) => unknown;
    createEffect?: (uuid: string, statusId: string) => WorldEffect;
    deleteEffect?: (uuid: string, effectId: string) => unknown;
  }): FoundryClient =>
    ({
      findToken: vi.fn(() => opts.located ?? null),
      getRawActor: vi.fn(() => opts.actor),
      moveToken: vi.fn(opts.moveToken ?? (() => ({}))),
      createActorStatusEffect: vi.fn(
        opts.createEffect ?? (() => ({ _id: EFFECT_ID, name: 'Prone', statuses: ['prone'] })),
      ),
      deleteActorEffect: vi.fn(opts.deleteEffect ?? (() => undefined)),
    }) as unknown as FoundryClient;

  describe('handleMoveToken', () => {
    it('moves a located token and reports the new position', async () => {
      const token = { _id: TOKEN_ID, name: 'Goblin', x: 0, y: 0 };
      const client = createMockClient({ located: { scene: makeScene(token), token } });

      const result = await handleMoveToken({ tokenId: TOKEN_ID, x: 100, y: 200 }, client);

      expect(result.content[0].text).toContain('Token Moved');
      expect(result.content[0].text).toContain('Goblin');
      expect(result.content[0].text).toContain('(100, 200)');
      expect(client.moveToken).toHaveBeenCalledWith(SCENE_ID, TOKEN_ID, 100, 200);
    });

    it('raises McpError when the token is not found', async () => {
      const client = createMockClient({ located: null });
      await expect(handleMoveToken({ tokenId: TOKEN_ID, x: 1, y: 2 }, client)).rejects.toThrow(
        McpError,
      );
      expect(client.moveToken).not.toHaveBeenCalled();
    });

    it('rejects non-finite coordinates before reaching the client', async () => {
      const client = createMockClient({});
      await expect(
        handleMoveToken({ tokenId: TOKEN_ID, x: Number.NaN, y: 0 }, client),
      ).rejects.toThrow(McpError);
      expect(client.moveToken).not.toHaveBeenCalled();
    });

    it('rejects a missing tokenId', async () => {
      const client = createMockClient({});
      await expect(handleMoveToken({ tokenId: '', x: 1, y: 2 }, client)).rejects.toThrow(McpError);
    });
  });

  describe('handleApplyStatusEffect', () => {
    it('applies a new status effect on a linked actor (parentUuid Actor.<id>)', async () => {
      const token = { _id: TOKEN_ID, name: 'Goblin', actorId: ACTOR_ID, actorLink: true };
      const actor = { _id: ACTOR_ID, name: 'Goblin', type: 'npc', system: {}, effects: [] };
      const client = createMockClient({
        located: { scene: makeScene(token), token },
        actor: actor as unknown as WorldActor,
      });

      const result = await handleApplyStatusEffect(
        { tokenId: TOKEN_ID, statusId: 'prone' },
        client,
      );

      expect(result.content[0].text).toContain('Status Effect Applied');
      expect(result.content[0].text).toContain('prone');
      expect(client.createActorStatusEffect).toHaveBeenCalledWith(`Actor.${ACTOR_ID}`, 'prone');
      expect(client.deleteActorEffect).not.toHaveBeenCalled();
    });

    it('targets the synthetic actor UUID for an unlinked token', async () => {
      const token = { _id: TOKEN_ID, name: 'Goblin', actorId: ACTOR_ID, actorLink: false };
      const client = createMockClient({
        located: { scene: makeScene(token), token },
        actor: undefined,
      });

      await handleApplyStatusEffect({ tokenId: TOKEN_ID, statusId: 'stunned' }, client);

      expect(client.createActorStatusEffect).toHaveBeenCalledWith(
        `Scene.${SCENE_ID}.Token.${TOKEN_ID}.Actor.${ACTOR_ID}`,
        'stunned',
      );
    });

    it('is a no-op when applying an already-present status', async () => {
      const token = { _id: TOKEN_ID, name: 'Goblin', actorId: ACTOR_ID, actorLink: true };
      const actor = {
        _id: ACTOR_ID,
        name: 'Goblin',
        type: 'npc',
        system: {},
        effects: [{ _id: EFFECT_ID, name: 'Prone', statuses: ['prone'] }],
      };
      const client = createMockClient({
        located: { scene: makeScene(token), token },
        actor: actor as unknown as WorldActor,
      });

      const result = await handleApplyStatusEffect(
        { tokenId: TOKEN_ID, statusId: 'prone' },
        client,
      );

      expect(result.content[0].text).toContain('already active');
      expect(client.createActorStatusEffect).not.toHaveBeenCalled();
    });

    it('removes an existing status effect by its id when active=false', async () => {
      const token = { _id: TOKEN_ID, name: 'Goblin', actorId: ACTOR_ID, actorLink: true };
      const actor = {
        _id: ACTOR_ID,
        name: 'Goblin',
        type: 'npc',
        system: {},
        effects: [{ _id: EFFECT_ID, name: 'Prone', statuses: ['prone'] }],
      };
      const client = createMockClient({
        located: { scene: makeScene(token), token },
        actor: actor as unknown as WorldActor,
      });

      const result = await handleApplyStatusEffect(
        { tokenId: TOKEN_ID, statusId: 'prone', active: false },
        client,
      );

      expect(result.content[0].text).toContain('Status Effect Removed');
      expect(client.deleteActorEffect).toHaveBeenCalledWith(`Actor.${ACTOR_ID}`, EFFECT_ID);
      expect(client.createActorStatusEffect).not.toHaveBeenCalled();
    });

    it('is a no-op when removing an absent status', async () => {
      const token = { _id: TOKEN_ID, name: 'Goblin', actorId: ACTOR_ID, actorLink: true };
      const actor = { _id: ACTOR_ID, name: 'Goblin', type: 'npc', system: {}, effects: [] };
      const client = createMockClient({
        located: { scene: makeScene(token), token },
        actor: actor as unknown as WorldActor,
      });

      const result = await handleApplyStatusEffect(
        { tokenId: TOKEN_ID, statusId: 'prone', active: false },
        client,
      );

      expect(result.content[0].text).toContain('nothing to remove');
      expect(client.deleteActorEffect).not.toHaveBeenCalled();
    });

    it('raises McpError when the token has no associated actor', async () => {
      const token = { _id: TOKEN_ID, name: 'Decoration' };
      const client = createMockClient({ located: { scene: makeScene(token), token } });
      await expect(
        handleApplyStatusEffect({ tokenId: TOKEN_ID, statusId: 'prone' }, client),
      ).rejects.toThrow(McpError);
    });

    it('raises McpError when the token is not found', async () => {
      const client = createMockClient({ located: null });
      await expect(
        handleApplyStatusEffect({ tokenId: TOKEN_ID, statusId: 'prone' }, client),
      ).rejects.toThrow(McpError);
    });

    it('rejects a missing statusId', async () => {
      const token = { _id: TOKEN_ID, actorId: ACTOR_ID, actorLink: true };
      const client = createMockClient({ located: { scene: makeScene(token), token } });
      await expect(
        handleApplyStatusEffect({ tokenId: TOKEN_ID, statusId: '' }, client),
      ).rejects.toThrow(McpError);
    });
  });
});

// --------------------------------------------------------------------------
// Client-level: exercise the real methods with a mock socket, asserting the
// emitted modifyDocument body (mirrors combat-mutations.test.ts).
// --------------------------------------------------------------------------
describe('FoundryClient token mutations', () => {
  type SocketEmitMock = (event: string, payload: unknown, cb: (response: unknown) => void) => void;

  const buildClient = (opts: { writeEnabled?: boolean; connected?: boolean }) => {
    const client = new FoundryClient({
      baseUrl: 'http://localhost:30000',
      writeEnabled: opts.writeEnabled ?? true,
    });
    const emit = vi.fn(((_event, payload, cb) => {
      const op = (
        payload as {
          operation?: {
            updates?: Array<Record<string, unknown>>;
            data?: Array<Record<string, unknown>>;
          };
        }
      ).operation;
      const result = op?.updates ?? op?.data ?? [];
      cb({ result: [result[0] ?? { _id: EFFECT_ID }] });
    }) as SocketEmitMock);
    if (opts.connected !== false) {
      (client as unknown as { socket: { connected: boolean; emit: SocketEmitMock } }).socket = {
        connected: true,
        emit,
      };
    }
    return { client, emit };
  };

  it('moveToken emits a Token update with parentUuid Scene.<id>', async () => {
    const { client, emit } = buildClient({});
    await client.moveToken(SCENE_ID, TOKEN_ID, 150, 250);
    const [event, body] = emit.mock.calls[0] as unknown[] as [string, Record<string, unknown>];
    expect(event).toBe('modifyDocument');
    expect(body).toMatchObject({
      type: 'Token',
      action: 'update',
      operation: {
        updates: [{ _id: TOKEN_ID, x: 150, y: 250 }],
        parentUuid: `Scene.${SCENE_ID}`,
      },
    });
  });

  it('createActorStatusEffect emits an ActiveEffect create with statuses and parentUuid', async () => {
    const { client, emit } = buildClient({});
    await client.createActorStatusEffect(`Actor.${ACTOR_ID}`, 'prone');
    const [, body] = emit.mock.calls[0] as unknown[] as [string, Record<string, unknown>];
    expect(body).toMatchObject({
      type: 'ActiveEffect',
      action: 'create',
      operation: {
        data: [{ name: 'prone', statuses: ['prone'] }],
        parentUuid: `Actor.${ACTOR_ID}`,
      },
    });
  });

  it('createActorStatusEffect accepts the unlinked synthetic-actor UUID form', async () => {
    const { client, emit } = buildClient({});
    const uuid = `Scene.${SCENE_ID}.Token.${TOKEN_ID}.Actor.${ACTOR_ID}`;
    await client.createActorStatusEffect(uuid, 'stunned', { name: 'Stunned', img: 'x.png' });
    const [, body] = emit.mock.calls[0] as unknown[] as [string, Record<string, unknown>];
    expect(body).toMatchObject({
      type: 'ActiveEffect',
      action: 'create',
      operation: {
        data: [{ name: 'Stunned', statuses: ['stunned'], img: 'x.png' }],
        parentUuid: uuid,
      },
    });
  });

  it('deleteActorEffect emits an ActiveEffect delete carrying ids and parentUuid', async () => {
    const { client, emit } = buildClient({});
    await client.deleteActorEffect(`Actor.${ACTOR_ID}`, EFFECT_ID);
    const [, body] = emit.mock.calls[0] as unknown[] as [string, Record<string, unknown>];
    expect(body).toMatchObject({
      type: 'ActiveEffect',
      action: 'delete',
      operation: { ids: [EFFECT_ID], parentUuid: `Actor.${ACTOR_ID}` },
    });
  });

  it('rejects token writes when FOUNDRY_WRITE_ENABLED is false', async () => {
    const { client } = buildClient({ writeEnabled: false });
    await expect(client.moveToken(SCENE_ID, TOKEN_ID, 1, 2)).rejects.toThrow(
      /FOUNDRY_WRITE_ENABLED/,
    );
  });

  it('rejects token writes when the Socket.IO connection is not active', async () => {
    const { client } = buildClient({ writeEnabled: true, connected: false });
    await expect(client.moveToken(SCENE_ID, TOKEN_ID, 1, 2)).rejects.toThrow(
      /Socket\.IO connection/,
    );
  });

  it('rejects a malformed sceneId', async () => {
    const { client } = buildClient({});
    await expect(client.moveToken('short', TOKEN_ID, 1, 2)).rejects.toThrow(/Invalid sceneId/);
  });

  it('rejects a malformed tokenId', async () => {
    const { client } = buildClient({});
    await expect(client.moveToken(SCENE_ID, 'short', 1, 2)).rejects.toThrow(/Invalid tokenId/);
  });

  it('rejects non-finite coordinates at the client', async () => {
    const { client } = buildClient({});
    await expect(client.moveToken(SCENE_ID, TOKEN_ID, Number.POSITIVE_INFINITY, 0)).rejects.toThrow(
      /Invalid coordinates/,
    );
  });

  it('rejects a malformed actor UUID for status effects', async () => {
    const { client } = buildClient({});
    await expect(client.createActorStatusEffect('Actor.short', 'prone')).rejects.toThrow(
      /Invalid actor UUID/,
    );
  });

  it('rejects a malformed effectId on delete', async () => {
    const { client } = buildClient({});
    await expect(client.deleteActorEffect(`Actor.${ACTOR_ID}`, 'short')).rejects.toThrow(
      /Invalid effectId/,
    );
  });
});
