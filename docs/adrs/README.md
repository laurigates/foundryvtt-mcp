# Architecture Decision Records

This directory contains ADRs for the foundryvtt-mcp project using [MADR format](https://adr.github.io/madr/).

## Index

| # | Title | Status | Date |
|---|-------|--------|------|
| [ADR-007](0007-release-please-for-automated-releases.md) | release-please for Automated Release Management | Accepted | 2025-03-01 |
| [ADR-008](0008-npm-trusted-publishing-oidc.md) | npm Trusted Publishing via OIDC | Accepted | 2026-03-07 |
| [ADR-009](0009-package-rename-foundryvtt-mcp.md) | Package Rename to foundryvtt-mcp | Accepted | 2026-03-07 |

> **Note**: ADR-001 through ADR-006 are located in `docs/blueprint/adrs/` (earlier placement before blueprint standardization).
> Future ADRs should be created in this directory (`docs/adrs/`).

## Creating New ADRs

```bash
# Use blueprint to derive from discussions
/blueprint:derive-adr

# Or create manually following MADR format:
# docs/adrs/{NNNN}-{kebab-case-title}.md
```
