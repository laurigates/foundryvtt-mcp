# PF2e manual MCP workflows

The companion [workflows.json](workflows.json) contains a call for every operation.
Replace `pf2e-14-demo`, `Actor.REPLACE_ACTOR`, scene/token UUIDs and the weapon UUID
with discovered values. These are manual recipes, not an automatically executed
batch. New operations need PF2e 8.7.1, Foundry 14.361+ in generation 14 and a paired
execution-capable runtime. Writes need target write enablement and Actor OWNER
permission, or a GM runtime.

## Inspect before selecting an action

Run the `inspect` workflow's reads. Prepared statistics differ from raw Actor
source data. Read actual skill/lore slugs, numeric resource limits and strike
identities before making a request. Do not invent system data paths or API names.

## Skills, saves and perception

Clear the paired user's selected targets. Run the calls in `checks`; replace the
example skill if unavailable. Supply an origin `token_uuid` if the Actor has
several active tokens. The four methods skip modifier dialogs and use native
PF2e checks. A numeric DC is explicit; spell-origin and target-relative contexts
are not inferred. Secret checks may return redacted values despite requested
public visibility. Chat-disabled rolls still require write enablement.

## Conditions and resources

Inspect conditions, then `condition_on` sets `prone` active without toggling it.
`condition_increase` and `condition_decrease` adjust `frightened` through PF2e's
condition methods. Locked and temporary grants and persistent-damage editors are
excluded. `resource_set` sets focus to 2 only if the Actor's actual maximum permits
it. Record and restore the original resource value in a test world.

## Currency

Inspect the balance, then `currency_add` adds one gold piece and
`currency_remove` removes it through PF2e's inventory API. With `by_value: true`,
PF2e may make change. Compare copper value after each request. These are direct
system inventory edits, not a merchant purchase: do not use them as a second
payment after a module's trade operation. Inspect before retrying any uncertain
result; compound inventory changes are not an atomic adapter transaction.

## One strike

Read `strikes` and copy `strike_index` plus `expected_item_uuid` into
`strike_attack`. The Actor must have only one active origin token, and the
explicit target must be rendered in the paired client's same scene. Disable the
paired user's check dialogs beforehand; the bridge will not change the setting.
`attack_number` selects attack 1, 2 or 3 and its prepared multiple-attack penalty;
upstream may consume ammo or a consumable weapon. This call neither rolls damage
nor performs another attack.

## Daily preparation

Run `daily_preparation` only on an Actor you intend to recharge, preferably a
copy during verification. It calls `recharge({duration: 'day', commit: true})`,
then checks the returned plan against source documents. Read resources and
spellcasting again. This is not a full night's rest, HP healing or condition
recovery. After `outcome_unknown`, inspect source state before any new request.
