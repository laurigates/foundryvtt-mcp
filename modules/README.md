# Module integrations

For the list of included modules, adapter/upstream versions, Foundry requirements
and verification status, see the [module bridge catalog](../docs/bridges/modules.md).
Installation and API details belong in each package's README.

Each directory preserves the exact Foundry module ID and contains a manifest,
Python adapter, README, fixed runtime bindings, and tests. Tool names follow
`module_{id}_{operation}`.

The session activates integrations only when the remote module is active and its
operation probes succeed. Module state, installed versions and adapter instances
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
Earlier generations remain outside that scope even if an existing runtime probe
succeeds; this policy does not add a shared version guard. Each package can have
narrower requirements, and later generations are not automatically verified.

## Upstream source references

Keep the adapter version/update separate from the upstream code used. Select the
latest official release; if there are no releases, select the latest tag; if
neither exists, use the default-branch commit and its full hash as the upstream
version. Record the resolved commit and source inspection date in the package
README, independently of live verification. An unexamined newer release is a
pending synchronization target, not an established source baseline.

Follow the [upstream source reference policy](../docs/guides/writing-integrations.md#upstream-source-references)
and [integration authoring guide](../docs/guides/writing-integrations.md) for
package structure, runtime bindings, shared helpers and validation.
