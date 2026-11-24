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
 * The REST module refused `FOUNDRY_API_KEY` (HTTP 401/403). A distinct class
 * so diagnostics can report it as an authentication failure (#301).
 */
export class RestKeyRejectedError extends Error {
  override name = 'RestKeyRejectedError';
}

/**
 * `/api/world` answered 2xx with a body that is not the module's envelope: an
 * incompatible server or module version. A distinct class so the client can
 * tell "answered, unusably" from "not reachable".
 */
export class RestProbeResponseError extends Error {
  override name = 'RestProbeResponseError';
}

/**
 * What the module's `/api/world` must answer with: its `{ success: true, data }`
 * envelope around the world object (`WorldAPI.getWorldInfo`). A bare JSON
 * object is not enough (#310): any JSON server returns one, and the MCP used
 * to read that as "connected" and then every field as missing.
 */
const RestWorldProbeSchema = z.looseObject({
  success: z.literal(true),
  data: z.looseObject({}),
});

/**
 * Proves the REST module is installed and accepts `FOUNDRY_API_KEY` (#230).
 *
 * `/api/status` cannot do this: Foundry core serves it unauthenticated, so a
 * 200 there says nothing about the module or the key. `/api/world` is a module
 * route that requires the key, and the body is validated rather than trusting
 * any 2xx: it must be the module's `{ success: true, data: {...} }` envelope. Shared by `FoundryClient.connect()`, the diagnostics probe and the
 * `scripts/` setup wizard and API diagnostics (#255).
 *
 * @param get - performs the GET (with the `x-api-key` header applied)
 * @returns the world object from the envelope's `data`
 * @throws Error naming the key on HTTP 401/403, the missing module on any
 *   other HTTP status or a non-object body, or an incompatible server for a
 *   JSON object without the envelope. A transport failure (no HTTP
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
      throw new RestKeyRejectedError(
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

  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    const got = data === null ? 'null' : Array.isArray(data) ? 'array' : typeof data;
    throw new RestProbeResponseError(`${notJson}: got ${got} body`);
  }
  const parsed = RestWorldProbeSchema.safeParse(data);
  if (!parsed.success) {
    throw new RestProbeResponseError(
      "FOUNDRY_API_KEY is set but /api/world did not answer with the REST module's " +
        '{success: true, data} envelope (another server, an incompatible module version, ' +
        'or the module reported a failure)',
    );
  }
  return parsed.data.data;
}
