---
id: ADR-006
title: ES Modules with .js Imports for MCP SDK Compatibility
status: accepted
created: 2026-03-03
---

# ADR-006: ES Modules with .js Imports for MCP SDK Compatibility

## Context

The `@modelcontextprotocol/sdk` package is published as an ES module (ESM). Node.js ESM requires explicit file extensions in import specifiers (e.g., `import { foo } from './bar.js'`). TypeScript's default behavior omits extensions, which causes runtime resolution failures when the compiled output runs under Node.js ESM.

The project targets `"type": "module"` in `package.json` to use native ESM throughout, matching the SDK's expectations.

## Decision

Set `"type": "module"` in `package.json`. Use `.js` extensions on all relative TypeScript imports (e.g., `import { logger } from '../utils/logger.js'`), which TypeScript resolves correctly to `.ts` source files during compilation and to `.js` output files at runtime.

`tsconfig.json` uses `"moduleResolution": "bundler"` or `"node16"`/`"nodenext"` to enforce this pattern. Development uses `tsx` for on-the-fly TypeScript execution without a build step.

## Consequences

**Positive:**
- Full ESM compatibility with `@modelcontextprotocol/sdk` and other ESM-only packages.
- Native browser compatibility if any code is ever shared with a browser context.
- Aligns with the direction of the Node.js ecosystem.

**Negative:**
- `.js` extension on TypeScript imports is counter-intuitive and a common source of confusion for contributors new to the pattern.
- CommonJS interop (e.g., `require()`) requires dynamic `createRequire` workarounds for any legacy CJS-only dependencies.
- `tsx` is required as a dev dependency to run TypeScript directly without compiling first.
