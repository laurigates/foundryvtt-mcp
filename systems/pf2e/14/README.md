# Pathfinder 2e integration

This package exposes **22 fixed MCP operations: 10 reads and 12 writes**. It uses
PF2e's prepared statistics, condition Items, resource management, inventory
currency and recharge APIs. Rules remain in the active Foundry runtime. This
package does not expose the complete system API or every sheet interaction.

| Metadata | Value |
|---|---|
| Package Foundry generation | **14**; `foundryGeneration: 14` |
| Foundry system ID | `pf2e` |
| Adapter version / update | **0.2.1** / `2026-11-22` |
| Status | **Experimental** |
| Upstream repository | [foundryvtt/pf2e](https://github.com/foundryvtt/pf2e) |
| Upstream system release | **[8.7.1](https://github.com/foundryvtt/pf2e/releases/tag/pf2e-8.7.1)** |
| Source reference / kind | Release [pf2e-8.7.1](https://github.com/foundryvtt/pf2e/releases/tag/pf2e-8.7.1) |
| Upstream source commit | [`397f125aea87e6d6fa36e878c9c07d0e672826cf`](https://github.com/foundryvtt/pf2e/commit/397f125aea87e6d6fa36e878c9c07d0e672826cf) |
| Upstream release date | `2026-11-17` |
| Source inspected / latest PF2e release checked | `2026-11-22`; matches the latest published PF2e release |
| Project support scope | Foundry **13 or later**, including 13; this release has narrower requirements |
| New-operation runtime gate | PF2e **8.7.1**, Foundry **14.361+ within generation 14**, required runtime APIs |
| Upstream Foundry declaration | Minimum **14.361**, verified **14.370**, maximum **14** |
| Actually tested live combinations | **None**; `compatibility.tested: []`, `upstream.verifiedAt: null` |
| Worker protocol | `1` |

**8.7.1 is the game system version; 0.2.1 is this adapter's version.** The upstream
repository publishes several systems: its generic latest-release endpoint can
identify Starfinder or Anachronism. This adapter pins the release for **`pf2e`**.
See [UPSTREAM.md](UPSTREAM.md) for source analysis and
[coverage boundaries](UPSTREAM.md#deliberate-coverage-boundaries).

## Autonomous generation-14 package

This entire directory is the installable `systems/pf2e/14/` unit. Its
manifest, adapter, sources, generated scripts, tests and examples stay together;
there are no runtime or build imports from a sibling generation. The shared host
owns transport, target routing and worker lifecycle. It selects this package
only for Foundry generation **14**, including the preserved `get_actor_data`
operation. Missing generation metadata or a missing exact-generation package
never authorizes cross-generation fallback. The exact system version/minimum
build checks below apply in addition to this package selection.

For an isolated copy, run `node build.mjs --check` and
`node --test tests/*.test.mjs` from this directory.

## Core display projection

`actor-projection.json` declares the PF2e source paths the shared core uses to
display HP and AC (`system.attributes.hp` and `system.attributes.ac`). It carries
no validation bounds, so the core attribute write path applies no PF2e-specific
limits, matching the behaviour before the projection existed. The file restores
the HP and AC fields the pre-projection client mapped generically; it is a display
projection, not a live compatibility claim.

## Install and connect

Install PF2e **8.7.1** from its [official release](https://github.com/foundryvtt/pf2e/releases/tag/pf2e-8.7.1)
in a compatible Foundry generation-14 installation and launch the intended world.
The MCP package does not install a game system, create a world or migrate data.
Use this MCP branch with Node.js 18+; no extra packages are
required. Configure a `rest-api` or `composite` target with a ready paired client.
The bridge needs `runtime.execute`; standalone `socketio` and historical
`legacy-rest` do not provide it. See [Providers and targets](../../../docs/guides/providers-and-targets.md).

Copy [examples/targets.example.json](examples/targets.example.json), replace its
world/origin/relay/runtime-client placeholders, and point `FOUNDRY_TARGETS_FILE`
to that file's absolute path. Supply `FOUNDRY_PF2E_USERNAME`,
`FOUNDRY_PF2E_PASSWORD` and `FOUNDRY_PF2E_RELAY_API_KEY` through the environment.
The example enables writes for the manual workflows; use a disposable test Actor
while verifying the integration.

Call `list_targets`, then `get_target_status` and `list_systems` with the selected
`target_id`. Only the system matching that world's actual ID activates. Each
server target retains its own world, system, module set and write policy.

### Permissions and readiness

- New reads require Actor **OBSERVER** permission, or a GM runtime.
- Rolls and changes require target-local **`writeEnabled: true`** and Actor
  **OWNER** permission, or a GM runtime. Ownership is rechecked before dispatch.
- Rolls remain writes with chat disabled: rule hooks can change state, and
  strikes can consume ammunition and consumable weapons.
- New operations require the pinned system version and Foundry build range.
  Probes also require an existing Actor exposing the relevant methods. They do
  not roll, change documents or open dialogs.
- `get_actor_data` preserves its historical source-data schema and binding.
  Its capability-based behavior is retained; the new permission/version gates
  are not retroactively substituted into that existing binding.

Foundry below 13 is outside project support. PF2e 8.7.1 itself requires Foundry
14.361 or later: new tools are not claimed to support older PF2e on Foundry 13.

## Operation catalog

All names below have the prefix **`system_pf2e_`**. The host adds `target_id` and
binds each call to the current session. Bindings take `actor_uuid`; use the actual
synthetic Actor UUID when working with an unlinked Token Actor.

### Reads

| Operation | Result / purpose |
|---|---|
| `get_actor_data` | Original Actor identity and unmodified source `system` data |
| `get_actor_summary` | Prepared level, abilities, HP, AC, movement, traits and resources |
| `get_statistics` | Skills/lore, saves and perception with modifiers and DCs |
| `get_statistic` | One existing statistic by its exact slug |
| `get_conditions` | Condition values, active/overridden, locked and temporary state |
| `get_inventory` | Physical inventory and bulk; unidentified names/values hidden from non-GMs |
| `get_currency` | Native currency denominations and copper value |
| `get_resource` | Existing numeric resource, such as `focus` or `hero-points` |
| `get_strikes` | Prepared strike indices, item UUIDs and MAP variants |
| `get_spellcasting` | Spellcasting entries, slots and spells; no casting |

### Rolls and mutations

| Operation | Behavior / limits |
|---|---|
| `roll_skill` | Existing skill or lore via the native Statistic API |
| `roll_save` | `fortitude`, `reflex` or `will`; optional numeric DC |
| `roll_perception` | Native perception check; does not update initiative |
| `roll_statistic` | Existing statistic slug; no caller formula or arbitrary modifier |
| `roll_strike` | One attack/MAP variant with explicit token context; may consume ammo/items; no damage application |
| `set_condition` | Explicit `active: true/false`; no blind toggle |
| `increase_condition` | Increment a valued condition with a bounded maximum |
| `decrease_condition` | Decrease one step or request explicit removal |
| `set_resource` | Native resource update with bounds and observed-value checks |
| `add_currency` | Positive integer pp/gp/sp/cp through native inventory API |
| `remove_currency` | Funds check, optional change and observed copper-value check |
| `recharge` | `turn`, `round` or `day`; can restore spell slots; not a full rest |

### Check context and result visibility

Statistic tools pass `skipDialog: true`. They accept optional `dc`, `token_uuid`,
`message_mode` (`public`, `gm`, `blind`, `self`) and `create_message`. The paired
user's selected targets must be empty because these are non-targeted checks.
Provide `token_uuid` when the Actor has several active tokens. Spell origin,
target-relative defenses, action traits and incapacitation context are not
inferred for a generic save or skill check.

Results include total, formula, natural d20/substitution, degree of success,
message UUID and effective visibility when confirmed. For a non-GM, roll values
are returned only when the callback's actual ChatMessage reports
`isContentVisible === true`, is not blind, and has a recognized non-blind PF2e
message mode. System secret-check policy and later module hooks can override
requested visibility; PF2e context flags alone do not authorize disclosure.
Visible `gm` and `self` messages remain available to their authorized runtime user.
Blind checks or unconfirmed visibility redact every roll value; `message_mode`
is `blind` when known, otherwise `null`. In particular, `create_message: false`
does not prove that a non-GM may see the result. A GM retains access to roll values.
Redaction never repeats the roll or falls back to another operation.

### Strikes and mutations

Read `get_strikes` before choosing `strike_index` and `expected_item_uuid`. Pass
the Actor's only active origin `token_uuid` and an explicit `target_token_uuid`
rendered in the paired client's same scene. Non-GMs need OBSERVER access to the
target Actor. Check dialogs must already be **disabled for the paired user**:
the strike wrapper does not honor a caller's `skipDialog` argument. The bridge
never changes user settings. It preserves upstream ammunition consumption and
consumable-weapon behavior. Alternative usages and damage rolling are excluded.

Condition, resource and currency writes check their observed postconditions.
Recharge checks its returned update plan against source Actor/Item documents,
not only prepared data. Its `affected` summary is reported by PF2e, not an
exhaustive diff of module-hook side effects. Persistent-damage editors and
locked/temporary condition grants are excluded.

Timeouts, exceptions after dispatch and unconfirmed effects produce
**`outcome_unknown`**. Inspect the affected Actor before another action. There is
no automatic retry, rollback or fallback to a core mutation. Multi-document
currency and recharge operations are not guaranteed atomic transactions.

## Examples

[examples/workflows.md](examples/workflows.md) explains inspection, checks,
conditions/resources, currency, strikes and preparation.
[examples/workflows.json](examples/workflows.json) provides one MCP call for each
operation. These manual recipes contain replacement UUIDs; they are not an
executable batch for an arbitrary world.

## Core and module coexistence

Choose system tools for PF2e rules. A core dice expression is not a PF2e check,
and a core status patch is not a valued PF2e condition operation. A module trade
may include pricing and hooks absent from direct system currency editing: do
not execute both paths for one purchase.

Bindings call the current Actor, statistic, strike variant and inventory object.
Installed module wrappers participate naturally. No saved base prototype is
called and no global `module > system > core` overwrite rule is imposed.
Version gates cannot certify every installed module combination. See the
[system catalog](../../../docs/bridges/systems.md) and [source notes](UPSTREAM.md).

## Development and verification

Authored sources are in `src/`. `build.mjs` produces standalone fixed bindings,
probes and the manifest. Generated files are committed and no bundler runs in the
production request path. The binding executes inside the host operation context and
does not open an independent connection.

```bash
node systems/pf2e/14/build.mjs --write
node systems/pf2e/14/build.mjs --check
node --test systems/pf2e/14/tests/*.test.mjs
```

Local tests exercise invocation signatures, generated scripts, readiness,
permissions, live-instance wrapping, source postconditions, secret results,
per-target state and uncertain outcomes. They do not establish live compatibility.

For a live smoke test, use a disposable PF2e 8.7.1 world on Foundry 14.361+.
Discover tools, read statistics, roll a known skill, add/remove a test condition,
change and restore a known resource, then add/remove a tracked coin amount.
Test strikes only with explicit scene tokens and expendable ammo. Test recharge
on a copy of the Actor because it restores resources and slots. Record exact
Foundry/PF2e and active-module versions only after actual successful runs. Until
then keep `compatibility.tested` empty and `upstream.verifiedAt` null.
