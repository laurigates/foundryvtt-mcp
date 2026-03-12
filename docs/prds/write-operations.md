# PRD-003: Write Operations — Game State Mutation

**Status**: Planned
**Created**: 2026-03-12
**Source**: docs/blueprint/feature-tracker.json (FR-018 through FR-024)
**Confidence**: 8/10

## Overview

Extend the foundryvtt-mcp server with write operations that allow AI assistants to actively participate in game sessions — not just observe. This includes combat management, token manipulation, scene navigation, character sheet editing, journal management, macro execution, and multi-world support.

## Problem Statement

The current implementation (v1.0.0) is entirely read-only. AI assistants can observe world state but cannot:
- Take actions during combat (start/end combat, advance turns)
- Move tokens or apply status effects
- Navigate the GM between scenes
- Edit character sheets or journal entries
- Execute macros or custom scripts
- Switch between worlds

This limits the AI assistant role to "observer with suggestions" rather than "active collaborator."

## Goals

1. Enable AI assistants to take game-meaningful write actions during sessions
2. Maintain backward compatibility — all read operations unchanged
3. Implement proper authorization to prevent unintended mutations
4. Support the most impactful write operations first (combat management)

## Non-Goals

- Full GM parity — not every FoundryVTT UI action needs an MCP tool
- Real-time sync / reactive world updates (separate concern)
- Multi-instance support (single server connection)

## Features

### FR-018: Combat Management (Priority: High)

**As a** GM using an AI assistant,
**I want** to start/end combat encounters and advance initiative via MCP tools,
**So that** the AI can help manage encounter flow.

Acceptance criteria:
- `start_combat` — create a new combat encounter with selected tokens
- `end_combat` — delete active combat encounter
- `next_turn` — advance initiative to next combatant
- `set_initiative` — set initiative score for a combatant
- All tools require active combat to exist (return clear error otherwise)

### FR-019: Token Manipulation (Priority: Medium)

**As a** GM using an AI assistant,
**I want** to move tokens and apply status effects,
**So that** the AI can help narrate and mechanically represent scene outcomes.

Acceptance criteria:
- `move_token` — move a token to x,y coordinates on current scene
- `apply_status_effect` — add/remove condition effects (Stunned, Prone, etc.)
- `update_token` — update token properties (name, visibility, disposition)
- Validates that token exists on current scene

### FR-020: Scene Navigation (Priority: Medium)

**As a** GM using an AI assistant,
**I want** to switch the active scene,
**So that** the AI can manage pacing and direct players to new locations.

Acceptance criteria:
- `activate_scene` — set a scene as the active (viewed) scene for all players
- `preload_scene` — preload a scene without activating
- Returns scene metadata on success

### FR-021: Character Sheet Editing (Priority: Medium)

**As a** GM or player using an AI assistant,
**I want** to update actor attributes (HP, resources, currency),
**So that** the AI can apply mechanical outcomes from narrative events.

Acceptance criteria:
- `update_actor` — partial update actor properties (hp, attributes, currency)
- `add_item_to_actor` — add an item from world/compendium to actor inventory
- `remove_item_from_actor` — remove item by id from actor
- All updates via FoundryVTT's Socket.IO update events (not direct DB writes)

### FR-022: Journal Creation and Editing (Priority: Low)

**As a** GM using an AI assistant,
**I want** to create and update journal entries,
**So that** the AI can document session events, NPCs, and lore.

Acceptance criteria:
- `create_journal` — create new journal entry with title and content
- `update_journal` — update journal entry page content
- Content provided as HTML or Markdown (auto-converted)

### FR-023: Macro Execution (Priority: Low)

**As a** GM using an AI assistant,
**I want** to execute FoundryVTT macros by name or ID,
**So that** the AI can trigger complex scripted game effects.

Acceptance criteria:
- `execute_macro` — execute macro by name or id
- Returns execution result or error
- Security: only execute macros already present in the world (no arbitrary code injection)

### FR-024: Multi-World Support (Priority: Low)

**As a** server admin,
**I want** to connect the MCP server to different worlds,
**So that** I can use the AI assistant across multiple campaigns.

Acceptance criteria:
- `list_worlds` — list available worlds on the server
- `switch_world` — disconnect from current world and reconnect to named world
- Connection state properly reset between worlds

## Technical Approach

### Socket.IO Write Pattern

FoundryVTT processes mutations via Socket.IO events. Write operations follow this pattern:

```typescript
socket.emit('modifyDocument', {
  type: 'Actor',
  action: 'update',
  data: [{ _id: actorId, ...changes }]
}, callback);
```

Key Socket.IO events for writes:
- `modifyDocument` — create/update/delete documents
- `activateScene` — scene navigation
- `combat` — combat management (start/end/update)

### Authorization

- All write tools should check `FOUNDRY_WRITE_ENABLED=true` env var (default: false)
- Operations must respect FoundryVTT's permission system (user role matters)
- Potentially add per-tool enable/disable via env vars

### Cache Invalidation

After write operations, the in-memory cache will be stale. Options:
1. Emit a `refreshWorldData` event internally after writes
2. Accept stale cache with documentation (YAGNI for v1 writes)
3. Subscribe to FoundryVTT's update events to patch cache incrementally

Recommended: option 2 initially, document with `refresh_world_data` tool as the manual refresh.

## Release Plan

| Phase | Features | Version |
|-------|----------|---------|
| Phase 1 | FR-018 (combat), FR-019 (tokens) | v1.1.0 |
| Phase 2 | FR-020 (scenes), FR-021 (characters) | v1.2.0 |
| Phase 3 | FR-022 (journals), FR-023 (macros), FR-024 (multi-world) | v1.3.0+ |

## Open Questions

1. Should write operations require a separate, elevated API key?
2. How to handle FoundryVTT permission errors gracefully (user lacks GM role)?
3. Should `FOUNDRY_WRITE_ENABLED` be global or per-tool?
