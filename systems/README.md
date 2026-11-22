# System integrations

For the list of included systems, adapter/upstream versions, Foundry requirements
and verification status, see the [system bridge catalog](../docs/bridges/systems.md).
Operations, source inspection notes and limitations belong in each package README.

Each directory is named after the exact Foundry system ID. It contains
`manifest.json`, `adapter.py`, `README.md`, fixed runtime bindings, and `tests/`.
The session selects the adapter matching its remote system. An unknown system
does not disable generic core operations or independent module integrations.

Tool names are `system_{id}_{operation}`. IDs are preserved, including hyphens;
the loader creates an internal valid Python import name independently.

The common loader, worker and availability checks live in `src/integrations/` and
`python/foundry_mcp_modules/`. Each target has its own worker and adapter instances.
Providers own credentials and connections. Adapters receive a target-bound proxy
for invoking their registered bindings; they do not open HTTP connections.

The bundled system adapters initially expose read-only Actor data. They do not
claim support for unverified skill-roll, attack or resource-spending APIs. Add
those operations only with a pinned upstream contract and appropriate tests.

Empty compatibility version lists mean **no version restriction has been
declared**, not that every release has been tested. Consult `status`, the
`compatibility.tested` matrix and each README before claiming compatibility.

The support and maintenance scope starts at **Foundry VTT 13, inclusive**.
Earlier generations remain outside that scope even if an existing runtime probe
succeeds; this policy does not add a shared version guard. The minimum does not
establish support for every later generation or every upstream system release.

An optional `actor-projection.json` belongs to the system integration. It allows
generic core responses to project familiar fields without embedding one game's
data paths in the provider. Systems without a projection retain generic identity
and raw system data.

## Upstream source references

Keep the adapter version/update separate from the upstream code used. Select the
latest official release; if there are no releases, select the latest tag; if
neither exists, use the default-branch commit and its full hash as the upstream
version. Record the resolved commit and source inspection date in the package
README, independently of live verification. Missing provenance means that the
baseline has not been recorded, not that upstream has no releases or tags.

Follow the [upstream source reference policy](../docs/guides/writing-integrations.md#upstream-source-references).
Record source inspection when performed; populate `compatibility.tested` and
`upstream.verifiedAt` only after an actual live verification.
