# Choosing core, system and module calls

Core tools, system bridges and module bridges coexist in one target's catalog.
They expose different contracts. Installing a module does not make every module
operation preferable to every system or core operation, and this server does not
apply a global `module > system > core` precedence rule.

This guide separates the current implementation from a possible future intent
resolver. The [module catalog](../bridges/modules.md) and
[system catalog](../bridges/systems.md) list package coverage, source versions and
Foundry requirements; their package READMEs describe individual operations.

## One active world and system per target

In the deployment described here, a Foundry server runs one active world at a
time, and that world has one selected game system and potentially many active
modules. A target session binds to that world and system. The MCP server can
manage several independent targets, including separate Foundry servers, without
selecting a global current world.

The integration manager selects the system package whose exact ID matches
`environment.system.id` and whose generation matches the observed Foundry version.
Module packages for that same Foundry generation are evaluated independently using their
installed/active state, declared compatibility, execution capability and runtime
probes. An absent system bridge does not disable generic core access or an
independent module bridge.

`target_id` is required when multiple targets are configured, even if only one is
currently online. An explicit configured `expectedWorldId`, or the world identity
already bound to the session, prevents silent adoption of a different world at
the same server address. Reconnection revalidates identity; it is not a command
to switch worlds. See [providers and targets](providers-and-targets.md).

Sources: [session manager](../../src/sessions/manager.ts),
[session identity and lifecycle](../../src/sessions/session.ts), and
[integration selection](../../src/integrations/manager.ts).

## Generation selection precedes operation selection

The package layout is `systems/<id>/<generation>/` and
`modules/<id>/<generation>/`. A target reporting `14.370` selects only `14/`;
another target reporting `13.350` can use `13/` in a separate worker at the same
time. These directory generations are independent of the session generation
counter used to invalidate work after reconnection.

Each selected package still checks its upstream system/module version, required
APIs and permissions. A directory named `14` does not certify every upstream
release or every module stack on Foundry 14. Missing variants remain unavailable,
and a malformed variant in another generation is reported without being imported
or probed. `list_systems` and `list_modules` include the selected
`foundryGeneration`, valid `availableGenerations` and any `variantErrors`.

Core Actor/Item projections also live within the system's generation directory.
They apply the manifest's exact Foundry and system version filters, including
when a descriptor is already cached for another target. A missing required
version, an incompatible manifest or an absent descriptor keeps generic identity,
raw data and generic patch validation; core does not reuse another generation's
system fields or bounds. Providers remain responsible for generic document
operations.

This selects an implementation of an explicitly named tool. It does not establish
priority between different core, system or module workflows. The public tool
name stays stable across generations; incompatible contracts still require
distinct operation names, because the multi-target catalog withholds conflicting
schemas instead of presenting one generation's schema for both.

