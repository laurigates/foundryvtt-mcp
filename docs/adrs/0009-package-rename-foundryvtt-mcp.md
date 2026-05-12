# ADR-009: Package Rename to foundryvtt-mcp

**Status**: Accepted
**Date**: 2026-03-07 (commit fdc5b60, PR #114)
**Confidence**: 9/10

## Context

The npm package was originally named `foundry-mcp-server`. Before the v1.0.0 public release on npm, the name needed review:
- `foundry-mcp-server` is accurate but verbose and describes implementation (`server`) rather than purpose
- The package is consumed as a CLI tool via `npx` or `bunx`, not as a library
- The prefix `foundryvtt-` matches the FoundryVTT ecosystem convention (modules use `foundryvtt-` prefix)
- A `bin` entry was needed to enable `npx -y foundryvtt-mcp` and `bunx foundryvtt-mcp` usage

## Decision

Rename the package from `foundry-mcp-server` to `foundryvtt-mcp` and add a `bin` entry pointing to the compiled entry point:

```json
{
  "name": "foundryvtt-mcp",
  "bin": {
    "foundryvtt-mcp": "dist/index.js"
  }
}
```

## Evidence from Git History

- `fdc5b60` `feat: rename package to foundryvtt-mcp and add bin entry (#114)` — full rename
- Multiple earlier release tags use `foundry-mcp-server-v*` prefix (e.g., `foundry-mcp-server-v0.11.0`)
- v1.0.0 release tag uses new prefix: `foundryvtt-mcp-v1.0.0`

## Consequences

**Positive:**
- Matches FoundryVTT ecosystem naming conventions
- Enables zero-install usage: `npx -y foundryvtt-mcp` and `bunx foundryvtt-mcp`
- Shorter, more memorable name
- Better discoverability on npm for users searching "foundryvtt"

**Negative:**
- Breaking change for anyone who added the package before v1.0.0 (pre-release, minimal user base)
- Old package name `foundry-mcp-server` now orphaned on npm (unpublished)
- Documentation and config examples needed updates

## Alternatives Considered

- **Keep foundry-mcp-server**: Rejected — less discoverable, inconsistent with ecosystem
- **foundry-mcp**: Shorter but ambiguous; could refer to any Foundry product
- **@foundryvtt/mcp**: Scoped package would require official Foundry org ownership
