# ADR-007: release-please for Automated Release Management

**Status**: Accepted
**Date**: 2025-03-01 (commit 3146c38)
**Confidence**: 9/10

## Context

The project needed a consistent, automated release process to:
- Maintain a `CHANGELOG.md` from conventional commits
- Bump `package.json` versions without manual edits
- Create GitHub releases with release notes
- Support multiple packages in the repository (MCP server + REST API module)

## Decision

Use [release-please](https://github.com/googleapis/release-please) via a GitHub Actions workflow with a manifest-based configuration (`release-please-config.json` + `.release-please-manifest.json`).

Conventional commits drive version bumps automatically:
- `feat:` → minor version bump
- `fix:` → patch version bump
- `feat!:` / `BREAKING CHANGE:` → major version bump

## Evidence from Git History

- `3146c38` `ci: configure release-please with manifest` — initial setup with manifest
- Multiple `chore(main): release …` PRs created automatically by the bot
- 20+ automated release PRs from v0.4.0 through v1.0.0
- `a222434` `ci(release): add workflow_dispatch trigger` — manual trigger added for flexibility
- `95b63dc` `chore(release): Refactor release-please config` — config simplified over time

## Consequences

**Positive:**
- Zero-touch releases: merge a release PR to publish
- CHANGELOG.md always up to date and machine-generated
- Release history clearly tied to conventional commit scopes
- Supports multi-package repositories via manifest

**Negative:**
- Requires strict conventional commit discipline from all contributors
- release-please PRs can accumulate if releases are delayed
- Manifest config can be tricky to set up initially (evidenced by multiple early fix commits)

## Alternatives Considered

- **Manual releases**: Rejected — error-prone and inconsistent
- **semantic-release**: Similar capability but more complex plugin ecosystem
- **standard-version**: Local-only, no GitHub Actions integration
