/**
 * Unit tests for src/foundry/auth.ts edge cases (Issue #136).
 *
 * Covers:
 * - CN-3: plaintext HTTP warning emitted for non-localhost hosts only.
 * - CN-4: FOUNDRY_USER_ID shortcut bypasses the Socket.IO getJoinData lookup
 *         when a 16-char alphanumeric document _id is passed as the user.
 * - CN-7: schema-mismatched / unrelated upstream behaviors continue past
 *         non-fatal events. (For auth, this is the "warn-and-continue"
 *         pattern for the plaintext-HTTP check itself — the warning fires
 *         but authentication still completes.)
 */

import axios from 'axios';
import type { Socket } from 'socket.io-client';
import { io } from 'socket.io-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('axios');
vi.mock('socket.io-client');
vi.mock('../../utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const { authenticateFoundry, sessionSocketOptions } = await import('../auth.js');
const { logger } = await import('../../utils/logger.js');

const mockAxios = vi.mocked(axios);
const mockIo = vi.mocked(io);

/**
 * Builds a successful axios GET /join response that yields a session cookie.
 */
function mockJoinCookieResponse() {
  mockAxios.get = vi.fn().mockResolvedValue({
    status: 200,
    headers: { 'set-cookie': ['session=test-session-cookie; Path=/'] },
    data: {},
  });
}

/**
 * Builds a successful axios POST /join response.
 */
function mockJoinPostSuccess() {
  mockAxios.post = vi.fn().mockResolvedValue({
    status: 200,
    data: { status: 'success' },
  });
}

/**
 * Builds a minimal Socket.IO mock that fires the 'session' event immediately
 * so resolveUserId can issue getJoinData. Returns the emit spy so tests can
 * assert against it.
 */
function buildMockSocket(users: Array<{ _id: string; name: string }>) {
  const handlers = new Map<string, (...args: unknown[]) => void>();
  const emit = vi.fn((event: string, cb?: (data: unknown) => void) => {
    if (event === 'getJoinData' && cb) {
      cb({ users });
    }
  });
  const socket = {
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      handlers.set(event, handler);
      // Fire 'session' synchronously on registration to drive the flow.
      if (event === 'session') {
        queueMicrotask(() => handler());
      }
      return socket;
    }),
    off: vi.fn(),
    emit,
    disconnect: vi.fn(),
  } as unknown as Socket;
  return { socket, emit };
}

