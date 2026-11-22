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

## Complete package example

[`item-piles/`](item-piles/README.md) demonstrates a larger integration without
provider-specific code. Its `src/registry.mjs` collects explicit operations from
domain files, each with input/output schemas, API requirements and a `readOnly`
classification. `src/runtime.mjs` contains shared document, permission and DTO
helpers. `build.mjs` embeds that factory and one fixed handler into each runtime
script, and generates the manifest and per-operation probes.

The generated files are checked in. The production loader reads them as ordinary
bindings; it does not bundle modules, install dependencies or resolve imports at
runtime. Callers cannot supply JavaScript, an API function name or another
operation to the Python callback. The Python adapter allowlist comes from the
local manifest and remains bound to the host's operation token.

Run `npm run generate:item-piles` after editing its sources, then
`npm run check:item-piles` and `npm run test:item-piles`. The ordinary build and
test commands reject stale generated output. Node tests cover the fixed bindings
and probe policy; `npm run test:python` also discovers the package's adapter tests.

New Item Piles operations use the inspected 3.3.4 API contract on Foundry 13/14.
They require active `socketlib` and `lib-wrapper`; writes additionally require
the selected target's write flag and a GM runtime. Read operations check document
access. The earlier `get_items` read retains its capability-based version policy.
These restrictions describe what may be advertised, not a performed live test.
