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

/**
 * Socket.IO connection options carrying a FoundryVTT session.
 *
 * FoundryVTT resolves the session from the `session` **cookie** on the
 * handshake request; the `session` query parameter alone leaves the socket
 * anonymous. An anonymous socket still connects at the transport level — it
 * simply never answers `getJoinData` and emits `session` as `null` — so the
 * only symptom is a bare timeout with no `connect_error` (#206).
 *
 * `extraHeaders` is honoured by socket.io-client in Node.js for both the
 * WebSocket and polling handshakes; the query parameter is kept for servers
 * that read it.
 */
export function sessionSocketOptions(session: string): Partial<ManagerOptions & SocketOptions> {
  return {
    transports: ['websocket'],
    query: { session },
    extraHeaders: { Cookie: `session=${session}` },
  };
}

/**
 * Extracts the session cookie value from a GET /join response.
 */
async function getSessionCookie(baseUrl: string): Promise<string> {
  const res = await axios.get(`${baseUrl}/join`, {
    // Accept 200 (join page) and 302 (redirect after cookie set)
    validateStatus: (status) => status === 200 || status === 302,
    maxRedirects: 0,
  });

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
async function resolveUserId(baseUrl: string, user: string, session: string): Promise<string> {
  // FoundryVTT document IDs are 16-character alphanumeric strings
  if (/^[a-zA-Z0-9]{16}$/.test(user)) {
    logger.debug('User identifier is already a document _id', { userId: user });
    return user;
  }

  logger.debug('Resolving display name to document _id', { displayName: user });

  return new Promise((resolve, reject) => {
    const socket = io(baseUrl, sessionSocketOptions(session));

    const cleanup = () => {
      socket.off('session', onSession);
      socket.off('connect_error', onConnectError);
    };

    const timeout = setTimeout(() => {
      cleanup();
      socket.disconnect();
      reject(new Error('Timeout resolving user ID via getJoinData'));
    }, 10000);

    const onSession = () => {
      socket.emit('getJoinData', (data: { users?: Array<{ _id: string; name: string }> }) => {
        clearTimeout(timeout);
        cleanup();
        socket.disconnect();

        if (!data?.users || !Array.isArray(data.users)) {
          return reject(new Error('getJoinData returned no users'));
        }

        const found = data.users.find((u) => u.name.toLowerCase() === user.toLowerCase());
        if (!found) {
          const available = data.users.map((u) => u.name).join(', ');
          logger.debug('User not found in FoundryVTT user list', { available });
          return reject(new Error(`User "${user}" not found`));
        }

        logger.debug('Resolved user document _id', { displayName: user, _id: found._id });
        resolve(found._id);
      });
    };

    const onConnectError = (err: Error) => {
      clearTimeout(timeout);
      cleanup();
      socket.disconnect();
      reject(new Error(`Socket.IO connection failed during user resolution: ${err.message}`));
    };

    socket.on('session', onSession);
    socket.on('connect_error', onConnectError);
  });
}

/**
 * Authenticates with FoundryVTT using the proven 4-step flow.
 *
 * @returns Session cookie and resolved user document _id
 */
export async function authenticateFoundry(
  baseUrl: string,
  user: string,
  password: string,
): Promise<{ session: string; userId: string }> {
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
  const session = await getSessionCookie(baseUrl);

  // Step 2: Resolve user to document _id
  const userId = await resolveUserId(baseUrl, user, session);

  // Step 3: POST /join as JSON with document _id
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
      headers: {
        'Content-Type': 'application/json',
        Cookie: `session=${session}`,
      },
      // Accept 200 (success JSON), 302 (redirect to /game on success) and 401
      // (bad password). 401 carries FoundryVTT's own explanation in the body;
      // letting axios throw on it would surface a bare
      // "Request failed with status code 401" instead (#206).
      validateStatus: (status) => status === 200 || status === 302 || status === 401,
    },
  );

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
