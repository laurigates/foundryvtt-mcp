import { setImmediate } from 'node:timers/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TargetConfig } from '../../config/targets.js';
import { IntegrationError } from '../../integrations/types.js';
import {
  assertOperationCurrent,
  captureOperationContext,
  trackOperation,
  withOperationContext,
} from '../../providers/operation-context.js';
import { SocketIOProvider } from '../../providers/socketio.js';
import { FoundrySession, type SessionIntegrations } from '../session.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function integrations(): SessionIntegrations {
  return {
    reconcile: vi.fn(async () => {}),
    getTools: () => [],
    list: () => [],
    has: () => false,
    call: vi.fn(async () => null),
    close: vi.fn(async () => {}),
  };
}

const sessions: FoundrySession[] = [];
afterEach(async () => {
  await Promise.all(sessions.splice(0).map((session) => session.close()));
  vi.restoreAllMocks();
});

async function nativeSession() {
  const config: TargetConfig = {
    id: 'native',
    provider: { kind: 'socketio', baseUrl: 'http://native.test', writeEnabled: true },
    writeEnabled: true,
    integrationsEnabled: false,
  };
  const provider = new SocketIOProvider(
    config.provider as Extract<TargetConfig['provider'], { kind: 'socketio' }>,
  );
  const socket = { connected: true, emit: vi.fn(), off: vi.fn(), disconnect: vi.fn() };
  vi.spyOn(provider, 'connect').mockImplementation(async () => {
    Reflect.set(provider, 'generation', provider.getGeneration() + 1);
    Reflect.set(provider, '_isConnected', true);
    Reflect.set(provider, 'socket', socket);
  });
  vi.spyOn(provider, 'inspect').mockResolvedValue({
    world: { id: 'world-a', title: 'A' },
    system: { id: 'dnd5e', version: 'test' },
    foundryVersion: 'test',
    modules: [],
    ready: true,
  });
  vi.spyOn(provider, 'refreshWorldData').mockResolvedValue();
  const session = new FoundrySession(config, provider, {
    integrationFactory: integrations,
    monitorIntervalMs: 0,
  });
  sessions.push(session);
  await session.start();
  return { session, provider, socket };
}

describe('Operation lifecycle', () => {
  it.each(['reconnect', 'refresh'] as const)(
    'stops the second native combat send after %s invalidates the operation',
    async (action) => {
      const { session, socket } = await nativeSession();
      const sent = deferred<void>();
      const closing = deferred<void>();
      let acknowledge: ((response: unknown) => void) | undefined;
      socket.emit.mockImplementation((_event, request, callback) => {
        if (request.type === 'Combat') {
          acknowledge = callback;
          sent.resolve();
        } else {
          callback({ result: [{ _id: 'combatant0000001' }] });
        }
      });
      const write = session.run(
        (provider) =>
          provider.startCombat('scene00000000001', [
            { sceneId: 'scene00000000001', tokenId: 'token00000000001' },
          ]),
        { write: true },
      );
      const rejected = expect(write).rejects.toMatchObject({ code: 'outcome_unknown' });
      let recovery: Promise<void> | undefined;
      try {
        await sent.promise;
        session.integrations.close = vi.fn(() => closing.promise);
        recovery = session[action]();
        await setImmediate();
        expect(session.state).toBe('connecting');
        acknowledge?.({ result: [{ _id: 'combat0000000001' }] });
        await setImmediate();
        expect(socket.emit).toHaveBeenCalledTimes(1);
        closing.resolve();
        await recovery;
        await rejected;
        expect(socket.emit).toHaveBeenCalledTimes(1);
        await expect(session.run(async () => 'new operation')).resolves.toBe('new operation');
      } finally {
        closing.resolve();
        await session.close();
        await Promise.allSettled([recovery, rejected]);
      }
    },
  );

  it('keeps the target queue occupied after a public error until dispatched work settles', async () => {
    const { session } = await nativeSession();
    const finished = deferred<void>();
    const events: string[] = [];
    const failed = session.run(
      async () => {
        events.push('write-started');
        trackOperation(finished.promise.then(() => events.push('write-finished')));
        throw new IntegrationError('outcome_unknown', 'Worker stopped after dispatch');
      },
      { write: true },
    );
    let next: Promise<number> | undefined;
    try {
      await expect(failed).rejects.toMatchObject({ code: 'outcome_unknown' });
      next = session.run(async () => events.push('next-operation'));
      await setImmediate();
      expect(events).toEqual(['write-started']);
      finished.resolve();
      await next;
      expect(events).toEqual(['write-started', 'write-finished', 'next-operation']);
    } finally {
      finished.resolve();
      await next?.catch(() => {});
    }
  });

  it('does not let a callback send after its operation has returned', async () => {
    const { session } = await nativeSession();
    const context = await session.run(async () => captureOperationContext());
    expect(context).toBeDefined();
    expect(() => withOperationContext(context, assertOperationCurrent)).toThrow(
      'The operation is no longer active',
    );
  });

  it('shares the in-progress close promise with every caller', async () => {
    const { session, provider } = await nativeSession();
    const stopped = deferred<void>();
    const disconnect = vi.spyOn(provider, 'disconnect').mockImplementation(() => stopped.promise);
    const first = session.close();
    const second = session.close();
    try {
      expect(second).toBe(first);
      let completed = false;
      void second.then(() => {
        completed = true;
      });
      await setImmediate();
      expect(completed).toBe(false);
      expect(session.state).toBe('closed');
      stopped.resolve();
      await Promise.all([first, second]);
      expect(disconnect).toHaveBeenCalledTimes(2);
    } finally {
      stopped.resolve();
      await Promise.allSettled([first, second]);
    }
  });

  it('does not start authentication after close interrupts integration cleanup', async () => {
    const { session, provider } = await nativeSession();
    const cleaned = deferred<void>();
    session.integrations.close = vi.fn(() => cleaned.promise);
    // Use start() from idle to exercise establish's first asynchronous boundary.
    Reflect.set(session, 'currentState', 'idle');
    const starting = session.start();
    const rejected = expect(starting).rejects.toMatchObject({ code: 'session_closed' });
    await setImmediate();
    const closing = session.close();
    cleaned.resolve();
    await Promise.all([closing, rejected]);
    expect(provider.connect).toHaveBeenCalledTimes(1);
    expect(session.state).toBe('closed');
  });
});
