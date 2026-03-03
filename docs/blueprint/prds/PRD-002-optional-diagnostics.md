---
id: PRD-002
title: Optional Diagnostics via REST API Module
status: accepted
created: 2026-03-03
---

# PRD-002: Optional Diagnostics via REST API Module

## Problem Statement

Troubleshooting a live FoundryVTT session requires access to server logs, health metrics, and error analysis. The core Socket.IO connection does not expose these operational signals. A companion FoundryVTT module that provides a local REST API can surface this data, but the MCP server must integrate with it optionally so that users without the module are unaffected.

## Requirements

### Functional

1. **Optional Activation** - Diagnostics tools are only registered and available when `FOUNDRY_API_KEY` is set in the environment. Users without the REST API module installed are not impacted.

2. **MCP Tools** - When activated, expose the following five tools:
   - `get_recent_logs` - Retrieve filtered FoundryVTT server logs
   - `search_logs` - Search logs with regex patterns
   - `get_system_health` - Server performance and health metrics
   - `diagnose_errors` - Analyze errors and return troubleshooting suggestions
   - `get_health_status` - Comprehensive health diagnostics

3. **MCP Resource** - Expose `foundry://system/diagnostics` resource URI when the API key is present.

4. **Module Distribution** - The companion FoundryVTT module (`module.json`) is published as a GitHub release artifact so users can install it directly from the FoundryVTT module installer.

### Non-Functional

- REST API calls use `FOUNDRY_API_KEY` for authentication; the key is never logged.
- Diagnostics endpoints time out independently of the main Socket.IO connection.

## Out of Scope

- Writing to FoundryVTT logs or modifying server configuration via the REST API.
