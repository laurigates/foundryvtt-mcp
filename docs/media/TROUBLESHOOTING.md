# FoundryVTT MCP Troubleshooting Guide

This guide helps you diagnose and resolve common issues with the FoundryVTT MCP server.

## Quick Diagnostics

### Setup Wizard (Recommended for New Users)
```bash
npm run setup-wizard
```
The interactive setup wizard will detect your FoundryVTT installation and guide you through configuration.

### Health Check
```bash
# Test connection directly:
npm run test-connection

# Or use the MCP tool for comprehensive diagnostics (requires REST API module):
# In your AI client, run: get_health_status
```

### Check Current Status
The server provides detailed diagnostics on startup. Look for:
- Connection status
- Authentication method and status
- World data loading confirmation
- Feature availability summary

## Common Issues

### Connection Issues

#### "Connection Refused" or "ECONNREFUSED"
**Symptoms**: Cannot connect to FoundryVTT server
**Solutions**:
1. **Start FoundryVTT**: Ensure FoundryVTT is running and accessible
2. **Check URL**: Verify `FOUNDRY_URL` in your `.env` file
   ```env
   FOUNDRY_URL=http://localhost:30000
   ```
3. **Test manually**: Open the URL in your browser to confirm FoundryVTT is accessible
4. **Check port**: Default FoundryVTT port is 30000, but yours might be different
5. **Firewall**: Ensure no firewall is blocking the connection

#### "Host Not Found" or "ENOTFOUND"
**Symptoms**: DNS resolution fails
**Solutions**:
1. **Check hostname**: Verify the hostname in `FOUNDRY_URL` is correct
2. **Use IP address**: Try using `127.0.0.1` instead of `localhost`
3. **Network connectivity**: Ensure your network connection is working

#### "Timeout" Errors
**Symptoms**: Connection attempts time out
**Solutions**:
1. **Increase timeout**: Add to `.env`:
   ```env
   FOUNDRY_TIMEOUT=20000
   ```
2. **Check FoundryVTT performance**: Ensure FoundryVTT isn't overloaded
3. **Network latency**: Consider network speed if using remote FoundryVTT

### Authentication Issues

#### "Session cookie not obtained"
**Symptoms**: Cannot fetch the `/join` page or extract session cookie
**Solutions**:
1. **Check URL**: Verify `FOUNDRY_URL` points to a running FoundryVTT instance
2. **Active world**: Ensure a world is active (not on the setup screen) — the `/join` page only exists when a world is loaded
3. **Test manually**: Open `http://localhost:30000/join` in your browser
4. **Proxy issues**: If behind a reverse proxy, ensure the `/join` path is forwarded correctly

#### "User ID resolution failed"
**Symptoms**: Username cannot be resolved to a user ID
**Solutions**:
1. **Verify username**: Username must match a FoundryVTT user exactly (case-sensitive)
2. **Active world**: The user must exist in the active world
3. **Set user ID directly**: Set `FOUNDRY_USER_ID` to the 16-character document `_id` of your user:
   ```env
   FOUNDRY_USER_ID=abc123def456ghij
   ```
   Find the `_id` in FoundryVTT's user data or by inspecting the `/join` page response.
4. **User status**: Verify the user account is active and not banned

#### "Authentication failed" or "joinGame rejected"
**Symptoms**: Socket.IO authentication fails after user ID resolution
**Solutions**:
1. **Verify password**: Check the password is correct
2. **User permissions**: Ensure user has required permissions in FoundryVTT
3. **Active sessions**: Check if the user already has an active session (some configurations limit concurrent sessions)
4. **Debug logging**: Set `LOG_LEVEL=debug` to see the full authentication flow

### World Data Issues

#### "World data not received"
**Symptoms**: Connection succeeds but no game data is available
**Solutions**:
1. **Active world**: Ensure a world is active in FoundryVTT (not on the setup screen)
2. **Authentication completed**: Verify the full 4-step auth flow completed — check logs for `joinGame` success
3. **User permissions**: The user must have permission to view world data
4. **Restart**: Try restarting both FoundryVTT and the MCP server

#### "Empty search results"
**Symptoms**: Search commands return no results
**Solutions**:
1. **Data exists**: Verify actors/items/journals exist in your FoundryVTT world
2. **Permissions**: Ensure the MCP user has permission to view the data
3. **World data loaded**: Check server startup logs for worldData loading confirmation
4. **Refresh data**: Use the `refresh_world_data` tool to reload from FoundryVTT
5. **User context**: Try searching directly in FoundryVTT to confirm data visibility

#### Scene Information Not Available
**Symptoms**: Scene commands return limited data
**Solutions**:
1. **Active scene**: Ensure a scene is activated in FoundryVTT
2. **Permissions**: Verify user can access scene information
3. **Refresh**: Use `refresh_world_data` to reload the cached state

### Feature-Specific Issues

