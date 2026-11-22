/** Public merchant, pricing, and roll-table operations for the inspected 3.3.4 API. */
const uuid = { type: 'string', minLength: 1, pattern: '^\\S+$' };
const quantity = { type: 'number', exclusiveMinimum: 0, maximum: Number.MAX_SAFE_INTEGER,
  description: 'Number of purchases; each purchase contains the configured number of item units.' };
const boolean = { type: 'boolean' };
const interaction = { type: 'string', minLength: 1, maxLength: 200 };
const object = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
const jsonValue = { anyOf: [
  { type: 'null' }, { type: 'boolean' }, { type: 'number' }, { type: 'string' },
  { type: 'array', items: { $ref: '#/$defs/JsonValue' } },
  { type: 'object', additionalProperties: { $ref: '#/$defs/JsonValue' } },
] };
const jsonRef = { $ref: '#/$defs/JsonValue' };
const withJson = (schema) => ({ ...schema, $defs: { JsonValue: jsonValue } });
const summary = object({ id: { type: 'string' }, uuid: { type: 'string' }, name: { type: 'string' }, type: { type: 'string' }, quantity: { type: 'number' } });
const itemDeltas = { type: 'array', items: object({ item: summary, quantity: { type: 'number' }, type: { type: 'string' } }, ['item', 'quantity']) };
const attributeDeltas = { type: 'object', additionalProperties: { type: 'number' } };
const price = object({
  payment_index: { type: 'integer', minimum: 0 }, free: boolean, primary: boolean,
  quantity: { type: 'number' }, base_cost: { type: 'number' }, total_cost: { type: 'number' },
  base_price_string: { type: 'string' }, price_string: { type: 'string' },
  max_quantity: { type: ['number', 'null'] }, unlimited: boolean,
  base_prices: { type: 'array', items: jsonRef }, prices: { type: 'array', items: jsonRef },
});

