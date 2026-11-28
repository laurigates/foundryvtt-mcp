# Writing system and module integrations

An integration is a trusted package distributed with this MCP server. Put game
system integrations in `systems/<upstream-id>/<foundry-generation>/` and module
integrations in `modules/<upstream-id>/<foundry-generation>/`. Keep the exact
upstream ID, including hyphens. Display
titles do not participate in identity or routing.

## Package structure

Each numeric directory is a complete independent package, for example
`modules/example-module/13/`, `modules/example-module/14/`, or
`systems/example-system/14/`. There is no upper generation limit baked into the
directory convention: a future `15/` package follows the same contract, but it
must be authored and checked before it becomes usable.

Every generation package includes `manifest.json`, `README.md`, and the fixed
JavaScript bindings and probes it declares. Colocated `tests/` directories hold
package contract tests. The shared loader is identical for both families; the
host evaluates the bindings directly, with no separate adapter runtime.

Keep runtime files and local helpers within that generation directory. Bindings
and probes cannot escape it through `..` or symlinks. Do not import
code from a sibling generation: copying `14/` must not require `13/`. An optional
README directly under the upstream ID can index the available generations; it
is not an adapter package and has no manifest.

The D&D 5e, PF2e and Item Piles packages expose explicit reads and mutations with
shared package-local helpers, generated fixed bindings, contract tests and pinned
upstream source references. Their original raw reads remain available under the
existing contracts. These are experimental integrations; local fixtures do not
establish live compatibility.

## Install a third-party adapter

An external GitHub repository can use the same layout or distribute one complete
generation directory as a release artifact. Installation is local:

1. Obtain and review the adapter's source or release. The upstream Foundry module
   or system still needs its normal installation in Foundry; this is its MCP bridge.
2. Copy the **complete generation directory** into this server's package root,
   keeping the exact upstream ID: `modules/<id>/14/` or `systems/<id>/14/`.
   Copy another generation as a separate sibling when needed. Do not merge a
   new package into an existing variant or leave a flat manifest at the ID root.
3. Run `npm run check:integrations` and `npm run test:bindings` from the server
   checkout. A package can supply its own generator and tests; runtime loading
   does not require a generator.
4. Refresh or reconnect the target, or restart the MCP server. Inspect
   `list_systems`, `list_modules` or `get_target_status` for the selected generation,
   upstream version observed in the world, unavailable operations and load errors.

There is no central ID allowlist, provider dispatch table or adapter registry to
edit. Discovery inspects the filesystem. Merely creating a directory does not
activate it: its manifest, exact generation, installed upstream package, provider
execution support and operation probes must agree. A missing generation does not
enable a nearby version's tool set.

These are trusted executable packages, not sandboxed uploads. The server does not
clone GitHub repositories, install package dependencies or execute arbitrary source
supplied in an MCP call. Keep external adapters in a maintained checkout or image;
edits inside a transient `npx` cache or an installed dependency can disappear on
upgrade. No network access is needed for package discovery or generation selection.

### Create a new package

From the server checkout, create a self-contained starting package with:

```bash
npm run create:integration -- --kind module --id example-module --foundry 14
```

Use `--kind system` for a system bridge. The generated skeleton intentionally
stays unavailable until its fixed binding and readiness probe are implemented.
Fill in the input/output schemas, permissions, upstream reference and README,
then add contract tests. Existing packages are not overwritten. The scaffold
creates files only; it does not install or activate anything in Foundry.

### Migrating a flat package

Existing third-party `modules/<id>/manifest.json` and
`systems/<id>/manifest.json` packages without `foundryGeneration` remain readable
under their original compatibility policy. This is a migration allowance, not
the format for new packages. A legacy flat manifest cannot coexist with numeric
variant directories for the same ID: the loader reports the ambiguity instead
of silently choosing an implementation.

Move the complete flat package under its actual generation, add the matching
integer `foundryGeneration` to its manifest, fix package-local paths and test it.
For another generation, copy or create a separate self-contained package and
review the matching upstream code. Public tool names do not gain a generation
suffix; target routing determines which implementation runs.

## Manifest contract

`src/integrations/manifest.ts` is the source of truth. Version 1 requires:

