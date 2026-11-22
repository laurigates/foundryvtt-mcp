import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { config, resetConfig } from '../index.js';

describe('legacy environment contract', () => {
  let previousEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    previousEnv = process.env;
    process.env = { NODE_ENV: 'test', FOUNDRY_URL: 'https://foundry.test/game' };
    resetConfig();
  });

  afterEach(() => {
    process.env = previousEnv;
    resetConfig();
  });

  it('keeps the old defaults and resolves one read-only target without new settings', () => {
    expect(config.foundry).toMatchObject({
      url: 'https://foundry.test/game',
      socketPath: '/socket.io/',
      timeout: 10000,
      retryAttempts: 3,
      retryDelay: 1000,
      writeEnabled: false,
    });
    expect(config.targets).toHaveLength(1);
    expect(config.targets[0]).toMatchObject({
      id: 'default',
      writeEnabled: false,
      provider: {
        kind: 'socketio',
        baseUrl: 'https://foundry.test/game',
        socketPath: '/socket.io/',
        timeout: 10000,
        retryAttempts: 3,
        retryDelay: 1000,
        writeEnabled: false,
      },
    });
  });

  it('retains legacy native credentials, socket subpath and retry settings', () => {
    Object.assign(process.env, {
      FOUNDRY_USERNAME: 'GM',
      FOUNDRY_PASSWORD: 'fixture-password',
      FOUNDRY_USER_ID: 'gm-id',
      FOUNDRY_SOCKET_PATH: '/game/socket.io/',
      FOUNDRY_TIMEOUT: '5000',
      FOUNDRY_RETRY_ATTEMPTS: '0',
      FOUNDRY_RETRY_DELAY: '0',
      FOUNDRY_WRITE_ENABLED: 'true',
      USE_REST_MODULE: 'true',
    });
    expect(config.targets[0]?.provider).toEqual({
      kind: 'socketio',
      baseUrl: 'https://foundry.test/game',
      username: 'GM',
      password: 'fixture-password',
      userId: 'gm-id',
      socketPath: '/game/socket.io/',
      timeout: 5000,
      retryAttempts: 0,
      retryDelay: 0,
      writeEnabled: true,
    });
  });

  it('keeps the historical API key on its bridge even when other credentials exist', () => {
    Object.assign(process.env, {
      FOUNDRY_API_KEY: 'historical-key',
      FOUNDRY_USERNAME: 'GM',
      FOUNDRY_PASSWORD: 'fixture-password',
      FOUNDRY_REST_RELAY_URL: 'https://relay.test',
      FOUNDRY_REST_API_KEY: 'relay-key',
      FOUNDRY_REST_CLIENT_ID: 'paired-client',
      USE_REST_MODULE: 'false',
    });
    expect(config.foundry.apiKey).toBe('historical-key');
    expect(config.targets[0]?.provider).toMatchObject({
      kind: 'legacy-rest',
      baseUrl: 'https://foundry.test/game',
      apiKey: 'historical-key',
      writeEnabled: false,
    });
    expect(config.targets[0]?.provider).not.toHaveProperty('relayUrl');
    expect(config.targets[0]?.provider).not.toHaveProperty('clientId');
  });

  it('keeps an empty historical API key on the native path', () => {
    process.env.FOUNDRY_API_KEY = '';
    expect(config.targets[0]?.provider.kind).toBe('socketio');
    expect(config.targets[0]?.provider).not.toHaveProperty('apiKey');
  });

  it.each(['false', 'TRUE', '1', ''])('does not broaden the old write opt-in for %j', (value) => {
    process.env.FOUNDRY_WRITE_ENABLED = value;
    expect(config.foundry.writeEnabled).toBe(false);
    expect(config.targets[0]?.writeEnabled).toBe(false);
    expect(config.targets[0]?.provider).toHaveProperty('writeEnabled', false);
  });

  it('lets explicit target settings override legacy connection and write settings', () => {
    Object.assign(process.env, {
      FOUNDRY_URL: 'not-a-valid-legacy-url',
      FOUNDRY_API_KEY: 'unused-key',
      FOUNDRY_PASSWORD: 'unused-password',
      FOUNDRY_WRITE_ENABLED: 'true',
      FOUNDRY_TARGETS_JSON: JSON.stringify([
        { id: 'a', provider: { kind: 'socketio', baseUrl: 'https://a.test' } },
        { id: 'b', provider: { kind: 'socketio', baseUrl: 'https://b.test' } },
      ]),
    });
    expect(config.targets.map((target) => target.writeEnabled)).toEqual([false, false]);
    for (const target of config.targets) {
      expect(target.provider).not.toHaveProperty('apiKey');
      expect(target.provider).not.toHaveProperty('password');
    }
  });
});
