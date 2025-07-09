# FoundryVTT MCP Server Setup Guide

This guide will walk you through setting up the FoundryVTT MCP Server with different connection methods.

## Quick Start

1. **Install dependencies**:

   ```bash
   npm install
   ```

2. **Copy environment file**:

   ```bash
   cp .env.example .env
   ```

3. **Configure your connection** (see options below)

4. **Start the server**:
   ```bash
   npm run dev
   ```

## Connection Methods

The FoundryVTT MCP Server supports two connection methods, each with different capabilities:

### Method 1: REST API Module (Recommended)

**Best for**: Full functionality including data querying, dice rolling, and content management.

**Setup**:

1. Install the [Foundry REST API](https://foundryvtt.com/packages/foundry-rest-api) module in FoundryVTT
2. Get the API key from the module configuration page in FoundryVTT
3. Configure the module with your API key
4. Update your `.env`:
   ```env
   FOUNDRY_URL=http://localhost:30000
   USE_REST_MODULE=true
   FOUNDRY_API_KEY=your_api_key_here
   ```

**Features Available**:

- ✅ Search actors, items, scenes
- ✅ Get detailed actor/item information
- ✅ Dice rolling with FoundryVTT engine
- ✅ World and scene information
- ✅ Real-time data access

### Method 2: WebSocket Only (Limited)

**Best for**: Basic functionality when REST API module isn't available.

**Setup**:

1. Ensure FoundryVTT is running and accessible
2. Update your `.env`:
   ```env
   FOUNDRY_URL=http://localhost:30000
   USE_REST_MODULE=false
   FOUNDRY_USERNAME=your_username
   FOUNDRY_PASSWORD=your_password
   ```

**Features Available**:

- ✅ Fallback dice rolling (client-side simulation)
- ✅ Basic scene information
- ✅ WebSocket connection for real-time events
- ❌ Limited actor/item searching
- ❌ No direct data manipulation

## Detailed Configuration

### Environment Variables

| Variable           | Required | Description            | Default |
| ------------------ | -------- | ---------------------- | ------- |
| `FOUNDRY_URL`      | ✅       | FoundryVTT server URL  | -       |
| `USE_REST_MODULE`  | ✅       | Enable REST API module | `false` |
| `FOUNDRY_API_KEY`  | ⭐       | REST API module key    | -       |
| `FOUNDRY_USERNAME` | ⭐       | FoundryVTT username    | -       |
| `FOUNDRY_PASSWORD` | ⭐       | FoundryVTT password    | -       |
| `LOG_LEVEL`        | ❌       | Logging level          | `info`  |

⭐ Required based on connection method

### FoundryVTT Configuration

#### For REST API Module:

1. Go to **Add-on Modules** in FoundryVTT
2. Install **"Foundry REST API"**
3. Enable the module in your world
4. Configure module settings with your API key
5. Restart FoundryVTT

#### For WebSocket Only:

1. Ensure FoundryVTT is accessible at the configured URL
2. Create a user account with appropriate permissions
3. The server will use basic HTTP and WebSocket connections

## Testing Your Setup

### 1. Test Connection

```bash
npm run dev
```

Look for these success messages:

```
✅ Connected to FoundryVTT successfully
🚀 FoundryVTT MCP Server running
```

### 2. Test with AI Assistant

Once the server is running, test these commands with your AI assistant:

**Basic Dice Rolling**:

- "Roll 1d20+5 for an attack roll"
- "Roll 4d6 drop lowest for ability scores"

**Data Queries** (REST API module required):

- "Search for goblin actors"
- "Find all magic weapons"
- "What's the current scene information?"

**Content Generation**:

- "Generate a random NPC"
- "Create some loot for a level 5 party"

## Troubleshooting

### Common Issues

#### "Failed to connect to FoundryVTT"

- **Check**: FoundryVTT is running at the configured URL
- **Check**: No firewall blocking the connection
- **Try**: Test URL in browser: `http://localhost:30000`

#### "Empty search results"

- **Cause**: REST API module not configured
- **Solution**: Install and configure the REST API module, or accept limited functionality

#### "Authentication failed"

- **Check**: Username/password are correct
- **Check**: User has necessary permissions in FoundryVTT
- **Try**: Test login through FoundryVTT web interface

#### "WebSocket connection issues"

- **Check**: FoundryVTT allows WebSocket connections
- **Check**: No proxy server blocking WebSocket upgrades
- **Try**: Different port or connection method

### Getting Help

1. **Check logs**: Run with `LOG_LEVEL=debug` for detailed information
2. **Test manually**: Try accessing FoundryVTT directly in your browser
3. **Module issues**: Check the REST API module documentation
4. **Network issues**: Verify firewall and network configuration

## Advanced Configuration

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
- **FoundryVTT v10**: Basic support (WebSocket only)
- **Earlier versions**: Not tested, may work with limitations

---

**Need more help?** Check the main README or open an issue on GitHub.
