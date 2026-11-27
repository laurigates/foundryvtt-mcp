# ADR-014: Support Foundry v13 and v14 by Accepting Both Wire Shapes

**Status**: Accepted
**Date**: 2026-09-04 (commit 010b005, PR #227); extended 2026-11-23 (add53ef, PR #306) and 2026-11-24 (81452f9, PR #326); recorded retroactively 2026-11-24
**Domain**: foundry-transport
**Related**: [ADR-001](../blueprint/adrs/ADR-001-socketio-for-foundry-communication.md), [ADR-013](0013-live-world-cache-from-broadcasts.md)
**Issues**: #222, #232, #305, #324

## Context

ADR-001 noted that the Socket.IO approach reverse-engineers internal Foundry behaviour and may break across major versions. Between v13 and v14 it did, in three places:

| Change | Seen in | Effect on the MCP |
|--------|---------|-------------------|
| `POST /join` user id key: `userid` (13.348, 14.364) vs `userId` (reported for 14.367) | #222 | HTTP 401 "user does not exist" with correct credentials |
| `POST /join` without an `Origin` header rejected with HTTP 400 | 14.369, #305 | every Socket.IO session failed at auth step 3 |
| A write with side effects acks as `{ results: [...] }` and broadcasts as `modifyDocumentBatch` | 14.369, #232 | `startCombat` threw after creating the Combat; the cache missed batched changes |

Users run both lines: the published package is used against v13 worlds, and the harness and production run 14.369. Foundry does not document these shapes, and which release changed the `/join` key could not be confirmed from a bundle.

## Decision

Support v13 and v14 in one code path by accepting every shape either version sends, rather than branching on a detected version:

- `POST /join` sends the user id under both `userid` and `userId`; each server reads the spelling it wants and ignores the other (#227).
- Both `/join` requests send `Origin` set to the base URL's origin (scheme, host, port; a route prefix stays out) (#306).
- `modifyDocument()` validates both ack shapes with Zod, rejects if any entry carries an error, and returns the primary entry's result; the client subscribes to both `modifyDocument` and `modifyDocumentBatch` (#326).

The wire shape is verified against the official app build cached by the harness (`.claude/rules/foundry-write-protocol.md`), never copied into this repo.

## Consequences

**Positive:**
- One build works on both lines; no version detection to get wrong.
- Each change is pinned by unit tests on both shapes (for example `src/foundry/__tests__/modify-document-v14.test.ts`).

**Negative:**
- Live verification lags the source reading: the 14.369 write round trip is still pending (#324).
- The integration tier pins one build (`docker-compose.test.yml`, currently 14.367), so v13 is covered by unit tests only.
- When v13 support is dropped, the v13-only branches remain until someone removes them deliberately.

## Alternatives Considered

- **Detect the server version and branch.** Rejected: the version is known only after joining, and the `/join` changes happen before that.
- **Support only the latest Foundry.** Rejected: existing v13 users would break on upgrade of the MCP.
