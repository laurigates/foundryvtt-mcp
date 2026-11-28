# Testing Requirements

The project uses Bun, Just, Vitest and Playwright. Prefer the `justfile` recipes; see [development.md](development.md) and the [Development Guide](../../docs/guides/development.md).

## Tiers

| Tier | Command | Scope |
|---|---|---|
| Unit | `just test` | Vitest: core handlers, provider/session/catalog contracts, offline and fake-I/O cases |
| Type safety | `just check-types` and `just check-types-scripts` | TypeScript source and scripts (separate tsconfigs) |
| Quality gate | `just qa` | Biome lint + both TypeScript checks + integration bindings + Vitest coverage |
| Package smoke | `bun run smoke`, `smoke:dotenv`, `smoke:integrations`, `smoke:pack` | Startup, load order, packaged integration contracts, installed package assets |
| Live integration | `bun run test:integration` or `just test-integration-docker` | FoundryVTT over real authenticated transports; requires a configured server |
| Browser E2E | `just test-e2e` | Playwright tests; requires browser and running setup |

The regular repository test workflow runs build, script typechecking, Vitest, startup/dotenv/package smoke checks and Biome. Do not assume that it performs the relay or live Foundry tiers. Add tests to the relevant tier whenever a feature changes.

## Architecture-specific coverage

- Different `target_id` values must not share mutable world data, credentials or integration state; identical upstream document IDs must remain isolated.
- `ToolCatalog` must apply consistent rules in `tools/list` and `tools/call`. Test offline targets, unavailable capabilities, single/multiple target ambiguity, read-only configuration, conflicting integration schemas and target-qualified resources.
- Providers must reject stale generations and world/origin changes. A lost write response is `outcome_unknown`, not permission to retry.
- Test runtime probes, JSON Schema validation, arbitrary source-ID preservation, binding execution, missing packages and manager cleanup.
- Test both native Socket.IO `modifyDocument` and paired relay document execution **when the functionality exists**. Remote APIs are not interchangeable.
- Cache/query behavior includes incremental document broadcasts, explicit refresh, world-content search and plain-text excerpts.
- Cover both single v13-style acknowledgements and v14 `{ results: [...] }` acknowledgements, including errors in side-effect responses and `modifyDocumentBatch` broadcasts.
- Optional legacy REST augmentation belongs to one Socket.IO target. Cover read fallback and bridge cooldowns without changing another target's capabilities, credentials or write path.
- Verify packaged imports and adapter bindings from a working directory outside the checkout.
- Keep source tests (`src/**/__tests__`), package tests (`systems/*/tests/`, `modules/*/tests/`) and live tests (`tests/integration/`) independent.

## Live Foundry tier

- `tests/integration/setup.ts` supplies the existing Socket.IO connection helper.
- `tests/integration/global-setup.ts` **waits** for an existing server on port `30001`; it does not start a container.
- The `live` project in `vitest.integration.config.ts` owns that global setup. The separate `parity` project reads its own environment, has no global setup and skips when its prerequisites are missing; selecting the parity file alone must not wait for the `30001` container.
- For container runs, use `just test-integration-docker`. The local `.env.integration` file (copy from `.env.integration.example`) needs your Foundry license and download credentials. Compose interpolation and `env_file` are different; shell-only variables may not reach the container.
- `docker-compose.test.yml` pins Foundry's image tag and `FOUNDRY_VERSION`. Change both together. A local override is read from the shell by Compose, not from the container `env_file`.
- `src/__tests__/foundry-version-pins.test.ts` checks those two defaults. Compose interpolation does not read `env_file`, and an explicit `environment` entry takes precedence over it.
- The container uses transient storage and may start without an active world. Authenticating into a world requires world bootstrap.
- Mutation integration tests require an appropriate GM/owner and a disposable world; they should revert mutations and skip if prerequisites are missing. Do not run destructive tests against production.
- The old bridge's compendium endpoint may not exist in your local bridge setup. A relay fake is not a live ThreeHats compatibility test.

## Evidence and release claims

Local unit tests, the fake relay, and smoke/package tests verify source contracts and packaging, **not** live upstream API or Foundry-version support. Only update `compatibility.tested` for system/module integrations after actually testing the stated combination, and record version, commands, outcomes and known limitations. The [overhaul implementation record](../../docs/prps/provider-session-integration-overhaul.md) contains dated baseline evidence rather than a guarantee about subsequent commits.
