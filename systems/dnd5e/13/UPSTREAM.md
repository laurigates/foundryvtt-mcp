# D&D5e Foundry 13: upstream source reference

| Field | Value |
|---|---|
| System ID / Foundry generation | `dnd5e` / **13** |
| Adapter version / update | **0.1.1** / **2026-11-22** |
| Upstream repository | [foundryvtt/dnd5e](https://github.com/foundryvtt/dnd5e) |
| Upstream system release | **[5.3.3](https://github.com/foundryvtt/dnd5e/releases/tag/release-5.3.3)** |
| Release tag / date | `release-5.3.3` / **2026-05-07** |
| Resolved source commit | [`965ad2d0cf5d063dac675ba078b5bd3c3c0dd449`](https://github.com/foundryvtt/dnd5e/commit/965ad2d0cf5d063dac675ba078b5bd3c3c0dd449) |
| Source manifest | `id: dnd5e`, `version: 5.3.3`, Foundry minimum **13.347**, upstream verified **14** |
| Source inspection / latest compatible release check | **2026-11-22** |
| Latest stable release compatible with Foundry 13 | **5.3.3** |
| Latest stable release overall at this check | **6.1.1**, requiring Foundry **14.367**; used by the separate generation-14 package |
| Live verification | **None**; `compatibility.tested: []`, `upstream.verifiedAt: null` |

## Release selection

The official release catalog contains **5.3.3**, published on 2026-05-07. Its
resolved `system.json` has minimum `13.347`, so generation 13 remains within its
declared Foundry range. The nine newer stable releases, **6.0.0–6.0.6** and
**6.1.0–6.1.1**, were checked through their tagged manifests; each declares
minimum `14.367`. They do not replace this generation-13 source reference.

The upstream `verified: 14` field is the system author's compatibility
declaration. It is not a test result for this MCP adapter and does not allow this
folder to activate on generation 14. This selection follows the
[release → tag → commit policy](../../../docs/guides/writing-integrations.md#upstream-source-references)
for the actual system and Foundry generation; it does not fall back to an
unidentified commit when an official release exists.

## Inspected contract and scope

The inspection was limited to the retained `get_actor_data` contract. All source
links below are fixed to the resolved release commit:

| Source | Relevant evidence |
|---|---|
| [`system.json`](https://github.com/foundryvtt/dnd5e/blob/965ad2d0cf5d063dac675ba078b5bd3c3c0dd449/system.json) | Exact system ID, version, Foundry declaration and Actor document types |
| [`dnd5e.mjs`](https://github.com/foundryvtt/dnd5e/blob/965ad2d0cf5d063dac675ba078b5bd3c3c0dd449/dnd5e.mjs) | Registers `Actor5e` as the current Actor document class and installs the system's Actor data models |
| [`module/documents/actor/actor.mjs`](https://github.com/foundryvtt/dnd5e/blob/965ad2d0cf5d063dac675ba078b5bd3c3c0dd449/module/documents/actor/actor.mjs) | `Actor5e` extends the runtime Actor through `SystemDocumentMixin`, uses `fromUuid`, and uses `this.toObject()` / `source.toObject()` to obtain document source data |
| [`document.mjs`](https://github.com/foundryvtt/dnd5e/blob/965ad2d0cf5d063dac675ba078b5bd3c3c0dd449/module/documents/mixins/document.mjs), [`dependent.mjs`](https://github.com/foundryvtt/dnd5e/blob/965ad2d0cf5d063dac675ba078b5bd3c3c0dd449/module/documents/mixins/dependent.mjs), [`flags.mjs`](https://github.com/foundryvtt/dnd5e/blob/965ad2d0cf5d063dac675ba078b5bd3c3c0dd449/module/documents/mixins/flags.mjs) | The Actor mixin chain keeps the inherited document serialization interface; these mixins do not override `toObject()` |

The package resolves an Actor UUID, checks the document and system IDs, calls the
current Actor's `toObject()` and returns `{id, uuid, name, type, system}`. It does
not evaluate rules, call the system's roll API or mutate state. The existing
schema, binding, probe and display descriptor remain unchanged. Establishing this
source reference does not claim a backport of generation-14 operations, complete
D&D5e API coverage or a fresh field-by-field validation of the display descriptor.

## Metadata and runtime boundaries

The manifest now records the repository, release tag plus full resolved commit,
and release date. Its live verification date remains null and its live test
matrix remains empty. The adapter version stays **0.1.1**, because this change
records source provenance without changing the operation's implementation or
public contract.

Generation selection belongs to the host, using the folder and matching numeric
`foundryGeneration: 13`. The original probe tests capabilities only. Empty exact
version arrays and the preserved binding do not enforce the source release's
minimum build or restrict execution to system 5.3.3. The pin identifies inspected
code; a successful probe does not certify arbitrary release/module combinations.
There is no cross-generation fallback. Every source needed to generate or test
this package remains inside this directory.

Further API coverage requires operation-specific source inspection and tests.
Mark live support only after actual runtime validation; local fixture tests do
not establish it.
