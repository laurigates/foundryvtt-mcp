# FoundryVTT MCP Server Setup Guide

This guide walks you through setting up the FoundryVTT MCP Server.

## Quick Start

1. **Install dependencies**:

   ```bash
   npm install
   ```

2. **Copy environment file**:

   ```bash
   cp .env.example .env
   ```

3. **Configure your connection** (see below)

4. **Start the server**:
   ```bash
   npm run dev
   ```

## Connection Setup

The MCP server connects to FoundryVTT via Socket.IO using a standard user account. No custom modules are required for full game data access.

### Prerequisites

- FoundryVTT server running with an **active world** (not on the setup screen)
- A FoundryVTT user account with appropriate permissions

### Setup Types

Before configuring, determine your FoundryVTT deployment:

#### Local Development Setup
- FoundryVTT running on your local machine
- Typically uses `http://localhost:30000` or similar
- No reverse proxy or SSL/TLS

#### Reverse Proxy / Remote Setup
- FoundryVTT behind a reverse proxy (nginx, Apache, Caddy, etc.)
- Custom domains with SSL/TLS (e.g., `https://dnd.lakuz.com`)
- Cloud hosting or remote server deployments
- May use custom ports or paths

#### Network/IP Setup
- FoundryVTT accessible via local network IP
- Different port configurations
- Direct IP access without domain names

### Configuration

Update your `.env` file based on your setup type:

**Local Development:**
```env
FOUNDRY_URL=http://localhost:30000
FOUNDRY_USERNAME=your_username
FOUNDRY_PASSWORD=your_password
```

**Reverse Proxy / Remote:**
```env
FOUNDRY_URL=https://dnd.lakuz.com
FOUNDRY_USERNAME=your_username
FOUNDRY_PASSWORD=your_password
```

**Network/IP:**
```env
FOUNDRY_URL=http://192.168.1.100:30000
FOUNDRY_USERNAME=your_username
FOUNDRY_PASSWORD=your_password
```

### Features Available

All features work out of the box with username/password authentication:

- Search actors, items, scenes, and journals
- Get detailed actor/item information
- Dice rolling with FoundryVTT engine
- Combat state and initiative tracking
- Chat message history
- User list and online status
- Full-text world search
- World summary and scene information
- NPC and loot generation
- Rule lookups

### Environment Variables

| Variable           | Required | Description                                  | Default |
| ------------------ | -------- | -------------------------------------------- | ------- |
| `FOUNDRY_URL`      | Yes      | FoundryVTT server URL                        | -       |
| `FOUNDRY_USERNAME` | Yes      | FoundryVTT username                          | -       |
| `FOUNDRY_PASSWORD` | Yes      | FoundryVTT password                          | -       |
| `FOUNDRY_USER_ID`  | No       | 16-char document `_id` (bypasses username resolution) | - |
| `FOUNDRY_API_KEY`  | No       | REST API module key (enables diagnostics)    | -       |
| `LOG_LEVEL`        | No       | Logging level                                | `info`  |

### Optional: Diagnostics Tools

Installing the **Foundry Local REST API** module and setting `FOUNDRY_API_KEY` enables 5 server monitoring tools:

- `get_recent_logs` - Retrieve filtered FoundryVTT logs
- `search_logs` - Search logs with regex patterns
- `get_system_health` - Server performance and health metrics
- `diagnose_errors` - Error analysis with troubleshooting suggestions
- `get_health_status` - Comprehensive health diagnostics

To enable:
1. Install the REST API module in FoundryVTT
2. Enable it in your world and copy the generated API key
3. Add `FOUNDRY_API_KEY=your_key` to your `.env` file

## Testing Your Setup

### 1. Test Connection

```bash
npm run dev
```

Look for these success messages:

```
Connected to FoundryVTT successfully
FoundryVTT MCP Server running
```

### 2. Test with AI Assistant

Once the server is running, test these commands with your AI assistant:

**Dice Rolling**:

