# Development Workflow

## Test-Driven Development

Follow **RED → GREEN → REFACTOR**:
1. Write a failing test that describes the desired behavior.
2. Implement the smallest change that makes it pass.
3. Refactor without breaking the tests.

For cross-target behavior, test both a single configured target and multiple isolated targets. A mock or fake relay does not establish live Foundry compatibility.

## Commit Conventions

Use conventional commits: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`. Add a scope when useful (`fix(sessions):`). Do not include credentials or generated secret-bearing target files in a commit.

## Build and Test

This project uses **Bun** for dependency management (`bun.lock`) and **Just** for task recipes (`justfile`). Prefer Just for local/CI parity.

- `just qa` — pre-commit gate: Biome lint, `tsc --noEmit` for `src/`, script typecheck via `tsconfig.scripts.json`, integration bindings and Vitest coverage.
- `just check-types` / `just check-types-scripts` — standalone TypeScript checks.
- `just test` / `just test-coverage` — integration bindings followed by Vitest unit tests/coverage.
- `just lint` / `just lint-fix` — Biome check (fix only when intended).
- `just build` — compile TypeScript.
- `just test-e2e` — Playwright; requires its external runtime setup.
- `just antipatterns` — ast-grep anti-pattern scan.
- `bun run smoke`, `smoke:dotenv`, `smoke:integrations`, `smoke:pack` — startup, environment, packaged integration and distribution checks.

The pre-commit hook checks staged secrets with **Gitleaks** and runs `lint-staged`/Biome. Formatting only selected files is preferable when unrelated pre-existing lint debt exists.

## Architecture boundaries

- `src/index.ts` owns the MCP transport. `src/tools/catalog.ts` owns tool/resource discovery **and** dispatch.
- Resolve `target_id` via `src/sessions/`. Each target owns a provider, cache, integration lifecycle, write setting, operation queue, identity and generation. There must be no global mutable current world.
- Core tool handlers depend on `FoundryCore` (`src/providers/types.ts`), not `FoundryClient` or transport internals. `src/foundry/client.ts` is only a compatibility export.
- `src/tools/availability.ts` retains legacy transport helpers; the active server enforces per-target capabilities through `ToolCatalog`.
- Put game-system-specific interpretation in `systems/` (including projections), module-specific APIs in `modules/`, and shared manifest/loader code in `src/integrations/`.
- Preserve exact upstream IDs in public tool names; validate schemas and runtime probes before advertising operations. There is no arbitrary-JS MCP tool.
- Explicit writes require the selected target's write flag, provider capabilities and Foundry permissions. Do not replay unknown-outcome writes or fail over to another target.

See [Development Guide](../../docs/guides/development.md), [ADR-011](../../docs/adrs/0011-provider-session-integration-overhaul.md) and [Writing integrations](../../docs/guides/writing-integrations.md).

## Type Safety

- Do not use `as any` in production; prefer proper interfaces or `Partial<T>`.
- Validate untrusted responses, Socket.IO events and relay/worker payloads with Zod, JSON Schema or runtime guards before projecting them.
- Prefer type guards (`typeof`, `isRecord()`) to assertions; avoid `as unknown as T` double-casts.
- Keep provider capability contracts and MCP input/output schemas consistent across targets.

## Resource Cleanup

- Owners of timers, sockets, subprocesses and event listeners must expose and invoke a lifecycle cleanup method (`close()` or `destroy()`).
- Remove Socket.IO listeners on all exit paths and cancel/reject pending work when its generation is invalidated.
- EventEmitter subclasses must release their listeners during cleanup.
- Session shutdown and reconnection must not affect a different target's resources.

## Verification evidence

Run `just qa` and relevant smoke tests before committing implementation changes. Record exact commands and results; do not infer live compatibility from unit tests, fake relays or a startup banner. Do not update integration `compatibility.tested` without a performed live test.
