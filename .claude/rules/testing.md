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
- `tests/integration/global-setup.ts` only **waits** for the container at
  `:30001` — it does **not** start it.
- **Running it:** needs (a) `.env.integration` (copy from
  `.env.integration.example`, add a real `FOUNDRY_LICENSE_KEY` — the file is
  gitignored and ships only as the `.example`) and (b) the ephemeral test
  container up on `:30001`. Use **`just test-integration-docker`** (wraps `bun
  run test:integration:docker`: `docker-compose.test.yml up --wait` → run suite
  → `down -v`). Plain `just test-integration` assumes the `:30001` container is
  already running and otherwise blocks ~120s before failing in global-setup.
- The test container uses tmpfs `/data` + `CONTAINER_PRESERVE_CONFIG=false`, so
  it starts world-less; Socket.IO auth specs need a bootstrapped world (still
  manual — the CI wiring for this tier is gated on `FOUNDRY_*` secrets, issue #140).
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
