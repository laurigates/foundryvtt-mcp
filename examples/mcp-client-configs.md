# MCP Client Configuration Examples

This document provides configuration examples for connecting various AI assistants to your FoundryVTT MCP Server.

## Claude Desktop

Add this to your Claude Desktop MCP settings file:

### Location
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Linux**: `~/.config/Claude/claude_desktop_config.json`

### Configuration

```json
{
  "mcpServers": {
    "foundry-vtt": {
      "command": "node",
      "args": ["/path/to/foundry-mcp-server/dist/index.js"],
      "env": {
        "FOUNDRY_URL": "http://localhost:30000",
        "USE_REST_MODULE": "true",
        "FOUNDRY_API_KEY": "your_api_key_here",
        "LOG_LEVEL": "info"
      }
    }
  }
}
```

### Alternative: Using .env file

```json
{
  "mcpServers": {
    "foundry-vtt": {
      "command": "node",
      "args": ["/path/to/foundry-mcp-server/dist/index.js"],
      "cwd": "/path/to/foundry-mcp-server"
    }
  }
}
```

## Custom MCP Client (Node.js)

```javascript
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const transport = new StdioClientTransport({
  command: 'node',
  args: ['./dist/index.js'],
  cwd: '/path/to/foundry-mcp-server'
});

const client = new Client({
  name: "foundry-client",
  version: "1.0.0"
}, {
  capabilities: {}
});

await client.connect(transport);

// Example: Roll dice
const rollResult = await client.request({
  method: "tools/call",
  params: {
    name: "roll_dice",
    arguments: {
      formula: "1d20+5",
      reason: "Initiative roll"
    }
  }
});

console.log(rollResult);

// Example: Search for actors
const actorSearch = await client.request({
  method: "tools/call",
  params: {
    name: "search_actors",
    arguments: {
      query: "goblin",
      limit: 5
    }
  }
});

console.log(actorSearch);

// Example: Access resources
const worldActors = await client.request({
  method: "resources/read",
  params: {
    uri: "foundry://world/actors"
  }
});

console.log(worldActors);
```

## Custom MCP Client (Python)

```python
import asyncio
import json
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

async def main():
    server_params = StdioServerParameters(
        command="node",
        args=["./dist/index.js"],
        cwd="/path/to/foundry-mcp-server"
    )

    async with stdio_client(server_params) as (read, write):
        async with ClientSession(read, write) as session:
            # Initialize the client
            await session.initialize()

            # Roll dice
            roll_result = await session.call_tool(
                "roll_dice",
                arguments={"formula": "2d6+3", "reason": "Damage roll"}
            )
            print("Roll result:", roll_result)

            # Generate NPC
            npc_result = await session.call_tool(
                "generate_npc",
                arguments={"race": "elf", "role": "merchant", "level": 5}
            )
            print("Generated NPC:", npc_result)

            # Read world data
            world_data = await session.read_resource("foundry://world/info")
            print("World info:", world_data)

if __name__ == "__main__":
    asyncio.run(main())
```

## Environment Variables Reference

When configuring your MCP client, you can set these environment variables:

```bash
# Required
FOUNDRY_URL=http://localhost:30000

# Connection Method (choose one approach)
# Option 1: REST API Module (recommended)
USE_REST_MODULE=true
FOUNDRY_API_KEY=your_api_key_here

# Option 2: Basic WebSocket (limited functionality)
USE_REST_MODULE=false
FOUNDRY_USERNAME=your_username
FOUNDRY_PASSWORD=your_password

# Optional
LOG_LEVEL=info
NODE_ENV=production
FOUNDRY_TIMEOUT=15000
```

## Testing Your Configuration

1. **Test the MCP server standalone**:
   ```bash
   cd /path/to/foundry-mcp-server
   npm run test-connection
   ```

2. **Test MCP client connection**:
   ```bash
   # Using curl to test if server responds
   echo '{"method": "tools/list", "id": 1}' | node dist/index.js
   ```

3. **Debug connection issues**:
   ```bash
   # Run with debug logging
   LOG_LEVEL=debug node dist/index.js
   ```

## Example Prompts for AI Assistants

Once connected, try these prompts with your AI assistant:

### Basic Commands
- "Roll 1d20+5 for an attack roll"
- "Search for goblin actors in the current world"
- "What's the current scene information?"
- "Generate a random human merchant NPC"

### Advanced Queries
- "Create appropriate loot for a level 8 party after defeating a young dragon"
- "Generate a random forest encounter for a 4th level party"
- "Look up the grappling rules"
- "Suggest tactics for fighting undead creatures"

### Data Access
- "Show me all actors in the world"
- "What spells are available in the compendium?"
- "List the current game settings"
- "Get detailed information about the current scene"

## Troubleshooting

### Common Issues

1. **"Server not found" or connection errors**
   - Check the path to `dist/index.js` is correct
   - Ensure the server was built: `npm run build`
   - Verify FoundryVTT is running

2. **"Tool not available" errors**
   - Check if FoundryVTT is accessible
   - Verify environment variables are set correctly
   - Try `npm run test-connection` to diagnose

3. **"Empty results" or limited functionality**
   - Install the FoundryVTT REST API module for full features
   - Set `USE_REST_MODULE=true` and configure API key
   - Some features work without REST module but with limitations

4. **Permission or authentication errors**
   - Check FoundryVTT user permissions
   - Verify API key is valid
   - Ensure FoundryVTT allows external connections

### Getting Debug Information

Add debug environment variables to your MCP client config:

```json
{
  "env": {
    "LOG_LEVEL": "debug",
    "NODE_ENV": "development"
  }
}
```

This will provide detailed logging to help diagnose connection and functionality issues.

## Performance Tips

1. **Use resource caching**: Resources are cached for 5 minutes by default
2. **Limit search results**: Use the `limit` parameter to avoid large data transfers
3. **Batch operations**: Group related requests when possible
4. **Monitor logs**: Watch for performance warnings in debug mode

## Security Considerations

1. **API Keys**: Never commit API keys to version control
2. **Network Access**: Run on internal networks when possible
3. **User Permissions**: Limit FoundryVTT user permissions to necessary functions
4. **Monitoring**: Monitor logs for unusual activity

---

For more detailed setup instructions, see the main [SETUP_GUIDE.md](../SETUP_GUIDE.md).
