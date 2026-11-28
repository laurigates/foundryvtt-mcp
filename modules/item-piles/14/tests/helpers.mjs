import { runInNewContext } from 'node:vm';
import { createRuntime } from '../src/runtime.mjs';

export const plain = (value) => JSON.parse(JSON.stringify(value));

export function fixture(overrides = {}) {
  const actor = (id) => ({ documentName: 'Actor', id, uuid: `Actor.${id}`, name: id, type: 'character',
    system: { currency: { gp: 20, sp: 5 } }, flags: {}, items: new Map(), testUserPermission: () => true });
  const seller = actor('seller');
  const buyer = actor('buyer');
  const item = { documentName: 'Item', id: 'potion', uuid: 'Actor.seller.Item.potion', name: 'Potion', type: 'consumable',
    parent: seller, system: { quantity: 4 }, flags: {}, testUserPermission: () => true,
    toObject() { return { _id: this.id, name: this.name, type: this.type, system: structuredClone(this.system), flags: structuredClone(this.flags) }; } };
  seller.items.set(item.id, item);
  const table = { documentName: 'RollTable', id: 'loot', uuid: 'RollTable.loot', name: 'Loot', testUserPermission: () => true };
  const token = { documentName: 'Token', id: 'seller', uuid: 'Scene.shop.Token.seller', name: 'Seller', actor: seller, testUserPermission: () => true };
  const documents = new Map([seller, buyer, item, table, token].map((entry) => [entry.uuid, entry]));
  const api = {
    CURRENCIES: [
      { name: 'Gold', abbreviation: '{#}gp', type: 'attribute', exchangeRate: 1, primary: true, data: { path: 'system.currency.gp' } },
      { name: 'Silver', abbreviation: '{#}sp', type: 'attribute', exchangeRate: 0.1, data: { path: 'system.currency.sp' } },
    ], SECONDARY_CURRENCIES: [{ name: 'Favor', abbreviation: '{#}favor', type: 'attribute', exchangeRate: 1, data: { path: 'system.favor' } }],
    ITEM_QUANTITY_ATTRIBUTE: 'system.quantity',
    getItemQuantity: (value) => value.system?.quantity ?? 1,
    ...overrides,
  };
  const game = { ready: true, release: { generation: 14 }, user: { id: 'gm', isGM: true },
    modules: new Map([['item-piles', { active: true, version: '3.3.4' }], ['socketlib', { active: true }], ['lib-wrapper', { active: true }]]),
    itempiles: { API: api } };
  return { game, api, documents, seller, buyer, item, table, token, fromUuid: async (uuid) => documents.get(uuid) ?? null };
}

export function runtime(world, options = {}) {
  return runInNewContext(`(${createRuntime.toString()})(${JSON.stringify(options)})`, { game: world.game, fromUuid: world.fromUuid });
}

// Handlers are self-contained by construction: build.mjs embeds their source in
// standalone bindings that receive only `args` and `runtime`. Calling the handler
// directly keeps that contract under test without constructing code at runtime.
export async function execute(operation, args, world) {
  const options = { readOnly: operation.readOnly, requiredMethods: operation.requiredMethods, legacy: operation.id === 'get_items' };
  return operation.handler(structuredClone(args), runtime(world, options));
}
