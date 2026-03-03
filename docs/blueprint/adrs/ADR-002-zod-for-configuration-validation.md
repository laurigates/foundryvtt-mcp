---
id: ADR-002
title: Zod for Runtime Configuration Validation
status: accepted
created: 2026-03-03
---

# ADR-002: Zod for Runtime Configuration Validation

## Context

The MCP server is configured entirely through environment variables. TypeScript type checking alone cannot validate environment variables at runtime; a misconfigured `FOUNDRY_URL` (e.g., missing protocol, wrong format) would only fail at connection time with an opaque error rather than at startup with a clear message.

Configuration errors are a primary source of setup friction for new users. Early and explicit validation with actionable error messages reduces support burden.

## Decision

Use Zod (`zod` v3.x) to define a `ConfigSchema` that validates all environment variables when the configuration is first accessed. The schema:

- Enforces required fields (`FOUNDRY_URL` must be a valid HTTP/HTTPS URL).
- Applies defaults for optional fields (e.g., `timeout: 10000`, `retryAttempts: 3`).
- Derives the `Config` TypeScript type via `z.infer<typeof ConfigSchema>`, keeping the schema and type in sync automatically.
- In test environments (`NODE_ENV=test`), throws a `ZodError` instead of calling `process.exit(1)`, enabling test isolation.

Configuration is loaded lazily via a `Proxy` so tests can set environment variables before the first access.

## Consequences

**Positive:**
- Single source of truth for configuration shape and defaults.
- Runtime type safety matches compile-time types without manual synchronization.
- Zod's error messages are surfaced with field-level context and user-friendly guidance (URL format examples).
- Lazy loading allows test setup before validation fires.

**Negative:**
- Adds Zod as a production dependency (though it is already used for MCP tool input schemas, so no net addition).
- Developers must update both the schema and the `rawConfig` mapping when adding a new environment variable.
