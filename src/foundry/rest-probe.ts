/**
 * REST-module probe, kept free of config and logger imports so that
 * `scripts/` entrypoints (setup wizard, API diagnostics) can import it before
 * any `.env` exists: importing `client.ts` resolves the whole config through
 * `utils/logger.ts` and exits when `FOUNDRY_URL` is unset (#255).
 */

import { z } from 'zod';

/** HTTP status of a rejected request, read reflectively; undefined without a response. */
function httpStatusOf(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }
  const response: unknown = Reflect.get(error, 'response');
  if (typeof response !== 'object' || response === null) {
    return undefined;
  }
  const status: unknown = Reflect.get(response, 'status');
  return typeof status === 'number' ? status : undefined;
}

/**
 * Shape the REST module's `/api/world` must answer with: a JSON object. Rejects
 * the HTML page, string, array or null that a server without the module (or a
 * proxy in front of it) can return with a 200. Extra fields pass through.
 */
const RestWorldProbeSchema = z.looseObject({});

/**
 * Proves the REST module is installed and accepts `FOUNDRY_API_KEY` (#230).
 *
 * `/api/status` cannot do this: Foundry core serves it unauthenticated, so a
 * 200 there says nothing about the module or the key. `/api/world` is a module
 * route that requires the key, and the body is validated rather than trusting
 * any 2xx. Shared by `FoundryClient.connect()`, the diagnostics probe and the
 * `scripts/` setup wizard and API diagnostics (#255).
 *
 * @param get - performs the GET (with the `x-api-key` header applied)
 * @returns the validated `/api/world` body
 * @throws Error naming the key on HTTP 401/403, or the missing module on any
 *   other HTTP status or a non-object body. A transport failure (no HTTP
 *   response) is rethrown unchanged so "server unreachable" stays visible.
 */
export async function probeRestModule(
  get: (url: string) => Promise<{ data: unknown }>,
): Promise<Record<string, unknown>> {
  const notJson =
    'FOUNDRY_API_KEY is set but the REST module did not answer /api/world with JSON ' +
    '(module missing or key rejected)';

  let data: unknown;
  try {
    ({ data } = await get('/api/world'));
  } catch (error) {
    const status = httpStatusOf(error);
    if (status === 401 || status === 403) {
      throw new Error(
        `FOUNDRY_API_KEY was rejected by the REST module at /api/world (HTTP ${status}); ` +
          'check the key configured in the module settings',
        { cause: error },
      );
    }
    if (status !== undefined) {
      throw new Error(`${notJson}: HTTP ${status}`, { cause: error });
    }
    throw error;
  }

  const parsed = RestWorldProbeSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error(`${notJson}: got ${data === null ? 'null' : typeof data} body`);
  }
  return parsed.data;
}
