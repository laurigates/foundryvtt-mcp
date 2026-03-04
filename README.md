# FoundryVTT MCP Server

A Model Context Protocol (MCP) server that integrates with FoundryVTT, allowing AI assistants to interact with your tabletop gaming sessions through natural language.

## Features

- **Dice Rolling** — standard RPG notation with any formula
- **Data Querying** — search and inspect actors, items, scenes, journals
- **Game State** — combat tracking, chat messages, user presence
- **Content Generation** — NPCs, loot tables, rule lookups
- **World Search** — full-text search across all game entities
- **Live Connection** — Socket.IO loads complete world state on connect
- **MCP Resources** — `foundry://` URIs for direct data access
- **Diagnostics** — optional server health monitoring (requires REST API module)

## Quick Start

### Prerequisites

- Node.js 18+
- FoundryVTT server running with an active world
- MCP-compatible AI client (Claude Desktop, etc.)

### Setup

```bash
git clone <repository-url>
cd foundry-mcp-server
npm install
npm run setup-wizard
```

The setup wizard will detect your FoundryVTT server, test connectivity, and generate your `.env` configuration.

To configure manually, see the [Configuration Guide](docs/guides/configuration.md).

## Usage

Ask your AI assistant things like:

- "Roll 1d20+5 for an attack roll"
- "Show me all the NPCs in this scene"
- "What's the current combat initiative order?"
- "Search the world for anything related to dragons"
- "Generate a random NPC merchant"

## Available Tools

### Data Access

- `search_actors` — find characters, NPCs, monsters
- `get_actor_details` — detailed character information
- `search_items` — find equipment, spells, consumables
- `get_scene_info` — current scene details
- `search_journals` — search notes and handouts
- `get_journal` — retrieve a specific journal entry
- `get_users` — list online users and their status
- `get_combat_state` — combat state and initiative order
- `get_chat_messages` — recent chat history

### World

- `search_world` — full-text search across all game entities
- `get_world_summary` — overview of the current world state
- `refresh_world_data` — reload world data from FoundryVTT

### Game Mechanics

- `roll_dice` — roll dice with any formula
- `lookup_rule` — game rules and spell descriptions

### Content Generation

- `generate_npc` — create random NPCs
- `generate_loot` — create treasure appropriate for level

### Diagnostics (requires REST API module)

- `get_recent_logs` — retrieve filtered FoundryVTT logs
- `search_logs` — search logs with regex patterns
- `get_system_health` — server performance and health metrics
- `diagnose_errors` — analyze errors with troubleshooting suggestions
- `get_health_status` — comprehensive health diagnostics

## Available Resources

- `foundry://actors` — all actors in the world
- `foundry://items` — all items in the world
- `foundry://scenes` — all scenes
- `foundry://scenes/current` — current active scene
- `foundry://journals` — all journal entries
- `foundry://users` — online users
- `foundry://combat` — active combat state
- `foundry://world/settings` — world and campaign settings
- `foundry://system/diagnostics` — system diagnostics (requires REST API module)

## Configuration

Copy `.env.example`, set `FOUNDRY_URL`, `FOUNDRY_USERNAME`, and `FOUNDRY_PASSWORD`, then run `npm run build && npm start`.

Full environment variable reference: [Configuration Guide](docs/guides/configuration.md)

## Troubleshooting

```bash
npm run test-connection   # Test FoundryVTT connectivity
npm run setup-wizard      # Re-run interactive setup
```

Detailed guide: [TROUBLESHOOTING.md](TROUBLESHOOTING.md)

## Development

See [Development Guide](docs/guides/development.md) for project structure, adding tools, testing, and building.

## Roadmap

See [Feature Tracker](docs/blueprint/feature-tracker.md) for completed and planned features.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Integration

See [Integration Guide](docs/guides/integration.md) for Claude Desktop config and custom MCP client examples.

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
