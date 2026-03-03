---
id: ADR-004
title: In-Memory World State Cache
status: accepted
created: 2026-03-03
---

# ADR-004: In-Memory World State Cache

## Context

FoundryVTT emits the full world state (actors, items, scenes, journals, combat, users, chat messages) once during the Socket.IO `joinGame` handshake. Subsequent real-time changes are broadcast as incremental events, but reliably tracking all of them adds significant complexity.

MCP tool calls from AI assistants are read-heavy and latency-sensitive. Making a Socket.IO round trip per tool invocation would add latency and coupling to FoundryVTT's availability for every query.

## Decision

Cache the full `WorldData` snapshot received at connection time in the `FoundryClient` instance as a private in-memory field (`this.worldData`). All read-path MCP tool handlers (search_actors, get_combat_state, etc.) query this cache rather than the live Socket.IO connection.

The `refresh_world_data` tool allows an AI assistant or user to explicitly trigger a reconnect and reload of the snapshot when stale data is suspected.

Cache settings (TTL, max size) are configurable via `CACHE_TTL_SECONDS` and `CACHE_MAX_SIZE` environment variables and validated via the Zod config schema.

## Consequences

**Positive:**
- All read queries are O(1) memory lookups with no network latency.
- The MCP server remains functional for reads if the FoundryVTT connection drops temporarily after initial load.
- Simple to reason about: one snapshot, one source of truth per session.

**Negative:**
- World data can become stale between the initial load and a manual `refresh_world_data` call. Combat state, token positions, and chat messages will lag behind live changes.
- The entire world state is held in process memory; very large worlds (thousands of actors/items) could increase memory pressure.
- Real-time reactivity (e.g., push notifications to the AI when combat state changes) is not supported with this model.
