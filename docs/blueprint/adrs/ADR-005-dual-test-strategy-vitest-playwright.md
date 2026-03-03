---
id: ADR-005
title: Dual Test Strategy: Vitest and Playwright
status: accepted
created: 2026-03-03
---

# ADR-005: Dual Test Strategy: Vitest and Playwright

## Context

The MCP server has two distinct testing needs:

1. **Unit and integration tests** for TypeScript modules (config validation, tool handlers, FoundryClient methods) that run quickly without external dependencies.
2. **End-to-end integration tests** that exercise the full Socket.IO connection against a real FoundryVTT container to verify the authentication flow and world data loading work correctly.

A single test framework optimized for one layer tends to be awkward for the other.

## Decision

Use two test frameworks:

- **Vitest** (`vitest` v1.x) for unit tests. Config in `vitest.config.ts`. Tests live in `src/__tests__/` and alongside source files. Run with `bun test`. A separate `vitest.integration.config.ts` is used for integration tests that require a live FoundryVTT instance (provisioned via Docker Compose in `docker-compose.test.yml`).

- **Playwright** (`@playwright/test` v1.x) for E2E tests targeting the MCP server's external behavior as an MCP client would see it. Config in `playwright.config.ts`. Run with `bun run test:e2e`.

CI workflows run unit tests on every push/PR (`test.yml`). Integration tests run in a dedicated workflow (`integration-test.yml`) with Docker Compose.

## Consequences

**Positive:**
- Vitest's native ES module and TypeScript support requires no transpilation step for unit tests.
- Playwright provides reliable browser-like automation for testing MCP tool call sequences end-to-end.
- Separation keeps the fast unit test suite independent of Docker/FoundryVTT availability.

**Negative:**
- Two test frameworks mean two configuration files, two runner commands, and two sets of documentation for contributors to learn.
- Integration tests require Docker and a FoundryVTT license to run locally.
