/**
 * FoundryVTT authentication module
 *
 * Implements the proven 4-step authentication flow for direct WebSocket access:
 * 1. GET /join → session cookie
 * 2. Socket.IO connect + getJoinData → resolve user document _id
 * 3. POST /join as JSON with document _id → authenticated session
 * 4. Socket.IO reconnect with session → full game state access
 */

import axios from 'axios';
import type { ManagerOptions, SocketOptions } from 'socket.io-client';
import { io } from 'socket.io-client';
import { logger } from '../utils/logger.js';

/** Bounds every authentication stage and lets its owning connection cancel it. */
export interface FoundryAuthOptions {
  timeout?: number;
  signal?: AbortSignal;
}

/**
 * Socket.IO connection options carrying a FoundryVTT session.
 *
 * The session is sent twice, and both copies are load-bearing — do not drop
 * either. Per #231, FoundryVTT v14 resolves the session from the `session`
 * **cookie** on the handshake request, while v13 reads it from
 * `handshake.query` (not yet verified against a server; tracked in #253).
 * A socket whose server finds no session still connects at the transport
 * level — it simply never answers `getJoinData` and emits `session` as
 * `null` — so the only symptom of losing either copy is a bare timeout with
 * no `connect_error` (#206).
 *
 * `extraHeaders` is honoured by socket.io-client in Node.js for both the
 * WebSocket and polling handshakes.
 *
 * `path` is the server's Socket.IO endpoint (`FOUNDRY_SOCKET_PATH`): behind a
 * `routePrefix` it is `/<prefix>/socket.io/` (#231). Pair it with
 * {@link socketOrigin} — the URL handed to `io()` must not carry the prefix.
 */
export function sessionSocketOptions(
  session: string,
  path = '/socket.io/',
): Partial<ManagerOptions & SocketOptions> {
  return {
    transports: ['websocket'],
    path,
    query: { session },
    extraHeaders: { Cookie: `session=${session}` },
  };
}

/**
 * The URL to hand `io()` for a FoundryVTT base URL: its origin only.
 *
 * socket.io-client reads the URL's pathname as the **namespace**, not the
 * transport path, so `io('https://host/foundry')` would join namespace
 * `/foundry` instead of reaching a server behind a `routePrefix` (#231). The
 * prefix belongs in the `path` option ({@link sessionSocketOptions}); the
 * HTTP `/join` calls keep the full base URL.
 */
export function socketOrigin(baseUrl: string): string {
  return new URL(baseUrl).origin;
}

/**
 * Extracts the session cookie value from a GET /join response.
 */
async function getSessionCookie(baseUrl: string, options: FoundryAuthOptions): Promise<string> {
  options.signal?.throwIfAborted();
  const res = await axios.get(`${baseUrl}/join`, {
    // Matches the POST /join (#305); harmless here, and keeps both requests
    // looking like the same browser-origin login flow.
    headers: { Origin: socketOrigin(baseUrl) },
    // Accept 200 (join page) and 302 (redirect after cookie set)
    validateStatus: (status) => status === 200 || status === 302,
    maxRedirects: 0,
    timeout: options.timeout ?? 10000,
    ...(options.signal ? { signal: options.signal } : {}),
  });
  options.signal?.throwIfAborted();

  const cookies = res.headers['set-cookie'];
  if (!cookies) {
    throw new Error('No session cookie returned from /join');
  }

  const cookieString = Array.isArray(cookies) ? cookies.join(' ') : cookies;
  const match = cookieString.match(/session=([^;]+)/);
  if (!match?.[1]) {
    throw new Error('Could not extract session cookie from response');
  }

  logger.debug('Session cookie obtained');
  return match[1];
}

/**
 * Resolves a user identifier to a FoundryVTT document _id.
 *
 * If the input is already a 16-character alphanumeric string (document _id format),
 * returns it directly. Otherwise, connects via Socket.IO and emits getJoinData
 * to look up the _id by display name.
 */
async function resolveUserId(
  baseUrl: string,
  user: string,
  session: string,
  socketPath?: string,
  options: FoundryAuthOptions = {},
): Promise<string> {
  options.signal?.throwIfAborted();
  // FoundryVTT document IDs are 16-character alphanumeric strings
  if (/^[a-zA-Z0-9]{16}$/.test(user)) {
    logger.debug('User identifier is already a document _id', { userId: user });
    return user;
  }

  logger.debug('Resolving display name to document _id', { displayName: user });

  return new Promise((resolve, reject) => {
    const socket = io(socketOrigin(baseUrl), sessionSocketOptions(session, socketPath));
    let settled = false;
    let requested = false;

    const cleanup = () => {
      clearTimeout(timeout);
      socket.off('session', onSession);
      socket.off('connect_error', onConnectError);
      options.signal?.removeEventListener('abort', onAbort);
      socket.disconnect();
    };
    const fail = (error: unknown) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(error);
    };
    const onAbort = () => fail(options.signal?.reason ?? new Error('Authentication aborted'));
    const timeout = setTimeout(
      () => fail(new Error('Timeout resolving user ID via getJoinData')),
      options.timeout ?? 10000,
    );

    const onSession = () => {
      if (settled || requested) {
        return;
      }
      requested = true;
      try {
        socket.emit('getJoinData', (data: { users?: unknown[] } | null) => {
          if (settled) {
            return;
          }
          if (!Array.isArray(data?.users)) {
            fail(new Error('getJoinData returned no users'));
            return;
          }

          const users = data.users.filter(
            (value): value is { _id: string; name: string } =>
              typeof value === 'object' &&
              value !== null &&
              '_id' in value &&
              typeof value._id === 'string' &&
              value._id.length > 0 &&
              'name' in value &&
              typeof value.name === 'string',
          );
          const found = users.find((u) => u.name.toLowerCase() === user.toLowerCase());
          if (!found) {
            logger.debug('User not found in FoundryVTT user list', {
              available: users.map((u) => u.name).join(', '),
            });
            fail(new Error(`User "${user}" not found`));
            return;
          }

          settled = true;
          cleanup();
          logger.debug('Resolved user document _id', { displayName: user, _id: found._id });
          resolve(found._id);
        });
      } catch (error) {
        fail(error);
      }
    };

    const onConnectError = (err: Error) => {
      fail(new Error(`Socket.IO connection failed during user resolution: ${err.message}`));
    };

    options.signal?.addEventListener('abort', onAbort, { once: true });
    if (options.signal?.aborted) {
      onAbort();
      return;
    }
    socket.on('session', onSession);
    socket.on('connect_error', onConnectError);
  });
}

