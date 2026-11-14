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
  it('is true when /api/world answers with a JSON object', async () => {
    const client = clientWithGet(async () => ({ status: 200, data: { id: 'w', title: 'World' } }));
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
  it('is valid when /api/world answers with a JSON object', async () => {
    const client = clientWithGet(async () => ({ status: 200, data: { id: 'w', title: 'World' } }));
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
