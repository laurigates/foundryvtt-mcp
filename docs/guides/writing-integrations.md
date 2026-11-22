# Writing system and module integrations

An integration is a trusted package distributed with this MCP server. Put game
system integrations in `systems/<upstream-id>/` and module integrations in
`modules/<upstream-id>/`. Keep the exact upstream ID, including hyphens. Display
titles do not participate in identity or routing.

## Package structure

Every package includes `manifest.json`, `adapter.py`, and `README.md`. Each declared
operation identifies a fixed JavaScript binding and a runtime probe. Colocated
`tests/` directories hold adapter contract tests. The shared loader/protocol is
identical for both families.

Use the D&D 5e and PF2e packages as small actor-data read examples. Item Piles is
the larger example: explicit read/write operations, shared runtime helpers,
generated fixed bindings, contract tests and a documented upstream source
reference. These are experimental integrations; local fixtures do not establish
live compatibility.

## Manifest contract

`src/integrations/manifest.ts` is the source of truth. Version 1 requires:

| Field | Meaning |
|---|---|
| `schemaVersion`, `protocolVersion` | Both currently `1` |
| `kind` | `system` or `module` |
| `id` | Must exactly match the directory and upstream ID |
| `adapterVersion`, `updatedAt` | Our adapter version and last update date |
| `entrypoint` | Python entrypoint relative to this directory |
| `status` | `experimental` or `supported` |
| `upstream` | Official repository, inspected source reference, upstream date and live verification date; unknowns use `null` (see [source references](#upstream-source-references)) |
| `compatibility` | Exact version filters and actually tested combinations |
| `operations` | One or more operation definitions |

Each operation defines `id`, `description`, `inputSchema`, `outputSchema`,
`binding`, `probe`, and `readOnly`. Inputs and outputs are validated against JSON
Schema. The public name is constructed exactly as:

```text
system_{id}_{operation}
module_{id}_{operation}
```

For example, `module_item-piles_get_items` preserves `item-piles`. IDs are never
silently normalized. The registry rejects invalid names and collisions, including
collisions between differently split identifiers. The runtime stores the original
identity fields separately rather than splitting the public tool name.

### Output schemas and reference scope

An operation's `outputSchema` describes its own return value. MCP advertises a
wrapper with `target_id`, `world_id`, `session_generation` and `result`, where
`result` contains that value. The catalog embeds the operation schema as a
separate JSON Schema resource: root-local references such as `#/$defs/Value`
and recursive `#` still address the operation result, not the MCP wrapper.

Existing absolute or relative `$id` values and nested resource scopes are
preserved. Anonymous, empty-ID and fragment-only roots receive a synthetic
absolute resource base. These IDs use a reserved `.invalid` host and a stable
hash of the tool name and canonical schema; they are identifiers, not addresses
to fetch. No `$ref` strings or result data are rewritten. Equivalent object-key
ordering across targets therefore does not create a catalog conflict.

Keep schemas self-contained and compatible with the repository's Ajv validator.
The loader does not register external schema documents or provide a network
schema loader; an external `$ref` is not supported merely because it has an
absolute URL. Test both operation validation and the wrapped schema through the
MCP client, including invalid data, recursion and any nested `$id` resources.

### Version filters

An empty `foundryVersions` or `integrationVersions` filter imposes no exact-version
restriction; it is not a compatibility guarantee. `compatibility.tested` records
actual live combinations and stays empty until they are verified. Optional
`compatibility.systems` restricts a module to named systems. This restriction
does not require that our corresponding system adapter is installed.

The integration support and maintenance scope starts at **Foundry VTT 13,
inclusive**. Foundry 12 and earlier are outside that scope even if an existing
probe succeeds. This is a support policy, not a shared runtime version guard;
document the actual per-operation checks separately. A minimum of 13 does not
establish support for every later generation. Do not put major numbers or range
expressions into exact-match manifest arrays to represent this policy.

## Python adapter

Expose an `Adapter` class with an async `execute` method:

```python
class Adapter:
    async def execute(self, operation, arguments, context):
        if operation != "get_actor_data":
            raise ValueError(f"Unsupported operation: {operation}")
        return await context.invoke(operation, arguments)
```

The context is bound to one target and one integration. `invoke` calls only the
binding registered for the current operation. URL, credentials, relay client IDs,
and provider selection belong to the Node host. A Python filename is loaded by
path, so an upstream directory ID containing a hyphen needs no Python import-name
normalization.

## Runtime binding and probe

The provider supplies `args` from validated JSON input. A binding resolves Foundry
UUIDs in the selected runtime, calls the upstream API, and returns JSON data.
Keep the API path, argument mapping, and result transformation in the integration
package. This lets providers remain independent of specific systems and modules.

Return document summaries or plain data, not live Foundry Document objects. If the
upstream API already handles system-specific behavior, use it rather than
reimplementing its logic through generic document edits.

A probe returns `{ "ready": true }` or `{ "ready": false, "reason": "..." }`.
Check the actual world/system/module and the API used by the operation. A module's
active flag alone does not establish runtime readiness. Probes run at activation
and again before a call. Losing readiness removes the operation from availability.

Bindings and probes are trusted executable package content. They are not supplied
by the MCP caller. Do not claim a write is read-only to bypass target policy. A
read may still trigger upstream logging or notifications; document upstream
behavior accurately. Runtime execution permission remains an upstream setting.

The Node host binds Python callback tokens to the operation's original session
context. Each provider send rechecks that context, and a callback arriving after
its call or worker has closed cannot start a replacement operation. Worker
failure does not cancel a runtime request already sent: ordinary work on that
target waits for the locally tracked request to settle. A failed mutating
operation that already invoked the provider is reported as `outcome_unknown`
unless the provider explicitly rejected execution. Never retry it automatically.
Item Piles demonstrates mutating operations with `readOnly: false`, target-local
write enablement and an additional runtime GM gate. The system adapters currently
contain only actor-data reads.

## Shared helpers without changing the provider

For a large package, keep authored source under the package and generate the
standalone files already supported by the loader. Item Piles uses a registry of
`{ id, description, readOnly, inputSchema, outputSchema, requiredMethods, handler }`
records collected from domain modules. Each handler receives `(args, runtime)`;
the runtime factory provides shared helpers. Both functions must be self-contained
when serialized: use the explicit runtime parameter instead of importing hidden
handler dependencies.

Its generator embeds the runtime factory and one selected handler into each
binding. A probe only constructs the same runtime inside a readiness check; it
never runs the handler. This keeps API/version/permission checks consistent.
The manifest, bindings and probes are checked in, and `--check` compares them with
fresh in-memory output without writing. Regeneration is a separate explicit
`--write` action; obsolete generated files are detected.

```bash
npm run generate:item-piles
npm run check:item-piles
npm run test:item-piles
npm run test:python
```

The core loader, manifest version, Python protocol and providers are unchanged.
Arguments remain JSON data for a fixed operation. `target_id` is reserved by the
host; use fields such as `source_uuid` and `target_uuid` for documents participating
in an operation. Keep the previous public contract when extending a package.

Readiness remains per operation. The manager currently probes operations in
sequence, so a large package performs more relay roundtrips during activation.
Generated helper reuse improves source maintenance; it does not claim runtime
bundling or eliminate that discovery cost.

## Systems and modules in one session

The system matching the world's identity is selected independently from active
modules. A missing system adapter leaves core document access and independent
module integrations available. Each world has separate adapter instances and a
separate optional Python process; the package code itself is shared on disk.

Runtime loading records a malformed package as an integration error and keeps
unrelated valid packages usable. Every package involved in a public-name
collision is withheld; load order never selects a winner. Direct
`loadIntegrations(packageRoot)` calls remain strict for development and package
smoke checks. The runtime explicitly selects the error-reporting loader mode.

If a future operation needs a system capability, declare that dependency when it
is implemented. Avoid imports between every module and every system. Introduce a
module-specific compatibility binding only when a real API difference requires it.

The optional `actor-projection.json` used by the core provider belongs in the
system package. It declares data paths and existing validation bounds; unknown
systems keep raw document data and are not assigned D&D-specific fields.

## Upstream source references

The adapter version identifies our package. The upstream source baseline identifies
the external module or system code inspected and used to align that package.
Record both: an adapter update date alone cannot identify its upstream contract.

Choose the synchronization reference in this order:

1. **Latest official published release**, when available. Record its version/tag
   and a link to that specific release; label a prerelease explicitly if selected.
2. **Latest official tag**, only when upstream has no releases. Record the tag and
   its source link, resolving annotated tags to the underlying commit.
3. **Current default-branch commit**, only when upstream has neither releases nor
   tags. Use the **full commit hash as the upstream version**, with an immutable
   commit link. Do not invent a release number or use the branch name as a version.

For all three cases, record the full resolved commit SHA. A release/tag URL alone
does not pin the source if the reference later moves. Select a release rather than
newer untagged branch work while a release exists; when choosing among tags, check
the upstream version/date convention rather than relying on lexical tag ordering.
An unavailable repository or failed lookup does not prove that releases or tags
are absent: leave the reference unknown or record the check as incomplete.

"Latest" means latest when checked, so record that date. The reference selected
for synchronization becomes the **used source baseline** only after its relevant
code has been inspected and the adapter aligned with its contract. If the latest
reference is ahead of the inspected baseline, list both and mark synchronization
as pending. Do not advance the baseline merely because a newer release exists.

Each package README records these fields separately:

| Field | Required documentation |
|---|---|
| Adapter version / update | `adapterVersion` and `updatedAt` from this package |
| Upstream repository | Official source repository |
| Upstream source version / kind | Used release version, tag name, or full commit hash; identify which kind it is |
| Upstream source commit | Full resolved SHA and immutable source link |
| Upstream release / commit date | Publication date for a release; commit date for a tag or commit baseline |
| Source inspected on | Date the relevant upstream code was examined |
| Latest reference checked on | Check date and latest reference found; identify any pending alignment |
| Foundry scope / runtime checks | Minimum project scope of 13, package restrictions and actual operation gates |
| Live verification / tested combinations | Only performed live checks, separately from source inspection and fixtures |

Unknown source fields stay explicitly unrecorded. Missing provenance is not a
commit-only fallback. When a baseline is established, use the existing manifest
fields without changing the schema:

- `upstream.repository`: official repository URL.
- `upstream.reference`: `<release-or-tag>@<full-commit-SHA>` for a release/tag,
  or just `<full-commit-SHA>` when neither releases nor tags exist.
- `upstream.updatedAt`: the documented upstream release/commit date.
- `upstream.verifiedAt`: date of an actual live verification; keep `null` after
  source inspection alone. Record checked combinations in `compatibility.tested`.

Source-inspection and latest-reference-check dates belong in the README. A
documentation-only check does not require an adapter version bump. If metadata
is generated, update its authored source and regenerate the checked-in manifest.

Keep the [module bridge catalog](../bridges/modules.md) and
[system bridge catalog](../bridges/systems.md) aligned with package metadata and
README source records. The root README links to these catalogs and stays generic;
installation instructions, specific APIs and usage examples belong in individual
package READMEs.

## Documentation and tests

Each README follows the source-reference record above and documents exposed
operations and limitations. The installed upstream version is a session
observation, separate from the adapter version and the inspected source baseline.

Test input validation, DTO results, incorrect system/module context, API absence,
and Python callback behavior. Verify two targets cannot share mutable adapter
state and that a new upstream version cannot silently change an existing public
tool schema. Add explicit versioned operations if the public contract cannot
remain compatible.

Run:

```bash
npm test
npm run test:python
npm run build
npm run smoke:integrations
npm run smoke:pack
```

The packed smoke launches a real Python worker from an installed distribution and
a different working directory with a fake provider callback. It verifies the
package boundary, not a live Foundry API. Update `compatibility.tested` only after
the corresponding live test has actually been performed.
