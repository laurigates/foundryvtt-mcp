// INTEGRATION_PROBE: module dependencies and their setup remain Foundry's responsibility.
const api = game.itempiles?.API;
const ready = Boolean(game.ready && game.modules.get("item-piles")?.active && api && typeof api.getActorItems === "function" && typeof api.getItemQuantity === "function" && typeof fromUuid === "function");
return {ready, reason: ready ? undefined : "The Item Piles public API is unavailable or not ready"};
