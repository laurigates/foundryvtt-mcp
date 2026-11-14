import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `scripts/` is outside the tsc surface (see .claude/rules/scripts-typecheck-gap.md).
 * These tests pin how `scripts/setup-wizard.ts` and `scripts/diagnose-api.ts`
 * decide that the REST module works (#255): Foundry core serves `/api/status`
 * unauthenticated (#230), so a server without the module answers 200 there
 * and 200 with an HTML page elsewhere. Neither may count as a working module.
 */

const HTML_PAGE = '<!DOCTYPE html><html><body>Foundry Virtual Tabletop</body></html>';

/** Every request answers 200 with an HTML page: core Foundry, no REST module. */
const coreOnlyResponse = { status: 200, data: HTML_PAGE, headers: {} };

const axiosCall = vi.fn();
const axiosGet = vi.fn();

vi.mock('axios', () => {
  const axios = Object.assign((...args: unknown[]) => axiosCall(...args), {
    get: (...args: unknown[]) => axiosGet(...args),
    isAxiosError: (error: unknown) =>
      typeof error === 'object' && error !== null && Reflect.get(error, 'isAxiosError') === true,
  });
  return { default: axios };
});

/** Stops the wizard's constructor from attaching readline to the test's stdin. */
vi.mock('readline', () => ({
  createInterface: () => ({ question: vi.fn(), close: vi.fn() }),
}));

function capturedLog(spy: ReturnType<typeof vi.spyOn>): string {
  return spy.mock.calls.map((args: unknown[]) => args.map(String).join(' ')).join('\n');
}

describe('scripts/setup-wizard.ts REST module check (#255)', () => {
  beforeEach(() => {
    axiosCall.mockReset();
    axiosGet.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * Step 5 (`testAuthentication`, private) of a wizard already past steps 1-4
   * with an API key, reached reflectively so the test skips the prompts.
   */
  async function apiKeyAuthStep(): Promise<() => Promise<unknown>> {
    const { SetupWizard } = await import('../../scripts/setup-wizard.js');
    const wizard = new SetupWizard();
    Reflect.set(wizard, 'config', {
      foundryUrl: 'http://foundry.test',
      authMethod: 'api-key',
      apiKey: 'any-key',
    });
    const step: unknown = Reflect.get(wizard, 'testAuthentication');
    if (typeof step !== 'function') {
      throw new Error('SetupWizard.testAuthentication is missing');
    }
    return () => Promise.resolve(Reflect.apply(step, wizard, []));
  }

  it('rejects a core-only server that answers 200 with HTML', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    axiosGet.mockResolvedValue(coreOnlyResponse);
    const testAuthentication = await apiKeyAuthStep();

    await expect(testAuthentication()).rejects.toThrow(/\/api\/world/);
  });

  it('accepts the key only when /api/world answers with a JSON object', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    axiosGet.mockResolvedValue({ status: 200, data: { title: 'My World' }, headers: {} });
    const testAuthentication = await apiKeyAuthStep();

    await testAuthentication();

    expect(axiosGet).toHaveBeenCalledWith(
      'http://foundry.test/api/world',
      expect.objectContaining({ headers: { 'x-api-key': 'any-key' } }),
    );
    expect(axiosGet).not.toHaveBeenCalledWith(
      expect.stringContaining('/api/status'),
      expect.anything(),
    );
    expect(capturedLog(log)).toContain('My World');
  });
});

describe('scripts/diagnose-api.ts REST module verdict (#255)', () => {
  beforeEach(() => {
    axiosCall.mockReset();
    axiosGet.mockReset();
    vi.resetModules();
    vi.stubEnv('FOUNDRY_URL', 'http://foundry.test');
    vi.stubEnv('FOUNDRY_API_KEY', 'any-key');
    vi.useFakeTimers({ toFake: ['setTimeout'] });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  async function runWithAdvancingTimers(): Promise<string> {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { runDiagnostics } = await import('../../scripts/diagnose-api.js');
    const done = runDiagnostics();
    await vi.runAllTimersAsync();
    await done;
    return capturedLog(log);
  }

  it('does not report the REST module as working on a core-only server', async () => {
    axiosCall.mockResolvedValue(coreOnlyResponse);
    axiosGet.mockResolvedValue(coreOnlyResponse);

    const output = await runWithAdvancingTimers();

    expect(output).not.toMatch(/REST API module is (likely installed|properly configured)/);
    expect(output).toContain('REST API module check failed');
    expect(output).not.toContain('API authentication is working');
  });

  it('reports the REST module as working when /api/world answers with a JSON object', async () => {
    axiosCall.mockResolvedValue({ status: 200, data: { ok: true }, headers: {} });
    axiosGet.mockResolvedValue({ status: 200, data: { title: 'My World' }, headers: {} });

    const output = await runWithAdvancingTimers();

    expect(axiosGet).toHaveBeenCalledWith(
      'http://foundry.test/api/world',
      expect.objectContaining({ headers: expect.objectContaining({ 'x-api-key': 'any-key' }) }),
    );
    expect(output).toContain('REST API module is properly configured');
  });
});
