# Module integrations

For the list of included modules, adapter/upstream versions, Foundry requirements
and verification status, see the [module bridge catalog](../docs/bridges/modules.md).
Installation and API details belong in each package's README.

Each module directory preserves the exact Foundry module ID. Its numeric children,
such as `modules/<id>/13/` and `modules/<id>/14/`, are independent packages with
their own manifest, README, fixed runtime bindings, probes and tests.
The manifest's `foundryGeneration` must match the directory. Tool names follow
`module_{id}_{operation}` and do not change when a target upgrades Foundry.

The session selects the exact Foundry generation before activating an integration;
the remote module must be active and its operation probes must succeed. There is
no fallback to an older or newer generation. Module state, installed versions and adapter instances
are independent for each target. A module can work without a local system
adapter when its own API provides the required behavior.

The module's internal Foundry dependencies remain its responsibility. This
server checks the public API it invokes; it does not install or manage other
Foundry packages.

Bindings are local reviewed resources distributed with the integration. The MCP
caller supplies JSON arguments, not JavaScript or a runtime function path.
Provider credentials and transport details belong to the session host.

`compatibility.systems`, when present, restricts the remote system IDs. It does
not require a local system adapter. Version lists are exact-match restrictions
when nonempty; empty lists leave compatibility to runtime probes and must not be
presented as tested support. Record actual live verification separately.

The support and maintenance scope starts at **Foundry VTT 13, inclusive**.
Versioned adapters enforce that generation boundary. Generic core operations and
legacy flat third-party packages retain their existing capability policies.
Each generation package can have narrower upstream-version/build requirements;
later generations are not automatically verified.

Copy a complete generation directory from an external adapter repository into
`modules/<id>/<generation>/` and refresh or reconnect the target. It is discovered
without editing a registry or provider. See the
[installation and authoring guide](../docs/guides/writing-integrations.md#install-a-third-party-adapter).
Packages must contain their own runtime resources; sibling generations are not
shared dependencies.

## Upstream source references

Keep the adapter version/update separate from the upstream code used. Select the
latest official release compatible with this Foundry generation; if the project
has no releases, select the latest compatible tag; if
neither exists, use the default-branch commit and its full hash as the upstream
version. Record the resolved commit and source inspection date in the package
README, independently of live verification. An unexamined newer release is a
pending synchronization target, not an established source baseline.

Follow the [upstream source reference policy](../docs/guides/writing-integrations.md#upstream-source-references)
and [integration authoring guide](../docs/guides/writing-integrations.md) for
package structure, runtime bindings, shared helpers and validation.
