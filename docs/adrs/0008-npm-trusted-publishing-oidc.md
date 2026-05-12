# ADR-008: npm Trusted Publishing via OIDC

**Status**: Accepted
**Date**: 2026-03-07 (commit cf64b93, PR #113)
**Confidence**: 9/10

## Context

Publishing to npm originally required a long-lived `NODE_AUTH_TOKEN` secret stored in GitHub repository secrets. This token is a security risk:
- Tokens don't expire automatically
- If compromised, can publish malicious packages
- Must be manually rotated

npm introduced [trusted publishing](https://docs.npmjs.com/generating-provenance-statements) via OIDC, which allows GitHub Actions to authenticate without any stored secrets.

## Decision

Replace `NODE_AUTH_TOKEN`-based npm authentication with OIDC trusted publishing:
1. Configure the npm package on npmjs.com to trust GitHub Actions from this repository
2. Use `npm publish` without a token — GitHub Actions OIDC provides authentication
3. Require Node.js ≥ 24 (npm ≥ 11.5.1 required for OIDC publishing support)
4. Remove `--provenance` flag (automatic with OIDC)

## Evidence from Git History

- `cf64b93` `feat(ci): migrate to npm trusted publishing (OIDC) (#113)` — full migration
- `39a41f7` `feat(justfile): add npm-token and publish-dry-run recipes (#111)` — prior token-based tooling
- `6f46e26` `chore: configure npm publishing via CI (#110)` — initial CI publishing setup

Commit message body:
> Replace token-based npm authentication with OIDC trusted publishing.
> Remove NODE_AUTH_TOKEN and --provenance flag (automatic with OIDC)

## Consequences

**Positive:**
- No long-lived secrets in GitHub repository settings
- Provenance attestation is automatic and free
- Reduces secret rotation burden
- Aligned with npm security best practices

**Negative:**
- Requires npm package to be pre-configured on npmjs.com for trusted publishing
- Requires Node.js 24+ in CI (minor constraint)
- One-way migration — if OIDC support is removed from npm, manual rollback needed

## Alternatives Considered

- **Continue with NODE_AUTH_TOKEN**: Rejected — worse security posture, requires manual rotation
- **GitHub Packages**: Rejected — poor discoverability for MCP server users vs npm public registry
