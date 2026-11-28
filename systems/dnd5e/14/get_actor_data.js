const actor = await fromUuid(args.actor_uuid);
if (!actor || actor.documentName !== "Actor") throw new Error("Actor UUID does not resolve to an Actor");
if (game.system.id !== "dnd5e") throw new Error("This operation requires the dnd5e system");
const data = actor.toObject();
return {id: actor.id, uuid: actor.uuid, name: actor.name, type: actor.type, system: data.system ?? {}};
