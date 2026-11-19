import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadTargetConfiguration, normalizeLegacyTarget } from '../targets.js';

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('target configuration', () => {
  it('keeps target credentials and write permissions isolated', () => {
    const env = {
      FOUNDRY_WRITE_ENABLED: 'true',
      CAMPAIGN_PASSWORD: 'secret-a',
      RELAY_KEY: 'secret-b',
      FOUNDRY_TARGETS_JSON: JSON.stringify({
        version: 1,
        targets: [
          {
            id: 'campaign-a',
            writeEnabled: true,
            provider: {
              kind: 'socketio',
              baseUrl: 'http://a.test',
              username: 'GM',
              passwordEnv: 'CAMPAIGN_PASSWORD',
            },
          },
          {
            id: 'campaign-b',
            provider: {
              kind: 'rest-api',
              relayUrl: 'https://relay.test',
              clientId: 'client-b',
              apiKeyEnv: 'RELAY_KEY',
            },
          },
        ],
      }),
    };
    const targets = loadTargetConfiguration(env);
    expect(targets).toHaveLength(2);
    expect(targets?.[0]?.writeEnabled).toBe(true);
    expect(targets?.[1]?.writeEnabled).toBe(false);
    expect(targets?.[0]?.provider).toMatchObject({ password: 'secret-a', writeEnabled: true });
    expect(targets?.[1]?.provider).toMatchObject({ apiKey: 'secret-b', writeEnabled: false });
    expect(targets?.[0]?.provider).not.toHaveProperty('passwordEnv');
  });

  it('rejects duplicate targets and ambiguous configuration sources', () => {
    const target = { id: 'same', provider: { kind: 'socketio', baseUrl: 'http://foundry.test' } };
    expect(() =>
      loadTargetConfiguration({ FOUNDRY_TARGETS_JSON: JSON.stringify([target, target]) }),
    ).toThrow(/Duplicate target/);
    expect(() =>
      loadTargetConfiguration({ FOUNDRY_TARGETS_JSON: '[]', FOUNDRY_TARGETS_FILE: 'targets.json' }),
    ).toThrow(/either/);
  });

  it('reads a versioned target file and rejects unsupported versions', () => {
    const directory = mkdtempSync(join(process.cwd(), '.test-targets-'));
    directories.push(directory);
    const path = join(directory, 'targets.json');
    writeFileSync(
      path,
      JSON.stringify({
        version: 1,
        targets: [{ id: 'local', provider: { kind: 'socketio', baseUrl: 'http://foundry.test' } }],
      }),
    );
    expect(loadTargetConfiguration({ FOUNDRY_TARGETS_FILE: path })?.[0]?.id).toBe('local');
    writeFileSync(path, JSON.stringify({ version: 99, targets: [] }));
    expect(() => loadTargetConfiguration({ FOUNDRY_TARGETS_FILE: path })).toThrow();
  });

  it('does not silently replace literal credentials with environment references', () => {
    const provider: Record<string, unknown> = {
      kind: 'legacy-rest',
      baseUrl: 'http://foundry.test',
      apiKey: 'literal-secret',
      apiKeyEnv: 'KEY',
    };
    expect(() =>
      loadTargetConfiguration({
        KEY: 'env-secret',
        FOUNDRY_TARGETS_JSON: JSON.stringify([{ id: 'a', provider }]),
      }),
    ).toThrow(/both/);
    delete provider.apiKey;
    expect(() =>
      loadTargetConfiguration({ FOUNDRY_TARGETS_JSON: JSON.stringify([{ id: 'a', provider }]) }),
    ).toThrow(/KEY/);
  });

  it('requires world identity for a composite provider', () => {
    const provider = {
      kind: 'composite',
      core: { kind: 'socketio', baseUrl: 'http://foundry.test' },
      execution: {
        kind: 'rest-api',
        relayUrl: 'http://relay.test',
        apiKey: 'key',
        clientId: 'client',
      },
    };
    expect(() =>
      loadTargetConfiguration({ FOUNDRY_TARGETS_JSON: JSON.stringify([{ id: 'a', provider }]) }),
    ).toThrow(/expectedWorldId/);
    const targets = loadTargetConfiguration({
      FOUNDRY_TARGETS_JSON: JSON.stringify([{ id: 'a', expectedWorldId: 'world-a', provider }]),
    });
    expect(targets?.[0]?.provider).toMatchObject({
      execution: { expectedWorldId: 'world-a', writeEnabled: false },
      core: { writeEnabled: false },
    });
  });

  it('converts existing environment configuration into one default target', () => {
    const target = normalizeLegacyTarget(
      {
        url: 'http://foundry.test',
        apiKey: 'old-key',
        socketPath: '/socket.io/',
        timeout: 10000,
        retryAttempts: 3,
        retryDelay: 1000,
        writeEnabled: false,
      },
      {},
    );
    expect(target.id).toBe('default');
    expect(target.provider).toMatchObject({
      kind: 'legacy-rest',
      apiKey: 'old-key',
      baseUrl: 'http://foundry.test',
    });
  });

  it('uses separate relay credentials for new providers', () => {
    const target = normalizeLegacyTarget(
      {
        url: 'http://foundry.test',
        apiKey: 'old-key',
        socketPath: '/socket.io/',
        timeout: 10000,
        retryAttempts: 3,
        retryDelay: 1000,
        writeEnabled: false,
      },
      {
        FOUNDRY_PROVIDER: 'rest-api',
        FOUNDRY_REST_RELAY_URL: 'http://relay.test',
        FOUNDRY_REST_API_KEY: 'relay-key',
        FOUNDRY_REST_CLIENT_ID: 'client-a',
      },
    );
    expect(target.provider).toMatchObject({ kind: 'rest-api', apiKey: 'relay-key' });
    expect(target.provider).not.toHaveProperty('baseUrl');
  });
});