/**
 * Authenticates with FoundryVTT using the proven 4-step flow.
 *
 * @param socketPath Socket.IO endpoint for the user-resolution handshake;
 *   defaults to `/socket.io/` (see {@link sessionSocketOptions}).
 * @param options Timeout per HTTP/socket stage (default 10 seconds) and cancellation signal.
 * @returns Session cookie and resolved user document _id
 */
export async function authenticateFoundry(
  baseUrl: string,
  user: string,
  password: string,
  socketPath?: string,
  options: FoundryAuthOptions = {},
): Promise<{ session: string; userId: string }> {
  const authOptions = {
    ...options,
    timeout:
      options.timeout !== undefined && Number.isFinite(options.timeout) && options.timeout > 0
        ? options.timeout
        : 10000,
  };
  // Warn when credentials are sent over plaintext HTTP to a non-localhost host
  try {
    const parsed = new URL(baseUrl);
    // new URL('http://[::1]').hostname returns the bracketed form '[::1]';
    // strip IPv6 brackets so loopback comparison is uniform.
    const host = parsed.hostname.replace(/^\[|\]$/g, '');
    const isLocalhost = host === 'localhost' || host === '127.0.0.1' || host === '::1';
    if (parsed.protocol === 'http:' && !isLocalhost) {
      logger.warn(
        'WARNING: Connecting to a non-localhost host over plain HTTP. ' +
          'Your password will be transmitted in plaintext. ' +
          'Use HTTPS for non-local FoundryVTT instances.',
        { host: parsed.hostname },
      );
    }
  } catch {
    // URL already validated by config; ignore parse errors here
  }

  // Step 1: Get session cookie
  const session = await getSessionCookie(baseUrl, authOptions);

  // Step 2: Resolve user to document _id
  const userId = await resolveUserId(baseUrl, user, session, socketPath, authOptions);

  // Step 3: POST /join as JSON with document _id
  authOptions.signal?.throwIfAborted();
  const joinRes = await axios.post(
    `${baseUrl}/join`,
    {
      action: 'join',
      // Both spellings are deliberate — do not "de-duplicate" them (#222).
      // sessions.authenticateUser destructures the id straight off the body and
      // never validates a schema, so the spelling it does not read is simply
      // undefined and the other is ignored. Reading the shipped server bundles:
      // v13.348 and v14.364 both take `{ userid, password }`; #222 reports
      // v14.367 taking `{ userId, password }`. A key the server does not read
      // yields `db.User.get(undefined)` → HTTP 401 JOIN.ErrorUserDoesNotExist,
      // so sending only one spelling breaks whichever generation wants the other.
      userid: userId,
      userId: userId,
      password,
    },
    {
      timeout: authOptions.timeout,
      ...(authOptions.signal ? { signal: authOptions.signal } : {}),
      headers: {
        'Content-Type': 'application/json',
        Cookie: `session=${session}`,
        // FoundryVTT 14.369 answers a POST /join without an Origin header with
        // HTTP 400 {"error":"The request could not be processed."} (#305).
        // Origin is scheme + host + port only, so a routePrefix in baseUrl
        // must not be included.
        Origin: socketOrigin(baseUrl),
      },
      // Accept 200 (success JSON), 302 (redirect to /game on success), 400
      // (request rejected, e.g. the #305 origin check) and 401 (bad password).
      // 400 and 401 carry FoundryVTT's own explanation in the body; letting
      // axios throw on them would surface a bare
      // "Request failed with status code 4xx" instead (#206, #305).
      validateStatus: (status) =>
        status === 200 || status === 302 || status === 400 || status === 401,
    },
  );
  authOptions.signal?.throwIfAborted();

  if (joinRes.data?.status !== 'success' && joinRes.data?.redirect !== '/game') {
    // FoundryVTT v13+ answers a rejected /join with a plain-text i18n key
    // (e.g. "JOIN.ErrorInvalidPassword") rather than a JSON error object.
    const msg =
      (typeof joinRes.data === 'string' && joinRes.data.trim()) ||
      joinRes.data?.message ||
      joinRes.data?.error ||
      'Unknown error';
    throw new Error(`FoundryVTT authentication failed (HTTP ${joinRes.status}): ${msg}`);
  }

  logger.info('FoundryVTT authentication successful', { userId });
  return { session, userId };
}
