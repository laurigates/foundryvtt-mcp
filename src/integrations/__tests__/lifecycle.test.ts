import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  captureOperationContext,
  ProviderOperationContext,
  withOperationContext,
} from '../../providers/operation-context.js';
import { IntegrationManager } from '../manager.js';

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

async function fixture(readOnly = false): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'foundry-integration-lifecycle-'));
  roots.push(root);
  const module = join(root, 'modules', 'fixture');
  await mkdir(module, { recursive: true });
  await Promise.all([
    writeFile(join(module, 'README.md'), 'Test-only integration\n'),
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

describe('integration lifecycle boundaries', () => {
  it('does not register an operation whose activation probe completes after the session changed', async () => {
    const root = await fixture(true);
    const started = deferred<void>();
    const release = deferred<void>();
    const manager = new IntegrationManager({
      targetId: 'stale-activation',
      packageRoot: root,
      execute: async (script) => {
        if (script.includes('PROBE')) {
          started.resolve();
          await release.promise;
        }
        return { ready: true };
      },
    });
    const activation = manager.reconcile(environment);
    await started.promise;
    await manager.close();
    release.resolve();
    await activation;
    expect(manager.getTools()).toEqual([]);
    expect(manager.list()[0]).toMatchObject({
      state: 'not-ready',
      operations: [{ available: false }],
    });
    await expect(manager.call('module_fixture_invoke', {})).rejects.toMatchObject({
      code: 'integration_unavailable',
    });
  });

  it('restores the calling operation context inside the provider dispatch', async () => {
    const root = await fixture(true);
    const context = new ProviderOperationContext(() => {});
    let observed: ProviderOperationContext | undefined;
    const manager = new IntegrationManager({
      targetId: 'context',
      packageRoot: root,
      execute: async (script) => {
        if (script.includes('PROBE')) {
          return { ready: true };
        }
        observed = captureOperationContext();
        return { ok: true };
      },
    });
    try {
      await manager.reconcile(environment);
      await withOperationContext(context, () => manager.call('module_fixture_invoke', {}));
      expect(observed).toBe(context);
    } finally {
      context.finish();
      await manager.close();
    }
  });

  it('reports an uncertain dispatched write when the provider loses its result', async () => {
    const root = await fixture();
    let executions = 0;
    const manager = new IntegrationManager({
      targetId: 'write-uncertain',
      packageRoot: root,
      writesEnabled: true,
      execute: async (script) => {
        if (script.includes('PROBE')) {
          return { ready: true };
        }
        executions += 1;
        throw new Error('Response lost after dispatch');
      },
    });
    try {
      await manager.reconcile(environment);
      await expect(manager.call('module_fixture_invoke', {})).rejects.toMatchObject({
        code: 'outcome_unknown',
      });
      expect(executions).toBe(1);
    } finally {
      await manager.close();
    }
  });

  it('rejects an expired operation context before marking a write as dispatched', async () => {
    const root = await fixture();
    const context = new ProviderOperationContext(() => {});
    let executions = 0;
    const manager = new IntegrationManager({
      targetId: 'expired-context',
      packageRoot: root,
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
      await manager.reconcile(environment);
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
      const root = await fixture();
      let executions = 0;
      const manager = new IntegrationManager({
        targetId: 'confirmed-no-write',
        packageRoot: root,
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
        await manager.reconcile(environment);
        await expect(manager.call('module_fixture_invoke', {})).rejects.toMatchObject({ code });
        expect(executions).toBe(1);
      } finally {
        await manager.close();
      }
    },
  );
});
