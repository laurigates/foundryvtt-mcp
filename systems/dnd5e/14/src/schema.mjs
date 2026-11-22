/** Package-owned contracts: fixed operations accept JSON, never code or API paths. */
export const text = { type: 'string' };
export const boolean = { type: 'boolean' };
export const number = { type: 'number' };
export const uuid = { type: 'string', minLength: 1, maxLength: 500, pattern: '^\\S+$' };
export const key = { type: 'string', minLength: 1, maxLength: 100, pattern: '^[A-Za-z0-9][A-Za-z0-9_-]*$' };
export const object = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
export const array = (items) => ({ type: 'array', items });
export const jsonValue = { anyOf: [
  { type: 'null' }, boolean, number, text,
  { type: 'array', items: { $ref: '#/$defs/JsonValue' } },
  { type: 'object', additionalProperties: { $ref: '#/$defs/JsonValue' } },
] };
export const jsonObject = { type: 'object', additionalProperties: { $ref: '#/$defs/JsonValue' } };
export const withJson = (schema) => ({ ...schema, $defs: { JsonValue: jsonValue } });
export const reference = object({ id: text, uuid: text, name: text, type: text });
export const actorInput = { actor_uuid: uuid };
export const activityInput = { item_uuid: uuid, activity_id: key };
export const rollOptions = {
  chat_message: boolean,
  roll_mode: { type: 'string', enum: ['public', 'gm', 'blind', 'self'] },
  advantage: boolean, disadvantage: boolean,
  dc: { type: 'integer', minimum: 0, maximum: 1000 },
};
export const roll = object({
  formula: text, total: number, result: text,
  is_critical: boolean, is_fumble: boolean,
  message_uuid: { type: ['string', 'null'] },
  data: jsonObject,
});
export const rollResult = withJson(object({
  actor_uuid: text, item_uuid: { type: ['string', 'null'] },
  activity_id: { type: ['string', 'null'] }, rolls: array(roll), rolls_redacted: boolean, message_uuids: array(text),
  observed_actor: jsonObject,
}));
export const damageEntry = object({
  type: key, value: { type: 'number', minimum: 0, maximum: 1000000 },
  properties: { type: 'array', maxItems: 30, uniqueItems: true, items: key },
}, ['type', 'value']);
export const damageInput = {
  ...actorInput,
  damages: { type: 'array', minItems: 1, maxItems: 30, items: damageEntry },
  multiplier: { type: 'number', minimum: 0, maximum: 100 },
};
