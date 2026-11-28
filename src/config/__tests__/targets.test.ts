import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LegacyRestProvider } from '../../providers/legacy-rest.js';
import {
  legacyConfigForTarget,
  loadTargetConfiguration,
  normalizeLegacyTarget,
} from '../targets.js';

vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('target configuration', () => {
  it('keeps an explicit native bridge bound to its own target and credential reference', () => {
    const targets = loadTargetConfiguration({
      BRIDGE_KEY: 'bridge-a',
      FOUNDRY_API_KEY: 'unrelated-global-key',
      FOUNDRY_TARGETS_JSON: JSON.stringify([
        {
          id: 'a',
          expectedWorldId: 'world-a',
          writeEnabled: true,
          provider: {
            kind: 'socketio',
            baseUrl: 'https://a.test',
            username: 'GM',
            password: 'password-a',
            restUrl: 'https://bridge-a.test',
            restApiKeyEnv: 'BRIDGE_KEY',
          },
        },
        {
          id: 'b',
          expectedWorldId: 'world-b',
          provider: { kind: 'socketio', baseUrl: 'https://b.test' },
        },
      ]),
    });
    const first = targets?.[0];
    expect(first?.provider).toMatchObject({
      kind: 'socketio',
      restUrl: 'https://bridge-a.test',
      restApiKey: 'bridge-a',
      writeEnabled: true,
    });
    expect(first?.provider).not.toHaveProperty('restApiKeyEnv');
    expect(first?.provider).not.toHaveProperty('apiKey');
    expect(targets?.[1]?.provider).not.toHaveProperty('restApiKey');
    expect(targets?.[1]?.provider).not.toHaveProperty('restUrl');
    if (!first) {
      throw new Error('Expected a configured target');
    }
    expect(legacyConfigForTarget(first)).toMatchObject({
      url: 'https://a.test',
      restUrl: 'https://bridge-a.test',
      apiKey: 'bridge-a',
    });
  });

  it('requires a configured world identity when more than one target is declared', () => {
    expect(() =>
      loadTargetConfiguration({
        FOUNDRY_TARGETS_JSON: JSON.stringify([
          {
            id: 'a',
            expectedWorldId: 'world-a',
            provider: { kind: 'socketio', baseUrl: 'https://a.test' },
          },
          { id: 'b', provider: { kind: 'socketio', baseUrl: 'https://b.test' } },
        ]),
      }),
    ).toThrow(/expectedWorldId/);
    const targets = loadTargetConfiguration({
      FOUNDRY_TARGETS_JSON: JSON.stringify([
        {
          id: 'a',
          expectedWorldId: 'world-a',
          provider: { kind: 'socketio', baseUrl: 'https://a.test' },
        },
        {
          id: 'b',
          expectedWorldId: 'world-b',
          provider: { kind: 'socketio', baseUrl: 'https://b.test' },
        },
      ]),
    });
    expect(targets?.map((target) => target.expectedWorldId)).toEqual(['world-a', 'world-b']);
  });

  it('accepts a relay provider world identity in place of the target setting', () => {
    const targets = loadTargetConfiguration({
      FOUNDRY_TARGETS_JSON: JSON.stringify([
        {
          id: 'a',
          expectedWorldId: 'world-a',
          provider: { kind: 'socketio', baseUrl: 'https://a.test' },
        },
        {
          id: 'b',
          provider: {
            kind: 'rest-api',
            relayUrl: 'https://relay.test',
            apiKey: 'relay-key',
            clientId: 'client-b',
            expectedWorldId: 'world-b',
          },
        },
      ]),
    });
    expect(targets?.[1]?.provider).toMatchObject({ kind: 'rest-api', expectedWorldId: 'world-b' });
  });

  it('keeps a single target without expectedWorldId on its historical behaviour', () => {
    const targets = loadTargetConfiguration({
      FOUNDRY_TARGETS_JSON: JSON.stringify([
        { id: 'only', provider: { kind: 'socketio', baseUrl: 'https://only.test' } },
      ]),
    });
    expect(targets?.[0]?.expectedWorldId).toBeUndefined();
  });

  it('rejects incomplete bridge configuration rather than silently changing transport', () => {
    const provider = {
      kind: 'socketio',
      baseUrl: 'https://foundry.test',
      username: 'GM',
      password: 'native-password',
      restUrl: 'https://bridge.test',
    };
    expect(() =>
      loadTargetConfiguration({
        FOUNDRY_TARGETS_JSON: JSON.stringify([{ id: 'a', provider }]),
      }),
    ).toThrow(/both restUrl and restApiKey/);
    expect(() =>
      loadTargetConfiguration({
        FOUNDRY_TARGETS_JSON: JSON.stringify([
          {
            id: 'a',
            provider: { ...provider, password: '', restApiKey: 'bridge-key' },
          },
        ]),
      }),
    ).toThrow(/native username or userId and password/);
  });

  it('normalizes upstream dual settings without losing target writes or native credentials', () => {
    const target = normalizeLegacyTarget(
      {
        url: 'https://foundry.test',
        apiKey: 'bridge-key',
        restUrl: 'https://bridge.test',
        username: 'GM',
        password: 'native-password',
        socketPath: '/socket.io/',
        timeout: 10000,
        retryAttempts: 3,
        retryDelay: 1000,
        writeEnabled: true,
      },
      {},
    );
    expect(target.provider).toMatchObject({
      kind: 'socketio',
      baseUrl: 'https://foundry.test',
      username: 'GM',
      password: 'native-password',
      restUrl: 'https://bridge.test',
      restApiKey: 'bridge-key',
      writeEnabled: true,
    });
    expect(target.provider).not.toHaveProperty('apiKey');
  });

  it('uses the separate REST URL for a legacy bridge without native credentials', () => {
    const target = normalizeLegacyTarget(
      {
        url: 'https://foundry.test',
        apiKey: 'bridge-key',
        restUrl: 'https://bridge.test',
        socketPath: '/socket.io/',
        timeout: 10000,
        retryAttempts: 3,
        retryDelay: 1000,
        writeEnabled: false,
      },
      {},
    );
    expect(target.provider).toMatchObject({
      kind: 'legacy-rest',
      baseUrl: 'https://bridge.test',
      apiKey: 'bridge-key',
      writeEnabled: false,
    });
  });

  it.each([
    { name: 'restUrl', augment: { restUrl: 'https://other-bridge.test' } },
    { name: 'restApiKey', augment: { restApiKey: 'augment-key' } },
    { name: 'restApiKeyEnv', augment: { restApiKeyEnv: 'AUGMENT_KEY' } },
    {
      name: 'both bridge fields',
      augment: { restUrl: 'https://other-bridge.test', restApiKey: 'augment-key' },
    },
  ])('rejects $name on an explicitly selected legacy REST provider', ({ augment }) => {
    expect(() =>
      loadTargetConfiguration({
        AUGMENT_KEY: 'resolved-augment-key',
        FOUNDRY_TARGETS_JSON: JSON.stringify([
          {
            id: 'legacy',
            writeEnabled: true,
            provider: {
              kind: 'legacy-rest',
              baseUrl: 'https://bridge.test',
              apiKey: 'legacy-key',
              username: 'GM',
              password: 'native-password',
              ...augment,
            },
          },
        ]),
      }),
    ).toThrow(/Unrecognized key/);
  });

  it.each([undefined, false, true])(
    'keeps a valid legacy provider read-only with target writeEnabled=%s',
    (writeEnabled) => {
      const targets = loadTargetConfiguration({
        FOUNDRY_WRITE_ENABLED: 'true',
        FOUNDRY_TARGETS_JSON: JSON.stringify([
          {
            id: 'legacy',
            ...(writeEnabled === undefined ? {} : { writeEnabled }),
            provider: {
              kind: 'legacy-rest',
              baseUrl: 'https://bridge.test',
              apiKey: 'legacy-key',
              username: 'GM',
              password: 'native-password',
            },
          },
        ]),
      });
      const target = targets?.[0];
      if (!target || target.provider.kind !== 'legacy-rest') {
        throw new Error('Expected a configured legacy REST target');
      }
      const provider = new LegacyRestProvider(target.provider);

      expect(target.writeEnabled).toBe(writeEnabled ?? false);
      expect(provider.kind).toBe('legacy-rest');
      expect(provider.getTransportMode()).toBe('rest');
      expect(provider.capabilities.has('core.write')).toBe(false);
      expect(provider.getConnectionReport().socket.used).toBe(false);
    },
  );

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
            expectedWorldId: 'world-a',
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
            expectedWorldId: 'world-b',
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
    const target = {
      id: 'same',
      expectedWorldId: 'world-same',
      provider: { kind: 'socketio', baseUrl: 'http://foundry.test' },
    };
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

  it('selects the relay runtime mode from the environment', () => {
    const foundry = {
      url: 'http://foundry.test',
      apiKey: 'old-key',
      socketPath: '/socket.io/',
      timeout: 10000,
      retryAttempts: 3,
      retryDelay: 1000,
      writeEnabled: false,
    };
    const named = normalizeLegacyTarget(foundry, {
      FOUNDRY_PROVIDER: 'rest-api',
      FOUNDRY_REST_RELAY_URL: 'http://relay.test',
      FOUNDRY_REST_API_KEY: 'relay-key',
      FOUNDRY_REST_CLIENT_ID: 'client-a',
    });
    expect(named.provider).toMatchObject({ runtimeMode: 'named' });
    const script = normalizeLegacyTarget(foundry, {
      FOUNDRY_PROVIDER: 'rest-api',
      FOUNDRY_REST_RELAY_URL: 'http://relay.test',
      FOUNDRY_REST_API_KEY: 'relay-key',
      FOUNDRY_REST_CLIENT_ID: 'client-a',
      FOUNDRY_REST_EXECUTE_JS_PATH: '/execute-js',
    });
    expect(script.provider).toMatchObject({
      runtimeMode: 'execute-js',
      executeJsPath: '/execute-js',
    });
  });
});

