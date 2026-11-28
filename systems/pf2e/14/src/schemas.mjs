export const text = { type: 'string' };
export const nullableText = { type: ['string', 'null'] };
export const number = { type: ['number', 'null'] };
export const flag = { type: 'boolean' };
export const data = { type: 'object', additionalProperties: true };
export const nullableData = { type: ['object', 'null'], additionalProperties: true };
export const uuid = { type: 'string', minLength: 1, maxLength: 300, pattern: '^\\S+$' };
export const slug = { type: 'string', minLength: 1, maxLength: 80, pattern: '^[a-z][a-z0-9-]*$' };
export const integer = { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
export const object = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
export const array = (items) => ({ type: 'array', items });
export const actorInput = (properties = {}, required = []) => object({ actor_uuid: uuid, ...properties }, ['actor_uuid', ...required]);
export const actor = object({ id: text, uuid: text, name: text, type: text });
export const statistic = object({ slug: text, label: text, attribute: nullableText, rank: number, proficient: flag,
  modifier: number, dc: number, check_type: text, breakdown: text, dc_breakdown: text, domains: array(text) });
export const condition = object({ ...actor.properties, slug: text, value: number, active: flag, locked: flag, temporary: flag });
export const conditions = object({ actor_uuid: text, conditions: array(condition) });
export const resource = object({ slug: text, label: text, value: integer, max: integer });
export const resourceResult = object({ actor_uuid: text, resource });
export const currency = object({ denominations: data, copper_value: integer });
export const currencyResult = object({ actor_uuid: text, ...currency.properties });
export const coinInput = { ...object({ pp: integer, gp: integer, sp: integer, cp: integer }, []), minProperties: 1 };
export const rollInput = { token_uuid: uuid, dc: { type: 'integer', minimum: 0, maximum: 1000 },
  message_mode: { type: 'string', enum: ['public', 'gm', 'blind', 'self'], default: 'public' },
  create_message: { type: 'boolean', default: true } };
export const rollResult = object({ total: number, formula: nullableText, natural: number, degree_of_success: number,
  message_uuid: nullableText, message_mode: nullableText, hidden: flag });
export const strike = object({ index: integer, label: text, slug: text, item_uuid: text, ready: flag, visible: flag,
  modifier: number, variants: array(object({ index: integer, label: text })), alternative_usages: integer });
