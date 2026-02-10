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
    validateStatus: () => true,
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
async function resolveUserId(
  baseUrl: string,
  user: string,
  session: string,
): Promise<string> {
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

    const timeout = setTimeout(() => {
      socket.disconnect();
      reject(new Error('Timeout resolving user ID via getJoinData'));
    }, 10000);

    socket.on('session', () => {
      socket.emit('getJoinData', (data: { users?: Array<{ _id: string; name: string }> }) => {
        clearTimeout(timeout);
        socket.disconnect();

        if (!data?.users || !Array.isArray(data.users)) {
          return reject(new Error('getJoinData returned no users'));
        }

        const found = data.users.find(
          (u) => u.name.toLowerCase() === user.toLowerCase(),
        );
        if (!found) {
          const available = data.users.map((u) => u.name).join(', ');
          return reject(
            new Error(`User "${user}" not found. Available users: ${available}`),
          );
        }

        logger.debug('Resolved user document _id', { displayName: user, _id: found._id });
        resolve(found._id);
      });
    });

    socket.on('connect_error', (err) => {
      clearTimeout(timeout);
      socket.disconnect();
      reject(new Error(`Socket.IO connection failed during user resolution: ${err.message}`));
    });
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
      validateStatus: () => true,
    },
  );

  if (joinRes.data?.status !== 'success' && joinRes.data?.redirect !== '/game') {
    const msg = joinRes.data?.message || joinRes.data?.error || 'Unknown error';
    throw new Error(`FoundryVTT authentication failed: ${msg}`);
  }

  logger.info('FoundryVTT authentication successful', { userId });
  return { session, userId };
}
