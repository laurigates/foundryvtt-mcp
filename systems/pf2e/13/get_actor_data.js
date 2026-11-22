const actor = await fromUuid(args.actor_uuid);
if (!actor || actor.documentName !== "Actor") throw new Error("Actor UUID does not resolve to an Actor");
if (game.system.id !== "pf2e") throw new Error("This operation requires the pf2e system");
const data = actor.toObject();
return {id: actor.id, uuid: actor.uuid, name: actor.name, type: actor.type, system: data.system ?? {}};
