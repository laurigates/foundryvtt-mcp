/** Historical raw read only; no inspected Foundry 13 upstream release is claimed. */
export const metadata = Object.freeze({
  "schemaVersion": 1,
  "protocolVersion": 1,
  "kind": "system",
  "id": "dnd5e",
  "adapterVersion": "0.1.1",
  "updatedAt": "2026-11-22",
  "entrypoint": "adapter.py",
  "status": "experimental",
  "upstream": {
    "repository": null,
    "reference": null,
    "updatedAt": null,
    "verifiedAt": null
  },
  "compatibility": {
    "foundryVersions": [],
    "integrationVersions": [],
    "tested": []
  },
  "foundryGeneration": 13
});
export const legacyOperation = Object.freeze({
  "id": "get_actor_data",
  "description": "Read an Actor document and its unmodified dnd5e system data. Does not calculate game rules or roll dice.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "actor_uuid": {
        "type": "string",
        "minLength": 1,
        "pattern": "^\\S+$",
        "description": "Actor UUID in the selected target world."
      }
    },
    "required": [
      "actor_uuid"
    ],
    "additionalProperties": false
  },
  "outputSchema": {
    "type": "object",
    "properties": {
      "id": {
        "type": "string"
      },
      "uuid": {
        "type": "string"
      },
      "name": {
        "type": "string"
      },
      "type": {
        "type": "string"
      },
      "system": {
        "type": "object",
        "additionalProperties": true
      }
    },
    "required": [
      "id",
      "uuid",
      "name",
      "type",
      "system"
    ],
    "additionalProperties": true
  },
  "binding": "get_actor_data.js",
  "probe": "probe.js",
  "readOnly": true
});
export const legacyBinding = "const actor = await fromUuid(args.actor_uuid);\nif (!actor || actor.documentName !== \"Actor\") throw new Error(\"Actor UUID does not resolve to an Actor\");\nif (game.system.id !== \"dnd5e\") throw new Error(\"This operation requires the dnd5e system\");\nconst data = actor.toObject();\nreturn {id: actor.id, uuid: actor.uuid, name: actor.name, type: actor.type, system: data.system ?? {}};\n";
export const legacyProbe = "// INTEGRATION_PROBE: no state changes and no assumption about skill/roll API signatures.\nconst ready = Boolean(game.ready && game.system.id === \"dnd5e\" && typeof fromUuid === \"function\");\nreturn {ready, reason: ready ? undefined : \"The dnd5e runtime is not ready\"};\n";
