# Pathfinder 2e: Foundry 13 raw Actor read

This is a single manual read recipe, not a rules or mutation workflow.

1. Start the intended Foundry **13** world using system **`pf2e`**.
2. Configure an execution-capable target from [targets.example.json](targets.example.json);
   replace the world/origin/relay/runtime-client placeholders and environment credentials.
3. Call `get_target_status` and `list_systems` with `target_id: "pf2e-13-demo"`.
   Confirm that the host selected the generation-13 package.
4. Replace `Actor.REPLACE_ACTOR_ID` in [workflows.json](workflows.json) with an
   Actor UUID from that world, then call `system_pf2e_get_actor_data`.
5. Read the returned `id`, `uuid`, `name`, `type` and source `system` object.

The recipe does not enable writes. No upstream release/version for this
Foundry-13 variant has been inspected or pinned, and no live combination has
been verified. Method availability is an experimental capability check only.