describe('relay runtime mode', () => {
  const load = (provider: Record<string, unknown>) =>
    loadTargetConfiguration({
      FOUNDRY_TARGETS_JSON: JSON.stringify([
        {
          id: 'relay',
          expectedWorldId: 'world-a',
          provider: {
            kind: 'rest-api',
            relayUrl: 'https://relay.test',
            apiKey: 'relay-key',
            clientId: 'client-a',
            ...provider,
          },
        },
      ]),
    })?.[0]?.provider;

  it('defaults to named operations', () => {
    expect(load({})).toMatchObject({ runtimeMode: 'named' });
    expect(load({})).not.toHaveProperty('executeJsPath');
  });

  it('treats an explicit JS path as the opt-in for the historical transport', () => {
    expect(load({ executeJsPath: '/execute-js' })).toMatchObject({ runtimeMode: 'execute-js' });
  });

  it('keeps a configured named runtime path', () => {
    expect(load({ runtimePath: '/mcp/operation' })).toMatchObject({
      runtimeMode: 'named',
      runtimePath: '/mcp/operation',
    });
  });

  it('rejects a transport path that belongs to the other mode', () => {
    expect(() => load({ runtimeMode: 'named', executeJsPath: '/execute-js' })).toThrow(
      /executeJsPath requires runtimeMode 'execute-js'/,
    );
    expect(() => load({ runtimeMode: 'execute-js', runtimePath: '/mcp/operation' })).toThrow(
      /runtimePath requires runtimeMode 'named'/,
    );
  });
});
