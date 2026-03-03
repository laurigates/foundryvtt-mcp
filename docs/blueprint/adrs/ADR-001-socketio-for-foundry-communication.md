---
id: ADR-001
title: Socket.IO for FoundryVTT Communication
status: accepted
created: 2026-03-03
---

# ADR-001: Socket.IO for FoundryVTT Communication

## Context

FoundryVTT does not expose a documented public REST API for world data. It is a browser-based application that communicates with its Node.js server over Socket.IO WebSockets. To access game state (actors, items, scenes, combat, etc.) without a custom module, a client must speak the same Socket.IO protocol the FoundryVTT browser client uses.

An alternative approach using a custom FoundryVTT module with its own REST API (see PRD-002) requires users to install and maintain a module, creating an optional dependency that should not be mandatory for core functionality.

## Decision

Use `socket.io-client` (v4.x) to connect directly to the FoundryVTT Socket.IO server. Implement a 4-step authentication flow that mirrors the browser login process:

1. GET `/join` to obtain a session cookie.
2. Connect via Socket.IO with the session cookie and emit `getJoinData` to resolve the username to a FoundryVTT document `_id`.
3. POST `/join` with the document `_id` and password to create an authenticated session.
4. Reconnect via Socket.IO with the authenticated session to receive the full world state.

## Consequences

**Positive:**
- No custom FoundryVTT module required for core functionality.
- Full world state (actors, items, scenes, journals, combat, users, chat) is received in a single `joinGame` response event.
- The approach works with any FoundryVTT version that uses Socket.IO (v10+).

**Negative:**
- The authentication flow reverse-engineers internal FoundryVTT behavior and may break across major FoundryVTT versions.
- No official support or stability guarantees from the FoundryVTT team for this approach.
- Write operations (creating/modifying documents) are not exposed through Socket.IO in the same way, limiting mutation capabilities.
