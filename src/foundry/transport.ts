/**
 * Which connections the client opens, decided from configuration alone.
 *
 * - `socket`: Socket.IO only (the default). Reads from `worldData`, writes via
 *   `modifyDocument`, live broadcasts.
 * - `dual`: Socket.IO stays primary; the REST bridge (the
 *   foundryvtt-local-rest-api module's Node server, `:3030` by default) is an
 *   optional augment for what only code running inside Foundry can see:
 *   prepared (derived) actor values, compendium search, logs, system health.
 * - `rest`: the deprecated REST-only mode, kept so a configuration that set
 *   `FOUNDRY_API_KEY` without Socket.IO credentials behaves as it did.
 *
 * Kept free of config and logger imports, like `rest-probe.ts`, so scripts can
 * use it before any `.env` exists.
 */

export type TransportMode = 'socket' | 'dual' | 'rest';

export interface TransportSettings {
  /** FOUNDRY_URL: the Foundry server (Socket.IO). */
  url: string;
  /** FOUNDRY_API_KEY: the REST bridge key. */
  apiKey?: string | undefined;
  /** FOUNDRY_REST_URL: the REST bridge server. */
  restUrl?: string | undefined;
  username?: string | undefined;
  userId?: string | undefined;
  password?: string | undefined;
}

export interface TransportPlan {
  mode: TransportMode;
  /** Base URL for REST requests; absent in `socket` mode. */
  restBaseUrl?: string;
  /** Configuration problems to log once at startup. */
  warnings: string[];
}

const REST_ONLY_DEPRECATION =
  'REST-only mode (FOUNDRY_API_KEY without FOUNDRY_USERNAME/FOUNDRY_USER_ID and ' +
  'FOUNDRY_PASSWORD) is deprecated: it has no writes, combat, journals, chat or live updates. ' +
  'Add Socket.IO credentials and set FOUNDRY_REST_URL to the bridge server for dual mode.';

const MISSING_REST_URL =
  'FOUNDRY_API_KEY is set together with Socket.IO credentials but FOUNDRY_REST_URL is not, ' +
  'so the deprecated REST-only mode is used and FOUNDRY_URL is treated as the bridge. ' +
  'Set FOUNDRY_URL to the Foundry server and FOUNDRY_REST_URL to the bridge server ' +
  '(e.g. http://localhost:3030) for dual mode.';

const REST_URL_WITHOUT_KEY =
  'FOUNDRY_REST_URL is set but FOUNDRY_API_KEY is not; the REST bridge augment stays off.';

/** Decide the transport mode and REST base URL; empty strings count as unset. */
export function resolveTransportPlan(settings: TransportSettings): TransportPlan {
  const apiKey = settings.apiKey || undefined;
  const restUrl = settings.restUrl || undefined;
  const hasSocketCredentials = Boolean((settings.username || settings.userId) && settings.password);

  if (!apiKey) {
    return { mode: 'socket', warnings: restUrl ? [REST_URL_WITHOUT_KEY] : [] };
  }
  if (restUrl && hasSocketCredentials) {
    return { mode: 'dual', restBaseUrl: restUrl, warnings: [] };
  }
  return {
    mode: 'rest',
    restBaseUrl: restUrl ?? settings.url,
    warnings: [hasSocketCredentials ? MISSING_REST_URL : REST_ONLY_DEPRECATION],
  };
}