#### Dice Rolling Not Working
**Symptoms**: Dice roll commands fail
**Solutions**:
1. **Check formula**: Ensure dice notation is valid (e.g., "1d20+5", "3d6")
2. **FoundryVTT version**: Ensure FoundryVTT version 11+ for best compatibility

#### Diagnostics Tools Not Working
**Symptoms**: Health monitoring and log tools fail
**Solutions**:
1. **REST API module required**: These 5 tools require the optional Foundry Local REST API module
2. **Install module**: Download from FoundryVTT's module browser
3. **Enable module**: Activate it in your world's module settings
4. **Set API key**: Add `FOUNDRY_API_KEY` to your `.env` file
5. **Update module**: Ensure you have the latest version (v0.8.1+)

## Environment Configuration

### .env File Template
```env
# Required
FOUNDRY_URL=http://localhost:30000
FOUNDRY_USERNAME=your_username
FOUNDRY_PASSWORD=your_password

# Optional: Direct user ID bypass
# FOUNDRY_USER_ID=abc123def456ghij

# Optional: Diagnostics (requires REST API module)
# FOUNDRY_API_KEY=your_api_key_here

# Optional Settings
FOUNDRY_TIMEOUT=10000
FOUNDRY_RETRY_ATTEMPTS=3
FOUNDRY_RETRY_DELAY=1000
LOG_LEVEL=info
```

### Configuration Validation
Run the setup wizard to validate your configuration:
```bash
npm run setup-wizard
```

## Advanced Diagnostics

### Enable Debug Logging
Add to your `.env` file:
```env
LOG_LEVEL=debug
```
This provides detailed logs including the full Socket.IO authentication flow.

### Manual Connection Testing
Test individual components:

1. **Basic connectivity**:
   ```bash
   curl http://localhost:30000
   ```

2. **Join page accessibility** (confirms active world):
   ```bash
   curl -s http://localhost:30000/join | head -20
   ```

3. **REST API status** (if module installed):
   ```bash
   curl http://localhost:30000/api/status
   ```

4. **Authenticated REST endpoint** (if module installed):
   ```bash
   curl -H "x-api-key: YOUR_API_KEY" http://localhost:30000/api/world
   ```

### Test Individual Features
Use the MCP tools to test specific functionality:
- `roll_dice` - Test dice rolling
- `search_actors` - Test actor search
- `get_combat_state` - Test combat tracking
- `get_users` - Test user awareness
- `search_world` - Test world-wide search
- `get_health_status` - Comprehensive diagnostics (requires REST API module)

## Platform-Specific Issues

### macOS
- **Firewall**: Check macOS firewall settings
- **Permission**: Ensure FoundryVTT has network permissions

### Linux
- **Port availability**: Ensure port 30000 isn't blocked
- **User permissions**: Check file system permissions

### Windows
- **Windows Defender**: Check firewall exceptions
- **WSL users**: Verify network bridge configuration

## Getting Help

### Documentation
- **Setup Guide**: [SETUP_GUIDE.md](SETUP_GUIDE.md)
- **README**: [README.md](README.md)
- **FoundryVTT Docs**: [https://foundryvtt.com/api/](https://foundryvtt.com/api/)

### Reporting Issues
If you continue to experience problems:

1. **Run diagnostics**:
   ```bash
   npm run test-connection
   ```

2. **Gather information**:
   - Your `.env` configuration (redact sensitive values)
   - MCP server logs (with `LOG_LEVEL=debug`)
   - FoundryVTT version and active modules
   - Error messages and stack traces

3. **Report the issue**: [GitHub Issues](https://github.com/laurigates/foundryvtt-mcp/issues)

### Community Support
- **Discord**: Join the FoundryVTT community
- **Reddit**: r/FoundryVTT
- **Forums**: FoundryVTT community forums

## Quick Reference

### Common Commands
```bash
# Setup and configuration
npm run setup-wizard          # Interactive setup
npm run test-connection       # Test connectivity
npm run build                 # Build the project
npm start                     # Start the MCP server

# Development
npm run dev                   # Development mode
npm test                      # Run tests
npm run lint                  # Code linting
```

### Health Check Checklist
- [ ] FoundryVTT is running with an active world
- [ ] `.env` file exists with `FOUNDRY_URL`, `FOUNDRY_USERNAME`, `FOUNDRY_PASSWORD`
- [ ] Username matches a FoundryVTT user exactly (case-sensitive)
- [ ] No firewall blocking connections
- [ ] MCP server starts without errors
- [ ] World data loads on connect (check startup logs)
- [ ] Basic tools (dice rolling) work
- [ ] Search tools return expected results

### Essential URLs
Verify these work in your browser:
- FoundryVTT main: `http://localhost:30000`
- Join page (confirms active world): `http://localhost:30000/join`

Remember: Most issues are configuration-related. The setup wizard and health diagnostics can resolve most common problems!
