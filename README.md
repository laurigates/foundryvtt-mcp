# FoundryVTT MCP Server

A Model Context Protocol (MCP) server that integrates with FoundryVTT, allowing AI assistants to interact with your tabletop gaming sessions. Query actors, roll dice, generate content, and manage your game world through natural language.

## Features

### Core Functionality

- 🎲 **Dice Rolling** - Roll dice with standard RPG notation
- 🔍 **Data Querying** - Search actors, items, scenes, and journal entries
- 📊 **Game State** - Access current scene, combat status, and world information
- 🎭 **Content Generation** - Generate NPCs, loot, and random encounters
- 📝 **Rule Lookup** - Query game rules and mechanical information

### Real-time Integration

- 🔄 **Live Updates** - WebSocket connection for real-time game state
- ⚔️ **Combat Management** - Track initiative and combat state
- 👥 **User Awareness** - See who's online and their status

### AI-Powered Features

- 🧠 **Tactical Suggestions** - Get combat advice and strategy tips
- 🎪 **Story Assistance** - Generate plot hooks and narrative elements
- 🎨 **World Building** - Create locations, NPCs, and quests on demand

## Installation

### Prerequisites

- Node.js 18+
- FoundryVTT server running and accessible
- MCP-compatible AI client (Claude Desktop, etc.)

### Quick Setup (Recommended)

**🧙‍♂️ Interactive Setup Wizard:**
```bash
git clone <repository-url>
cd foundry-mcp-server
npm install
npm run setup-wizard
```

The setup wizard will:
- Automatically detect your FoundryVTT server
- Test connectivity and authentication
- Generate your `.env` configuration file
- Validate the complete setup

### Manual Setup

1. **Clone and install:**

```bash
git clone <repository-url>
cd foundry-mcp-server
npm install
```

2. **Configure environment:**

```bash
cp .env.example .env
# Edit .env with your FoundryVTT details
```

3. **Required environment variables:**

```env
FOUNDRY_URL=http://localhost:30000
FOUNDRY_API_KEY=your_api_key_here
# OR use username/password:
FOUNDRY_USERNAME=your_username
FOUNDRY_PASSWORD=your_password
```

4. **Test and start:**

```bash
npm run test-connection  # Verify setup
npm run build
npm start
```

### Development Mode

```bash
npm run dev
```

## FoundryVTT Configuration

The MCP server supports two secure, local-only authentication methods:

### Option 1: Local REST API Module (🔒 Recommended)

**Benefits:**

- ✅ **100% Local** - No external dependencies or third-party services
- ✅ **Maximum Privacy** - Your game data never leaves your network
- ✅ **Full Control** - You own and manage all authentication
- ✅ **Better Performance** - Direct local API access
- ✅ **Complete API Access** - Full access to all FoundryVTT features

**Setup:**

1. Install the **Foundry Local REST API** module:
   - In FoundryVTT: **Setup** → **Add-on Modules** → **Install Module**
   - Paste: `https://github.com/laurigates/foundryvtt-mcp/releases/latest/download/module.json`
2. Enable the module in your world
3. Go to **Settings** → **Configure Settings** → **Module Settings**
4. Find **"Foundry Local REST API"** and check **"Enable REST API"**
5. Copy the generated **API Key**
6. Add to your `.env` file:
   ```env
   FOUNDRY_URL=http://localhost:30000
   FOUNDRY_API_KEY=your_local_api_key_here
   ```

### Option 2: Username/Password (Fallback)

**Use when:** Local REST API module is not available or for simple setups.

**Limitations:** Some advanced features may not work properly.

1. Ensure your FoundryVTT user has appropriate permissions
2. Add credentials to `.env` file:
   ```env
   FOUNDRY_URL=http://localhost:30000
   FOUNDRY_USERNAME=your_username
   FOUNDRY_PASSWORD=your_password
   ```

### Comparison Table

| Feature         | **Local REST API Module**  | **Username/Password**    |
| --------------- | -------------------------- | ------------------------ |
| **Privacy**     | ✅ 100% Local              | ✅ 100% Local            |
| **Security**    | ✅ API Key auth            | ⚠️ Password auth         |
| **Performance** | ✅ Direct API access       | ⚠️ WebSocket only        |
| **Features**    | ✅ Complete API access     | ❌ Limited functionality |
| **Setup**       | ⚠️ Module install required | ✅ Simple credentials    |
| **Reliability** | ✅ Stable API              | ⚠️ Connection dependent  |

### Required Permissions (All Methods)

Your FoundryVTT user needs these permissions:

- View actors, items, scenes, and journals
- Create and modify journal entries (for content generation)
- Access compendium data
- Use dice rolling API

## Usage

### Basic Queries

Ask your AI assistant things like:

**Dice Rolling:**

- "Roll 1d20+5 for an attack roll"
- "Roll 4d6 drop lowest for ability scores"
- "Roll 2d10+3 for damage"

**Game Data:**

- "Show me all the NPCs in this scene"
- "Find magic weapons in the party's inventory"
- "What's the current combat initiative order?"
- "Search for healing potions"

**Content Generation:**

