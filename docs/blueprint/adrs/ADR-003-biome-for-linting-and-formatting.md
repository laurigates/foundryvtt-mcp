---
id: ADR-003
title: Biome for Linting and Formatting
status: accepted
created: 2026-03-03
---

# ADR-003: Biome for Linting and Formatting

## Context

The project previously used ESLint for linting. ESLint requires multiple packages (the base linter, TypeScript parser, various plugins) and separate Prettier configuration for formatting, leading to slow cold-start times and configuration complexity.

Biome is a single Rust-based tool that handles both linting and formatting, with native TypeScript support and significantly faster execution.

## Decision

Replace ESLint and Prettier with Biome (`@biomejs/biome` v2.x). Configuration is in `biome.json` at the repository root. Active rules include:

- `style.useConst: error` - Prefer `const` over `let` where possible.
- `style.useBlockStatements: error` - Require braces for all control flow.
- `style.noNonNullAssertion: warn` - Flag `!` assertions.
- `suspicious.noVar: error` - Disallow `var`.
- `suspicious.noDoubleEquals: error` - Require strict equality.
- `suspicious.noExplicitAny: warn` - Flag `any` type usage.
- `correctness.noUnusedVariables: error` - Disallow unused variables.

Formatting uses 2-space indentation, single quotes, semicolons, and a 100-character line width.

Biome is integrated into the CI `test` workflow (`bun run lint`) and runs via `bun run lint:fix` / `bun run format` locally.

## Consequences

**Positive:**
- Single dependency replaces ESLint + multiple plugins + Prettier.
- Substantially faster lint and format times (Rust-based vs. JavaScript-based).
- Unified configuration in one `biome.json` file.

**Negative:**
- Biome's rule set is not identical to ESLint's; some ESLint rules have no Biome equivalent (and vice versa), requiring a one-time migration review.
- Smaller ecosystem of community plugins compared to ESLint.
