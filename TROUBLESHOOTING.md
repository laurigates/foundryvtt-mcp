# FoundryVTT MCP Troubleshooting Guide

This guide helps you diagnose and resolve common issues with the FoundryVTT MCP server.

## Quick Diagnostics

### 🧙‍♂️ Setup Wizard (Recommended for New Users)
```bash
npm run setup-wizard
```
The interactive setup wizard will detect your FoundryVTT installation and guide you through configuration.

### 🔍 Health Check
```bash
# Use the MCP tool for comprehensive diagnostics
# In your AI client, run: get_health_status

# Or test connection directly:
npm run test-connection
```

### 📊 Check Current Status
The server provides detailed diagnostics on startup. Look for:
- Connection status (✅/⚠️/❌)
- Authentication method and status
- Feature availability summary
- Recommendations for improvements

## Common Issues

### 🔌 Connection Issues

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

### 🔐 Authentication Issues

#### "Unauthorized" or "401 Error"
**Symptoms**: Authentication fails
**Solutions**:

**For API Key Authentication**:
1. **Check API key**: Verify the key in `.env` matches FoundryVTT module settings
2. **Module status**: Ensure "Foundry Local REST API" module is:
   - Installed in FoundryVTT
   - Enabled in your world
   - API toggle is turned ON
3. **Regenerate key**: Generate a new API key in module settings
4. **Module version**: Ensure you have the latest version of the REST API module

**For Username/Password Authentication**:
1. **Verify credentials**: Check username and password are correct
2. **Case sensitivity**: Username is case-sensitive
3. **User permissions**: Ensure user has required permissions in FoundryVTT
4. **User status**: Verify the user account is active

### 📦 Module Issues

#### "REST API Not Available" or Limited Functionality
**Symptoms**: Basic features work but actor/item search returns empty results
**Solutions**:
1. **Install module**: Download "Foundry Local REST API" from FoundryVTT's module browser
2. **Enable module**: Activate it in your world's module settings
3. **Module configuration**: 
   - Go to Settings → Module Settings → Foundry Local REST API
   - Enable the "REST API" toggle
   - Copy the generated API key
4. **Update configuration**: Add the API key to your `.env` file
5. **Restart services**: Restart both FoundryVTT and the MCP server

#### "Diagnostics API Unavailable"
**Symptoms**: Health monitoring features don't work
**Solutions**:
1. **Update module**: Ensure you have the latest version (v0.8.1+)
2. **Feature support**: Diagnostics require the REST API module with diagnostics endpoints
3. **Alternative**: Use basic health check instead of detailed diagnostics

### 🎲 Feature-Specific Issues

#### Dice Rolling Not Working
**Symptoms**: Dice roll commands fail
**Solutions**:
1. **Check formula**: Ensure dice notation is valid (e.g., "1d20+5", "3d6")
2. **FoundryVTT version**: Ensure FoundryVTT version 11+ for best compatibility
3. **Fallback mode**: Dice rolling should work even without REST API

#### Actor/Item Search Returns Empty Results
**Symptoms**: Search commands return "No actors found"
**Solutions**:
1. **Data exists**: Verify actors/items exist in your FoundryVTT world
2. **Permissions**: Ensure MCP user has permission to view the data
3. **REST API**: Full search requires the REST API module (see Module Issues above)
4. **User context**: Try searching directly in FoundryVTT to confirm data visibility

#### Scene Information Not Available
**Symptoms**: Scene commands return mock or limited data
**Solutions**:
1. **Active scene**: Ensure a scene is activated in FoundryVTT
2. **REST API**: Real-time scene data requires the REST API module
3. **Permissions**: Verify user can access scene information

## Environment Configuration

### 📄 .env File Template
```env
# Required
FOUNDRY_URL=http://localhost:30000

# Authentication (choose one method)
# Method 1: API Key (Recommended)
FOUNDRY_API_KEY=your_api_key_here

# Method 2: Username/Password
# FOUNDRY_USERNAME=your_username
# FOUNDRY_PASSWORD=your_password

# Optional Settings
FOUNDRY_TIMEOUT=10000
FOUNDRY_RETRY_ATTEMPTS=3
FOUNDRY_RETRY_DELAY=1000
LOG_LEVEL=info
```

### 🔧 Configuration Validation
Run the setup wizard to validate your configuration:
```bash
npm run setup-wizard
```

## Advanced Diagnostics

### 📋 Enable Debug Logging
Add to your `.env` file:
```env
LOG_LEVEL=debug
```
This provides detailed logs for troubleshooting.

### 🔍 Manual Connection Testing
Test individual components:

1. **Basic connectivity**:
   ```bash
   curl http://localhost:30000
   ```

2. **REST API status**:
   ```bash
   curl http://localhost:30000/api/status
   ```

3. **Authenticated endpoint**:
   ```bash
   curl -H "x-api-key: YOUR_API_KEY" http://localhost:30000/api/world
   ```

### 🧪 Test Individual Features
Use the MCP tools to test specific functionality:
- `roll_dice` - Test dice rolling
- `search_actors` - Test actor search
- `get_health_status` - Comprehensive diagnostics
- `get_system_health` - FoundryVTT system status

## Platform-Specific Issues

### 🍎 macOS
- **Firewall**: Check macOS firewall settings
- **Permission**: Ensure FoundryVTT has network permissions

### 🐧 Linux
- **Port availability**: Ensure port 30000 isn't blocked
- **User permissions**: Check file system permissions

### 🪟 Windows
- **Windows Defender**: Check firewall exceptions
- **WSL users**: Verify network bridge configuration

## Getting Help

### 📚 Documentation
- **Setup Guide**: [SETUP_GUIDE.md](SETUP_GUIDE.md)
- **README**: [README.md](README.md)
- **FoundryVTT Docs**: [https://foundryvtt.com/api/](https://foundryvtt.com/api/)

### 🐛 Reporting Issues
If you continue to experience problems:

1. **Run diagnostics**:
   ```bash
   npm run test-connection
   ```

2. **Gather information**:
   - Your `.env` configuration (redact sensitive values)
   - MCP server logs
   - FoundryVTT version and active modules
   - Error messages and stack traces

3. **Report the issue**: [GitHub Issues](https://github.com/laurigates/foundryvtt-mcp/issues)

### 💬 Community Support
- **Discord**: Join the FoundryVTT community
- **Reddit**: r/FoundryVTT
- **Forums**: FoundryVTT community forums

## Quick Reference

### 🚀 Common Commands
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

### ✅ Health Check Checklist
- [ ] FoundryVTT is running and accessible
- [ ] `.env` file exists with correct configuration
- [ ] Authentication method is properly configured
- [ ] REST API module is installed and enabled (for full features)
- [ ] No firewall blocking connections
- [ ] MCP server starts without errors
- [ ] Basic tools (dice rolling) work
- [ ] Search tools return expected results

### 🔗 Essential URLs
Verify these work in your browser:
- FoundryVTT main: `http://localhost:30000`
- API status: `http://localhost:30000/api/status`
- API world (with auth): `http://localhost:30000/api/world`

Remember: Most issues are configuration-related. The setup wizard and health diagnostics can resolve 90% of common problems!