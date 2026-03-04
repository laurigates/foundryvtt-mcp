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
import { io } from 'socket.io-client';
import { logger } from '../utils/logger.js';

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
    const socket = io(baseUrl, {
      transports: ['websocket'],
      query: { session },
    });

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
    if (
      parsed.protocol === 'http:' &&
      parsed.hostname !== 'localhost' &&
      parsed.hostname !== '127.0.0.1' &&
      !parsed.hostname.startsWith('::1')
    ) {
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
      userid: userId,
      password,
    },
    {
      headers: {
        'Content-Type': 'application/json',
        Cookie: `session=${session}`,
      },
      // Accept 200 (success JSON) and 302 (redirect to /game on success)
      validateStatus: (status) => status === 200 || status === 302,
    },
  );

  if (joinRes.data?.status !== 'success' && joinRes.data?.redirect !== '/game') {
    const msg = joinRes.data?.message || joinRes.data?.error || 'Unknown error';
    throw new Error(`FoundryVTT authentication failed: ${msg}`);
  }

  logger.info('FoundryVTT authentication successful', { userId });
  return { session, userId };
}
