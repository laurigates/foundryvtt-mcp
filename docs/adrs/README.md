# Architecture Decision Records

This directory contains ADRs for the foundryvtt-mcp project using [MADR format](https://adr.github.io/madr/).

## Index

| # | Title | Status | Date |
|---|-------|--------|------|
| [ADR-007](0007-release-please-for-automated-releases.md) | release-please for Automated Release Management | Accepted | 2025-03-01 |
| [ADR-008](0008-npm-trusted-publishing-oidc.md) | npm Trusted Publishing via OIDC | Accepted | 2026-03-07 |
| [ADR-009](0009-package-rename-foundryvtt-mcp.md) | Package Rename to foundryvtt-mcp | Accepted | 2026-03-07 |
| [ADR-010](0010-mutation-api-conventions.md) | Mutation API Conventions | Proposed | 2026-05-13 |
| [ADR-011](0011-dual-mode-transport.md) | Dual-Mode Transport: Socket.IO Primary, REST Bridge as Optional Augment | Accepted | 2026-11-24 |
| [ADR-012](0012-derived-values-from-source-data.md) | Compute Only the dnd5e Values That Are Exact From Source Data | Accepted | 2026-11-23 |
| [ADR-013](0013-live-world-cache-from-broadcasts.md) | Keep the World Cache Live From `modifyDocument` Broadcasts | Accepted | 2026-08-11 |
| [ADR-014](0014-foundry-v13-v14-wire-shapes.md) | Support Foundry v13 and v14 by Accepting Both Wire Shapes | Accepted | 2026-09-04 |

> **Note**: ADR-001 through ADR-006 are located in `docs/blueprint/adrs/` (earlier placement before blueprint standardization).
> Future ADRs should be created in this directory (`docs/adrs/`).
>
> Amendments across the two directories: ADR-011 amends ADR-001 (transport), and ADR-013 amends ADR-004 (world cache).

## Creating New ADRs

```bash
# Use blueprint to derive from discussions
/blueprint:derive-adr

# Or create manually following MADR format:
# docs/adrs/{NNNN}-{kebab-case-title}.md
```
