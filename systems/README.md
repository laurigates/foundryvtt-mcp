# System integrations

For the list of included systems, adapter/upstream versions, Foundry requirements
and verification status, see the [system bridge catalog](../docs/bridges/systems.md).
Operations, source inspection notes and limitations belong in each package README.

Each directory is named after the exact Foundry system ID. Each numeric child,
such as `systems/<id>/13/` or `systems/<id>/14/`, is a complete independent
package containing `manifest.json`, `adapter.py`, `README.md`, fixed bindings and
tests. Its `foundryGeneration` must match the directory. The session selects the
adapter matching both the remote system and the exact Foundry generation. It never
substitutes another generation's package. An unknown system
does not disable generic core operations or independent module integrations.

Tool names are `system_{id}_{operation}`. IDs are preserved, including hyphens;
the loader creates an internal valid Python import name independently.

The common loader, worker and availability checks live in `src/integrations/` and
`python/foundry_mcp_modules/`. Each target has its own worker and adapter instances.
Providers own credentials and connections. Adapters receive a target-bound proxy
for invoking their registered bindings; they do not open HTTP connections.

The bundled system adapters preserve their original raw Actor reads and add
explicit system-specific reads, rolls and mutations based on pinned upstream
contracts. Each operation has its own probe, input/output schema and read/write
classification. Rolls that can create chat or trigger system side effects require
the target's write opt-in, as do resource and document mutations. Runtime ownership
and operation-specific prerequisites still apply.

Use the [call selection guide](../docs/guides/core-system-module-calls.md) to
distinguish generic core document access from system rules and module workflows.
Names remain explicit; installing a module does not silently replace a system
tool, and a failed system mutation never falls back to a core attribute patch.

Empty compatibility version lists mean **no version restriction has been
declared**, not that every release has been tested. Consult `status`, the
`compatibility.tested` matrix and each README before claiming compatibility.

The support and maintenance scope starts at **Foundry VTT 13, inclusive**.
Versioned adapters enforce that generation boundary. Generic core operations and
legacy flat third-party packages keep their existing capability policies. The
minimum does not establish support for every later generation or upstream release.

An optional `actor-projection.json` belongs inside each generation package. It allows
generic core responses to project familiar fields without embedding one game's
data paths in the provider. Systems without a projection retain generic identity
and raw system data. Projection selection also uses the target's Foundry generation.
An unknown or missing generation does not reuse a descriptor from another version.

Third-party integration repositories can distribute just these directories. Copy
the desired complete variant into the matching path and refresh or reconnect the
target; no central registry edit is needed. See the
[installation and authoring guide](../docs/guides/writing-integrations.md#install-a-third-party-adapter).

## Upstream source references

Keep the adapter version/update separate from the upstream code used. Select the
latest official release compatible with this Foundry generation; if the project
has no releases, select the latest compatible tag; if
neither exists, use the default-branch commit and its full hash as the upstream
version. Record the resolved commit and source inspection date in the package
README, independently of live verification. Missing provenance means that the
baseline has not been recorded, not that upstream has no releases or tags.

Follow the [upstream source reference policy](../docs/guides/writing-integrations.md#upstream-source-references).
Record source inspection when performed; populate `compatibility.tested` and
`upstream.verifiedAt` only after an actual live verification.
