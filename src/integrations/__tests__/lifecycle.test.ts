import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  captureOperationContext,
  ProviderOperationContext,
  trackOperation,
  withOperationContext,
} from '../../providers/operation-context.js';
import type { FoundryProvider } from '../../providers/types.js';
import { FoundrySession } from '../../sessions/session.js';
import { IntegrationManager } from '../manager.js';

const sourceRoot = fileURLToPath(new URL('../../../', import.meta.url));
// `python3` is not installed on every platform, so the interpreter is resolved
// once here and honours the same override the server configuration accepts.
const defaultPython = process.platform === 'win32' ? 'python' : 'python3';
const python = process.env.FOUNDRY_PYTHON_EXECUTABLE ?? defaultPython;
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function fixture(adapter: string, readOnly = false): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'foundry-worker-lifecycle-'));
  roots.push(root);
  const worker = join(root, 'python/foundry_mcp_modules');
  const module = join(root, 'modules', 'fixture');
  await Promise.all([mkdir(worker, { recursive: true }), mkdir(module, { recursive: true })]);
  await copyFile(
    join(sourceRoot, 'python/foundry_mcp_modules/worker.py'),
    join(worker, 'worker.py'),
  );
  await Promise.all([
    writeFile(join(module, 'adapter.py'), adapter),
    writeFile(join(module, 'README.md'), 'Test-only adapter\n'),
    writeFile(join(module, 'binding.js'), 'return {ok: true};\n'),
    writeFile(join(module, 'probe.js'), '// PROBE\nreturn {ready: true};\n'),
    writeFile(
      join(module, 'manifest.json'),
      JSON.stringify({
        schemaVersion: 1,
        protocolVersion: 1,
        kind: 'module',
        id: 'fixture',
        adapterVersion: 'test',
        updatedAt: '2026-11-22',
        entrypoint: 'adapter.py',
        status: 'experimental',
        upstream: { repository: null, reference: null, updatedAt: null, verifiedAt: null },
        compatibility: { foundryVersions: [], integrationVersions: [], tested: [] },
        operations: [
          {
            id: 'invoke',
            description: 'Test operation',
            inputSchema: { type: 'object', additionalProperties: false },
            outputSchema: { type: 'object', additionalProperties: true },
            binding: 'binding.js',
            probe: 'probe.js',
            readOnly,
          },
        ],
      }),
    ),
  ]);
  return root;
}

const environment = {
  foundryVersion: 'test',
  system: { id: 'custom', version: 'test' },
  modules: [{ id: 'fixture', version: 'test', active: true }],
};
const forward =
  'class Adapter:\n    async def execute(self, operation, arguments, context):\n        return await context.invoke(operation, arguments)\n';