See [package installation and version policy](writing-integrations.md#install-a-third-party-adapter)
for external adapters and the migration allowance for legacy flat packages.

## Choose by the intended effect

| Intended effect | Appropriate contract, when available on the target | Important distinction |
|---|---|---|
| Find actors, items, scenes or journals; read generic document data | Core search/read tools | Finding a document does not execute its game rules |
| Read system-specific statistics or roll a system check, save or skill | The selected system bridge's documented operation | The system owns its modifiers, rule data and supported roll workflow |
| Change a game condition, apply damage or perform another rules workflow | A system operation that explicitly supports that effect | Generic document writes do not reproduce a rules workflow |
| Trade with a merchant, transfer pile currencies or use a module's inventory workflow | The corresponding active module bridge operation | The module owns its own prices, hooks and transaction behavior |
| Make an intentional administrative document edit | An explicit core mutation such as `update_actor_attributes` | The caller is choosing a low-level edit, with the limitations below |
| Evaluate a plain dice expression | Core `roll_dice` | This is not a skill check, attack or saving throw |
| Execute a workflow replaced or extended by another module | A bridge whose documented contract covers that module workflow, or the existing runtime method within its verified limits | An active module alone does not establish equivalent behavior or compatible arguments |

The exact tool name is authoritative. Core names such as `search_actors` remain
separate from `system_{system_id}_{operation}` and
`module_{module_id}_{operation}`. For example, `system_dnd5e_get_actor_data`,
`system_pf2e_get_actor_data` and `module_item-piles_get_items` are distinct calls;
none becomes an alias for another. Additional operations are listed in each
package README and exposed only when the selected target passes their checks.

The current catalog dispatches the named operation. It does not interpret a
generic tool as an instruction to choose another bridge, and it withholds
conflicting public schemas instead of letting load order choose a winner.
See [catalog discovery and dispatch](../../src/tools/catalog.ts).

### Core mutations are document operations

Three existing contracts need particular care when choosing a tool:

- `update_actor_attributes` patches permitted paths in `actor.system`. Setting HP
  directly is not an invocation of a system's damage application, resistance,
  recovery or rest workflow.
- `apply_status_effect` creates or removes a generic `ActiveEffect` identified by
  its `statuses` field. It does not invoke a PF2e condition workflow or establish
  the system's condition values, dependencies and rule effects.
- `roll_dice` evaluates a dice expression using the selected provider's supported
  grammar. It does not obtain a skill modifier, resolve a system check or consume
  a system resource. Its historical local-roller fallback is part of this plain
  dice utility, not a fallback implementation for system rolls.

These tools remain explicit administrative/utility operations. Do not use a
successful document update as evidence that a game rule was applied. A system
roll can also create chat, consume resources or trigger other effects; use its
documented write classification and target/runtime permission requirements.

Sources: [actor mutation handler](../../src/tools/handlers/actor-mutations.ts),
[status-effect handler](../../src/tools/handlers/token-mutations.ts), and
[document provider](../../src/providers/document-provider.ts).

## Runtime overrides and provider differences

A system binding should resolve the current Actor, Item or other runtime object
and call the method on that object. A module binding should call the active
module's public API. Calling the current runtime object allows the installed
document class and its wrappers to participate. Avoid calling a stored base
prototype, duplicating upstream rule arithmetic or bypassing the runtime method
to force an assumed original implementation.

This does not prove compatibility with every wrapper. A module can change return
values, introduce dialogs, require target selection, add side effects or replace
a workflow entirely. Method existence and an active module flag cannot verify
those semantics. A bridge must validate the contract it uses and document known
requirements, exclusions and tested combinations. Source-version gates and
local fixtures do not substitute for a live test with the relevant module stack.

The transport also changes what code runs:

| Provider path | What the current implementation invokes |
|---|---|
| `socketio` core mutations | The native `modifyDocument` protocol, without invoking a client-side system action method |
| `rest-api` core mutations | Fixed scripts that use the runtime's `CONFIG[type].documentClass` and embedded-document APIs; this can traverse document overrides but still does not select a higher-level rules workflow |
| `rest-api` system/module operations | The integration's fixed binding in the paired Foundry client runtime |
| `composite` | Native core operations plus relay execution for system/module bindings; the chosen operation does not switch paths automatically |

In a composite target the native user and paired runtime user may differ.
Permission to use one path does not establish permission on the other. The
composite checks that both connections identify the same origin, world and
system, and rejects different Foundry generations when both can be identified.
Different build strings within one generation are accepted; an unknown generation
is not inferred. The binding still needs its own document permissions, API checks
and version restrictions.

Sources: [provider contracts](../../src/providers/types.ts),
[relay document/runtime execution](../../src/providers/rest-api.ts), and
[composite provider](../../src/providers/composite.ts).

## Availability and changes during a session

The implementation already uses these target-local facts:

- world identity, system ID/version and Foundry version;
- installed module IDs/versions and their active flags;
- provider capabilities, runtime readiness and target write enablement;
- per-operation probes and runtime document/user permissions;
- session and transport generations, plus operation-bound callback tokens.

`get_target_status` reports target identity, provider capabilities and bridge
readiness. `list_systems` and `list_modules` report **packaged integrations** and
their per-operation availability. In particular, `list_modules` is not a complete
inventory of all installed modules or a detection report for every method
override. The provider's full module inventory is currently internal environment
data rather than a management-tool field. A bridge can expose its own diagnostic
view: for example, the system configuration read documented in the
[D&D 5e package](../../systems/dnd5e/README.md) reports active modules. That does not
turn `list_modules` into a complete installed-module inventory.

Connection, explicit refresh and reconnection reconcile available integrations.
Refreshing a stale core snapshot also reconciles them when the observed Foundry,
system, module or readiness context changes. Before a bridge call, its probe runs
again; a failed probe removes that operation from availability. A new or restored
operation requires reconciliation to be advertised again.

The session monitor detects transport loss and generation changes. It does not
continuously inspect all module settings or discover every runtime monkey patch.
After changing the module stack, refresh or reconnect the target as appropriate.
A passing probe remains evidence about its specific checks, not about every
effect of the new stack.

Old work stays bound to its original session. A replaced generation fences
callbacks and results so they cannot migrate into a new world or connection.
Operations within a target are serialized; different targets may run concurrently.
An uncertain write is reported as `outcome_unknown`, with no automatic retry,
transport fallback or replacement by a core edit. Inspect the affected state
before deciding on another operation.

Sources: [session refresh and fencing](../../src/sessions/session.ts),
[operation probes and worker callbacks](../../src/integrations/manager.ts), and
[provider operation context](../../src/providers/operation-context.ts).

## Possible future intent resolver — not implemented

A future convenience layer could select an operation for a stated intent, such
as a particular system check or a particular module transaction. It would need
explicit semantic declarations; comparing method names or installation order is
insufficient. The existing named tools should remain directly addressable.

A suitable resolver would:

1. Bind the request to a target and capture its world/system identity and session
   generation before selecting a candidate.
2. Consider only operations whose declared intent, arguments, expected effects,
   provider capability, versions and permissions match that request.
3. Apply an explicit preference configured for that target and intent, when the
   preferred operation is actually available. Never infer a blanket module
   priority from the active-module list.
4. Report ambiguity when several non-equivalent candidates remain, and report
   unsupported intent when none matches. Do not silently choose a lower-level
   document edit to approximate a missing rules operation.
5. Recheck the selected operation immediately before execution and report the
   chosen tool, bridge/adapter version, observed upstream version and original
   session provenance. A failure after dispatch must not select another candidate.

Before implementing this layer, document concrete overlapping workflows and
test them with the relevant system/module combinations. A module that adds an
automated attack workflow may have a different effect contract from a system
attack roll, even if both ultimately call a similarly named method. That
distinction must be resolved explicitly before either can substitute for the other.
