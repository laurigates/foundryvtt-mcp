# D&D5e integration

This package exposes **25 fixed MCP operations: 10 reads and 15 writes** for
prepared Actor and Item data, abilities, skills, saves, typed damage, recovery,
Boolean conditions and selected activity workflows. It invokes the installed
system's document methods and preserves runtime module wrappers. It does not
implement the complete D&D5e API or reproduce every sheet/chat-card workflow.

| Metadata | Value |
|---|---|
| Package Foundry generation | **14**; `foundryGeneration: 14` |
| Foundry system ID | `dnd5e` |
| Adapter version / update | **0.2.0** / **2026-11-22** |
| Status | **Experimental** |
| Official source repository | [foundryvtt/dnd5e](https://github.com/foundryvtt/dnd5e) |
| Upstream system release | **[6.1.1](https://github.com/foundryvtt/dnd5e/releases/tag/release-6.1.1)** |
| Upstream release tag | `release-6.1.1` |
| Resolved upstream commit | [`bc1b2c921e2f306dc5079f8de883ad64607118a6`](https://github.com/foundryvtt/dnd5e/commit/bc1b2c921e2f306dc5079f8de883ad64607118a6) |
| Release published | **2026-11-16** |
| Source inspection / latest-reference check | **2026-11-22**; latest published release matches the inspected baseline |
| Upstream Foundry declaration | Minimum **14.367**, verified **14** |
| New-operation runtime gate | System **6.1.1**, Foundry generation **14**, build **367 or later**, ready runtime and required methods |
| Project Foundry scope | **13 or later**; this system release has a narrower minimum |
| Actually tested live combinations | **None**; `compatibility.tested: []`, `upstream.verifiedAt: null` |
| Worker protocol | **1** |

Upstream **6.1.1** is the source version to keep synchronized; **0.2.0** is this
repository's adapter version. The [pinned source manifest](https://github.com/foundryvtt/dnd5e/blob/bc1b2c921e2f306dc5079f8de883ad64607118a6/system.json)
requires Foundry 14.367. Project scope starting at generation 13 does not make
this release compatible with generation 13. Later system versions and Foundry
generations require another source review before the new operations are enabled.
Reference selection follows the [release → tag → commit policy](../../../docs/guides/writing-integrations.md#upstream-source-references).

The original `get_actor_data` binding, probe and public schema remain unchanged.
That read stays capability-based and does not inherit the new version gates.
Its availability does not certify an untested combination. Foundry 12 and earlier
remain outside the project's maintenance scope. See [UPSTREAM.md](UPSTREAM.md)
for inspected APIs, source links and the reasons for the coverage boundaries;
the [system bridge catalog](../../../docs/bridges/systems.md) records other packages.

## Autonomous generation-14 package

This entire directory is the installable `systems/dnd5e/14/` unit. Its
manifest, adapter, sources, generated scripts, tests and examples stay together;
there are no runtime or build imports from a sibling generation. The shared host
owns transport, target routing and worker lifecycle. It selects this package
only for Foundry generation **14**, including the preserved `get_actor_data`
operation. Missing generation metadata or a missing exact-generation package
never authorizes cross-generation fallback. The exact system version/minimum
build checks below apply in addition to this package selection.

For an isolated copy, run `node build.mjs --check`,
`node --test tests/*.test.mjs` and
`python3 -B -m unittest discover -s tests -v` from this directory.

## Install and connect

### 1. Install the source system version

Install **D&D5e 6.1.1** on Foundry **14.367 or later within generation 14**, using
the versioned manifest published with the inspected release:

```text
https://github.com/foundryvtt/dnd5e/releases/download/release-6.1.1/system.json
```

Start the intended world using the `dnd5e` system. A running Foundry server has
one active world and that world has one active system. Record any active modules
when testing: a module may wrap the system methods that this adapter calls.
No live system/module/relay combination has been validated by this package yet.

### 2. Install this MCP branch

```bash
git clone --branch feat/multiworld-provider-overhaul https://github.com/p4535992/foundryvtt-mcp.git
cd foundryvtt-mcp
npm install
node systems/dnd5e/14/build.mjs --check
npm run build
```

Use Node.js 18+ and Python 3.10+. The branch includes the Python adapter, generated
bindings, probes and manifest; no additional Python dependencies are needed by
the adapter. These instructions do not install a Foundry world or publish a new
npm release.

### 3. Configure an execution-capable target

Use `rest-api` or `composite` with an active paired Foundry client and permission
to execute through the relay. Standalone `socketio` and historical `legacy-rest`
providers do not provide the `runtime.execute` capability used by these bindings.

Copy [examples/targets.example.json](examples/targets.example.json), replace its
world, origin, relay and client placeholders, and set `FOUNDRY_TARGETS_FILE` to
the copy's absolute path. The example uses target `dnd5e-14-demo` and enables writes
for a controlled test world. Credentials are environment-variable references.

```dotenv
FOUNDRY_TARGETS_FILE=/absolute/path/dnd5e-targets.local.json
FOUNDRY_DEMO_USERNAME=Your Foundry user
FOUNDRY_DEMO_PASSWORD=your-world-user-password
FOUNDRY_DEMO_RELAY_API_KEY=your-relay-key
```

Point the MCP client at `node /absolute/path/foundryvtt-mcp/dist/index.js` with
those variables. Both connections must be available for a composite target.
The shared [provider guide](../../../docs/guides/providers-and-targets.md) covers
other configurations and target identity checks.

New reads require **OBSERVER** permission on requested documents; new mutations
require target-local **`writeEnabled: true`** and **OWNER** permission on the
Actor and any selected Item, or a **GM runtime**. Mutations reject compendium
documents. The paired runtime user's permissions matter even when the native
connection uses a different account. System configuration reads have no selected
document. The historical `get_actor_data` behavior is retained as described above.

### 4. Check discovery

Call `list_targets`, then `get_target_status` and `list_systems` with
`{"target_id":"dnd5e-14-demo"}`. Check world/system identity, source version and
operation availability. Each new operation probes its required methods separately
and rechecks runtime readiness before execution. A missing method disables the
affected operation without inventing a replacement API.

## Calls and results

The public tool prefix is `system_dnd5e_`. `target_id` chooses the configured
connection; document UUIDs identify documents inside that connection's world.

```json
{
  "name": "system_dnd5e_roll_skill",
  "arguments": {
    "target_id": "dnd5e-14-demo",
    "actor_uuid": "Actor.REPLACE_HERO_ID",
    "skill": "ath",
    "chat_message": true,
    "roll_mode": "public"
  }
}
```

Use `get_system_config` to discover valid runtime ability, skill, tool, damage
and condition IDs; use the read operations to discover exact Item and activity
IDs. Arbitrary scripts, formulas, method paths and generic `system` updates are
not accepted. Utility rolls use the formula already stored on the activity.

The host wraps the operation result in structured MCP output with `target_id`,
`world_id`, `session_generation` and `result`. It removes `target_id` before
validating the package input. With multiple configured targets, select one
explicitly. The original `get_actor_data` result remains
`{id, uuid, name, type, system}` with its unmodified source `system` object.

## Operation catalog

All names below have the `system_dnd5e_` prefix. [manifest.json](manifest.json)
contains the exact machine-readable input/output schemas.

| Operation | Kind | Behavior and boundary |
|---|---|---|
| `get_actor_data` | Read | Preserved source Actor read and legacy capability probe |
| `get_actor_summary` | Read | Prepared abilities, skills, tools, attributes, spells, currency, traits and statuses |
| `get_actor_items` | Read | Actor inventory, prepared Item data and activity IDs; optional exact Item type |
| `get_item_data` | Read | Selected Item source and prepared system data |
| `get_effects` | Read | Actor and embedded-Item effects, statuses, suppression and disabled state |
| `get_roll_data` | Read | Actual `Actor.getRollData`, with JSON-safe document references |
| `get_system_config` | Read | Selected rule definitions and active module IDs/versions |
| `calculate_damage` | Read | Typed damage/healing preview through system modifiers; no HP update |
| `get_activities` | Read | Selected Item activity list and availability |
| `get_activity` | Read | Exact activity definition and prepared usage properties |
| `roll_ability_check` | Write | System ability check with optional advantage/disadvantage/DC |
| `roll_saving_throw` | Write | System saving throw for an explicit ability |
| `roll_skill` | Write | System skill check, optionally with an explicit ability |
| `roll_tool_check` | Write | System tool proficiency check |
| `roll_death_save` | Write | Death save with zero-HP/counter preflight; may change HP or counters |
| `roll_concentration` | Write | System concentration save at an explicit DC; no independent concentration removal |
| `roll_hit_die` | Write | Spend one available die of an explicit denomination and request system healing |
| `apply_damage` | Write | Typed damage/healing; reports observed HP before/after and whether it changed |
| `short_rest` | Write | System short rest with explicit `new_day`, no automatic hit-die spending |
| `long_rest` | Write | System long rest with explicit `new_day` |
| `set_condition` | Write | Explicit Boolean status on/off; levelled definitions such as exhaustion rejected |
| `activate_activity` | Write | Resource activation for selected built-in types; templates and subsequent actions disabled |
| `roll_activity_attack` | Write | Independent attack roll with selected ability/mode/ammunition; may consume ammunition |
| `roll_activity_damage` | Write | Independent base-context damage/healing roll; does not apply damage |
| `roll_activity_formula` | Write | Independent stored utility formula roll |

### Roll messages and visibility

All rolls are writes, including a GM roll with `chat_message:false`, because
system methods or hooks can change resources, flags, counters or documents.
Configuration dialogs are disabled. Accepted `roll_mode` values are Foundry 14
**`public`, `gm`, `blind`, `self`**; older `*roll` names are rejected.

Non-GM rolls require **`chat_message:true`**. Results expose dice/formulas/totals
only when the actual returned ChatMessage confirms its content is visible and
is not blind. Hidden or unconfirmed visibility returns `rolls: []` and
`rolls_redacted: true`. A wrapper suppressing the expected message also causes
redaction. A GM may roll without chat and receive the result. `observed_actor`
contains separately permission-checked current resources/statuses.

### Damage, recovery and observed state

Damage entries carry an explicit type, positive amount and optional known
properties; healing uses a healing type and positive amount. The system owns
resistance, immunity, vulnerability and modifier rules. A preview is not a
reservation: state and hooks can change before application. `apply_damage`
reports `before`, `after` and `hp_changed`; immunity, clamping or a hook veto can
leave HP unchanged without proving that the raw requested amount was applied.

Rests disable dialogs, world-time advancement and bastion turns. Choose
`new_day` explicitly and spend hit dice in a separate deliberate call if needed.
`observed_planned_updates` checks the returned Actor/Item update plan against
observed documents. It does not certify every effect expiry or third-party hook;
before/after state includes effect UUIDs and `get_effects` permits a follow-up
inspection. No operation rolls back or retries a partly executed workflow.

### Activity context boundaries

Activity mutation/roll operations require an **empty runtime token-target
selection**. They do not change that selection or infer targets. Supported
activation types are built-in attack, check, save, damage, heal and utility;
concentration and specialized placement/selection activities are excluded.
Activation does not automatically roll attack/damage, apply effects, request
saves or create templates.

A slot-consuming spell requires an explicit available `spell_slot` whose level
matches the spell's base level exactly. Missing/exhausted slots, undercasting,
upcasting and higher-level pact slots are rejected. The upstream activation
creates a clone with usage/scaling state; independent MCP calls do not retain
that context automatically.

For attack damage, explicitly provide `ability`, `attack_mode` and
`ammunition_id` (or null). The damage API receives the actual ammunition Item;
if the final ammunition Item was deleted by an attack, the missing context is
rejected. Damage/formula calls reject scaled or consumed Item flags and hit-die
consumption contexts. They do not read a prior chat card or infer critical state.
These are controlled standalone operations; complete upcast/target automation
requires a separate persisted-context contract.

## Core, system and module coexistence

Each target selects one active system; system and module tools retain separate
namespaces. Use core tools for generic document/world operations, these system
tools for D&D5e rule actions, and module tools for the explicit module workflows
they implement. Installed modules can still wrap these actual Actor/Activity
methods. There is no universal rule that the last installed module should replace
every core/system call, and the adapter never calls a saved base prototype to
evade a wrapper.

Method dispatch preserves runtime extension points; it does not certify every
module combination. On `outcome_unknown`, inspect resources, inventory, effects
and chat before another action. Do not retry or fall back to a generic core write:
the first call may already have changed state before a hook/transport failure.

## Examples and validation

[examples/workflows.md](examples/workflows.md) explains inspection, skill/save
rolls, typed damage/recovery, conditions, rests, independent weapon rolls and
resource activation. [examples/workflows.json](examples/workflows.json) includes
manual call recipes for every operation, with explicit `REPLACE_*` UUID/ID
placeholders. It is not an automatic batch or a promise of complete UI behavior.

The implementation registry and runtime factory are the source of truth for
new bindings/probes. Regenerate deterministically after editing them:

```bash
node systems/dnd5e/14/build.mjs --write
node systems/dnd5e/14/build.mjs --check
node --test systems/dnd5e/14/tests/*.test.mjs
python3 -B -m unittest discover -s systems/dnd5e/14/tests -v
```

Local tests execute the generated bindings with controlled fixtures and cover
dispatch, permission/version gates, actual runtime wrappers, message visibility,
resource preflight, observed results and uncertain outcomes without retries.
They do not run the complete official system, Foundry or a relay. For live
validation, record the precise Foundry/system/provider/module versions, confirm
read discovery first, then validate each needed write on a controlled Actor and
inspect resources/effects/chat after it. Only an actual live run may populate
`compatibility.tested` and `upstream.verifiedAt`.

`actor-projection.json` retains the existing HP, AC, level and ability display
paths moved out of generic provider code. It is an unchanged display projection,
not a rule implementation or a fresh certification of every field in 6.1.1.
