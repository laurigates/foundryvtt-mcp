/** Inventory and currency operations for the inspected Item Piles 3.3.4 API. */
const uuid = { type: 'string', minLength: 1, pattern: '^\\S+$' };
const number = { type: 'number' };
const text = { type: 'string' };
const boolean = { type: 'boolean' };
const quantity = { type: 'number', exclusiveMinimum: 0, maximum: Number.MAX_SAFE_INTEGER };
const nonnegative = { type: 'number', minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
const interaction = { type: 'string', minLength: 1, maxLength: 200 };
const object = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
const array = (items) => ({ type: 'array', items });
const inputArray = (items) => ({ type: 'array', minItems: 1, maxItems: 100, items });
const summary = object({ id: text, uuid: text, name: text, type: text, quantity: number });
const itemDeltas = array(object({ item: summary, quantity: number, type: text }, ['item', 'quantity']));
const attributeDeltas = { type: 'object', additionalProperties: number };
const currencyDeltas = object({ itemDeltas, attributeDeltas });
const allDeltas = object({ itemsTransferred: itemDeltas, attributesTransferred: attributeDeltas });
const attributes = (amount) => ({
  type: 'object', minProperties: 1, maxProperties: 100,
  propertyNames: {
    pattern: '^system\\.[A-Za-z0-9_-]+(?:\\.[A-Za-z0-9_-]+)*$',
    not: { pattern: '(?:^|\\.)(?:__proto__|prototype|constructor)(?:\\.|$)' },
  },
  additionalProperties: amount,
});
const itemRefs = inputArray(object({ item_uuid: uuid, quantity }));
const itemSelections = inputArray(object({ item_id: uuid, quantity }));
const currencyAmounts = (amount = quantity) => inputArray(object({
  abbreviation: { type: 'string', minLength: 1, maxLength: 100 }, quantity: amount,
}));
const itemFilters = { type: 'array', maxItems: 100, items: object({
  path: { type: 'string', minLength: 1, maxLength: 200 }, filter: { type: 'string', maxLength: 1000 },
}) };
const transfer = { source_uuid: uuid, target_uuid: uuid };
const logOptions = { skip_vault_logging: boolean, interaction_id: interaction };
const jsonValue = { anyOf: [
  { type: 'null' }, boolean, number, text,
  { type: 'array', items: { $ref: '#/$defs/JsonValue' } },
  { type: 'object', additionalProperties: { $ref: '#/$defs/JsonValue' } },
] };
const jsonObject = { type: 'object', additionalProperties: { $ref: '#/$defs/JsonValue' } };
const withJson = (schema) => ({ ...schema, $defs: { JsonValue: jsonValue } });

export const operations = [
  {
    id: 'get_items',
    description: 'Read an Actor inventory through the Item Piles public API, preserving the existing item summary contract.',
    readOnly: true, requiredMethods: ['getActorItems', 'getItemQuantity'],
    inputSchema: object({ actor_uuid: { ...uuid, description: 'Actor UUID in the selected target world.' } }),
    outputSchema: array(summary),
    handler: async function (args, runtime) {
      // Legacy input resolves only an Actor, not a Token alias.
      const actor = await runtime.document(args.actor_uuid, 'Actor');
      const items = await runtime.api.getActorItems(actor);
      if (!Array.isArray(items)) throw new Error('Item Piles returned an invalid inventory');
      return items.map((item) => runtime.itemSummary(item));
    },
  },
  {
    id: 'get_currencies',
    description: 'Read configured Actor currencies as numeric summaries. get_all includes zero balances; secondary includes secondary currencies (default true).',
    readOnly: true, requiredMethods: ['getActorCurrencies', 'getItemQuantity'],
    inputSchema: object({ actor_uuid: uuid, get_all: boolean, secondary: boolean }, ['actor_uuid']),
    outputSchema: array(object({
      id: { type: ['string', 'null'] }, name: text, abbreviation: text, type: { enum: ['attribute', 'item'] }, quantity: number,
      primary: boolean, secondary: boolean, exchangeRate: { type: ['number', 'null'] },
      path: { type: ['string', 'null'] }, item: { anyOf: [summary, { type: 'null' }] },
    })),
    handler: async function (args, runtime) {
      const actor = await runtime.actor(args.actor_uuid);
      const currencies = await runtime.api.getActorCurrencies(actor, { getAll: args.get_all ?? false, secondary: args.secondary ?? true });
      if (!Array.isArray(currencies)) throw new Error('Item Piles returned invalid currencies');
      return currencies.map((currency) => {
        if (!currency || typeof currency !== 'object') throw new Error('Item Piles returned an invalid currency');
        const type = currency.type ?? 'attribute';
        if (!['attribute', 'item'].includes(type)) throw new Error('Item Piles returned an unknown currency type');
        const path = currency.path ?? currency.data?.path;
        return {
          id: typeof currency.id === 'string' ? currency.id : null,
          name: typeof currency.name === 'string' ? currency.name : '',
          abbreviation: typeof currency.abbreviation === 'string' ? currency.abbreviation : '',
          type, quantity: runtime.finite(currency.quantity, 'Currency quantity'),
          primary: currency.primary === true, secondary: currency.secondary === true,
          exchangeRate: currency.exchangeRate == null ? null : runtime.finite(currency.exchangeRate, 'Currency exchange rate'),
          path: type === 'attribute' && typeof path === 'string' ? path : null,
          item: currency.item ? runtime.itemSummary(currency.item) : null,
        };
      });
    },
  },
  {
    id: 'get_currency_config',
    description: 'Read global currency definitions, abbreviations and system quantity/price paths. An optional Actor selects its primary currency; other definitions remain global.',
    readOnly: true, requiredMethods: ['getPrimaryCurrency', 'getCurrenciesAbbreviations'],
    inputSchema: object({ actor_uuid: uuid }, []),
    outputSchema: withJson(object({
      currencies: array(jsonObject), secondaryCurrencies: array(jsonObject),
      primaryCurrency: { anyOf: [jsonObject, { type: 'null' }] }, abbreviations: array(text),
      quantityAttribute: text, priceAttribute: text, decimalDigits: number,
    })),
    handler: async function (args, runtime) {
      const actor = args.actor_uuid ? await runtime.actor(args.actor_uuid) : false;
      const api = runtime.api;
      if (!Array.isArray(api.CURRENCIES) || !Array.isArray(api.SECONDARY_CURRENCIES)) throw new Error('Item Piles currency definitions are unavailable');
      const abbreviations = await api.getCurrenciesAbbreviations();
      if (!Array.isArray(abbreviations) || abbreviations.some((entry) => typeof entry !== 'string')) throw new Error('Item Piles returned invalid abbreviations');
      if (typeof api.ITEM_QUANTITY_ATTRIBUTE !== 'string' || typeof api.ITEM_PRICE_ATTRIBUTE !== 'string') throw new Error('Item Piles item attribute paths are unavailable');
      return {
        currencies: runtime.json(api.CURRENCIES), secondaryCurrencies: runtime.json(api.SECONDARY_CURRENCIES),
        primaryCurrency: runtime.json(await api.getPrimaryCurrency(actor)), abbreviations: [...abbreviations],
        quantityAttribute: api.ITEM_QUANTITY_ATTRIBUTE, priceAttribute: api.ITEM_PRICE_ATTRIBUTE,
        decimalDigits: runtime.finite(api.CURRENCY_DECIMAL_DIGITS, 'Currency decimal setting'),
      };
    },
  },
  {
    id: 'calculate_currencies',
    description: 'Calculate structured registered primary currency amounts. Provide either other_currencies (subtract defaults to true) or a nonnegative multiplier. Secondary currencies are excluded because 3.3.4 combines them incorrectly; no dice or formulas are accepted.',
    readOnly: true, requiredMethods: ['calculateCurrencies'],
    inputSchema: {
      ...object({ currencies: currencyAmounts(nonnegative), other_currencies: currencyAmounts(nonnegative), multiplier: nonnegative, subtract: boolean }, ['currencies']),
      oneOf: [{ required: ['other_currencies'], not: { required: ['multiplier'] } }, { required: ['multiplier'], not: { required: ['other_currencies'] } }],
    },
    outputSchema: object({ currencies: text }),
    handler: async function (args, runtime) {
      const hasAmounts = Object.hasOwn(args, 'other_currencies');
      const hasMultiplier = Object.hasOwn(args, 'multiplier');
      if (hasAmounts === hasMultiplier) throw new Error('Provide exactly one of other_currencies or multiplier');
      const first = runtime.currencyString(args.currencies, { allowZero: true, allowSecondary: false });
      const second = hasAmounts ? runtime.currencyString(args.other_currencies, { allowZero: true, allowSecondary: false }) : runtime.finite(args.multiplier, 'Multiplier');
      if (hasMultiplier && (second < 0 || second > Number.MAX_SAFE_INTEGER)) throw new Error('Multiplier must be nonnegative and within the safe numeric range');
      const result = await runtime.api.calculateCurrencies(first, second, args.subtract ?? true);
      if (typeof result !== 'string') throw new Error('Item Piles returned an invalid currency calculation');
      return { currencies: result };
    },
  },
  {
    id: 'get_payment_data',
    description: 'Quote payment and change for structured primary currency amounts, optionally checking an Actor and quantity. Secondary currencies are excluded because the inspected parser can charge them twice. Quotes do not reserve funds.',
    readOnly: true, requiredMethods: ['getPaymentData'],
    inputSchema: object({ currencies: currencyAmounts(), actor_uuid: uuid, quantity }, ['currencies']),
    outputSchema: withJson(jsonObject),
    handler: async function (args, runtime) {
      const currencies = runtime.currencyString(args.currencies, { allowSecondary: false });
      const actor = args.actor_uuid ? await runtime.actor(args.actor_uuid) : false;
      const quantity = runtime.positive(args.quantity ?? 1);
      const result = await runtime.api.getPaymentData(currencies, { quantity, target: actor });
      if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('Item Piles returned invalid payment data');
      return runtime.json(result);
    },
  },
  {
    id: 'add_items',
    description: 'GM: add quantities from resolved Item UUIDs to an Actor. remove_existing_items explicitly replaces the existing inventory when true.',
    readOnly: false, requiredMethods: ['addItems', 'getItemQuantity'],
    inputSchema: object({ actor_uuid: uuid, items: itemRefs, remove_existing_items: boolean, ...logOptions }, ['actor_uuid', 'items']),
    outputSchema: itemDeltas,
    handler: async function (args, runtime) {
      runtime.requireGM();
      const actor = await runtime.actor(args.actor_uuid);
      const items = await runtime.itemsFromRefs(args.items);
      return runtime.write(async () => runtime.itemDeltas(await runtime.api.addItems(actor, items, {
        removeExistingActorItems: args.remove_existing_items ?? false,
        skipVaultLogging: args.skip_vault_logging ?? false, interactionId: args.interaction_id ?? false,
      })));
    },
  },
  {
    id: 'remove_items',
    description: 'GM: remove explicit positive quantities of exact embedded item IDs from an Actor, checking the available stock before invocation.',
    readOnly: false, requiredMethods: ['removeItems', 'getItemQuantity'],
    inputSchema: object({ actor_uuid: uuid, items: itemSelections, ...logOptions }, ['actor_uuid', 'items']),
    outputSchema: itemDeltas,
    handler: async function (args, runtime) {
      runtime.requireGM();
      const actor = await runtime.actor(args.actor_uuid);
      const items = runtime.itemSelections(actor, args.items);
      return runtime.write(async () => runtime.itemDeltas(await runtime.api.removeItems(actor, items, {
        skipVaultLogging: args.skip_vault_logging ?? false, interactionId: args.interaction_id ?? false,
      })));
    },
  },
  {
    id: 'transfer_items',
    description: 'GM: transfer explicit positive quantities of exact embedded item IDs between different Actors. Source stock is checked before the public API call.',
    readOnly: false, requiredMethods: ['transferItems', 'getItemQuantity'],
    inputSchema: object({ ...transfer, items: itemSelections, ...logOptions }, ['source_uuid', 'target_uuid', 'items']),
    outputSchema: itemDeltas,
    handler: async function (args, runtime) {
      runtime.requireGM();
      const source = await runtime.actor(args.source_uuid);
      const target = await runtime.actor(args.target_uuid);
      if (source.uuid === target.uuid) throw new Error('Source and target must be different Actors');
      const items = runtime.itemSelections(source, args.items);
      return runtime.write(async () => runtime.itemDeltas(await runtime.api.transferItems(source, target, items, {
        skipVaultLogging: args.skip_vault_logging ?? false, interactionId: args.interaction_id ?? false,
      })));
    },
  },
  {
    id: 'transfer_all_items',
    description: 'GM: transfer all eligible non-currency items between different Actors. Optional item_filters override configured exclusions.',
    readOnly: false, requiredMethods: ['transferAllItems', 'getItemQuantity'],
    inputSchema: object({ ...transfer, item_filters: itemFilters, ...logOptions }, ['source_uuid', 'target_uuid']),
    outputSchema: itemDeltas,
    handler: async function (args, runtime) {
      runtime.requireGM();
      const source = await runtime.actor(args.source_uuid);
      const target = await runtime.actor(args.target_uuid);
      if (source.uuid === target.uuid) throw new Error('Source and target must be different Actors');
      const filters = args.item_filters === undefined ? false : runtime.assertData(args.item_filters);
      return runtime.write(async () => runtime.itemDeltas(await runtime.api.transferAllItems(source, target, {
        itemFilters: filters, skipVaultLogging: args.skip_vault_logging ?? false, interactionId: args.interaction_id ?? false,
      })));
    },
  },
  {
    id: 'set_attributes',
    description: 'GM: set explicitly named safe system.* numeric attributes on an Actor, including zero. Returns upstream attribute deltas.',
    readOnly: false, requiredMethods: ['setAttributes'],
    inputSchema: object({ actor_uuid: uuid, attributes: attributes(number), interaction_id: interaction }, ['actor_uuid', 'attributes']),
    outputSchema: attributeDeltas,
    handler: async function (args, runtime) {
      runtime.requireGM();
      const actor = await runtime.actor(args.actor_uuid);
      const attributes = runtime.attributes(args.attributes);
      if (!Object.keys(attributes).length) throw new Error('Provide at least one attribute');
      return runtime.write(async () => runtime.attributes(await runtime.api.setAttributes(actor, attributes, {
        interactionId: args.interaction_id ?? false,
      }), { input: false }));
    },
  },
  {
    id: 'add_attributes',
    description: 'GM: add positive amounts to explicitly named safe system.* numeric attributes on an Actor.',
    readOnly: false, requiredMethods: ['addAttributes'],
    inputSchema: object({ actor_uuid: uuid, attributes: attributes(quantity), ...logOptions }, ['actor_uuid', 'attributes']),
    outputSchema: attributeDeltas,
    handler: async function (args, runtime) {
      runtime.requireGM();
      const actor = await runtime.actor(args.actor_uuid);
      const attributes = runtime.attributes(args.attributes);
      if (!Object.keys(attributes).length) throw new Error('Provide at least one attribute');
      for (const amount of Object.values(attributes)) runtime.positive(amount, 'Attribute amount');
      return runtime.write(async () => runtime.attributes(await runtime.api.addAttributes(actor, attributes, {
        skipVaultLogging: args.skip_vault_logging ?? false, interactionId: args.interaction_id ?? false,
      }), { input: false }));
    },
  },
  {
    id: 'remove_attributes',
    description: 'GM: remove positive amounts from safe system.* attributes, rejecting requests above the current numeric balance.',
    readOnly: false, requiredMethods: ['removeAttributes'],
    inputSchema: object({ actor_uuid: uuid, attributes: attributes(quantity), ...logOptions }, ['actor_uuid', 'attributes']),
    outputSchema: attributeDeltas,
    handler: async function (args, runtime) {
      runtime.requireGM();
      const actor = await runtime.actor(args.actor_uuid);
      const attributes = runtime.attributes(args.attributes);
      if (!Object.keys(attributes).length) throw new Error('Provide at least one attribute');
      for (const [path, amount] of Object.entries(attributes)) {
        runtime.positive(amount, 'Attribute amount');
        const available = path.split('.').reduce((value, part) => value?.[part], actor);
        if (amount > runtime.finite(available, `Available ${path}`)) throw new Error(`Requested amount exceeds the available ${path}`);
      }
      return runtime.write(async () => runtime.attributes(await runtime.api.removeAttributes(actor, attributes, {
        skipVaultLogging: args.skip_vault_logging ?? false, interactionId: args.interaction_id ?? false,
      }), { input: false }));
    },
  },
  {
    id: 'transfer_attributes',
    description: 'GM: transfer positive amounts of safe system.* attributes between different Actors, checking the source balance before invocation.',
    readOnly: false, requiredMethods: ['transferAttributes'],
    inputSchema: object({ ...transfer, attributes: attributes(quantity), ...logOptions }, ['source_uuid', 'target_uuid', 'attributes']),
    outputSchema: attributeDeltas,
    handler: async function (args, runtime) {
      runtime.requireGM();
      const source = await runtime.actor(args.source_uuid);
      const target = await runtime.actor(args.target_uuid);
      if (source.uuid === target.uuid) throw new Error('Source and target must be different Actors');
      const attributes = runtime.attributes(args.attributes);
      if (!Object.keys(attributes).length) throw new Error('Provide at least one attribute');
      for (const [path, amount] of Object.entries(attributes)) {
        runtime.positive(amount, 'Attribute amount');
        const available = path.split('.').reduce((value, part) => value?.[part], source);
        if (amount > runtime.finite(available, `Available ${path}`)) throw new Error(`Requested amount exceeds the available ${path}`);
      }
      return runtime.write(async () => runtime.attributes(await runtime.api.transferAttributes(source, target, attributes, {
        skipVaultLogging: args.skip_vault_logging ?? false, interactionId: args.interaction_id ?? false,
      }), { input: false }));
    },
  },
  {
    id: 'transfer_all_attributes',
    description: 'GM: transfer all positive configured attribute-currency balances present on both Actors. Uses public transferAttributes to avoid the 3.3.4 transferAllAttributes defect and emits its hooks.',
    readOnly: false, requiredMethods: ['getActorCurrencies', 'transferAttributes'],
    inputSchema: object({ ...transfer, ...logOptions }, ['source_uuid', 'target_uuid']),
    outputSchema: attributeDeltas,
    handler: async function (args, runtime) {
      runtime.requireGM();
      const source = await runtime.actor(args.source_uuid);
      const target = await runtime.actor(args.target_uuid);
      if (source.uuid === target.uuid) throw new Error('Source and target must be different Actors');
      const currencies = await runtime.api.getActorCurrencies(source, { getAll: false, secondary: true });
      if (!Array.isArray(currencies)) throw new Error('Item Piles returned invalid currencies');
      const attributes = {};
      for (const currency of currencies) {
        if (currency.type !== 'attribute') continue;
        const path = currency.data?.path ?? currency.path;
        // Paths come from trusted currency configuration, not caller input; custom
        // flags.* currencies remain supported after safe-path validation.
        const entry = runtime.attributes({ [path]: currency.quantity }, { input: false });
        const amount = entry[path];
        if (amount <= 0) continue;
        const targetValue = path.split('.').reduce((value, part) => value?.[part], target);
        if (targetValue === undefined) continue;
        runtime.finite(targetValue, `Target ${path}`);
        const sourceValue = path.split('.').reduce((value, part) => value?.[part], source);
        if (amount > runtime.finite(sourceValue, `Available ${path}`)) throw new Error(`Requested amount exceeds the available ${path}`);
        if (Object.hasOwn(attributes, path)) throw new Error(`Duplicate currency attribute ${path}`);
        attributes[path] = runtime.positive(amount, 'Attribute amount');
      }
      if (!Object.keys(attributes).length) return {};
      return runtime.write(async () => runtime.attributes(await runtime.api.transferAttributes(source, target, attributes, {
        skipVaultLogging: args.skip_vault_logging ?? false, interactionId: args.interaction_id ?? false,
      }), { input: false }));
    },
  },
  {
    id: 'update_currencies',
    description: 'GM: set registered attribute-currency totals, including explicit zero. Item-backed currencies are rejected because the inspected 3.3.4 setter does not honor their requested totals.',
    readOnly: false, requiredMethods: ['updateCurrencies', 'getItemQuantity'],
    inputSchema: object({ actor_uuid: uuid, currencies: currencyAmounts(nonnegative), interaction_id: interaction }, ['actor_uuid', 'currencies']),
    outputSchema: currencyDeltas,
    handler: async function (args, runtime) {
      runtime.requireGM();
      const actor = await runtime.actor(args.actor_uuid);
      const currencies = runtime.currencyString(args.currencies, { allowZero: true, allowItem: false });
      return runtime.write(async () => runtime.currencyDeltas(await runtime.api.updateCurrencies(actor, currencies, {
        interactionId: args.interaction_id ?? false,
      })));
    },
  },
  {
    id: 'add_currencies',
    description: 'GM: add positive amounts of registered currencies to an Actor using structured denominations; formulas and dice are not accepted.',
    readOnly: false, requiredMethods: ['addCurrencies', 'getItemQuantity'],
    inputSchema: object({ actor_uuid: uuid, currencies: currencyAmounts(), interaction_id: interaction }, ['actor_uuid', 'currencies']),
    outputSchema: currencyDeltas,
    handler: async function (args, runtime) {
      runtime.requireGM();
      const actor = await runtime.actor(args.actor_uuid);
      const currencies = runtime.currencyString(args.currencies);
      return runtime.write(async () => runtime.currencyDeltas(await runtime.api.addCurrencies(actor, currencies, {
        interactionId: args.interaction_id ?? false,
      })));
    },
  },
  {
    id: 'remove_currencies',
    description: 'GM: remove positive registered primary currency amounts using the public API affordability check. Secondary currencies are excluded because the inspected parser can charge them twice. change=false affects preflight only.',
    readOnly: false, requiredMethods: ['removeCurrencies', 'getItemQuantity'],
    inputSchema: object({ actor_uuid: uuid, currencies: currencyAmounts(), change: boolean, interaction_id: interaction }, ['actor_uuid', 'currencies']),
    outputSchema: currencyDeltas,
    handler: async function (args, runtime) {
      runtime.requireGM();
      const actor = await runtime.actor(args.actor_uuid);
      const currencies = runtime.currencyString(args.currencies, { allowSecondary: false });
      return runtime.write(async () => runtime.currencyDeltas(await runtime.api.removeCurrencies(actor, currencies, {
        change: args.change ?? true, interactionId: args.interaction_id ?? false,
      })));
    },
  },
  {
    id: 'transfer_currencies',
    description: 'GM: transfer positive primary currency amounts between different Actors with affordability preflight. Secondary currencies are unsupported by this 3.3.4 transfer method; change=false affects preflight only.',
    readOnly: false, requiredMethods: ['transferCurrencies', 'getItemQuantity'],
    inputSchema: object({ ...transfer, currencies: currencyAmounts(), change: boolean, interaction_id: interaction }, ['source_uuid', 'target_uuid', 'currencies']),
    outputSchema: currencyDeltas,
    handler: async function (args, runtime) {
      runtime.requireGM();
      const source = await runtime.actor(args.source_uuid);
      const target = await runtime.actor(args.target_uuid);
      if (source.uuid === target.uuid) throw new Error('Source and target must be different Actors');
      const currencies = runtime.currencyString(args.currencies, { allowSecondary: false });
      return runtime.write(async () => runtime.currencyDeltas(await runtime.api.transferCurrencies(source, target, currencies, {
        change: args.change ?? true, interactionId: args.interaction_id ?? false,
      })));
    },
  },
  {
    id: 'transfer_all_currencies',
    description: 'GM: transfer all configured item and attribute currencies between different Actors through the public API, including secondary currencies.',
    readOnly: false, requiredMethods: ['transferAllCurrencies', 'getItemQuantity'],
    inputSchema: object({ ...transfer, interaction_id: interaction }, ['source_uuid', 'target_uuid']),
    outputSchema: currencyDeltas,
    handler: async function (args, runtime) {
      runtime.requireGM();
      const source = await runtime.actor(args.source_uuid);
      const target = await runtime.actor(args.target_uuid);
      if (source.uuid === target.uuid) throw new Error('Source and target must be different Actors');
      return runtime.write(async () => runtime.currencyDeltas(await runtime.api.transferAllCurrencies(source, target, {
        interactionId: args.interaction_id ?? false,
      })));
    },
  },
  {
    id: 'transfer_everything',
    description: 'GM: transfer all eligible items and configured currencies between different Actors. The upstream transaction is not atomic and may delete an emptied source pile token.',
    readOnly: false, requiredMethods: ['transferEverything', 'getItemQuantity'],
    inputSchema: object({ ...transfer, item_filters: itemFilters, interaction_id: interaction }, ['source_uuid', 'target_uuid']),
    outputSchema: allDeltas,
    handler: async function (args, runtime) {
      runtime.requireGM();
      const source = await runtime.actor(args.source_uuid);
      const target = await runtime.actor(args.target_uuid);
      if (source.uuid === target.uuid) throw new Error('Source and target must be different Actors');
      const filters = args.item_filters === undefined ? false : runtime.assertData(args.item_filters);
      return runtime.write(async () => {
        const result = await runtime.api.transferEverything(source, target, { itemFilters: filters, interactionId: args.interaction_id ?? false });
        return { itemsTransferred: runtime.itemDeltas(result.itemsTransferred), attributesTransferred: runtime.attributes(result.attributesTransferred, { input: false }) };
      });
    },
  },
  {
    id: 'combine_piles',
    description: 'GM: combine distinct source item piles into a target Actor using configured item exclusions. Verifies no positive eligible source stock remains, then returns deltas and deleted token IDs. Upstream commits are not atomic; an uncertain result requires inspection.',
    readOnly: false, requiredMethods: ['combineItemPiles', 'isValidItemPile', 'getItemQuantity', 'getActorItems', 'getActorCurrencies'],
    inputSchema: object({ target_uuid: uuid, source_uuids: { ...inputArray(uuid), uniqueItems: true }, interaction_id: interaction }, ['target_uuid', 'source_uuids']),
    outputSchema: object({ ...allDeltas.properties, deletedTokens: { type: 'object', additionalProperties: array(text) } }),
    handler: async function (args, runtime) {
      runtime.requireGM();
      const target = await runtime.actor(args.target_uuid);
      if (!Array.isArray(args.source_uuids) || args.source_uuids.length === 0 || args.source_uuids.length > 100) throw new Error('Provide 1 to 100 source UUIDs');
      const sources = [];
      const seen = new Set();
      for (const uuid of args.source_uuids) {
        const source = await runtime.actor(uuid);
        if (source.uuid === target.uuid) throw new Error('Source and target must be different Actors');
        if (seen.has(source.uuid)) throw new Error('Duplicate source Actors are not allowed');
        seen.add(source.uuid);
        if (!await runtime.api.isValidItemPile(source)) throw new Error('Every source must be a valid Item Piles pile');
        sources.push(source);
      }
      return runtime.write(async () => {
        const result = await runtime.api.combineItemPiles(target, sources, { interactionId: args.interaction_id ?? false });
        const deleted = result.deletedTokens;
        if (!deleted || typeof deleted !== 'object' || Array.isArray(deleted)
          || Object.values(deleted).some((ids) => !Array.isArray(ids) || ids.some((id) => typeof id !== 'string'))) {
          throw new Error('Item Piles returned invalid deleted token IDs');
        }
        const normalized = { itemsTransferred: runtime.itemDeltas(result.itemsTransferred),
          attributesTransferred: runtime.attributes(result.attributesTransferred, { input: false }), deletedTokens: runtime.json(deleted) };
        // 3.3.4 ignores rejected source commits in Promise.allSettled. Read the
        // original Actor documents after the awaited call, including synthetic
        // Actors whose emptied pile token may have been deleted. A stale view is
        // conservatively uncertain rather than evidence that every source moved.
        for (const source of sources) {
          const items = await runtime.api.getActorItems(source);
          const currencies = await runtime.api.getActorCurrencies(source, { getAll: false, secondary: true });
          if (!Array.isArray(items) || !Array.isArray(currencies)) throw new Error('Source inventory could not be verified after combining piles');
          if (items.some((item) => runtime.finite(runtime.api.getItemQuantity(item), 'Remaining item quantity') > 0)
            || currencies.some((currency) => runtime.finite(currency.quantity, 'Remaining currency quantity') > 0)) {
            throw new Error(`Source ${source.uuid} still has positive eligible items or currencies after combining piles`);
          }
        }
        return normalized;
      });
    },
  },
];
