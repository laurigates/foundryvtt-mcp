# FoundryVTT MCP Server

![FoundryVTT MCP — AI assistants at your virtual tabletop](docs/assets/banner.webp)

[![npm version](https://img.shields.io/npm/v/foundryvtt-mcp)](https://www.npmjs.com/package/foundryvtt-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A [Model Context Protocol](https://modelcontextprotocol.io/) (MCP) server that integrates with FoundryVTT, allowing AI assistants to interact with your tabletop gaming sessions through natural language.

## Features

- **Dice Rolling** — dice terms and integer modifiers with `+`/`-`; advanced modifier syntax is not supported across all transports.
- **Data Querying** — actors, world items, scenes, journals, users and combat; optional REST-mode compendium search.
- **Game State Mutations** — opt-in tools for actor attributes, owned items, journals, tokens and combat (authenticated Socket.IO, permissions and write flag required).
- **Content Helpers** — locally generated NPC and loot *text*; `lookup_rule` is a placeholder, not a rules database.
- **World Search** — case-insensitive **name** search for actors, world items, scenes and journals (not full-text page search).
- **Live Connection** — Socket.IO loads the active world, follows document updates and provides a `refresh_world_data` tool to re-synchronize the cached snapshot.
- **MCP Resources** — `foundry://` URIs for direct reads.
- **Optional REST Mode** — `FOUNDRY_API_KEY` switches to the Foundry Local REST API module, enabling compendium search and REST diagnostics; it does **not** combine with Socket.IO writes.

See the **[MCP capability matrix](docs/guides/capabilities.md)** for the complete tool, resource and mode inventory (the canonical source for counts is [`src/tools/definitions.ts`](src/tools/definitions.ts) and [`src/tools/resources.ts`](src/tools/resources.ts)). For remote installations, see the [Linux server / local MCP client guide](docs/guides/remote-linux.md).

## Quick Start

### Prerequisites

- Node.js 18+ (or [Bun](https://bun.sh/))
- FoundryVTT server running with an active world
- MCP-compatible AI client (Claude Desktop, Claude Code, VS Code, etc.)

### Recommended: Create a Dedicated API User

It is recommended to create a separate FoundryVTT user account for the MCP server rather than using your own GM or player account. This provides better security and auditability.

**In FoundryVTT:**
1. Go to **Configuration** → **User Management**
2. Click **Create User**
3. Set a username (e.g., `mcp-api`) and a strong password
4. Assign the **Assistant GM** role (needed to read world data and roll dice)
5. Use this account's credentials in your MCP configuration

**Benefits:**
- Chat messages and actions from the MCP server are clearly attributed to a separate user
- You can revoke access by disabling the API user without affecting your own account
- Limits blast radius if credentials are ever exposed

### Installation

Run directly without installing — no clone needed:

```bash
bunx foundryvtt-mcp
```

Or with npx:

```bash
npx -y foundryvtt-mcp
```

### Client Configuration

#### Claude Desktop / Claude Code

Add to your MCP configuration (`claude_desktop_config.json` or `.mcp.json`):

```json
{
  "mcpServers": {
    "foundryvtt": {
      "command": "bunx",
      "args": ["foundryvtt-mcp"],
      "env": {
        "FOUNDRY_URL": "http://localhost:30000",
        "FOUNDRY_USERNAME": "your_username",
        "FOUNDRY_PASSWORD": "your_password"
      }
    }
  }
}
```

#### VS Code

Add to your VS Code MCP settings:

```json
{
  "servers": {
    "foundryvtt": {
      "command": "bunx",
      "args": ["foundryvtt-mcp"],
      "env": {
        "FOUNDRY_URL": "http://localhost:30000",
        "FOUNDRY_USERNAME": "your_username",
        "FOUNDRY_PASSWORD": "your_password"
      }
    }
  }
}
```

### Development Setup

For local development or contributing (this example clones the upstream source; see [Running a fork checkout](docs/guides/integration.md#running-a-fork-checkout) to use your own branch):

```bash
git clone https://github.com/laurigates/foundryvtt-mcp.git
cd foundryvtt-mcp
bun install
bun run setup-wizard
```

The setup wizard will detect your FoundryVTT server, test connectivity, and generate your `.env` configuration.

To configure manually, see the [Configuration Guide](docs/guides/configuration.md).

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `FOUNDRY_URL` | Yes | FoundryVTT server URL (e.g., `http://localhost:30000`) |
| `FOUNDRY_USERNAME` | Socket.IO | FoundryVTT user account |
| `FOUNDRY_PASSWORD` | Socket.IO | FoundryVTT user password |
| `FOUNDRY_USER_ID` | No | Optional alternative to `FOUNDRY_USERNAME`: bypass username-to-ID resolution |
| `FOUNDRY_API_KEY` | No | Selects **Foundry Local REST API mode** (a transport switch — see the [capability matrix](docs/guides/capabilities.md#connection-modes-not-interchangeable)) |
| `FOUNDRY_WRITE_ENABLED` | No | Enable game-state mutations — `true` required for the write tools (default: `false`) |
| `LOG_LEVEL` | No | `debug`, `info`, `warn`, or `error` (default: `info`) |
| `FOUNDRY_TIMEOUT` | No | Request timeout in ms (default: `10000`) |

## Usage

Ask your AI assistant things like:

- "Roll 1d20+5 for an attack roll"
- "Find actors named goblin"
- "What's the current combat initiative order?"
- "Find actors, items or scenes with dragon in their name"
- "Generate a random NPC merchant"

## Available Tools

### Data Access

- `search_actors` — find characters, NPCs, monsters
- `get_actor_details` — detailed character information
- `search_items` — find equipment, spells, consumables
- `search_compendium` — search enabled compendium packs by name/metadata (**requires REST mode with `FOUNDRY_API_KEY`**)
- `get_scene_info` — current scene details
- `search_journals` — search notes and handouts
- `get_journal` — retrieve a specific journal entry
- `get_users` — list users, roles, and live online status
- `get_combat_state` — combat state and initiative order
- `get_chat_messages` — recent chat history

### Write Operations (require `FOUNDRY_WRITE_ENABLED=true`)

Game-state mutations are **disabled by default**. They use the Socket.IO
`modifyDocument` protocol over an authenticated session, and the connected user
needs GM/owner permission. Set `FOUNDRY_WRITE_ENABLED=true` to enable them.

- `start_combat` — begin a new encounter, seeding combatants from tokens (does
  not check for an existing combat — calling it during an active one creates a
  second encounter)
- `next_turn` — advance the active combat to the next turn (wraps to the next round)
- `end_combat` — end (delete) the active combat encounter
- `set_initiative` — set a combatant's initiative in the active combat, moving the
  turn marker with the acting combatant if the reorder shifts them
- `move_token` — move a token to new x/y coordinates on its scene
- `apply_status_effect` — apply or remove a status condition (e.g. prone, stunned) on a token's actor
- `update_actor_attributes` — patch an actor's `system` attributes (HP, currency, spell slots, …)
- `create_actor_item` — add an inline item to an actor
- `update_actor_item` — apply a JSON merge patch to an actor's item
- `delete_actor_item` — remove an item from an actor
- `create_journal_entry` — create a journal entry with one or more text pages
  (GM-only by default; pass `visibility` to let players read it)

### World

- `search_world` — case-insensitive **name** search across world actors, items, scenes and journals
- `get_world_summary` — overview of the current world state
- `refresh_world_data` — reload world data from FoundryVTT; needed after a dropped
  connection, whose missed updates are never replayed into the cache

### Game Mechanics

- `roll_dice` — roll dice; dice terms (`NdS`) and whole numbers joined by `+`/`-`, with
  unsupported notation (`4d6kh3`, `1d20r1`, `*`) rejected rather than dropped.
  Parentheses are the one transport difference: FoundryVTT evaluates them when
  `FOUNDRY_API_KEY` is set, the local roller rejects them otherwise
- `lookup_rule` — **stub**: returns a templated placeholder, consults no rules source

### Content Generation

- `generate_npc` — generate NPC text (not written to the world)
- `generate_loot` — generate treasure text from a challenge rating (not written to the world)

### Diagnostics (requires REST API module)

- `get_recent_logs` — retrieve filtered FoundryVTT logs
- `search_logs` — search logs by pattern, listing the matching entries
- `get_system_health` — server health status with versions, user/module counts, memory
  and log error counts (no CPU or disk metrics)
- `diagnose_errors` — **stub**: returns a fixed "no errors detected" summary
- `get_health_status` — comprehensive health diagnostics; flags the world snapshot when
  the cache has stopped following live changes

## Available Resources

- `foundry://actors` — up to 100 world actor summaries and their IDs, plus the total count
- `foundry://items` — up to 100 world item summaries and their IDs, plus the total count
- `foundry://scenes` — all scenes
- `foundry://scenes/current` — current active scene
- `foundry://journals` — all journal entries
- `foundry://users` — online users
- `foundry://combat` — active combat state; `combatants` are in initiative order, so
  `combat.turn` indexes them directly
- `foundry://world/settings` — world and campaign settings
- `foundry://system/diagnostics` — system diagnostics (requires REST API module)

## Troubleshooting

The connectivity and setup helpers ship in the source tree (not the published `bin`), so run them from a dev checkout:

```bash
git clone https://github.com/laurigates/foundryvtt-mcp.git
cd foundryvtt-mcp && bun install
bun run test-connection   # Probe FoundryVTT connectivity
bun run setup-wizard      # Re-run interactive setup
```

Detailed guide: [TROUBLESHOOTING.md](TROUBLESHOOTING.md)

## Development

```bash
bun run build          # Compile TypeScript and make dist/index.js executable
bun run dev            # Development mode with hot reload
bun test               # Unit tests (Vitest)
bun run test:e2e       # E2E tests (Playwright)
bun run lint           # Lint code (Biome)
bun run smoke          # Startup smoke test against the local build
bun run smoke:pack     # Pack-and-install smoke test (mirrors what npx consumers get)
```

See [Development Guide](docs/guides/development.md) for project structure, adding tools, testing, and building.

## Roadmap

See [Feature Tracker](docs/blueprint/feature-tracker.md) for completed and planned features.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT License — see [LICENSE](LICENSE) for details.

## Support

- **Issues**: [GitHub Issues](https://github.com/laurigates/foundryvtt-mcp/issues)
- **Discord**: [FoundryVTT Discord](https://discord.gg/foundryvtt) #api-development
- **Docs**: [FoundryVTT API](https://foundryvtt.com/api/)

## Acknowledgments

- FoundryVTT team for the excellent VTT platform
- Anthropic for the Model Context Protocol
- The tabletop gaming community for inspiration and feedback
