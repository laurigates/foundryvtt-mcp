// INTEGRATION_PROBE: no state changes and no assumption about skill/roll API signatures.
const ready = Boolean(game.ready && game.system.id === "pf2e" && typeof fromUuid === "function");
return {ready, reason: ready ? undefined : "The pf2e runtime is not ready"};