- "Roll 1d20+5 for an attack roll"
- "Roll 4d6 drop lowest for ability scores"

**Data Queries**:

- "Search for goblin actors"
- "Find all magic weapons"
- "What's the current scene information?"
- "Who's online?"

**Content Generation**:

- "Generate a random NPC"
- "Create some loot for a level 5 party"

## Troubleshooting

### Common Issues

#### "Failed to connect to FoundryVTT"

- **Check**: FoundryVTT is running at the configured URL with an active world
- **Check**: No firewall blocking the connection
- **Try**: Test URL in browser (local: `http://localhost:30000`, remote: `https://dnd.lakuz.com`)
- **For reverse proxy**: Ensure WebSocket upgrades are properly configured

#### "Authentication failed"

- **Check**: Username matches a FoundryVTT user exactly (case-sensitive)
- **Check**: Password is correct
- **Check**: User has necessary permissions in FoundryVTT
- **Try**: Set `FOUNDRY_USER_ID` to the 16-character document `_id` to bypass username resolution

#### "World data not received"

- **Check**: A world is active in FoundryVTT (not on the setup screen)
- **Check**: Socket.IO authentication completed (check server logs)
- **Try**: Restart both FoundryVTT and the MCP server

#### "Empty search results"

- **Check**: Data exists in your FoundryVTT world
- **Check**: User has permission to view the data
- **Check**: World data loaded on connect (look for worldData log on startup)

#### "WebSocket connection issues"

- **Check**: FoundryVTT allows WebSocket connections
- **Check**: No proxy server blocking WebSocket upgrades
- **Try**: Different port or direct connection

#### "Reverse Proxy / SSL Issues"

**SSL Certificate Problems:**
- **Check**: SSL certificate is valid and not expired
- **Check**: Certificate includes your domain name
- **Try**: Test with curl: `curl -I https://dnd.lakuz.com`

**Proxy Configuration:**
- **Nginx**: Ensure `proxy_set_header Upgrade $http_upgrade;` and `proxy_set_header Connection "upgrade";`
- **Apache**: Enable `mod_proxy_wstunnel` for WebSocket support
- **Caddy**: WebSocket support is automatic with `reverse_proxy`

**Port and Path Issues:**
- **Check**: Reverse proxy forwards to correct FoundryVTT port (usually 30000)
- **Check**: No path conflicts (e.g., `/socket.io/` path is preserved)
- **Try**: Direct connection to bypass proxy temporarily

### Getting Help

1. **Check logs**: Run with `LOG_LEVEL=debug` for detailed information
2. **Test manually**: Try accessing FoundryVTT directly in your browser
3. **Network issues**: Verify firewall and network configuration

## Advanced Configuration

### Direct User ID

If username resolution fails, set the user ID directly. Find the 16-character document `_id` for your user in FoundryVTT's data:

```env
FOUNDRY_USER_ID=abc123def456ghij
```

### Custom Socket Path

If FoundryVTT uses a custom socket path:

```env
FOUNDRY_SOCKET_PATH=/custom/socket/path/
```

### Timeout Settings

For slow connections, increase timeouts:

```env
FOUNDRY_TIMEOUT=30000
FOUNDRY_RETRY_ATTEMPTS=5
FOUNDRY_RETRY_DELAY=2000
```

### Production Deployment

For production use:

```env
NODE_ENV=production
LOG_LEVEL=warn
```

## What's Next?

Once you have a working connection:

1. **Explore all available tools**: Check the README for a complete list
2. **Customize for your game**: Many tools can be configured for specific game systems
3. **Add more features**: The server is extensible - add your own tools and resources
4. **Contribute**: Found bugs or want new features? Contributions welcome!

## Supported FoundryVTT Versions

- **FoundryVTT v11+**: Fully supported
- **FoundryVTT v10**: Basic support
- **Earlier versions**: Not tested, may work with limitations

---

**Need more help?** Check the main README or open an issue on GitHub.
