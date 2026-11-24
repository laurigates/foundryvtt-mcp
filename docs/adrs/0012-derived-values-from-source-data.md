# ADR-012: Compute Only the dnd5e Values That Are Exact From Source Data

**Status**: Accepted
**Date**: 2026-11-23 (commit 8ecbdbc, PR #309; recorded retroactively 2026-11-24)
**Domain**: data-layer
**Related**: [ADR-001](../blueprint/adrs/ADR-001-socketio-for-foundry-communication.md), [ADR-011](0011-dual-mode-transport.md)
**Issues**: #308, #309

## Context

Socket.IO mode reads actors from the `world` payload, which carries document **source** data. dnd5e computes its derived values (ability `mod`, `details.level`, `attributes.prof`, `attributes.ac.value`, save and skill totals, character `hp.max`) in `prepareData`, which runs only in a browser client. Before #309 the Socket.IO mapper defaulted every ability modifier to +0, and the handlers printed Level and Armor Class as "Unknown" (#308). A caller had no way to tell a real +0 from a missing value.

Some of these values follow from source data by fixed rules; others depend on equipped items, the AC calculation mode, bonuses and Active Effects, which amounts to the system's whole preparation pipeline.

## Decision

`src/foundry/dnd5e-derived.ts` computes only the values whose rules need nothing but source data, and keeps any value the source already provides:

| Value | Rule |
|-------|------|
| Ability modifier | `floor((score - 10) / 2)` |
| Character level | sum of `system.levels` over the actor's `class` items |
| Proficiency bonus | `floor((level - 1) / 4) + 2` |
| Armor class | the stored flat value, only when the calculation is `flat` |

Everything else (non-flat AC, save and skill totals, a character's `hp.max` stored as `null`, anything an Active Effect changes) is not reimplemented. The mapper records it in `derivedUnavailable`, and the handlers print a label saying the value needs a prepared client instead of "Unknown" or a default number.

## Consequences

**Positive:**
- No invented numbers: a value is either exact or labelled as unavailable.
- No dependency on dnd5e internals beyond four stable rules.

**Negative:**
- In Socket.IO-only mode AC (for non-flat calculations), max HP for characters and save totals stay unavailable. [ADR-011](0011-dual-mode-transport.md) fills them from the REST bridge in dual mode.
- The rules are dnd5e-specific. Another game system gets none of them.
- The parity contract (`KNOWN_GAPS` in `src/foundry/parity.ts`) lists `hp.max`, `ac.value` and `abilities.*.save` as REST-only with cause `prepared`; computing one of them from source would close that gap and fail the test until `KNOWN_GAPS` is updated.

## Alternatives Considered

- **Reimplement `prepareData` for dnd5e.** Rejected: version-specific, and Active Effects and item-driven AC make it open-ended.
- **Keep printing "Unknown" / +0.** Rejected: +0 is a plausible real value and misleads callers.
- **Read prepared values from a REST source.** Adopted later as the dual-mode augment (ADR-011); this ADR covers the Socket.IO-only path.