- "Generate a random NPC merchant"
- "Create loot for a CR 5 encounter"
- "Generate a tavern with NPCs and plot hooks"

### Advanced Features

**Rule Lookups:**

- "Look up the grappling rules"
- "How does the Fireball spell work?"
- "What are the conditions for being frightened?"

**Tactical Advice:**

- "Suggest tactics for fighting a dragon"
- "What should our wizard do this turn?"
- "Analyze this combat encounter"

**World Building:**

- "Create a mysterious forest location"
- "Generate a side quest involving missing merchants"
- "Design a magic item appropriate for level 8 characters"

## Available Tools

### Data Access

- `search_actors` - Find characters, NPCs, monsters
- `search_items` - Find equipment, spells, consumables
- `search_journals` - Search notes and handouts
- `get_scene_info` - Current scene details
- `get_actor_details` - Detailed character information

### Game Mechanics

- `roll_dice` - Roll dice with any formula
- `update_actor_hp` - Modify character health
- `get_combat_status` - Combat state and initiative
- `lookup_rule` - Game rules and spell descriptions

### Content Generation

- `generate_npc` - Create random NPCs
- `generate_loot` - Create treasure appropriate for level
- `roll_table` - Random encounters, events, weather
- `suggest_tactics` - Combat advice and strategy

### Diagnostics & System Health

- `get_system_health` - Server performance and health metrics
- `get_recent_logs` - Retrieve filtered FoundryVTT logs
- `search_logs` - Search logs with regex patterns
- `diagnose_errors` - Analyze errors with troubleshooting suggestions

## Available Resources

The server exposes these FoundryVTT resources:

- `foundry://world/info` - World and campaign information
- `foundry://world/actors` - All actors in the world
- `foundry://scene/current` - Current active scene
- `foundry://combat/current` - Active combat state
- `foundry://compendium/spells` - Spell database
- `foundry://compendium/monsters` - Monster database

## Configuration

### Server Settings

Edit `.env` to customize:

```env
# Logging
LOG_LEVEL=info  # debug, info, warn, error

# Performance
FOUNDRY_TIMEOUT=10000      # Request timeout (ms)
FOUNDRY_RETRY_ATTEMPTS=3   # Retry failed requests
CACHE_TTL_SECONDS=300      # Cache data for 5 minutes
```

### Security

- Use API keys instead of passwords when possible
- Limit FoundryVTT user permissions to minimum required
- Run server on internal network only
- Monitor logs for suspicious activity

## Diagnostics & Troubleshooting

### Built-in Diagnostics

The server includes comprehensive diagnostic tools to help troubleshoot connection and performance issues:

**Connection Testing:**
```bash
# Test complete MCP connection and functionality
npm run test-connection

# Clean build and test setup
npm run setup
```

**Diagnostic Tools (via AI assistant):**
- **System Health:** "Get the FoundryVTT system health status"
- **Error Analysis:** "Diagnose recent errors and provide recommendations"
- **Log Search:** "Search logs for 'connection' patterns in the last hour"
- **Recent Issues:** "Show me recent error logs"

### Advanced Diagnostics

When using the **Local REST API module**, you get access to advanced diagnostic features:

- 🔍 **Real-time Log Analysis** - Monitor FoundryVTT console output and notifications
- 📊 **System Health Metrics** - Server performance, memory usage, and client connections
- 🎯 **Error Pattern Recognition** - Automatic detection of common issues
- 💡 **Smart Suggestions** - Context-aware troubleshooting recommendations
- 📈 **Performance Monitoring** - Track server uptime and response times

### Connection Issues

```bash
# Test FoundryVTT connection
curl http://localhost:30000/api/status

# Check server logs
npm run dev  # Shows detailed logging
```

### Common Problems

**"Failed to connect to FoundryVTT"**

- Verify FOUNDRY_URL is correct
- Check if FoundryVTT is running
- Ensure API access is enabled

**"Authentication failed"**

- Verify API key or username/password
- Check user permissions in FoundryVTT
- Ensure user is not banned/restricted

**"Tool not found" errors**

- Update to latest server version
- Check tool name spelling
- Review available tools in logs

## Development

### Project Structure

```
src/
├── config/           # Configuration management
├── foundry/          # FoundryVTT client and types
├── tools/            # MCP tool definitions
├── resources/        # MCP resource definitions
├── utils/            # Utilities and logging
└── index.ts          # Main server entry point
```

### Adding New Tools

1. Define tool schema in `src/tools/index.ts`
2. Add handler method in `src/index.ts`
3. Implement FoundryVTT API calls in `src/foundry/client.ts`
4. Add TypeScript types in `src/foundry/types.ts`
5. Test with your AI assistant

### Testing

```bash
# Run tests
npm test

# Run with coverage
npm run test:coverage

# Lint code
npm run lint
```

### Building

```bash
# Development build
npm run build

# Clean build
npm run clean && npm run build
```

## API Reference

### Environment Variables

