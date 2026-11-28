# ADR-015: Extension Boundaries — Named Operations, One Capability Table, Node Only

**Status**: Accepted (Lauri's review of #304, 2026-11-26)
**Date**: 2026-11-28
**Domain**: architecture
**Related**: [ADR-011](0011-dual-mode-transport.md), [ADR-010](0010-mutation-api-conventions.md), [ADR-014](0014-foundry-v13-v14-wire-shapes.md); laurigates/foundryvtt-local-rest-api [ADR-0003](https://github.com/laurigates/foundryvtt-local-rest-api/blob/main/docs/adrs/0003-response-contract.md), [ADR-0006](https://github.com/laurigates/foundryvtt-local-rest-api/blob/main/docs/adrs/0006-named-operations-only.md)
**Issues**: #304

## Context

#304 proposed per-system and per-module adapter packages
(`systems/<id>/<generation>/`, `modules/<id>/<generation>/`), several Foundry
targets per server, and a provider layer. The package shape was welcome. Its
execution model was not: adapter bindings ran by sending JavaScript source to
a third-party relay's `/execute-js` endpoint, writes could go over REST, a
Python worker was a mandatory runtime, availability lived in a provider layer
beside `capabilities.ts`, packages were discovered from whatever sat in a
directory, and upstream versions were exact pins inside the bindings.

None of the constraints it crossed were written down in this repository as
decisions. ADR-011 records the transports and the capability table, and the
bridge records its response contract, but nothing said that browser-side code
must be a named operation, that the host is Node only, or how an extension
declares the Foundry and upstream versions it supports. The deprecated
*REST-only mode* was also easy to read as "the bridge is legacy", which it is
not.

This ADR records the boundaries Lauri set in the #304 review so that any
extension work, by a contributor or an agent, starts from them.

## Decision

1. **Code that must run inside Foundry is a named operation in a companion
   Foundry module**, answered under laurigates/foundryvtt-local-rest-api's
   response contract (its ADR-0003) and its named-operations rule (its
   ADR-0006). The MCP sends an operation name and validated arguments, never
   script source. No transport, relay or adapter that accepts arbitrary
   JavaScript is used, including as an opt-in.
2. **The canonical transports are the two in ADR-011**: Socket.IO to Foundry
   (primary, all writes) and laurigates/foundryvtt-local-rest-api (the
   augment, in dual mode). The bridge is not legacy; only the REST-only *mode*
   is deprecated. A third-party relay is not a supported transport.
3. **Writes stay on Socket.IO `modifyDocument`** until a new ADR says
   otherwise, gated by `FOUNDRY_WRITE_ENABLED` (ADR-011, ADR-010).
4. **`src/foundry/capabilities.ts` stays the single table.** An extension
   operation is a capability entry and a `TOOL_CAPABILITIES` mapping, so
   `tools/list`, the CallTool gate (`src/tools/availability.ts`) and the
   parity tripwires (`capability-matrix.test.ts`, `parity-contract.test.ts`)
   cover it. No parallel provider or availability layer.
5. **The host is Node only.** TypeScript on Node, bun as the package
   manager. No Python or other runtime as a dependency of the server or of
   every target. A package that genuinely needs another runtime would need
   its own ADR, and could at most be opt-in for that package.
6. **Extension packages are allowlisted.** Configuration names the package ids
   and locations to load; the loader does not load whatever is present in a
   directory. Installing or updating from repository URLs is out of scope.
7. **Version ranges, Foundry style.** Each package manifest declares
   `minimum` / `verified` / `maximum` for the Foundry generation and for its
   upstream system or module, the scheme the bridge module uses (its
   ADR-0002): `verified` names a build the package has run on. No exact
   upstream pins inside bindings. A missing generation variant leaves the
   package unavailable; it never falls back to another generation.
8. **One strict schema validator** shared by all packages; a package whose
   schema fails it does not load.
9. **Single-target configuration behaves exactly as today.** Multi-target
   routing (`target_id`) is additive, and a target's world identity comes
   from configuration, not from the first world seen.
10. **Land in small PRs against current `main`**, one concern each: targets
    and sessions; the package format and loader; capability wiring; one
    reference adapter per PR; the companion module's named operations.

## Consequences

- An extension that needs browser-side behaviour costs a release of the
  companion module. That is the price of an auditable surface: a leaked
  bridge key never grants code execution as the GM.
- Tool count must be watched: one MCP tool per operation grows a dnd5e +
  Item Piles world from about 33 tools to 100–120. A per-target operation
  index is an open option.
- Agent-facing docs (`CLAUDE.md` § Architecture boundaries, `AGENTS.md`,
  `CONTRIBUTING.md`) link here; a change to any point above starts as a new
  ADR that supersedes this one.
