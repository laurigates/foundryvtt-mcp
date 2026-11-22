# Development Guide

This guide describes the target-scoped provider/session architecture on `feat/multiworld-provider-overhaul`. For architectural rationale see [ADR-011](../adrs/0011-provider-session-integration-overhaul.md), for configuration see [Providers and targets](providers-and-targets.md), and for extension contracts see [Writing integrations](writing-integrations.md).

## Toolchain and conventions

- Node.js 18+ and TypeScript ES modules (`.js` suffixes in source imports); Bun is the preferred package manager (`bun.lock`).
- Use the `justfile` recipes for repeatable local checks. Biome formats/lints, Zod checks external data, Vitest tests TypeScript and Python's standard-library unittest runs adapters.
- Follow **RED → GREEN → REFACTOR** for behavior changes. Write tests for new behavior and for any fixes affecting a public contract.
- Keep secrets out of commits and logs; the pre-commit hook requires Gitleaks and runs `lint-staged`. Never use `as any` to bypass contract validation.
- Use conventional commit messages (`feat(scope):`, `fix(scope):`, `docs:`, `test:`, etc.).

## Architecture and ownership

```text
src/index.ts                     MCP stdio entry point, startup and shutdown
  └─ src/tools/catalog.ts         One catalog for discovery, calls and resources
       └─ src/sessions/          Resolve target_id; per-target lifecycle and queue
            ├─ src/providers/    Core ports, transport, world cache and execution
            ├─ src/diagnostics/  Diagnostics scoped to the selected provider
            └─ src/integrations/ Manifest validation, probes, Python worker
                 ├─ systems/     Game-system adapters and projections
                 └─ modules/     Foundry-module adapters and bindings

src/config/index.ts               Environment and backward compatibility
src/config/targets.ts             Explicit target schemas, secrets and routing IDs
src/foundry/                     Authentication, types, cache/search helpers
src/tools/definitions.ts          Static core tool JSON schemas
src/tools/router.ts               Static core handler routing
src/tools/handlers/              Provider-independent core tools
python/foundry_mcp_modules/       Optional versioned JSONL worker
tests/integration/, tests/e2e/    Live integration and browser test tiers
```

`src/foundry/client.ts` is a **compatibility re-export**, not the application's shared client. New handlers accept `FoundryCore` from `src/providers/types.ts`. A `FoundrySession` owns one provider, cache, optional Python worker, generation/identity guards, write settings and pending operations. Different targets may run concurrently; work within a target is serialized.

Supported provider kinds are `socketio`, `legacy-rest` (the historical `/api/*` bridge), `rest-api` (paired ThreeHats runtime relay) and `composite` (native core plus relay execution). Their capabilities are not interchangeable and there is no fallback between providers after a failed mutation.

## Add or change a core MCP tool

1. Add/update its JSON input schema in `src/tools/definitions.ts` and add tests for the contract.
2. Implement the handler under `src/tools/handlers/` using `FoundryCore`, without constructing a new client or changing a global active world.
3. Wire dispatch in `src/tools/router.ts` and test routing/error handling.
4. Review `src/tools/catalog.ts` for required capability, read/write classification, system gating, discovery and execution checks. Tool listing and invocation must enforce the **same** target-local policy; unknown operations must not default to writable/available.
5. Keep `src/tools/availability.ts` and its legacy-transport contract tests consistent where relevant. It is **not** the server's target-aware discovery/dispatch implementation.
6. Cover offline targets, multiple target IDs, disabled writes, capability mismatch, stale generations and result provenance in catalog/session tests.

For resources, update `src/tools/resources.ts` and the corresponding capability/routing logic in `src/tools/catalog.ts` / `src/tools/router.ts`. Public resources are target-qualified (`foundry://targets/<target_id>/actors`); unqualified aliases only work when exactly one target is configured.

## Add a provider or change transport behavior

- Define/extend the `FoundryCore` and `FoundryProvider` ports in `src/providers/types.ts` and add the backend to `src/providers/factory.ts`.
- Validate configuration in `src/config/targets.ts`; a target ID is not a remote world ID or a relay client ID.
- Give each connection its own lifecycle, cache, identity checks, capability set and generation handling. Do not return results from an obsolete connection.
- Preserve the distinction between the native Socket.IO document protocol and relay-executed Foundry document APIs. Never replay uncertain writes automatically; report `outcome_unknown` and require inspection.
- Keep system-specific projections in `systems/<system-id>/actor-projection.json` rather than hardcoding them into a generic provider.
- Add provider, session and protocol regression tests. Live compatibility with a specific Foundry version requires an actual world test; mocked or fake-relay tests cannot establish it.

## Add a system or module integration

1. Put a trusted integration package in `systems/<upstream-id>/` or `modules/<upstream-id>/`, preserving the exact upstream ID.
2. Supply `manifest.json`, `adapter.py`, `README.md`, packaged JS bindings and probes, and adapter tests. Validate the contract using `src/integrations/manifest.ts`.
3. Use the shared `src/integrations/manager.ts` / `python-worker.ts` infrastructure; one optional Python process is scoped to each target. Credentials and provider selection stay in Node, not in Python.
4. Expose names as `system_{id}_{operation}` or `module_{id}_{operation}`. Never normalize hyphens, silently overwrite conflicting schemas or expose arbitrary JS execution as an MCP tool.
5. Probe the actual runtime API, return JSON-safe DTOs, validate inputs/outputs, and only advertise an operation while its target and provider can execute it.
6. Record upstream source, integration version and actual live-tested version combinations. Keep experimental status until live verification is performed.

The detailed manifest and binding contract is in [Writing integrations](writing-integrations.md).

## Development and validation

```bash
bun install --frozen-lockfile
just qa                    # Biome, src/ + scripts/ TypeScript, Vitest, Python tests
just build                 # TypeScript -> dist/
bun run smoke              # Installed entry point startup
bun run smoke:dotenv       # dotenv load order
bun run smoke:integrations # Packaged Python worker integration path
bun run smoke:pack         # npm package in a fresh consumer (requires dependency resolution)
just docs-check            # TypeDoc check
just antipatterns          # ast-grep scan
```

You may run narrower checks while iterating (`just test`, `just check-types`, `just check-types-scripts`, `just test-python`, `just lint`). Before committing, run `just qa` and the relevant build/smoke checks. The regular GitHub test workflow also runs build, script typecheck, Vitest, startup/dotenv/package smoke tests and Biome; not all integration gates are part of that workflow.

### Live tests and evidence boundaries

- `bun run test:integration` exercises `tests/integration/**` against an already running Foundry world, normally on port `30001`. `just test-integration-docker` manages the test container; it needs a local `.env.integration` with the requisite credentials/license. Do not point destructive tests at a production world.
- `just test-e2e` runs Playwright; it requires the matching browser/runtime setup.
- `bun run test:python` and `bun run smoke:integrations` test local worker/adapter contracts, **not** real upstream D&D 5e, PF2e or Item Piles compatibility.
- A successful package smoke test validates shipped assets and runtime paths; it does not substitute for an external Foundry/relay integration test.
- Record commands, versions and actual results. The dated baseline in [the implementation record](../prps/provider-session-integration-overhaul.md) is historical evidence, not proof of the current commit's status.

## API documentation

```bash
just docs
just docs-check
```

TypeDoc output is generated under `build/docs/`. Document public provider contracts and configuration, rather than presenting `FoundryClient` as the production application's sole API.