| Field | Meaning |
|---|---|
| `schemaVersion`, `protocolVersion` | Both currently `1` |
| `kind` | `system` or `module` |
| `id` | Must exactly match the directory and upstream ID |
| `foundryGeneration` | Integer `13` or later, required for a numeric generation directory and exactly equal to its name; omitted only by legacy flat packages |
| `adapterVersion`, `updatedAt` | Our adapter version and last update date |
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
collisions between differently split identifiers that can coexist on the same
generation. The same operation name can have separate implementations in `13/`
and `14/` because only one can be selected per target. The runtime stores the original
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

`foundryGeneration` selects the package from the observed Foundry version:
`14.370` selects `14/`. This is independent of the session generation counter,
which increments when a connection is replaced. A target with an unknown Foundry
version or no matching variant does not load that versioned package or
probe its bindings. Other targets and independent integrations remain usable.

After generation selection, an empty `foundryVersions` or `integrationVersions`
filter imposes no further version restriction; it is not a compatibility
guarantee. A nonempty list accepts an entry that matches the observed version
exactly or, when the entry is a bare integer such as `"14"`, every build of that
generation (`14.370` included). A full `"14.370"` entry stays an exact pin, and
an unknown observed version never matches a nonempty list. The scaffolder writes
the generation as a bare integer, so a generated package keeps working across
patch releases of the generation it was built for. `compatibility.tested` records
actual live combinations and stays empty until they are verified. Optional
`compatibility.systems` restricts a module to named systems. This restriction
does not require that our corresponding system adapter is installed.

The integration support and maintenance scope starts at **Foundry VTT 13,
inclusive**. Foundry 12 and earlier are outside that scope even if an existing
probe succeeds. Versioned packages enforce this floor and their exact generation.
Per-operation build requirements and upstream-version checks can narrow that
selection. Generic core operations and legacy flat packages retain their existing
policies. Range expressions are not supported in these arrays: use a bare
generation integer, an exact version, or a probe for additional build/API
requirements.

Three version identities must stay separate: `foundryGeneration` selects a
directory; the pinned upstream release identifies the system/module contract;
`adapterVersion` identifies our implementation of that contract. Updating one
generation never advances the source pin or adapter version of another.

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

