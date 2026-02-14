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

- `npm run build` before committing TypeScript changes
- `npm test` for unit tests (Vitest)
- `npm run test:e2e` for end-to-end tests (Playwright)
- `npm run lint` for code quality checks
- `just antipatterns` for ast-grep anti-pattern scanning

## Type Safety

- Never use `as any` in production code — use proper interfaces or `Partial<T>`
- Validate external data (API responses, Socket.IO payloads) with Zod schemas instead of bare `as X` casts
- Prefer runtime type guards (`typeof`, `isRecord()`) over type assertions for dynamic data
- Avoid `as unknown as X` double-casts — they indicate a missing type definition

## Resource Cleanup

- Classes with `setInterval`/`setTimeout` must provide a `destroy()` method
- Socket.IO event listeners must be cleaned up with `socket.off()` on all exit paths (resolve, reject, timeout)
- EventEmitter subclasses must call `removeAllListeners()` in their cleanup method
