const actor = await fromUuid(args.actor_uuid);
if (!actor || actor.documentName !== "Actor") throw new Error("Actor UUID does not resolve to an Actor");
const api = game.itempiles?.API;
if (!game.modules.get("item-piles")?.active || !api || typeof api.getActorItems !== "function") throw new Error("Item Piles is not available");
const items = await api.getActorItems(actor);
return items.map(item => ({id: item.id, uuid: item.uuid, name: item.name, type: item.type, quantity: api.getItemQuantity(item)}));
