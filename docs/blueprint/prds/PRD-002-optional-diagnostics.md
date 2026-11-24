---
id: PRD-002
title: Optional Diagnostics via REST API Module
status: accepted
created: 2026-03-03
updated: 2026-11-24
---

# PRD-002: Optional Diagnostics via REST API Module

> **Updated 2026-11-24:** the module is not part of this repository. It was removed in #84 (2025-08-21) and now lives at [laurigates/foundryvtt-local-rest-api](https://github.com/laurigates/foundryvtt-local-rest-api) as a Foundry module plus a Node bridge server. Since [ADR-011](../../adrs/0011-dual-mode-transport.md) the diagnostics come from that bridge as an optional augment alongside Socket.IO (dual mode). Requirements 1, 3 and 4 below are revised accordingly.

## Problem Statement

Troubleshooting a live FoundryVTT session requires access to server logs, health metrics, and error analysis. The core Socket.IO connection does not expose these operational signals. A companion FoundryVTT module that provides a local REST API can surface this data, but the MCP server must integrate with it optionally so that users without the module are unaffected.

## Requirements

### Functional

1. **Optional Activation** - The REST-backed diagnostics tools are offered only when the REST bridge is configured: `FOUNDRY_API_KEY` and `FOUNDRY_REST_URL` together with Socket.IO credentials (dual mode), or `FOUNDRY_API_KEY` alone (the deprecated REST-only mode). Users without the module and bridge are not impacted. Which tools each mode offers is recorded in [docs/guides/capabilities.md](../../guides/capabilities.md).

2. **MCP Tools** - When activated, expose the following five tools:
   - `get_recent_logs` - Retrieve filtered FoundryVTT server logs
   - `search_logs` - Search logs with regex patterns
   - `get_system_health` - Server performance and health metrics
   - `diagnose_errors` - Analyze errors and return troubleshooting suggestions
   - `get_health_status` - Comprehensive health diagnostics

3. **MCP Resource** - The `foundry://system/diagnostics` resource reads the bridge when it is configured and reports a notice otherwise.

4. **Module Distribution** - The module and bridge server are released from [laurigates/foundryvtt-local-rest-api](https://github.com/laurigates/foundryvtt-local-rest-api), not from this repository. That repo has no published release yet, so there is no manifest URL to install from (laurigates/foundryvtt-local-rest-api#2).

### Non-Functional

- REST API calls use `FOUNDRY_API_KEY` for authentication; the key is never logged.
- Diagnostics endpoints time out independently of the main Socket.IO connection.

## Out of Scope

- Writing to FoundryVTT logs or modifying server configuration via the REST API.
