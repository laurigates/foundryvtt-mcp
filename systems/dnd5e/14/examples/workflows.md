# D&D5e workflow examples

The accompanying [workflows.json](workflows.json) contains manual MCP recipes for
every operation. It is not a batch to run. Replace every `REPLACE_*` document or
activity ID, select the correct target, and inspect the prerequisites first.

Use D&D5e **6.1.1** on Foundry **14.367 or later within generation 14**, an
execution-capable `rest-api` or `composite` target, and Python 3.10+. A target has
one active world and one system; names remain `system_dnd5e_*` for that target.
The sample [target configuration](targets.example.json) enables writes for a
controlled test world and references environment variables for credentials.

## Inspect and roll an ability or skill

1. Call `list_targets`, `get_target_status` and `list_systems` for `dnd5e-14-demo`.
2. Call `get_system_config` for valid runtime ability/skill/tool IDs and installed
   module versions; call `get_actor_summary` for prepared values.
3. Use `roll_skill` with `skill:"ath"` for Athletics or `roll_saving_throw` with
   an explicit ability. These invoke the system method, including runtime wrappers.
4. Inspect the returned rolls and `observed_actor`. `chat_message:true` is required
   for non-GM rolls; hidden chat results return `rolls_redacted:true` and no totals.

Use `public`, `gm`, `blind` or `self` for `roll_mode`. These are Foundry 14 modes.
The ordinary core dice tool evaluates a generic dice expression and is not an
alternative implementation of a skill check.

## Typed damage and recovery

1. Read the recipient Actor state.
2. Preview with `calculate_damage`, for example seven fire damage. This invokes
   the system's immunity/resistance/modifier calculation and does not change HP.
3. After deliberately choosing to apply it, use `apply_damage` with the same
   explicit Actor UUID and typed input. The preview is not a reservation.
4. Inspect `before`, `after` and `hp_changed`. Zero change may mean immunity,
   clamping or a hook veto; the result does not claim the requested raw amount
   was applied. Healing uses type `healing` and a positive value.
5. Do not patch `system.attributes.hp.value` through a generic core update to
   simulate damage; that bypasses this system workflow and its hooks.

## Conditions and rests

Use `set_condition` with an explicit `active` value. The example uses `blinded`;
levelled conditions such as exhaustion are rejected. Read `get_effects` afterward.

For a short rest, inspect hit dice, call `roll_hit_die` deliberately if desired,
then call `short_rest` with `new_day:false`. Long-rest examples use
`new_day:true`; choose this according to the game rather than copying blindly.
No automatic hit-die spending, clock advancement or bastion turn is requested.
Inspect Actor resources and effects after the result. The planned-update check
does not prove that every third-party effect-expiry hook ran.

## Independent weapon attack and damage rolls

1. Read the Item and its activity IDs.
2. For a one-handed melee attack, choose the attack activity, `attack_mode:"oneHanded"`,
   an explicit ability and `ammunition_id:null`.
3. If separately rolling damage, explicitly carry the selected ability/mode,
   ammunition identity and critical decision to `roll_activity_damage`. The tool
   does not infer them from a previous call or chat card. It does not apply damage.
4. Ranged ammunition must exist. If the attack deletes the final ammunition Item,
   the bridge cannot reconstruct its damage context and rejects that context.

This is a pair of explicit base-context rolls, not the complete UI attack workflow.
Do not use these examples to approximate upcast, consumed-hit-die or automated
target workflows. Clear the runtime user's token selection first; the tools never
change that selection on the user's behalf.

## Resource activation only

`activate_activity` activates the selected built-in activity and its configured
consumption, with templates and subsequent actions disabled. It does not roll
attack/damage, apply target effects, prompt other players or establish concentration.

For a non-concentration level-1 spell consuming a slot, use an explicit available
`spell1` slot whose effective level is 1. Undercasting, upcasting, higher-level
pact slots, missing slots and exhausted slots are rejected before invocation.
Read Actor and Item state afterward. Do not assume a subsequent roll continues
the internal cloned/scaled Item used by the upstream activation.

## Failure handling

On `outcome_unknown`, inspect Actor resources, inventory, effects and chat before
another action. Do not repeat a resource mutation or fall back to a generic core
write. A timeout or exception does not establish rollback. Keep a record of the
exact system, Foundry, relay and module versions during actual live validation.
