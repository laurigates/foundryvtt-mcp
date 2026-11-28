# Project: foundryvtt-mcp

Model Context Protocol (MCP) server bridging AI assistants with FoundryVTT tabletop gaming software.

## Tech Stack

- **Language**: TypeScript (ES modules, `.js` imports for MCP SDK compatibility)
- **Runtime**: Node.js (Bun as package manager)
- **Test**: Vitest (unit + integration), Playwright (E2E)
- **Lint/Format**: Biome (linting + formatting)
- **Validation**: Zod schemas

## Essential Commands

```bash
just qa                # Lint, TypeScript (src + scripts), bindings and Vitest coverage
bun run build          # Compile TypeScript
bun run dev            # Development mode with hot reload
bun test               # Unit tests (Vitest)
bun run test:integration # Integration tests (needs :30001 container + .env.integration — prefer `just test-integration-docker`)
bun run test:e2e       # E2E tests (Playwright, headless)
bun run lint           # Lint code (Biome)
bun run lint:fix       # Auto-fix lint issues
bun run format         # Format code (Biome)
bun run test-connection # Test MCP→FoundryVTT connection
```

## Architecture

### Data Flow

1. MCP discovery and calls use `src/tools/catalog.ts`.
2. The catalog resolves `target_id` through `src/sessions/`.
3. Core handlers consume the target's `FoundryCore` provider interface.
4. System/module packages declare fixed bindings that the target's integration
   manager evaluates through the same target's execution provider.
5. Responses include target and session provenance.

### Key Modules

| Module | Path | Purpose |
|--------|------|---------|
| Providers | `src/providers/` | Core port, per-instance cache, transport and execution backends |
| Sessions | `src/sessions/` | Target routing, independent lifecycle, identity and generation checks |
| Integrations | `src/integrations/` | Manifest loader, operation availability, binding execution |
| Systems/modules | `systems/`, `modules/` | Separate packages: bindings, probes, manifests and READMEs |
| Auth | `src/foundry/auth.ts` | 4-step Socket.IO authentication |
| Config | `src/config/index.ts`, `src/config/targets.ts` | Validated environment and target configuration |
| Tools | `src/tools/definitions.ts` | MCP tool schemas |
| Catalog | `src/tools/catalog.ts` | Unified discovery, target routing and dispatch |
| Types | `src/foundry/types.ts` | FoundryVTT entity interfaces |

### Authentication & transport selection

Providers are selected per target before dispatch: `socketio`, `legacy-rest`,
`rest-api`, or `composite`. A Socket.IO target may add the historical REST bridge
with `restUrl` and `restApiKey`; the bridge augments reads within that target.
Socket.IO remains primary, and a failed bridge read falls back to the native
answer or an unavailable value. The composite instead combines native core
access with ThreeHats relay execution and verifies their remote identities.
Operations never change target or retry automatically after an uncertain mutation.

Without explicit target configuration, legacy environment settings become one
target. `resolveTransportPlan` selects native Socket.IO by default, Socket.IO
with the optional bridge when `FOUNDRY_API_KEY`, `FOUNDRY_REST_URL` and native
credentials are present, and the historical `legacy-rest` provider for a key
without that complete combination. `FOUNDRY_PROVIDER` selects a provider
explicitly. ThreeHats uses separate `FOUNDRY_REST_RELAY_URL`,
`FOUNDRY_REST_API_KEY` and `FOUNDRY_REST_CLIENT_ID` settings.
`USE_REST_MODULE` remains a no-op.

`src/foundry/client.ts` is only a compatibility export. Application code uses
provider interfaces. See [ADR-011](docs/adrs/0011-provider-session-integration-overhaul.md)
and the [configuration guide](docs/guides/providers-and-targets.md).

**Tool availability is target-scoped.** `src/tools/catalog.ts` is authoritative
for MCP discovery, dispatch, resources and schema conflicts. It checks target
readiness, provider capabilities, target-local writes, and D&D 5e-only demo
helpers. A tool may be listed because one configured target supports it but
remain unavailable for a different target; every call is rechecked.

`src/tools/availability.ts` is retained for transport-only compatibility helpers and
tests, **not** used as the multi-target MCP gateway. The server exposes 33
static core tools, 5 management tools and any compatible dynamically loaded
system/module operations. Management discovery remains available while worlds
are offline; resources are target-qualified (`foundry://targets/<id>/actors`).

Write operations require `writeEnabled` on the selected target and the matching
provider and remote permissions. Native Socket.IO core writes use
`modifyDocument`; the standalone relay executes fixed Foundry document APIs.
Composite mode uses Socket.IO for core work and the relay for packaged integration
bindings. A write with an unknown outcome is never retried or failed over
automatically.

See [capabilities](docs/guides/capabilities.md),
[development](docs/guides/development.md) and
[write protocol](.claude/rules/foundry-write-protocol.md).

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `FOUNDRY_URL` | Single native/legacy target | FoundryVTT server URL |
| `FOUNDRY_USERNAME` | Native authentication | FoundryVTT user |
| `FOUNDRY_PASSWORD` | Native authentication | FoundryVTT password |
| `FOUNDRY_USER_ID` | No | Bypass username→ID resolution |
| `FOUNDRY_API_KEY` | No | Historical `/api/*` bridge key; paired with `FOUNDRY_REST_URL` and native credentials, augments the single Socket.IO target |
| `FOUNDRY_REST_URL` | No | Historical bridge URL; a key without this URL or native credentials retains `legacy-rest` |
| `FOUNDRY_WRITE_ENABLED` | No | Legacy single-target write opt-in; explicit targets use their own `writeEnabled` (default `false`) |
| `FOUNDRY_PROVIDER` | No | Select `socketio`, `legacy-rest`, `rest-api` or `composite` in legacy configuration |
| `FOUNDRY_REST_RELAY_URL` / `FOUNDRY_REST_API_KEY` / `FOUNDRY_REST_CLIENT_ID` | Relay | Paired runtime relay settings, distinct from `FOUNDRY_API_KEY` |
| `LOG_LEVEL` | No | `debug` for verbose output |
| `FOUNDRY_TIMEOUT` | No | Request timeout (ms, default 10000) |
| `FOUNDRY_TARGETS_FILE` / `FOUNDRY_TARGETS_JSON` | No | Mutually exclusive explicit target configuration; `FOUNDRY_URL` is not required when used |

## Rules

See `.claude/rules/` for detailed guidelines:
- `development.md` — TDD workflow, commit conventions, build commands
- `testing.md` — Test tiers (unit, integration, E2E) and requirements
- `foundry-write-protocol.md` — target providers, optional REST read augmentation and the native/relay write protocols
- `document-management.md` — Document detection and organization

## Reference

- [FoundryVTT API](https://foundryvtt.com/api/)
- [Playwright Docs](https://playwright.dev/docs/intro)
- [MCP SDK](https://modelcontextprotocol.io/docs)
