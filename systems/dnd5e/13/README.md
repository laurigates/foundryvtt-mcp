# D&D5e integration — Foundry 13

This autonomous package preserves **one experimental read**:
`system_dnd5e_get_actor_data`. It returns the selected Actor's identity and
unmodified source `system` object. No system roll, rule calculation, activity,
resource or mutation operations are available in this variant.

| Metadata | Value |
|---|---|
| System ID | `dnd5e` |
| Foundry generation | **13**; `foundryGeneration: 13` |
| Adapter version / update | **0.1.1** / **2026-11-22** |
| Upstream system release | **[D&D5e 5.3.3](https://github.com/foundryvtt/dnd5e/releases/tag/release-5.3.3)** |
| Upstream tag / release date | `release-5.3.3` / **2026-05-07** |
| Resolved source commit | [`965ad2d0cf5d063dac675ba078b5bd3c3c0dd449`](https://github.com/foundryvtt/dnd5e/commit/965ad2d0cf5d063dac675ba078b5bd3c3c0dd449) |
| Upstream Foundry declaration | [`system.json`](https://github.com/foundryvtt/dnd5e/blob/965ad2d0cf5d063dac675ba078b5bd3c3c0dd449/system.json): minimum **13.347**, verified **14**; this adapter selects **generation 13 only** |
| Source inspection / latest compatible release check | **2026-11-22**; **5.3.3** is the latest stable release supporting generation 13 found in the official release catalog |
| Status | **Experimental** |
| Tested live combinations | **None**; `compatibility.tested: []`, `upstream.verifiedAt: null` |
| Operations | **1 read, 0 writes** |

The historical operation schema, binding and probe are preserved byte-for-byte.
The host selects this folder only for a target reporting Foundry generation 13;
its original capability probe is not a substitute for generation selection.
An absent generation or absent matching package does not authorize fallback to
another generation. Empty exact-version arrays do not widen the folder's scope.

The inspected upstream reference is D&D5e **5.3.3**, covering the manifest,
Actor registration, inheritance and source serialization used by this raw read.
Newer stable **6.x** releases require Foundry **14.367** and are not the source
baseline for this directory. The upstream manifest's `verified: 14` is its own
declaration; it does not change this package's generation or record a live test
of this adapter. See [UPSTREAM.md](UPSTREAM.md) for the inspected files and scope.

This source pin documents the code examined; the preserved capability probe does
not enforce an exact system version or the source manifest's minimum build.
A successful probe does not establish compatibility with every system release.

## Install and use

Keep this entire directory together when copying it. It includes its manifest,
Python adapter, original binding/probe, generator, tests and examples; it has no
runtime or build import from another generation or package. Install it as
`systems/dnd5e/13/` beneath an integration root. The shared host still owns
provider transport, target routing and the Python worker.

Use Python 3.10+ with an active execution-capable `rest-api` or `composite` target.
Standalone `socketio` and historical `legacy-rest` cannot execute this binding.
Node.js 18+ is needed to regenerate or run the local binding tests.
Copy [examples/targets.example.json](examples/targets.example.json), replace its
placeholders and set `FOUNDRY_TARGETS_FILE` to the copy's absolute path. The sample
uses `writeEnabled: false`. See the [provider guide](../../../docs/guides/providers-and-targets.md)
for host configuration.

Call `list_systems` for the intended target, then:

```json
{
  "name": "system_dnd5e_get_actor_data",
  "arguments": {
    "target_id": "dnd5e-13-demo",
    "actor_uuid": "Actor.REPLACE_ACTOR_ID"
  }
}
```

The result keeps its original contract: `{id, uuid, name, type, system}`.
`target_id` selects the connection and is removed before package validation;
`actor_uuid` resolves only inside that target's runtime. Missing Actors and
incorrect document/system identities are errors. The legacy runtime permission
behavior has not been replaced with a different contract.

[Manual examples](examples/workflows.md) and [JSON recipe](examples/workflows.json)
cover the only operation. This variant makes no promise about Foundry-14 APIs.

## Validate this folder independently

From this directory, with no sibling generation present:

```bash
node build.mjs --check
node --test tests/*.test.mjs
python3 -B -m unittest discover -s tests -v
```

`node build.mjs --write` regenerates the manifest and preserved scripts from
package-local sources. Local tests are fixtures, not live Foundry verification.
Update the source pin after examining the corresponding release and record live
combinations only after actual runtime tests; do not copy those claims from
another generation.

`actor-projection.json` preserves the historical display projection unchanged.
Its presence is not a fresh verification of those fields against a Foundry-13
D&D5e release.
