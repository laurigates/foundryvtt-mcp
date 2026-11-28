# D&D5e upstream contract and coverage

The package is independently installable for Foundry generation **14**. Its
numeric `foundryGeneration` matches its directory. Host generation selection
also constrains the unchanged legacy raw read; the legacy probe itself remains
capability-based. No build or runtime import requires another generation.

## Inspected source

| Field | Value |
|---|---|
| Package Foundry generation | **14**; `foundryGeneration: 14` |
| Official repository | [foundryvtt/dnd5e](https://github.com/foundryvtt/dnd5e) |
| Upstream system version | **6.1.1** |
| Reference kind / tag | Release [`release-6.1.1`](https://github.com/foundryvtt/dnd5e/releases/tag/release-6.1.1) |
| Resolved commit | [`bc1b2c921e2f306dc5079f8de883ad64607118a6`](https://github.com/foundryvtt/dnd5e/commit/bc1b2c921e2f306dc5079f8de883ad64607118a6) |
| Release published | 2026-11-16 |
| Source inspection / latest-release check | 2026-11-22; latest published release matches this baseline |
| Upstream Foundry declaration | Minimum **14.367**, verified **14** |
| Adapter version / update | **0.2.0** / 2026-11-22 |
| Live verification | None; `compatibility.tested: []`, `upstream.verifiedAt: null` |

The source [system.json](https://github.com/foundryvtt/dnd5e/blob/bc1b2c921e2f306dc5079f8de883ad64607118a6/system.json)
records version 6.1.1 and the actual Foundry minimum. The repository's project
scope begins at Foundry 13, but this release requires 14.367. Newly added operations
accept only system 6.1.1 and Foundry generation 14 at build 367 or later; later
generations need a new source review. These gates are not live verification.

The historical `get_actor_data` binding, probe and public schema are preserved.
Its capability-based availability is independent of the new API contract. Exact
version-filter arrays remain empty to preserve that operation; new bindings and
probes enforce their narrower restrictions.

## Primary sources inspected

All source links are immutable commit links:

- [Actor document implementation](https://github.com/foundryvtt/dnd5e/blob/bc1b2c921e2f306dc5079f8de883ad64607118a6/module/documents/actor/actor.mjs): prepared data, check/save/skill/tool/death/concentration/hit-die rolls, damage, rests and the status-effect override.
- [Document API types](https://github.com/foundryvtt/dnd5e/blob/bc1b2c921e2f306dc5079f8de883ad64607118a6/module/documents/_types.mjs): typed damage descriptions, rest configuration and result contracts.
- [Item implementation](https://github.com/foundryvtt/dnd5e/blob/bc1b2c921e2f306dc5079f8de883ad64607118a6/module/documents/item.mjs) and [base activity data](https://github.com/foundryvtt/dnd5e/blob/bc1b2c921e2f306dc5079f8de883ad64607118a6/module/data/activity/base-activity.mjs): ownership, availability, prepared data, spell-slot and concentration requirements.
- [Activity document mixin](https://github.com/foundryvtt/dnd5e/blob/bc1b2c921e2f306dc5079f8de883ad64607118a6/module/documents/activity/mixin.mjs) and [activity types](https://github.com/foundryvtt/dnd5e/blob/bc1b2c921e2f306dc5079f8de883ad64607118a6/module/documents/activity/_types.mjs): usage, consumption, cloning, scaling, subsequent actions, damage and usage result shape.
- [Attack activity](https://github.com/foundryvtt/dnd5e/blob/bc1b2c921e2f306dc5079f8de883ad64607118a6/module/documents/activity/attack.mjs) and [attack data](https://github.com/foundryvtt/dnd5e/blob/bc1b2c921e2f306dc5079f8de883ad64607118a6/module/data/activity/attack-data.mjs): ammunition, attack mode, ability, flags and the separate ammunition Item contract for damage.
- [Utility activity](https://github.com/foundryvtt/dnd5e/blob/bc1b2c921e2f306dc5079f8de883ad64607118a6/module/documents/activity/utility.mjs): rolling the already-configured formula.
- [Basic roll implementation](https://github.com/foundryvtt/dnd5e/blob/bc1b2c921e2f306dc5079f8de883ad64607118a6/module/dice/basic-roll.mjs), [D20 roll](https://github.com/foundryvtt/dnd5e/blob/bc1b2c921e2f306dc5079f8de883ad64607118a6/module/dice/d20-roll.mjs) and [roll types](https://github.com/foundryvtt/dnd5e/blob/bc1b2c921e2f306dc5079f8de883ad64607118a6/module/dice/_types.mjs): the three-argument process/dialog/message contract and Foundry 14 message modes.
- [Condition data](https://github.com/foundryvtt/dnd5e/blob/bc1b2c921e2f306dc5079f8de883ad64607118a6/module/data/active-effect/condition.mjs): levelled conditions behave differently from Boolean status effects.
- [System configuration](https://github.com/foundryvtt/dnd5e/blob/bc1b2c921e2f306dc5079f8de883ad64607118a6/module/config.mjs) and [initialization](https://github.com/foundryvtt/dnd5e/blob/bc1b2c921e2f306dc5079f8de883ad64607118a6/dnd5e.mjs): installed document classes, activity classes, skill/tool IDs and supported data types.

## Consequences for the adapter

### Actual methods and installed wrappers

The adapter calls `actor.rollSkill(...)`, `actor.applyDamage(...)`,
`actor.shortRest(...)`, or the selected `item.system.activities.get(id)` instance.
It does not call a cached base prototype or replace a system method with generic
document updates. Capability probes inspect the configured classes, then each
call checks the actual selected instance again. Runtime module wrappers and system
hooks therefore remain in the execution path.

This preserves dispatch; it does not prove compatibility with every installed
automation module. A wrapper can change dialogs, results or side effects. Exact
system version and method presence cannot identify all such changes.

### Rolls are mutating operations

All rolls are classified as writes even when `chat_message:false`. Death saves
can change counters and HP, hit dice consume resources and heal, attacks can
consume ammunition or thrown items, and activity rolls can update last-used flags.
Hooks may add further writes. The host must enable target-local writes and the
runtime user needs OWNER permission on the Actor (or GM).

The inspected APIs accept `(process, dialog, message)` objects. The adapter passes
`{configure:false}` for dialogs and leaves rule calculation to D&D5e. The accepted
Foundry 14 message modes are `public`, `gm`, `blind`, `self`; the system argument
is still called `message.rollMode`. Earlier `*roll` mode values are rejected.

For non-GM execution, a roll requires explicit `chat_message:true`. Some upstream
methods clone message configuration, so a hidden mode forced by a hook cannot
always be recovered when no ChatMessage exists. The result is returned only if
the actual parent ChatMessage has `isContentVisible === true` and is not blind.
Otherwise the DTO has `rolls_redacted:true` and no dice, totals or formula. This
also covers a wrapper suppressing the expected chat message. GM execution can
return the result without creating chat. Actor state remains a separately
permission-checked observation; it may show legitimate HP/counter changes.

### Damage and condition semantics

Typed damage entries are `{type, value, properties}` with numeric amounts and
known runtime definitions. Property arrays become Sets required by D&D5e. Numeric
bare damage is not passed, because the upstream numeric overload defaults to
ignoring damage modifiers. `calculate_damage` is a preview using the same rule
method; its hooks run and its result is not reserved for a later application.

`applyDamage` can return the Actor even when a pre-hook vetoes updates or immunity
reduces damage to zero. The adapter reports observed `before`, `after` and
`hp_changed`; an unchanged pool is not mislabeled as an applied amount. It does
not automatically perform concentration checks or construct a full spell workflow.

The D&D5e `toggleStatusEffect` override applies a level delta for levelled
conditions, even when a caller might expect `active:false` to mean removal.
`set_condition` rejects levelled definitions such as exhaustion. For Boolean
conditions it passes an explicit desired state, checks the observed status and
accepts a false return on successful removal rather than treating it as failure.

### Rest responses and evidence

`shortRest` and `longRest` own recovery, spell resources and effect expiry. The
adapter disables dialogs, automatic hit-die spending, game-clock advancement and
bastion turns; `new_day` must be selected explicitly. A separate `roll_hit_die`
operation provides a deliberate resource-spending step before a short rest.

Upstream can return a calculated `RestResult` after a `preRestCompleted` veto.
The adapter checks `updateData`, `updateItems` and `deleteItems` against observed
documents before reporting `observed_planned_updates:true`. This flag describes
those planned document updates only: it is not proof that every effect expiry or
third-party hook completed. Before/after Actor observations include effect UUIDs;
use `get_effects` to inspect expiry. There is no rollback or automatic retry.

### Activity use and context boundaries

`activate_activity` uses public `Activity.use` for built-in attack, check, save,
damage, heal and utility activities. It disables templates and subsequent
actions, so usage never claims to complete an attack, spell, save request or target
effect. Concentration activities are rejected; specialized types are excluded.

Slot-consuming spell activation requires an explicit `spell_slot` with a positive
finite balance and a level exactly matching the spell's base level. The inspected
upstream path does not consistently reject missing or lower-level slots, so the
adapter checks before dispatch. Higher-level slots are also rejected because
upcasting works on an Item clone, and a subsequent independent MCP call does not
automatically retain that clone's scaling/consumption context. This includes pact
slots whose effective level exceeds the spell level.

Activity rolls are independent operations on the current Item. Attack damage
requires explicit ability, attack mode and ammunition ID (or null), and passes
the actual ammunition Item to the damage API. Attack rolling instead passes its
ID, matching the two different upstream contracts. If ammunition was deleted,
its missing context is rejected rather than silently losing its damage properties.
Scaled/consumed Item flags and hit-die consumption contexts are rejected by the
standalone damage/formula operations. The caller must not treat activation then
rolling as an automatic continuation of the UI workflow.

Activity APIs read the runtime user's token targets implicitly. The bridge
requires that target selection to be empty before activation/attack/damage/formula
calls; it never changes the browser user's selection. Damage application uses an
explicit Actor UUID. There is no inference of target, attack outcome or critical
state from a previous call.

### Uncertain responses and serialization

Exceptions, empty roll results and unconfirmed API responses after dispatch are
reported as `outcome_unknown` with no retry. This does not imply cancellation or
rollback. A hook can fail after document changes, and provider timeout cannot
undo an executed request.

DTO conversion handles Sets, Maps, document references and non-finite values;
document identity is retained, including `_id` in usage plans. Private internal
fields and functions are omitted, and cycles become null. Upstream result plans
are labeled `reported_updates` rather than presented as independent snapshots.

## Deliberately excluded surfaces

| Surface | Boundary |
|---|---|
| Full system API, character creation, advancement, migration | Not exposed by these 25 operations |
| Generic `Item.use`, activity-choice dialogs | Exact activity IDs and fixed operations only |
| Summon, transform, teleport, enchant, cast, order, forward or custom activity types | No uncontrolled placement, cross-item selection or UI continuation |
| Upcasting, concentration activation, consumed-hit-die roll context | Requires a dedicated persisted execution-context contract |
| Targeted automation, attack-vs-AC resolution, saving throw requests, effect application | Not inferred from browser target state or chained automatically |
| Initiative workflow | Core encounter selection/create/reroll semantics are not duplicated in this package |
| Levelled conditions, arbitrary effect edits or arbitrary resource paths | No guessed Boolean behavior or generic rule-data writes |
| Formulas, JavaScript, method names from callers | Only fixed schemas; utility rolls use stored activity formulas |
| UI, sheet rendering, compendium import, world settings, bastions | Outside the exposed data workflow scope |

Local tests exercise the generated bindings with controlled fixtures. They do
not run the entire official system, Foundry, a relay or installed automation
modules. Record real version combinations only after the README's live checks.
