# Development Workflow

## Test-Driven Development

Follow RED -> GREEN -> REFACTOR:
1. Write a failing test that defines desired behavior
2. Implement minimal code to pass the test
3. Refactor while keeping tests green

## Commit Conventions

Use conventional commits: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`

Include scope when applicable: `feat(tools):`, `fix(auth):`

## Build & Test

This project uses **bun** as the package manager and **`just`** as the task
runner (`bun.lock`, `justfile`). Prefer the `just` recipes — they are what CI
runs and keep local/CI parity.

- `just qa` — one-shot gate before committing: biome lint + `tsc` + Vitest. Run this first.
- `just check-types` — `tsc --noEmit` only
- `just test` — unit tests (Vitest); `just test-coverage` for coverage
- `just lint` / `just lint-fix` — biome check (the linter+formatter); `lint-fix` auto-fixes
- `just build` — compile TypeScript
- `just test-e2e` — end-to-end tests (Playwright, headless)
- `just antipatterns` — ast-grep anti-pattern scan

A pre-commit hook (lint-staged) runs `biome check --write` on staged files, so
formatting is auto-applied at commit time. When only specific files need
formatting (e.g. avoiding pre-existing lint debt elsewhere), run
`bunx biome check --write <paths>` on just those files.

## Type Safety

- Never use `as any` in production code — use proper interfaces or `Partial<T>`
- Validate external data (API responses, Socket.IO payloads) with Zod schemas instead of bare `as X` casts
- Prefer runtime type guards (`typeof`, `isRecord()`) over type assertions for dynamic data
- Avoid `as unknown as X` double-casts — they indicate a missing type definition

## Resource Cleanup

- Classes with `setInterval`/`setTimeout` must provide a `destroy()` method
- Socket.IO event listeners must be cleaned up with `socket.off()` on all exit paths (resolve, reject, timeout)
- EventEmitter subclasses must call `removeAllListeners()` in their cleanup method
