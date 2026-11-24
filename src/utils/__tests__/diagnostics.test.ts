import { describe, expect, it, vi } from 'vitest';

vi.mock('../logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../config/index.js', () => ({
  config: { logLevel: 'info', foundry: { apiKey: 'test-api-key' } },
}));

const { DiagnosticSystem } = await import('../diagnostics.js');
const { FoundryClient } = await import('../../foundry/client.js');

/** A real REST-mode FoundryClient whose `get` is replaced; no request leaves the process. */
function clientWithGet(get: (url: string) => Promise<{ status: number; data: unknown }>) {
  const client = new FoundryClient({
    baseUrl: 'http://localhost:30000',
    apiKey: 'test-api-key',
  });
  vi.spyOn(client, 'get').mockImplementation(get as typeof client.get);
  return client;
}

/** `testRestApiAvailability` is private; reach it reflectively. */
function probe(system: InstanceType<typeof DiagnosticSystem>): Promise<boolean> {
  const fn = Reflect.get(system, 'testRestApiAvailability') as () => Promise<boolean>;
  return fn.call(system);
}

describe('DiagnosticSystem.testRestApiAvailability (#230)', () => {
  it('is true when /api/world answers with the module envelope', async () => {
    const client = clientWithGet(async () => ({
      status: 200,
      data: { success: true, data: { id: 'w', title: 'World' } },
    }));
    await expect(probe(new DiagnosticSystem(client))).resolves.toBe(true);
    expect(client.get).toHaveBeenCalledWith('/api/world');
    expect(client.get).not.toHaveBeenCalledWith('/api/status');
  });

  it('is false when /api/world answers 200 with HTML (no REST module)', async () => {
    const client = clientWithGet(async () => ({ status: 200, data: '<html></html>' }));
    await expect(probe(new DiagnosticSystem(client))).resolves.toBe(false);
  });

  it('is false when the key is rejected', async () => {
    const client = clientWithGet(async () => {
      throw Object.assign(new Error('Request failed with status code 401'), {
        response: { status: 401 },
      });
    });
    await expect(probe(new DiagnosticSystem(client))).resolves.toBe(false);
  });

  it('is false when /api/world answers 200 with a null body', async () => {
    // Guards against a probe that only checks "some 2xx came back".
    const client = clientWithGet(async () => ({ status: 200, data: null }));
    await expect(probe(new DiagnosticSystem(client))).resolves.toBe(false);
  });
});

type AuthResult = { valid: boolean; error?: string };

/** `testAuthentication` is private; reach it reflectively. */
function authenticate(system: InstanceType<typeof DiagnosticSystem>): Promise<AuthResult> {
  const fn = Reflect.get(system, 'testAuthentication') as () => Promise<AuthResult>;
  return fn.call(system);
}

describe('DiagnosticSystem.testAuthentication, REST mode (#230)', () => {
  it('is valid when /api/world answers with the module envelope', async () => {
    const client = clientWithGet(async () => ({
      status: 200,
      data: { success: true, data: { id: 'w', title: 'World' } },
    }));
    await expect(authenticate(new DiagnosticSystem(client))).resolves.toEqual({ valid: true });
    expect(client.get).toHaveBeenCalledWith('/api/world');
  });

  it('is not valid when /api/world answers 200 with HTML (no REST module)', async () => {
    const client = clientWithGet(async () => ({ status: 200, data: '<html></html>' }));
    const result = await authenticate(new DiagnosticSystem(client));
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/did not answer \/api\/world with JSON/);
  });

  it('is not valid and names the key when /api/world answers 401', async () => {
    const client = clientWithGet(async () => {
      throw Object.assign(new Error('Request failed with status code 401'), {
        response: { status: 401 },
      });
    });
    const result = await authenticate(new DiagnosticSystem(client));
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/FOUNDRY_API_KEY was rejected.*HTTP 401/);
  });
});

/**
 * A REST-mode client whose transport answers /api/world with `status`, so
 * `testConnection()` rejects through the real `connect()` → `probeRestModule`.
 */
function clientRejectingConnect(status: number) {
  const client = new FoundryClient({ baseUrl: 'http://localhost:30000', apiKey: 'test-api-key' });
  const http = Reflect.get(client, 'rest') as { get: (url: string) => Promise<unknown> };
  vi.spyOn(http, 'get').mockRejectedValue(
    Object.assign(new Error(`Request failed with status code ${status}`), {
      response: { status },
    }),
  );
  return client;
}

describe('DiagnosticSystem.diagnoseFeatureProblem, rejected API key (#301)', () => {
  it.each([401, 403])('keeps the rejection cause for HTTP %i (#288)', async (status) => {
    const result = await new DiagnosticSystem(
      clientRejectingConnect(status),
    ).diagnoseFeatureProblem('actors');
    expect(result.explanation).toMatch(new RegExp(`FOUNDRY_API_KEY was rejected.*HTTP ${status}`));
  });

  it('reports an API-key authentication failure, not an unexpected error', async () => {
    const result = await new DiagnosticSystem(clientRejectingConnect(401)).diagnoseFeatureProblem(
      'actors',
    );
    expect(result.explanation).toMatch(/^Authentication failed using API key/);
    expect(result.explanation).not.toMatch(/unexpected error/);
    expect(result.suggestions).toMatch(/Check API key/);
    expect(result.suggestions).toMatch(/REST API module is enabled/);
    expect(result.suggestions).not.toMatch(/Restart services/);
    expect(result.documentationUrl).toMatch(/#authentication-issues$/);
  });

  it('still uses the generic diagnostic when the module is missing (HTTP 404)', async () => {
    const result = await new DiagnosticSystem(clientRejectingConnect(404)).diagnoseFeatureProblem(
      'actors',
    );
    expect(result.explanation).toMatch(/unexpected error.*did not answer \/api\/world with JSON/);
  });
});

/** `testDiceRolling` is private; reach it reflectively. */
function rollCheck(system: InstanceType<typeof DiagnosticSystem>): Promise<boolean> {
  const fn = Reflect.get(system, 'testDiceRolling') as () => Promise<boolean>;
  return fn.call(system);
}

/** A REST-mode client whose `rollDice` answers with the given source. */
function clientRolling(source: 'server' | 'local') {
  const client = new FoundryClient({ baseUrl: 'http://localhost:30000', apiKey: 'test-api-key' });
  vi.spyOn(client, 'rollDice').mockResolvedValue({
    formula: '1d20',
    total: 11,
    breakdown: '1d20: [11]',
    timestamp: new Date().toISOString(),
    source,
  });
  return client;
}

describe('DiagnosticSystem.testDiceRolling, REST mode (#265)', () => {
  it('passes on a server roll', async () => {
    await expect(rollCheck(new DiagnosticSystem(clientRolling('server')))).resolves.toBe(true);
  });

  it('fails on a local fallback roll', async () => {
    await expect(rollCheck(new DiagnosticSystem(clientRolling('local')))).resolves.toBe(false);
  });
});

describe('DiagnosticSystem.testDiceRolling, Socket.IO mode (#265)', () => {
  it('passes on a local roll, which is the only kind this mode makes', async () => {
    const { config } = await import('../../config/index.js');
    const saved = config.foundry.apiKey;
    Reflect.deleteProperty(config.foundry, 'apiKey');
    try {
      await expect(rollCheck(new DiagnosticSystem(clientRolling('local')))).resolves.toBe(true);
    } finally {
      Reflect.set(config.foundry, 'apiKey', saved);
    }
  });
});
