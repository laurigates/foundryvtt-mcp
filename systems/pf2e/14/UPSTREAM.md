# PF2e upstream contract and coverage

The package is independently installable for Foundry generation **14**. Its
numeric `foundryGeneration` matches its directory. Host generation selection
also constrains the unchanged legacy raw read; the legacy probe itself remains
capability-based. No build or runtime import requires another generation.

## Inspected source

| Field | Value |
|---|---|
| Package Foundry generation | **14**; `foundryGeneration: 14` |
| Official repository | [foundryvtt/pf2e](https://github.com/foundryvtt/pf2e) |
| System ID / upstream version | `pf2e` / **8.7.1** |
| Release / tag | [pf2e-8.7.1](https://github.com/foundryvtt/pf2e/releases/tag/pf2e-8.7.1), published `2026-11-17` |
| Resolved source commit | [`397f125aea87e6d6fa36e878c9c07d0e672826cf`](https://github.com/foundryvtt/pf2e/commit/397f125aea87e6d6fa36e878c9c07d0e672826cf) |
| Source inspection / release check | `2026-11-22` |
| Upstream Foundry declaration | Minimum **14.361**, verified **14.370**, maximum generation **14** |
| Adapter version / update | `0.2.0` / `2026-11-22` |
| Live compatibility verification | None; `compatibility.tested: []`, `upstream.verifiedAt: null` |

This upstream repository publishes PF2e, Starfinder 2e and Anachronism releases.
Its repository-wide `releases/latest` endpoint returned an **SF2e Anachronism**
release during this inspection. That is not a PF2e source baseline. The selected
release is the latest published release for the requested **system ID `pf2e`**;
its tag, `system.pf2e.json` and `package.json` agree on version **8.7.1**.

The release → tag → default-branch commit convention applies within the intended
upstream package. A release for a different package is not a reason to record a
different system's version or silently follow the development branch.

## Primary sources

All source links pin the inspected commit:

- [System manifest](https://github.com/foundryvtt/pf2e/blob/397f125aea87e6d6fa36e878c9c07d0e672826cf/system.pf2e.json) and
  [package version](https://github.com/foundryvtt/pf2e/blob/397f125aea87e6d6fa36e878c9c07d0e672826cf/package.json).
- [Base Actor API](https://github.com/foundryvtt/pf2e/blob/397f125aea87e6d6fa36e878c9c07d0e672826cf/src/module/actor/base.ts): statistics, conditions, resources and recharge entry points.
- [Creature API](https://github.com/foundryvtt/pf2e/blob/397f125aea87e6d6fa36e878c9c07d0e672826cf/src/module/actor/creature/document.ts): `getResource`, `updateResource`, derived creature state and spellcasting.
- [Character strikes](https://github.com/foundryvtt/pf2e/blob/397f125aea87e6d6fa36e878c9c07d0e672826cf/src/module/actor/character/document.ts) and
  [NPC strike helper](https://github.com/foundryvtt/pf2e/blob/397f125aea87e6d6fa36e878c9c07d0e672826cf/src/module/actor/helpers.ts).
- [Statistic and StatisticCheck](https://github.com/foundryvtt/pf2e/blob/397f125aea87e6d6fa36e878c9c07d0e672826cf/src/module/system/statistic/statistic.ts),
  [check execution](https://github.com/foundryvtt/pf2e/blob/397f125aea87e6d6fa36e878c9c07d0e672826cf/src/module/system/check/check.ts) and
  [CheckRoll result](https://github.com/foundryvtt/pf2e/blob/397f125aea87e6d6fa36e878c9c07d0e672826cf/src/module/system/check/roll.ts).
- [Inventory and currency API](https://github.com/foundryvtt/pf2e/blob/397f125aea87e6d6fa36e878c9c07d0e672826cf/src/module/actor/inventory/index.ts),
  [bulk](https://github.com/foundryvtt/pf2e/blob/397f125aea87e6d6fa36e878c9c07d0e672826cf/src/module/actor/inventory/bulk.ts) and
  [Coins](https://github.com/foundryvtt/pf2e/blob/397f125aea87e6d6fa36e878c9c07d0e672826cf/src/module/item/physical/coins.ts).
- [Condition collection](https://github.com/foundryvtt/pf2e/blob/397f125aea87e6d6fa36e878c9c07d0e672826cf/src/module/actor/conditions.ts) and
  [condition document](https://github.com/foundryvtt/pf2e/blob/397f125aea87e6d6fa36e878c9c07d0e672826cf/src/module/item/condition/document.ts).
- [Spellcasting collection](https://github.com/foundryvtt/pf2e/blob/397f125aea87e6d6fa36e878c9c07d0e672826cf/src/module/actor/spellcasting.ts),
  [spellcasting entry](https://github.com/foundryvtt/pf2e/blob/397f125aea87e6d6fa36e878c9c07d0e672826cf/src/module/item/spellcasting-entry/document.ts) and
  [initiative](https://github.com/foundryvtt/pf2e/blob/397f125aea87e6d6fa36e878c9c07d0e672826cf/src/module/actor/initiative.ts).
- [Public `game.pf2e` interface](https://github.com/foundryvtt/pf2e/blob/397f125aea87e6d6fa36e878c9c07d0e672826cf/src/scripts/set-game-pf2e.ts).

The adapter calls live public Actor/statistic/inventory methods. Internal source
was read to understand behavior; private helpers are not imported or invoked.

## Decisions derived from the source

### Checks preserve PF2e rules

`actor.getStatistic(slug).roll(...)` runs PF2e contextual statistics, modifier
stacking, predicates, fortune/misfortune, degree-of-success adjustments and rule
element hooks. A core `1d20 + modifier` roll does not reproduce that behavior.
The bridge passes `skipDialog: true`, an optional numeric DC, explicit message
visibility and an optional Actor-owned TokenDocument. Callers cannot supply
executable callbacks, arbitrary modifiers, formulas, method paths or rule data.

`StatisticCheck.roll` can consult the paired user's current token targets even
when the caller omits a target. The generic statistic tools reject non-empty
target selections and require `token_uuid` when more than one origin token is
active. They are non-targeted checks. They do not infer a spell origin, a target
DC, incapacitation level, action traits or attack number from conversational text.

Checks are writes even with `create_message: false`: roll hooks can change state.
The trusted callback reads the actual message context because secret-check policy
may override the requested visibility. A non-GM receives redacted totals,
formula and degree for a blind result or an unconfirmed visibility context.
PF2e 8.7.1 uses `messageMode` values `public`, `gm`, `blind` and `self`.

### Strike execution needs a controlled client context

Character/NPC strike variants are prepared functions on `actor.system.actions`.
The bridge invokes the selected current variant, so live module wrappers and
system adjustments remain involved. The request includes an action index and
the exact item UUID returned by `get_strikes`; a changed identity fails before
rolling. Alternative usages are reported but not selected by this adapter.

The character strike wrapper does **not** pass a caller's `skipDialog` option into
`Check.roll`. Supplying that property would not guarantee a headless operation.
Therefore strike availability requires the paired user's **check dialogs to be
disabled already**. The bridge never changes that setting. Origin must be the
Actor's only active token; target must be an explicit rendered Token in the same
scene. The target Actor also needs OBSERVER permission for a non-GM runtime.

`consumeAmmo: true` preserves upstream ammunition use. PF2e can also consume a
weapon with the consumable trait. A successful attack result does not roll/apply
damage, grant an action-economy transaction or guarantee every automation module
completed its own work.

### Conditions are PF2e Items, not generic status flags

The bridge uses `toggleCondition(slug, {active})`, `increaseCondition` and
`decreaseCondition`. It never substitutes a generic ActiveEffect or direct flag
patch. Presence requests are explicit rather than toggle commands.

The `value` option of `increaseCondition` is an **increment for an existing
condition**, not an absolute target value. The bridge passes the exact active
condition document, rejects multiple active sources, locked grants and temporary
conditions, and verifies both the stored source and prepared value. Decreases
verify removal from the item collection or the remaining source value.

`persistent-damage` creation opens a PersistentDamageEditor; it is excluded.
Removing a granted condition cannot replace changing its granting effect.
Condition overrides may make the desired active state unachievable; the result
is reported as uncertain when postconditions do not match.

### Resources and currency

`getResource`/`updateResource` preserve PF2e's built-in and rule-element resource
handling. Existing numeric bounds are checked. Investiture is derived/read-only;
unsupported resource setters and silently ignored changes cannot report success.

Currency uses the current `inventory.currency`, `addCurrency` and
`removeCurrency` APIs rather than the older `coins`/`addCoins` aliases. Inputs are
positive integer pp/gp/sp/cp maps; formulas, arbitrary denomination slugs and
Starfinder currencies are not accepted. The system handles Item-backed coin
stacks and change. The bridge checks the copper-value delta afterward.

Upstream currency removal may add change before reducing other coin stacks.
Those steps are not an adapter-level atomic transaction. A failure or unexpected
balance after dispatch becomes `outcome_unknown`; no rollback or retry is claimed.

### Recharge is distinct from a full rest

`actor.recharge({duration, commit:true})` handles frequencies, resource renewals
and, for `day`, spell preparation. It does not promise sleep, HP recovery,
condition recovery or every resting rule. The Actor source returns an update plan
with `affected`; that structure alone is not proof that writes were accepted.

Spellcasting recharge mutates prepared slots/focus while computing the plan.
After the public call, the bridge therefore compares returned Actor/Item updates
against **source documents** (`toObject(true)`), verifies deletions, and matches
creations to newly observed Item IDs. Prepared values alone cannot confirm a
successful database update. Missing or mismatched effects report uncertainty.

## Deliberate coverage boundaries

| Surface | Treatment |
|---|---|
| Actor/skill/save/perception/custom-statistic data and checks | Implemented through current public runtime methods |
| Prepared strikes | Listing and single attack/MAP variant; explicit token context and dialog readiness required |
| Conditions, numeric resources, pp/gp/sp/cp currency, recharge | Implemented with bounded inputs and observed-state checks |
| Spellcasting | Read entries, slots and spells; casting/consumption/target selection is not implemented |
| Initiative tracker writes | Not exposed: `ActorInitiative.roll` calls tracker `setInitiative` without awaiting it; no false completion guarantee |
| Damage/healing and resistance/weakness/immunity resolution | Not exposed; a generic HP patch or numeric damage call is not presented as PF2e IWR automation |
| Persistent damage editor, crafting, character building, rest dialogs | Not exposed |
| Skill action macros, attacks' alternative usages, custom modifiers/roll options | Not inferred or exposed by the generic statistic wrappers |
| Rule-element editing, global settings, arbitrary item creation/update | Outside this bridge; no caller-selected scripts or generic API dispatcher |
| Optional modules and campaigns | Live wrappers are respected, but semantic compatibility with every module is not certified |

## Core and module coexistence

The runtime has one active system per world; this package activates only for
`pf2e`. It does not replace core MCP tools or rename module tools. Choose a system
tool for a PF2e rule workflow and a module tool for that module's workflow. For
example, direct PF2e currency editing and an Item Piles merchant trade are
different operations and must not both be run to satisfy one purchase.

Calls use the effective objects in the live world, never a captured base
prototype. Method existence and version gates do not prove a module override
preserves semantics. If execution fails after starting, there is no automatic
fallback to a core patch or a second module transaction.

## Verification boundaries

The Node tests execute generated bindings/probes with controlled fixtures and
exercise schemas, source/version gates, exact invocation options, live-instance
wrapping, permissions, ambiguous contexts, secret results and uncertain writes.
Python tests exercise manifest-bound dispatch. They are not tests in a licensed
Foundry installation. No live PF2e/Foundry/module combination is recorded yet.