describe('Python integration lifecycle boundaries', () => {
  it('does not resurrect a dead worker when its activation probe completes later', async () => {
    const root = await fixture(
      'import os, threading, time\nfrom pathlib import Path\nclass Adapter:\n    def __init__(self):\n        def stop():\n            while not Path(__file__).with_name("stop").exists():\n                time.sleep(0.01)\n            os._exit(23)\n        threading.Thread(target=stop, daemon=True).start()\n    async def execute(self, operation, arguments, context):\n        return {}\n',
      true,
    );
    const failure = deferred<void>();
    let probeStarted = false;
    const manager = new IntegrationManager({
      targetId: 'dead-worker',
      packageRoot: root,
      pythonExecutable: python,
      timeoutMs: 2000,
      execute: async () => {
        probeStarted = true;
        await writeFile(join(root, 'modules/fixture/stop'), '');
        await failure.promise;
        return { ready: true };
      },
      onChange: () => {
        if (manager.list().some((entry) => entry.state === 'error')) {
          failure.resolve();
        }
      },
    });
    try {
      await manager.reconcile(environment, 1);
      expect(probeStarted).toBe(true);
      expect(manager.getTools()).toEqual([]);
      expect(manager.list()[0]).toMatchObject({
        state: 'error',
        operations: [{ available: false }],
      });
      await expect(manager.call('module_fixture_invoke', {})).rejects.toMatchObject({
        code: 'integration_unavailable',
      });
    } finally {
      failure.resolve();
      await manager.close();
    }
  });

  it('restores the calling operation context inside a real Python callback', async () => {
    const root = await fixture(forward, true);
    const context = new ProviderOperationContext(() => {});
    let observed: ProviderOperationContext | undefined;
    const manager = new IntegrationManager({
      targetId: 'context',
      packageRoot: root,
      pythonExecutable: python,
      execute: async (script) => {
        if (script.includes('PROBE')) {
          return { ready: true };
        }
        observed = captureOperationContext();
        return { ok: true };
      },
    });
    try {
      await manager.reconcile(environment, 1);
      await withOperationContext(context, () => manager.call('module_fixture_invoke', {}));
      expect(observed).toBe(context);
    } finally {
      context.finish();
      await manager.close();
    }
  });

  it('reports an uncertain dispatched write and keeps its actual execution tracked after timeout', async () => {
    const root = await fixture(forward);
    const context = new ProviderOperationContext(() => {});
    const pending = deferred<Record<string, unknown>>();
    let executions = 0;
    const manager = new IntegrationManager({
      targetId: 'write-timeout',
      packageRoot: root,
      pythonExecutable: python,
      writesEnabled: true,
      // Long enough for a Python start on a loaded machine, so the timeout
      // lands after the write is dispatched and the outcome becomes unknown.
      timeoutMs: 2500,
      execute: async (script) => {
        if (script.includes('PROBE')) {
          return { ready: true };
        }
        executions += 1;
        return trackOperation(pending.promise);
      },
    });
    try {
      await manager.reconcile(environment, 1);
      await expect(
        withOperationContext(context, () => manager.call('module_fixture_invoke', {})),
      ).rejects.toMatchObject({ code: 'outcome_unknown' });
      context.finish();
      let drained = false;
      const drain = context.drain().then(() => {
        drained = true;
      });
      await Promise.resolve();
      expect(drained).toBe(false);
      await expect(manager.call('module_fixture_invoke', {})).rejects.toMatchObject({
        code: 'operation_pending',
      });
      expect(executions).toBe(1);
      pending.resolve({ ok: true });
      await drain;
    } finally {
      pending.resolve({ ok: true });
      context.finish();
      await manager.close();
    }
  });

  it('preserves a timeout before a mutating adapter invokes its binding', async () => {
    const root = await fixture(
      'import asyncio\nclass Adapter:\n    async def execute(self, operation, arguments, context):\n        await asyncio.sleep(5)\n        return await context.invoke(operation, arguments)\n',
    );
    let executions = 0;
    const manager = new IntegrationManager({
      targetId: 'before-dispatch',
      packageRoot: root,
      pythonExecutable: python,
      writesEnabled: true,
      // The timeout must outlast a Python start on a loaded machine but still
      // expire before the adapter sleep, so the binding never runs.
      timeoutMs: 2500,
      execute: async (script) => {
        if (script.includes('PROBE')) {
          return { ready: true };
        }
        executions += 1;
        return { ok: true };
      },
    });
    try {
      await manager.reconcile(environment, 1);
      await expect(manager.call('module_fixture_invoke', {})).rejects.toMatchObject({
        code: 'worker_timeout',
      });
      expect(executions).toBe(0);
    } finally {
      await manager.close();
    }
  });

  it('keeps the real session queue occupied after Python times out until provider execution settles', async () => {
    const root = await fixture(forward);
    const finished = deferred<void>();
    const events: string[] = [];
    let connected = false;
    let generation = 0;
    const provider = {
      kind: 'rest-api',
      capabilities: new Set(['core.read', 'core.write', 'runtime.execute']),
      connect: async () => {
        connected = true;
        generation += 1;
      },
      disconnect: async () => {
        connected = false;
        generation += 1;
      },
      isConnected: () => connected,
      getGeneration: () => generation,
      inspect: async () => ({
        ...environment,
        world: { id: 'queued-world', title: 'Queued world' },
        modules: environment.modules.map((module) => ({ ...module, title: module.id })),
        ready: true,
      }),
      execute: async (
        script: string,
        _args: Record<string, unknown>,
        options: { readOnly: boolean },
      ): Promise<unknown> => {
        if (script.includes('PROBE')) {
          expect(options.readOnly).toBe(true);
          return { ready: true };
        }
        expect(options.readOnly).toBe(false);
        events.push('write-start');
        // Deliberately do not call trackOperation here: the real session's
        // execute closure must track this promise under the restored call context.
        await finished.promise;
        events.push('write-finish');
        return { ok: true };
      },
    } as FoundryProvider;
    const session = new FoundrySession(
      {
        id: 'queued-python',
        provider: {
          kind: 'rest-api',
          relayUrl: 'http://relay.test',
          apiKey: 'fixture-key',
          clientId: 'fixture-client',
          writeEnabled: true,
        },
        writeEnabled: true,
        integrationsEnabled: true,
        pythonExecutable: python,
        // The queue assertion needs the timeout after the write is dispatched,
        // not during the Python start.
        integrationTimeoutMs: 2500,
      },
      provider,
      { packageRoot: root, monitorIntervalMs: 0 },
    );
    try {
      await session.start();
      expect(session.integrations.has('module_fixture_invoke')).toBe(true);
      const write = session.run(() => session.integrations.call('module_fixture_invoke', {}), {
        write: true,
      });
      await expect(write).rejects.toMatchObject({ code: 'outcome_unknown' });
      events.push('timeout');
      const next = session.run(async () => {
        events.push('next');
      });
      await setImmediate();
      expect(events).toEqual(['write-start', 'timeout']);
      finished.resolve();
      await next;
      expect(events).toEqual(['write-start', 'timeout', 'write-finish', 'next']);
    } finally {
      finished.resolve();
      await session.close();
    }
  });

  it('rejects an expired operation context before marking a write as dispatched', async () => {
    const root = await fixture(forward);
    const context = new ProviderOperationContext(() => {});
    let executions = 0;
    const manager = new IntegrationManager({
      targetId: 'expired-context',
      packageRoot: root,
      pythonExecutable: python,
      writesEnabled: true,
      execute: async (script) => {
        if (script.includes('PROBE')) {
          return { ready: true };
        }
        executions += 1;
        return { ok: true };
      },
    });
    try {
      await manager.reconcile(environment, 1);
      const result = withOperationContext(context, () => manager.call('module_fixture_invoke', {}));
      context.finish();
      await expect(result).rejects.toMatchObject({ code: 'session_changed' });
      expect(executions).toBe(0);
    } finally {
      await manager.close();
    }
  });

  it.each(['session_changed', 'execution_rejected'] as const)(
    'preserves a confirmed %s from the provider without claiming an unknown write',
    async (code) => {
      const root = await fixture(forward);
      let executions = 0;
      const manager = new IntegrationManager({
        targetId: 'confirmed-no-write',
        packageRoot: root,
        pythonExecutable: python,
        writesEnabled: true,
        execute: async (script) => {
          if (script.includes('PROBE')) {
            return { ready: true };
          }
          executions += 1;
          throw Object.assign(new Error('Write was not performed'), { code });
        },
      });
      try {
        await manager.reconcile(environment, 1);
        await expect(manager.call('module_fixture_invoke', {})).rejects.toMatchObject({ code });
        expect(executions).toBe(1);
      } finally {
        await manager.close();
      }
    },
  );

  it.each(['exit', 'protocol'] as const)(
    'reports outcome_unknown when Python loses a dispatched write through %s failure',
    async (failure) => {
      const ending =
        failure === 'exit'
          ? '        os._exit(29)\n'
          : '        sys.__stdout__.write("not-json\\n")\n        sys.__stdout__.flush()\n        await asyncio.sleep(2)\n';
      const root = await fixture(
        'import os, sys, asyncio\nclass Adapter:\n    async def execute(self, operation, arguments, context):\n        await context.invoke(operation, arguments)\n' +
          ending,
      );
      let executions = 0;
      const manager = new IntegrationManager({
        targetId: failure,
        packageRoot: root,
        pythonExecutable: python,
        writesEnabled: true,
        timeoutMs: 2500,
        execute: async (script) => {
          if (script.includes('PROBE')) {
            return { ready: true };
          }
          executions += 1;
          return { ok: true };
        },
      });
      try {
        await manager.reconcile(environment, 1);
        await expect(manager.call('module_fixture_invoke', {})).rejects.toMatchObject({
          code: 'outcome_unknown',
        });
        expect(executions).toBe(1);
      } finally {
        await manager.close();
      }
    },
  );
});
