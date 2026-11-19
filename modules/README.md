# Module integrations

Each directory preserves the exact Foundry module ID and contains a manifest,
Python adapter, README, fixed runtime bindings, and tests. Tool names follow
`module_{id}_{operation}`, for example `module_item-piles_get_items`.

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