describe('authenticateFoundry — plaintext HTTP warning (CN-3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockJoinCookieResponse();
    mockJoinPostSuccess();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('warns when connecting over http:// to a non-localhost host', async () => {
    // 16-char alphanumeric user bypasses socket lookup (CN-4 shortcut), so
    // this test isolates the warning logic without needing a socket mock.
    await authenticateFoundry('http://example.com', 'aaaaaaaaaaaaaaaa', 'pw');

    const warnCalls = vi.mocked(logger.warn).mock.calls;
    expect(warnCalls.length).toBeGreaterThan(0);
    const [firstMessage, firstContext] = warnCalls[0] ?? [];
    expect(String(firstMessage)).toContain('WARNING');
    expect(String(firstMessage)).toMatch(/plain ?HTTP|plaintext/i);
    expect(firstContext).toMatchObject({ host: 'example.com' });
  });

  it('does NOT warn for http://localhost', async () => {
    await authenticateFoundry('http://localhost:30000', 'aaaaaaaaaaaaaaaa', 'pw');
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('does NOT warn for http://127.0.0.1', async () => {
    await authenticateFoundry('http://127.0.0.1:30000', 'aaaaaaaaaaaaaaaa', 'pw');
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('does NOT warn for http://[::1] (bracketed IPv6 loopback)', async () => {
    // new URL('http://[::1]').hostname returns '[::1]' (with brackets). The
    // guard canonicalizes by stripping the brackets so the IPv6 loopback form
    // is recognized as localhost and no plaintext-HTTP warning is emitted.
    await authenticateFoundry('http://[::1]:30000', 'aaaaaaaaaaaaaaaa', 'pw');
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('does NOT warn for https:// (non-plaintext)', async () => {
    await authenticateFoundry('https://example.com', 'aaaaaaaaaaaaaaaa', 'pw');
    expect(logger.warn).not.toHaveBeenCalled();
  });
});

describe('authenticateFoundry — FOUNDRY_USER_ID shortcut (CN-4)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockJoinCookieResponse();
    mockJoinPostSuccess();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('skips Socket.IO getJoinData when user is a 16-char alphanumeric _id', async () => {
    // If the shortcut works, socket.io-client's io() must never be called.
    mockIo.mockImplementation(() => {
      throw new Error('socket.io-client should not be invoked for userId shortcut');
    });

    const { session, userId } = await authenticateFoundry(
      'http://localhost:30000',
      'abc123DEF456ghij', // exactly 16 alphanumeric chars
      'pw',
    );

    expect(userId).toBe('abc123DEF456ghij');
    expect(session).toBe('test-session-cookie');
    expect(mockIo).not.toHaveBeenCalled();
  });

  it('falls back to Socket.IO lookup when user is NOT a 16-char _id', async () => {
    const { socket, emit } = buildMockSocket([{ _id: 'resolvedDocId123', name: 'Gamemaster' }]);
    mockIo.mockReturnValue(socket);

    const { userId } = await authenticateFoundry('http://localhost:30000', 'Gamemaster', 'pw');

    expect(mockIo).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith('getJoinData', expect.any(Function));
    expect(userId).toBe('resolvedDocId123');
  });
});

describe('authenticateFoundry — warn-and-continue (CN-7 analogue)', () => {
  /**
   * Mirrors the schema-mismatch warn-and-continue pattern from client.ts:
   * for auth.ts, the plaintext-HTTP warning is the non-fatal event. Verify
   * the warning fires AND authentication still completes successfully.
   */

  beforeEach(() => {
    vi.clearAllMocks();
    mockJoinCookieResponse();
    mockJoinPostSuccess();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('emits warning AND still returns a valid session+userId', async () => {
    const result = await authenticateFoundry('http://example.com', 'abc123DEF456ghij', 'pw');

    // Warning fired (non-fatal).
    expect(logger.warn).toHaveBeenCalled();

    // Auth completed.
    expect(result).toEqual({
      session: 'test-session-cookie',
      userId: 'abc123DEF456ghij',
    });
    expect(mockAxios.post).toHaveBeenCalledWith(
      'http://example.com/join',
      expect.objectContaining({
        action: 'join',
        userid: 'abc123DEF456ghij',
        password: 'pw',
      }),
      expect.any(Object),
    );
  });

  it('swallows URL parse errors without aborting (try/catch around the warning)', async () => {
    // Pass an invalid URL: new URL() throws, but the catch block swallows it
    // and getSessionCookie below is what actually rejects. We assert the
    // logger.warn is NOT called (since the parse failed before the warn
    // check) and that auth.ts surfaces the downstream error cleanly.
    mockAxios.get = vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED'));

    await expect(authenticateFoundry('not a real url', 'abc123DEF456ghij', 'pw')).rejects.toThrow();

    expect(logger.warn).not.toHaveBeenCalled();
  });
});

describe('authenticateFoundry — session cookie on the Socket.IO handshake (#206)', () => {
  /**
   * FoundryVTT resolves the session from the `session` cookie on the handshake
   * request. Sending it only as a query parameter leaves the socket anonymous:
   * it connects, `connect_error` never fires, and `getJoinData` is simply never
   * answered — so the only symptom is the 10s timeout in resolveUserId.
   */

  beforeEach(() => {
    vi.clearAllMocks();
    mockJoinCookieResponse();
    mockJoinPostSuccess();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('passes the session as a Cookie header, not only as a query param', async () => {
    const { socket } = buildMockSocket([{ _id: 'resolvedDocId123', name: 'Gamemaster' }]);
    mockIo.mockReturnValue(socket);

    await authenticateFoundry('http://localhost:30000', 'Gamemaster', 'pw');

    expect(mockIo).toHaveBeenCalledWith(
      'http://localhost:30000',
      expect.objectContaining({
        extraHeaders: { Cookie: 'session=test-session-cookie' },
        query: { session: 'test-session-cookie' },
      }),
    );
  });
});

describe('sessionSocketOptions (#206)', () => {
  it('carries the session in both the Cookie header and the query param', () => {
    expect(sessionSocketOptions('abc123')).toEqual({
      transports: ['websocket'],
      query: { session: 'abc123' },
      extraHeaders: { Cookie: 'session=abc123' },
    });
  });
});

describe('authenticateFoundry — rejected /join is reported, not thrown raw (#206)', () => {
  /**
   * FoundryVTT v13+ answers a rejected /join with HTTP 401 and a plain-text
   * i18n key body (e.g. "JOIN.ErrorInvalidPassword"). Without 401 in
   * validateStatus axios throws first, surfacing a bare
   * "Request failed with status code 401" that says nothing about the cause.
   */

  beforeEach(() => {
    vi.clearAllMocks();
    mockJoinCookieResponse();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('surfaces FoundryVTT’s plain-text 401 body in the error message', async () => {
    mockAxios.post = vi.fn().mockResolvedValue({
      status: 401,
      data: 'JOIN.ErrorInvalidPassword',
    });

    await expect(
      authenticateFoundry('http://localhost:30000', 'abc123DEF456ghij', 'wrong'),
    ).rejects.toThrow('FoundryVTT authentication failed (HTTP 401): JOIN.ErrorInvalidPassword');
  });

  it('accepts 401 as a readable status rather than letting axios throw', async () => {
    mockAxios.post = vi.fn().mockResolvedValue({ status: 401, data: 'JOIN.ErrorInvalidPassword' });

    await expect(
      authenticateFoundry('http://localhost:30000', 'abc123DEF456ghij', 'wrong'),
    ).rejects.toThrow();

    const validateStatus = mockAxios.post.mock.calls[0]?.[2]?.validateStatus;
    expect(validateStatus?.(401)).toBe(true);
    expect(validateStatus?.(200)).toBe(true);
    expect(validateStatus?.(302)).toBe(true);
    expect(validateStatus?.(500)).toBe(false);
  });

  it('still surfaces a JSON { message } body when the server sends one', async () => {
    mockAxios.post = vi.fn().mockResolvedValue({
      status: 200,
      data: { status: 'failed', message: 'You may not join this world' },
    });

    await expect(
      authenticateFoundry('http://localhost:30000', 'abc123DEF456ghij', 'pw'),
    ).rejects.toThrow('FoundryVTT authentication failed (HTTP 200): You may not join this world');
  });
});

describe('authenticateFoundry — POST /join body key spellings (#222)', () => {
  /**
   * The /join body key is a wire-format contract: the server destructures it by
   * name and never validates a schema, so a key it does not read is silently
   * undefined rather than rejected. Both spellings are sent, and this test pins
   * both — a later "cleanup" of the apparent duplicate must go red.
   *
   * Driven through the display-name path so the posted value is the *resolved*
   * document _id rather than the caller's input. The existing assertions cannot
   * make that distinction: they read back the same local variable auth.ts posts.
   */

  beforeEach(() => {
    vi.clearAllMocks();
    mockJoinCookieResponse();
    mockJoinPostSuccess();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('posts the resolved document _id under BOTH userid and userId', async () => {
    const { socket } = buildMockSocket([{ _id: 'resolvedDocId123', name: 'Gamemaster' }]);
    mockIo.mockReturnValue(socket);

    await authenticateFoundry('http://localhost:30000', 'Gamemaster', 'pw');

    expect(mockAxios.post).toHaveBeenCalledWith(
      'http://localhost:30000/join',
      {
        action: 'join',
        userid: 'resolvedDocId123',
        userId: 'resolvedDocId123',
        password: 'pw',
      },
      expect.any(Object),
    );
  });
});