The host runs each binding inside the operation's original session context. Each
provider send rechecks that context, and a continuation arriving after its call or
session has closed cannot start a replacement operation. A provider request that
was already sent is not cancelled by a later failure: ordinary work on that target
waits for the locally tracked request to settle. A failed mutating operation that
already invoked the provider is reported as `outcome_unknown` unless the provider
explicitly rejected execution. Never retry it automatically.
Item Piles demonstrates mutating operations with `readOnly: false`, target-local
write enablement and an additional runtime GM gate. System rolls and mutations
also require write opt-in; their bindings check document ownership and any
operation-specific permission. A roll is not read-only merely because it returns
a number: it may create chat, consume resources or trigger hooks.

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
npm run generate:integrations
npm run check:integrations
npm run test:bindings
```

The scripts discover generation packages without hardcoded IDs. A package-local
`build.mjs`, when supplied, supports `--write` and `--check`. Main build/test
commands check every discovered generator; a hand-authored package needs no build
step. Existing `generate:systems`, `check:systems`, `test:systems` and Item Piles
aliases select their corresponding packages across generations.

The manifest/protocol version remains `1`; versioned loading adds generation
metadata while preserving legacy flat packages.
Arguments remain JSON data for a fixed operation. `target_id` is reserved by the
host; use fields such as `source_uuid` and `target_uuid` for documents participating
in an operation. Keep the previous public contract when extending a package.

Readiness remains per operation. The manager currently probes operations in
sequence, so a large package performs more relay roundtrips during activation.
Generated helper reuse improves source maintenance; it does not claim runtime
bundling or eliminate that discovery cost.

## Systems and modules in one session

The system matching the world's identity and Foundry generation is selected
independently from active modules of that same generation. A missing system adapter leaves core document access and independent
module integrations available. Each world has separate integration manager
instances; the package code itself is shared on disk.

Runtime loading records a malformed package as an integration error and keeps
unrelated valid packages usable. Every package involved in a public-name
collision within a simultaneously eligible generation is withheld; load order
never selects a winner. Invalid variants in a different generation are reported
without activating them or blocking a valid selected variant. Direct
`loadIntegrations(packageRoot)` calls remain strict for development and package
smoke checks. The runtime explicitly selects the error-reporting loader mode.

If a future operation needs a system capability, declare that dependency when it
is implemented. Avoid imports between every module and every system. Introduce a
module-specific compatibility binding only when a real API difference requires it.

The optional `actor-projection.json` used by the core provider belongs in the
selected generation package. It declares data paths and existing validation
bounds. Projection lookup uses the target's Foundry generation and applies the
manifest's `systems`, `foundryVersions` and `integrationVersions` filters. Cached
descriptors are checked against each target's observed versions on every use.
Unknown systems, missing generations and unmet version filters keep raw document
data and generic patch validation rather than borrowing another version's fields
or bounds. Empty version-filter arrays impose no restriction; nonempty filters
require a known observed version that matches exactly or by bare generation.

For choosing an operation, follow [core, system and module call selection](core-system-module-calls.md).
Invoke current runtime document methods so participating wrappers can run; do
not bypass them through a saved prototype. This does not certify arbitrary module
overrides. There is no global module-over-system-over-core priority or automatic
fallback after a rejected or uncertain mutation.

## Upstream source references

The adapter version identifies our package. The upstream source baseline identifies
the external module or system code inspected and used to align that package.
Record both: an adapter update date alone cannot identify its upstream contract.

Apply reference selection to the actual upstream module/system ID **and the
Foundry generation of the directory**. A repository may
publish several products: inspect the release assets/manifest and choose the
latest compatible release for this package, not an unrelated repository-wide
latest release. The latest overall release may require a newer Foundry generation;
in that case the older directory stays on the latest compatible release, with
its own source-check date. Do not backport by changing only a version number.

Choose the synchronization reference in this order:

1. **Latest official published release compatible with this generation**, when
   the project has releases. Record its version/tag
   and a link to that specific release; label a prerelease explicitly if selected.
2. **Latest compatible official tag**, only when upstream has no releases. Record the tag and
   its source link, resolving annotated tags to the underlying commit.
3. **Current default-branch commit**, only when upstream has neither releases nor
   tags and that code is compatible with the selected generation. Use the
   **full commit hash as the upstream version**, with an immutable
   commit link. Do not invent a release number or use the branch name as a version.

For all three cases, record the full resolved commit SHA. A release/tag URL alone
does not pin the source if the reference later moves. Select a release rather than
newer untagged branch work while a release exists; when choosing among tags, check
the upstream version/date convention rather than relying on lexical tag ordering.
An unavailable repository or failed lookup does not prove that releases or tags
are absent: leave the reference unknown or record the check as incomplete.
If no eligible upstream reference supports the requested generation, record that
gap and leave the relevant rules operations unavailable. An older raw-data
compatibility operation may remain explicitly unpinned; do not present it as a
reviewed integration of an older system release.

"Latest" means latest when checked, so record that date. The reference selected
for synchronization becomes the **used source baseline** only after its relevant
code has been inspected and the adapter aligned with its contract. If the latest
reference is ahead of the inspected baseline, list both and mark synchronization
as pending. Do not advance the baseline merely because a newer release exists.

Each package README records these fields separately. Put the linked upstream
system/module release near the top of the README, visibly separate from the
adapter version. A generation-specific directory still needs its own upstream
reference even when its only operation preserves an older raw-read contract.
Inspect and document that narrower contract before recording its release pin.

| Field | Required documentation |
|---|---|
| Adapter version / update | `adapterVersion` and `updatedAt` from this package |
| Foundry generation | Directory name and matching `foundryGeneration` |
| Upstream repository | Official source repository |
| Upstream source version / kind | Used release version, tag name, or full commit hash; identify which kind it is |
| Upstream source commit | Full resolved SHA and immutable source link |
| Upstream release / commit date | Publication date for a release; commit date for a tag or commit baseline |
| Source inspected on | Date the relevant upstream code was examined |
| Latest reference checked on | Check date and latest reference found; identify any pending alignment |
| Foundry scope / runtime checks | Exact selected generation, narrower build/API requirements and actual operation gates |
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
and binding execution behavior. Verify two targets cannot share mutable adapter
state and that a new upstream version cannot silently change an existing public
tool schema. Add explicit versioned operations if the public contract cannot
remain compatible.

Run:

```bash
npm test
npm run build
npm run smoke:integrations
npm run smoke:pack
```

The packed smoke loads the installed distribution's manifests and compiles their
contracts from a different working directory. It verifies the package boundary,
not a live Foundry API. Update `compatibility.tested` only after the corresponding
live test has actually been performed.