export const operations = [
  {
    id: 'get_item_categories',
    description: 'Read localized system item categories and custom Item Piles categories.',
    readOnly: true, requiredMethods: ['getItemCategories'],
    inputSchema: object({}), outputSchema: { type: 'object', additionalProperties: { type: 'string' } },
    handler: async function (args, runtime) {
      const result = await runtime.api.getItemCategories();
      if (!result || Array.isArray(result) || typeof result !== 'object' || Object.values(result).some((value) => typeof value !== 'string')) {
        throw new Error('Item Piles returned invalid item categories');
      }
      return runtime.json(result);
    },
  },
  {
    id: 'inspect_item',
    description: 'Inspect an item through public Item Piles quantity, base-cost, validity, and stacking helpers; optionally evaluate stacking for an Actor.',
    readOnly: true, requiredMethods: ['getItemQuantity', 'getCostOfItem', 'canItemStack', 'isItemInvalid'],
    inputSchema: object({ item_uuid: uuid, actor_uuid: uuid }, ['item_uuid']),
    outputSchema: withJson(object({ item: summary, base_cost: { type: 'number' }, can_stack: boolean, invalid: boolean, invalid_reason: jsonRef })),
    handler: async function (args, runtime) {
      const item = await runtime.item(args.item_uuid);
      const actor = args.actor_uuid ? await runtime.actor(args.actor_uuid) : false;
      const invalid = await runtime.api.isItemInvalid(item);
      return {
        item: runtime.itemSummary(item), base_cost: runtime.finite(await runtime.api.getCostOfItem(item), 'Item base cost'),
        can_stack: Boolean(await runtime.api.canItemStack(item, actor)), invalid: Boolean(invalid), invalid_reason: runtime.json(invalid),
      };
    },
  },
  {
    id: 'get_item_prices',
    description: 'Quote payment options for one item. quantity counts purchases; units_per_purchase and requested_units show the actual item units. A buyer enables affordability checks; quotes do not reserve stock or lock prices.',
    readOnly: true, requiredMethods: ['getPricesForItem', 'getItemQuantity'],
    inputSchema: object({ item_uuid: uuid, seller_uuid: uuid, buyer_uuid: uuid, quantity }, ['item_uuid']),
    outputSchema: withJson(object({ item: summary, seller_uuid: uuid, buyer_uuid: { type: ['string', 'null'] },
      units_per_purchase: { type: 'number', exclusiveMinimum: 0, maximum: Number.MAX_SAFE_INTEGER },
      requested_units: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
      affordability_checked: boolean, prices: { type: 'array', items: price } })),
    handler: async function (args, runtime) {
      const item = await runtime.item(args.item_uuid);
      const seller = args.seller_uuid ? await runtime.actor(args.seller_uuid)
        : item.parent?.documentName === 'Actor' ? runtime.assertReadable(item.parent) : false;
      if (!seller) throw new Error('A seller_uuid is required for an item that does not belong to an Actor');
      const buyer = args.buyer_uuid ? await runtime.actor(args.buyer_uuid) : false;
      const count = runtime.positive(args.quantity ?? 1);
      const unitsPath = runtime.api.QUANTITY_FOR_PRICE_ATTRIBUTE;
      let configuredUnits;
      if (unitsPath !== undefined && unitsPath !== null && unitsPath !== false && unitsPath !== '') {
        if (typeof unitsPath !== 'string' || !/^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/.test(unitsPath)
          || unitsPath.split('.').some((part) => ['__proto__', 'prototype', 'constructor'].includes(part))) {
          throw new Error('The configured quantity-for-price attribute must be a safe property path');
        }
        configuredUnits = unitsPath.split('.').reduce((value, part) => value?.[part], item);
      }
      const unitsPerPurchase = runtime.positive(configuredUnits ?? 1, 'Units per purchase');
      const requestedUnits = count * unitsPerPurchase;
      if (!Number.isSafeInteger(requestedUnits) || requestedUnits <= 0) {
        throw new Error('Requested item units must be a positive safe integer; fractional units would be truncated upstream');
      }
      const groups = await runtime.api.getPricesForItem(item, { seller, buyer, quantity: count });
      if (!Array.isArray(groups)) throw new Error('Item Piles returned invalid price groups');
      return {
        item: runtime.itemSummary(item), seller_uuid: seller.uuid, buyer_uuid: buyer ? buyer.uuid : null,
        units_per_purchase: unitsPerPurchase, requested_units: requestedUnits,
        affordability_checked: Boolean(buyer), prices: groups.map((group, index) => ({
          payment_index: index, free: group.free === true, primary: group.primary === true,
          quantity: runtime.finite(group.quantity ?? count),
          base_cost: runtime.finite(group.baseCost, 'Base price'), total_cost: runtime.finite(group.totalCost, 'Total price'),
          base_price_string: typeof group.basePriceString === 'string' ? group.basePriceString : '',
          price_string: typeof group.priceString === 'string' ? group.priceString : '',
          max_quantity: buyer && Number.isFinite(group.maxQuantity) ? group.maxQuantity : null,
          unlimited: group.maxQuantity === Infinity,
          base_prices: runtime.json(group.basePrices ?? []), prices: runtime.json(group.prices ?? []),
        })),
      };
    },
  },
  {
    id: 'get_merchant_modifiers',
    description: 'Read effective merchant buy/sell modifiers, optionally for a particular Actor. absolute=true excludes merchant base modifiers.',
    readOnly: true, requiredMethods: ['getMerchantPriceModifiers', 'isItemPileMerchant'],
    inputSchema: object({ merchant_uuid: uuid, actor_uuid: uuid, absolute: boolean }, ['merchant_uuid']),
    outputSchema: object({ buyPriceModifier: { type: 'number' }, sellPriceModifier: { type: 'number' } }),
    handler: async function (args, runtime) {
      const merchant = await runtime.actor(args.merchant_uuid);
      if (!runtime.api.isItemPileMerchant(merchant)) throw new Error('The target must be an Item Piles merchant');
      const actor = args.actor_uuid ? await runtime.actor(args.actor_uuid) : false;
      const result = await runtime.api.getMerchantPriceModifiers(merchant, { actor, absolute: args.absolute ?? false });
      return { buyPriceModifier: runtime.finite(result.buyPriceModifier), sellPriceModifier: runtime.finite(result.sellPriceModifier) };
    },
  },
  {
    id: 'update_merchant_modifiers',
    description: 'GM: update Actor-specific merchant buy/sell modifiers and verify the observed settings. Both amounts are required, including relative updates.',
    readOnly: false, requiredMethods: ['updateMerchantPriceModifiers', 'getActorFlagData', 'isItemPileMerchant'],
    inputSchema: object({ merchant_uuid: uuid, modifiers: { type: 'array', minItems: 1, maxItems: 100, items: object({
      actor_uuid: uuid, buy_price_modifier: { type: 'number' }, sell_price_modifier: { type: 'number' }, relative: boolean, override: boolean,
    }, ['actor_uuid', 'buy_price_modifier', 'sell_price_modifier']) } }),
    outputSchema: object({ merchant_uuid: uuid, modifiers: { type: 'array', items: object({
      actor_uuid: uuid, buy_price_modifier: { type: 'number' }, sell_price_modifier: { type: 'number' }, override: boolean,
    }) } }),
    handler: async function (args, runtime) {
      runtime.requireGM();
      const merchant = await runtime.actor(args.merchant_uuid);
      if (!runtime.api.isItemPileMerchant(merchant)) throw new Error('The target must be an Item Piles merchant');
      const before = await runtime.api.getActorFlagData(merchant);
      const seen = new Set();
      const entries = [];
      const expected = [];
      for (const modifier of args.modifiers) {
        const actor = await runtime.actor(modifier.actor_uuid);
        if (seen.has(actor.uuid)) throw new Error('Duplicate modifier Actors are not allowed');
        seen.add(actor.uuid);
        const buy = runtime.finite(modifier.buy_price_modifier, 'Buy price modifier');
        const sell = runtime.finite(modifier.sell_price_modifier, 'Sell price modifier');
        const relative = modifier.relative ?? false;
        if (!relative && (buy < 0 || sell < 0)) throw new Error('Absolute price modifiers must not be negative');
        const old = (before.actorPriceModifiers ?? []).find((entry) => entry.actorUuid === actor.uuid);
        const newBuy = relative ? (old?.buyPriceModifier ?? before.buyPriceModifier ?? 1) + buy : buy;
        const newSell = relative ? (old?.sellPriceModifier ?? before.sellPriceModifier ?? 0.5) + sell : sell;
        expected.push({ actor_uuid: actor.uuid, buy_price_modifier: Math.max(0, runtime.finite(newBuy)),
          sell_price_modifier: Math.max(0, runtime.finite(newSell)), override: modifier.override ?? false });
        entries.push({ actorUuid: actor.uuid, buyPriceModifier: buy, sellPriceModifier: sell,
          relative, override: modifier.override ?? false });
      }
      return runtime.write(async () => {
        const result = await runtime.api.updateMerchantPriceModifiers(merchant, entries);
        if (result === false || result === null) throw new Error('The upstream modifier update was not confirmed');
        const observed = await runtime.api.getActorFlagData(await runtime.actor(args.merchant_uuid));
        for (const wanted of expected) {
          const actual = (observed.actorPriceModifiers ?? []).find((entry) => entry.actorUuid === wanted.actor_uuid);
          if (!actual || actual.buyPriceModifier !== wanted.buy_price_modifier || actual.sellPriceModifier !== wanted.sell_price_modifier
            || Boolean(actual.override) !== wanted.override) throw new Error('The requested merchant modifiers could not be verified after the call');
        }
        return { merchant_uuid: merchant.uuid, modifiers: expected };
      });
    },
  },
  {
    id: 'trade_items',
    description: 'GM: buy or sell ONE item line through Item Piles tradeItems, exchanging payment and change. quantity counts purchases; validates the positive whole item units implied by the configured units-per-price value, actual stock and payment affordability. Never retries an uncertain result.',
    readOnly: false, requiredMethods: ['tradeItems', 'getPricesForItem', 'getItemQuantity', 'getActorFlagData', 'isItemPileMerchant'],
    inputSchema: object({ seller_uuid: uuid, buyer_uuid: uuid, item_id: uuid, quantity,
      payment_index: { type: 'integer', minimum: 0 }, interaction_id: interaction }, ['seller_uuid', 'buyer_uuid', 'item_id', 'quantity']),
    outputSchema: withJson(object({ itemDeltas, attributeDeltas, itemPrices: jsonRef })),
    handler: async function (args, runtime) {
      runtime.requireGM();
      const seller = await runtime.actor(args.seller_uuid);
      const buyer = await runtime.actor(args.buyer_uuid);
      if (seller.uuid === buyer.uuid) throw new Error('Seller and buyer must be different Actors');
      const item = seller.items?.get(args.item_id);
      if (!item) throw new Error('The exact item_id does not exist on the seller; name lookup is not supported');
      const count = runtime.positive(args.quantity);
      const index = args.payment_index ?? 0;
      if (!Number.isSafeInteger(index) || index < 0) throw new Error('payment_index must be a non-negative integer');
      const unitsPath = runtime.api.QUANTITY_FOR_PRICE_ATTRIBUTE;
      let configuredUnits;
      if (unitsPath !== undefined && unitsPath !== null && unitsPath !== false && unitsPath !== '') {
        if (typeof unitsPath !== 'string' || !/^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/.test(unitsPath)
          || unitsPath.split('.').some((part) => ['__proto__', 'prototype', 'constructor'].includes(part))) {
          throw new Error('The configured quantity-for-price attribute must be a safe property path');
        }
        configuredUnits = unitsPath.split('.').reduce((value, part) => value?.[part], item);
      }
      const unitsPerPurchase = runtime.positive(configuredUnits ?? 1, 'Units per purchase');
      const requestedUnits = count * unitsPerPurchase;
      if (!Number.isSafeInteger(requestedUnits) || requestedUnits <= 0) {
        throw new Error('Requested item units must be a positive safe integer; fractional units would be truncated upstream');
      }
      const sellerFlags = await runtime.api.getActorFlagData(seller);
      const itemFlags = item.flags?.['item-piles']?.item ?? {};
      const merchant = runtime.api.isItemPileMerchant(seller);
      const unlimitedStock = merchant && (itemFlags.infiniteQuantity === 'yes'
        || (itemFlags.infiniteQuantity !== 'no' && itemFlags.infiniteQuantity !== 'yes' && sellerFlags.infiniteQuantity === true));
      if (!unlimitedStock && requestedUnits > runtime.finite(runtime.api.getItemQuantity(item), 'Available item quantity')) {
        throw new Error('The requested quantity exceeds the seller stock');
      }
      const prices = await runtime.api.getPricesForItem(item, { seller, buyer, quantity: count });
      if (!Array.isArray(prices) || !prices[index]) throw new Error('The selected payment option does not exist');
      const available = prices[index].maxQuantity;
      if (!(available === Infinity || (Number.isFinite(available) && available >= count))) throw new Error('The buyer cannot afford the requested quantity');
      return runtime.write(async () => {
        const result = await runtime.api.tradeItems(seller, buyer,
          [{ item: item.id, quantity: count, paymentIndex: index }], { interactionId: args.interaction_id ?? false });
        if (!result?.itemPrices || typeof result.itemPrices !== 'object' || Array.isArray(result.itemPrices)
          || result.itemPrices.canBuy !== true) throw new Error('Item Piles returned invalid or unaffordable trade payment data');
        return { ...runtime.currencyDeltas(result), itemPrices: runtime.json(result.itemPrices) };
      });
    },
  },
  {
    id: 'refresh_merchant_inventory',
    description: 'GM: populate a merchant from its configured roll tables. remove_existing_items is required explicitly because true clears existing stock before replenishment.',
    readOnly: false, requiredMethods: ['refreshMerchantInventory', 'isItemPileMerchant', 'getItemQuantity'],
    inputSchema: object({ merchant_uuid: uuid, remove_existing_items: boolean }), outputSchema: itemDeltas,
    handler: async function (args, runtime) {
      runtime.requireGM();
      const merchant = await runtime.actor(args.merchant_uuid);
      if (!runtime.api.isItemPileMerchant(merchant)) throw new Error('The target must be an Item Piles merchant');
      if (typeof args.remove_existing_items !== 'boolean') throw new Error('Choose remove_existing_items explicitly');
      return runtime.write(async () => runtime.itemDeltas(await runtime.api.refreshMerchantInventory(merchant,
        { removeExistingActorItems: args.remove_existing_items })));
    },
  },
  {
    id: 'roll_item_table',
    description: 'GM: roll one exact RollTable UUID and optionally add the results to an Actor. This is a write even without a recipient; reset, normalization, chat and replacing inventory default to false. Text results may also credit currencies, but returned item deltas do not confirm monetary effects: read get_currencies afterward to inspect balances.',
    readOnly: false, requiredMethods: ['rollItemTable', 'getItemQuantity'],
    inputSchema: object({ table_uuid: uuid, actor_uuid: uuid, rolls: { type: 'integer', minimum: 1, maximum: 100 },
      reset_table: boolean, normalize_table: boolean, display_chat: boolean, remove_existing_items: boolean,
      custom_category: { type: 'string', minLength: 1, maxLength: 200 } }, ['table_uuid', 'rolls']),
    outputSchema: itemDeltas,
    handler: async function (args, runtime) {
      runtime.requireGM();
      const table = await runtime.document(args.table_uuid, 'RollTable');
      const actor = args.actor_uuid ? await runtime.actor(args.actor_uuid) : false;
      if (!Number.isInteger(args.rolls) || args.rolls < 1 || args.rolls > 100) throw new Error('rolls must be an integer between 1 and 100');
      if (table.uuid.startsWith('Compendium.') && (args.reset_table || args.normalize_table)) throw new Error('Compendium tables cannot be reset or normalized by this operation');
      if (args.remove_existing_items && !actor) throw new Error('Replacing inventory requires actor_uuid');
      return runtime.write(async () => runtime.itemDeltas(await runtime.api.rollItemTable(table.uuid, {
        timesToRoll: args.rolls, targetActor: actor,
        resetTable: args.reset_table ?? false, normalizeTable: args.normalize_table ?? false,
        displayChat: args.display_chat ?? false, removeExistingActorItems: args.remove_existing_items ?? false,
        customCategory: args.custom_category ?? false,
      })));
    },
  },
];
