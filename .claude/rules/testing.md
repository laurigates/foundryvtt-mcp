# Testing Requirements

This project uses **bun** + **`just`** (see `development.md` for the full
command reference). Prefer the `just` recipes — they are what CI runs, keeping
local/CI parity.

## Tiers

| Tier | Command | Scope |
|------|---------|-------|
| Unit | `just test` (`bun test`) | Pure logic, handlers, client methods with mocked I/O. New functions require unit tests; `just test-coverage` for coverage. |
| Integration | `bun run test:integration` | `tests/integration/**` against a **live** FoundryVTT (`docker-compose.test.yml`, port 30001). Real Socket.IO auth + worldData. |
| E2E | `just test-e2e` (`bun run test:e2e`) | Playwright smoke specs (`tests/e2e/**`). |
| Gate | `just qa` | biome + `tsc` + unit Vitest — run before committing. |

## Integration tier (live FoundryVTT)

- Connects through the shared helper `tests/integration/setup.ts`
  (`createConnectedClient`) in Socket.IO mode (`FOUNDRY_USERNAME`/`FOUNDRY_PASSWORD`).
- `tests/integration/global-setup.ts` waits for the container to be ready.
- **Write-tool tests** (`mutations.integration.test.ts`) exercise the
  `modifyDocument` write protocol: they require `writeEnabled: true` and a world
  **GM** user, target an actor with a mutable attribute, and **revert every
  mutation**. When no mutable actor / world is available they `ctx.skip()`
  rather than fail — matching the live-world precondition of the other
  integration specs.
- The bridge/REST path is **read-only**; `search_compendium` integration
  coverage is blocked on the bridge implementing `/api/compendium/search`.
- CI runs this tier only once the `FOUNDRY_*` secrets are configured (issue #140).

## Coverage areas

- Tool handlers (read **and** write) and the Socket.IO `modifyDocument` protocol
  (see `foundry-write-protocol.md`)
- Authentication (4-step Socket.IO join) and connection lifecycle
- `foundry://` resource URIs and tool/contract schemas
- World-data caching and querying