| Variable                 | Required | Description                | Default       |
| ------------------------ | -------- | -------------------------- | ------------- |
| `FOUNDRY_URL`            | ✅       | FoundryVTT server URL      | -             |
| `FOUNDRY_API_KEY`        | ⭐       | API key for authentication | -             |
| `FOUNDRY_USERNAME`       | ⭐       | Username (if no API key)   | -             |
| `FOUNDRY_PASSWORD`       | ⭐       | Password (if no API key)   | -             |
| `LOG_LEVEL`              | ❌       | Logging verbosity          | `info`        |
| `NODE_ENV`               | ❌       | Environment mode           | `development` |
| `FOUNDRY_TIMEOUT`        | ❌       | Request timeout (ms)       | `10000`       |
| `FOUNDRY_RETRY_ATTEMPTS` | ❌       | Retry failed requests      | `3`           |
| `CACHE_TTL_SECONDS`      | ❌       | Cache duration             | `300`         |

⭐ Either API key OR username/password required

### Tool Schemas

#### roll_dice

```json
{
  "formula": "1d20+5",
  "reason": "Attack roll against goblin"
}
```

#### search_actors

```json
{
  "query": "goblin",
  "type": "npc",
  "limit": 10
}
```

#### generate_npc

```json
{
  "race": "human",
  "level": 5,
  "role": "merchant",
  "alignment": "neutral good"
}
```

## Integration Examples

### Claude Desktop Configuration

Add to your Claude Desktop MCP settings:

```json
{
  "mcpServers": {
    "foundry": {
      "command": "node",
      "args": ["/path/to/foundry-mcp-server/dist/index.js"],
      "env": {
        "FOUNDRY_URL": "http://localhost:30000",
        "FOUNDRY_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

### Custom MCP Client

```typescript
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: "node",
  args: ["./dist/index.js"],
});

const client = new Client(
  {
    name: "foundry-client",
    version: "1.0.0",
  },
  {
    capabilities: {},
  },
);

await client.connect(transport);

// Roll dice
const result = await client.request({
  method: "tools/call",
  params: {
    name: "roll_dice",
    arguments: {
      formula: "1d20+5",
      reason: "Initiative roll",
    },
  },
});
```

## Roadmap

### Version 0.2.0

- [ ] Combat management tools (start/end combat, advance initiative)
- [ ] Token manipulation (move, update status effects)
- [ ] Scene navigation and switching
- [ ] Playlist controls and ambient audio

### Version 0.3.0

- [ ] Character sheet editing (level up, add equipment)
- [ ] Journal entry creation and editing
- [ ] Macro execution and management
- [ ] Advanced content generation (dungeons, NPCs with full stats)

### Version 1.0.0

- [ ] Multi-world support
- [ ] User permission management
- [ ] Webhook support for external triggers
- [ ] Performance optimization and caching
- [ ] Full test coverage
- [ ] Docker deployment

## Documentation

Complete API documentation is available in the `docs/` directory, auto-generated from TypeScript source code and JSDoc comments.

### 📖 Viewing Documentation

**Local development:**

```bash
npm run docs        # Generate documentation
npm run docs:serve  # Generate and serve locally
```

**Online:** Browse the `docs/` folder in this repository or visit the GitHub Pages site (if enabled).

### 📚 What's Documented

- **FoundryClient API** - Complete client documentation with examples
- **TypeScript Interfaces** - All data structures and type definitions
- **Configuration** - Environment variables and setup options
- **Utilities** - Helper functions and logging
- **Usage Examples** - Code samples for common operations

The documentation is automatically updated via GitHub Actions when source code changes.

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Make your changes and add tests
4. Commit: `git commit -m 'Add amazing feature'`
5. Push: `git push origin feature/amazing-feature`
6. Open a Pull Request

### Code Style

- Use TypeScript strict mode
- Follow existing naming conventions
- Add JSDoc comments for public APIs
- Write tests for new functionality
- Use meaningful commit messages

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Troubleshooting

### 🔍 Quick Diagnostics
```bash
npm run test-connection      # Test FoundryVTT connectivity
npm run setup-wizard        # Re-run interactive setup
```

### 🏥 Health Check
Use the `get_health_status` MCP tool for comprehensive diagnostics, or check server logs during startup for detailed status information.

### 📚 Common Issues
- **Connection refused**: Ensure FoundryVTT is running on the configured port
- **Authentication failed**: Verify API key or username/password in `.env`
- **Empty search results**: Install and enable the "Foundry Local REST API" module
- **Limited functionality**: REST API module required for full features

**📖 Detailed troubleshooting guide**: [TROUBLESHOOTING.md](TROUBLESHOOTING.md)

## Support

- **Issues**: GitHub Issues for bugs and feature requests
- **Discord**: [FoundryVTT Discord](https://discord.gg/foundryvtt) #api-development
- **Documentation**: [FoundryVTT API Docs](https://foundryvtt.com/api/)
- **Troubleshooting**: [TROUBLESHOOTING.md](TROUBLESHOOTING.md)

## Acknowledgments

- FoundryVTT team for the excellent VTT platform
- Anthropic for the Model Context Protocol
- The tabletop gaming community for inspiration and feedback

---

**Happy Gaming! 🎲**
