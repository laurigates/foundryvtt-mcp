/** Pile lifecycle, explicit container state, and read-only vault planning (public 3.3.4 API). */
const uuid = { type: 'string', minLength: 1, pattern: '^\\S+$' };
const boolean = { type: 'boolean' };
const string = { type: 'string' };
const number = { type: 'number' };
const nonnegative = { type: 'number', minimum: 0 };
const count = { type: 'integer', minimum: 0 };
const object = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
const strings = { type: 'array', items: string };
const tokenIds = { type: 'array', items: uuid, minItems: 1, maxItems: 100, uniqueItems: true };
const clock = object({ hour: { type: 'integer', minimum: 0, maximum: 23 }, minute: { type: 'integer', minimum: 0, maximum: 59 } }, []);
const access = object({ uuid, view: boolean, organize: boolean,
  items: object({ withdraw: boolean, deposit: boolean }), currencies: object({ withdraw: boolean, deposit: boolean }),
}, ['uuid', 'organize', 'items', 'currencies']);
const settingsProperties = {
  ...Object.fromEntries(('enabled canInspectItems displayItemTypes displayOne showItemName overrideSingleItemScale shareItemsEnabled shareCurrenciesEnabled takeAllEnabled splitAllEnabled activePlayers closed locked infiniteQuantity infiniteCurrencies purchaseOnly hideNewItems hideItemsWithZeroCost keepZeroQuantity onlyAcceptBasePrice hideTokenWhenClosed refreshItemsOnOpen logMerchantActivity restrictVaultAccess vaultExpansion logVaultActions').split(' ').map((key) => [key, boolean])),
  ...Object.fromEntries(('closedImage emptyImage openedImage lockedImage closeSound openSound lockedSound unlockedSound merchantImage').split(' ').map((key) => [key, string])),
  ...Object.fromEntries(('closedImages emptyImages openedImages lockedImages closeSounds openSounds lockedSounds unlockedSounds closedDays closedHolidays refreshItemsDays refreshItemsHolidays').split(' ').map((key) => [key, strings])),
  type: { type: 'string', enum: ['pile', 'container', 'merchant', 'vault'] }, distance: nonnegative,
  deleteWhenEmpty: { anyOf: [boolean, { type: 'string', enum: ['default', 'true', 'false'] }] },
  canStackItems: { type: 'string', enum: ['yes', 'no', 'alwaysyes', 'alwaysno'] },
  singleItemScale: { type: 'number', exclusiveMinimum: 0 }, displayQuantity: { type: 'string', enum: ['yes', 'no'] },
  buyPriceModifier: nonnegative, sellPriceModifier: nonnegative,
  openTimes: object({ enabled: boolean, status: { type: 'string', enum: ['auto', 'open', 'closed'] }, open: clock, close: clock }, []),
  cols: { type: 'integer', minimum: 1, maximum: 100 }, rows: { type: 'integer', minimum: 1, maximum: 100 },
  baseExpansionCols: { type: 'integer', minimum: 0, maximum: 100 }, baseExpansionRows: { type: 'integer', minimum: 0, maximum: 100 },
  vaultAccess: { type: 'array', items: access }, vaultLogType: { type: 'string', enum: ['user_actor', 'user', 'actor'] },
};
const settings = object(settingsProperties, []);
// Existing worlds may contain custom pile types, older flag values, or larger
// dimensions. Reading those values must not apply the limits used for new edits.
const observedSettings = object({ ...settingsProperties,
  ...Object.fromEntries('type canStackItems displayQuantity vaultLogType'.split(' ').map((key) => [key, string])),
  ...Object.fromEntries('distance singleItemScale buyPriceModifier sellPriceModifier cols rows baseExpansionCols baseExpansionRows'.split(' ').map((key) => [key, number])),
  deleteWhenEmpty: { anyOf: [string, boolean] },
}, []);
const tokenSettings = object({ name: string, texture: object({ src: string, scaleX: number, scaleY: number }, []),
  width: { type: 'number', exclusiveMinimum: 0 }, height: { type: 'number', exclusiveMinimum: 0 },
  elevation: number, rotation: number, alpha: { type: 'number', minimum: 0, maximum: 1 }, hidden: boolean,
  disposition: { type: 'integer', enum: [-1, 0, 1] },
}, []);
const summary = object({ id: string, uuid: string, name: string, type: string, quantity: number });
const position = object({ x: count, y: count, flipped: boolean });
const nullablePosition = { anyOf: [{ type: 'null' }, position] };
const placement = object({ x: { type: ['number', 'null'] }, y: { type: ['number', 'null'] }, width: number, height: number, flipped: boolean });
const jsonValue = { anyOf: [{ type: 'null' }, boolean, number, string,
  { type: 'array', items: { $ref: '#/$defs/JsonValue' } }, { type: 'object', additionalProperties: { $ref: '#/$defs/JsonValue' } }] };

export const operations = [
  {
    id: 'get_pile',
    description: 'Read the public pile state and allowlisted container, merchant, sharing, and vault settings for an Actor or Token UUID. Macros and arbitrary extension flags are omitted; vaultAccess is configured access, not a player authorization decision.',
    readOnly: true,
    requiredMethods: ['getActorFlagData', 'isValidItemPile', 'isRegularItemPile', 'isItemPileContainer', 'isItemPileLootable', 'isItemPileMerchant', 'isItemPileVault', 'isItemPileEmpty', 'isItemPileClosed', 'isItemPileLocked'],
    inputSchema: object({ actor_uuid: uuid }),
    outputSchema: object({ actor_uuid: uuid, name: string, states: object(Object.fromEntries('enabled regular container lootable merchant vault empty closed locked'.split(' ').map((key) => [key, boolean]))), settings: observedSettings }),
    handler: async function (args, runtime) {
      const actor = await runtime.actor(args.actor_uuid);
      const flags = await runtime.api.getActorFlagData(actor);
      if (!flags || typeof flags !== 'object' || Array.isArray(flags)) throw new Error('Item Piles returned invalid pile settings');
      const settings = {};
      for (const key of 'enabled canInspectItems displayItemTypes displayOne showItemName overrideSingleItemScale shareItemsEnabled shareCurrenciesEnabled takeAllEnabled splitAllEnabled activePlayers closed locked infiniteQuantity infiniteCurrencies purchaseOnly hideNewItems hideItemsWithZeroCost keepZeroQuantity onlyAcceptBasePrice hideTokenWhenClosed refreshItemsOnOpen logMerchantActivity restrictVaultAccess vaultExpansion logVaultActions'.split(' ')) {
        if (typeof flags[key] === 'boolean') settings[key] = flags[key];
      }
      for (const key of 'type deleteWhenEmpty canStackItems displayQuantity vaultLogType closedImage emptyImage openedImage lockedImage closeSound openSound lockedSound unlockedSound merchantImage'.split(' ')) {
        if (typeof flags[key] === 'string' || (key === 'deleteWhenEmpty' && typeof flags[key] === 'boolean')) settings[key] = flags[key];
      }
      for (const key of 'distance singleItemScale buyPriceModifier sellPriceModifier cols rows baseExpansionCols baseExpansionRows'.split(' ')) {
        if (Number.isFinite(flags[key])) settings[key] = flags[key];
      }
      for (const key of 'closedImages emptyImages openedImages lockedImages closeSounds openSounds lockedSounds unlockedSounds closedDays closedHolidays refreshItemsDays refreshItemsHolidays'.split(' ')) {
        if (Array.isArray(flags[key])) settings[key] = flags[key].filter((value) => typeof value === 'string');
      }
      if (flags.openTimes && typeof flags.openTimes === 'object') {
        const value = flags.openTimes;
        settings.openTimes = {};
        if (typeof value.enabled === 'boolean') settings.openTimes.enabled = value.enabled;
        if (['auto', 'open', 'closed'].includes(value.status)) settings.openTimes.status = value.status;
        for (const part of ['open', 'close']) {
          if (!value[part] || typeof value[part] !== 'object') continue;
          settings.openTimes[part] = {};
          for (const [key, max] of [['hour', 23], ['minute', 59]]) {
            if (Number.isInteger(value[part][key]) && value[part][key] >= 0 && value[part][key] <= max) settings.openTimes[part][key] = value[part][key];
          }
        }
      }
      if (Array.isArray(flags.vaultAccess)) {
        settings.vaultAccess = flags.vaultAccess.filter((entry) => entry && typeof entry.uuid === 'string' && entry.uuid && !/\s/.test(entry.uuid)).map((entry) => ({
          uuid: entry.uuid, view: entry.view == null ? true : Boolean(entry.view), organize: entry.organize === true,
          items: { withdraw: entry.items?.withdraw === true, deposit: entry.items?.deposit === true },
          currencies: { withdraw: entry.currencies?.withdraw === true, deposit: entry.currencies?.deposit === true },
        }));
      }
      return { actor_uuid: actor.uuid, name: typeof actor.name === 'string' ? actor.name : '', settings: runtime.json(settings), states: {
        enabled: Boolean(await runtime.api.isValidItemPile(actor)), regular: Boolean(await runtime.api.isRegularItemPile(actor)),
        container: Boolean(await runtime.api.isItemPileContainer(actor)), lootable: Boolean(await runtime.api.isItemPileLootable(actor)),
        merchant: Boolean(await runtime.api.isItemPileMerchant(actor)), vault: Boolean(await runtime.api.isItemPileVault(actor)),
        empty: Boolean(await runtime.api.isItemPileEmpty(actor)), closed: Boolean(await runtime.api.isItemPileClosed(actor)), locked: Boolean(await runtime.api.isItemPileLocked(actor)),
      } };
    },
  },
  {
    id: 'create_pile',
    description: 'GM: create an empty pile Actor, optionally placing a token at an explicit Scene position. scene_uuid is always required. An existing actor_uuid requires position; omit actor_uuid to create a new Actor. Add inventory separately with add_items using the returned actor_uuid (the token Actor for an unlinked token); base_actor_uuid identifies its base Actor. Actor-only creation uses a linked prototype.',
    readOnly: false, requiredMethods: ['createItemPile', 'getActorFlagData'],
    inputSchema: object({ scene_uuid: uuid, actor_uuid: uuid, name: { type: 'string', minLength: 1, maxLength: 200 },
      position: object({ x: number, y: number }), settings, token_settings: tokenSettings,
      actor_settings: object({ name: string, img: string }, []), folders: { type: 'array', minItems: 1, maxItems: 20, items: { type: 'string', minLength: 1 } },
    }, ['scene_uuid']),
    outputSchema: object({ actor_uuid: uuid, base_actor_uuid: uuid, token_uuid: { type: ['string', 'null'] }, scene_uuid: uuid, created_actor: boolean }),
    handler: async function (args, runtime) {
      runtime.requireGM();
      runtime.assertData(args);
      const config = (value, keys, label) => {
        value ??= {};
        if (typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
        for (const key of Object.keys(value)) if (!keys.includes(key)) throw new Error(`Unsupported ${label}: ${key}`);
        return JSON.parse(JSON.stringify(value));
      };
      for (const key of Object.keys(args)) if (!['scene_uuid', 'actor_uuid', 'name', 'position', 'settings', 'token_settings', 'actor_settings', 'folders'].includes(key)) throw new Error(`Unsupported create setting: ${key}`);
      const settings = config(args.settings, 'enabled type distance deleteWhenEmpty canStackItems canInspectItems displayItemTypes displayOne showItemName overrideSingleItemScale singleItemScale shareItemsEnabled shareCurrenciesEnabled takeAllEnabled splitAllEnabled activePlayers closed locked closedImage closedImages emptyImage emptyImages openedImage openedImages lockedImage lockedImages closeSound closeSounds openSound openSounds lockedSound lockedSounds unlockedSound unlockedSounds merchantImage infiniteQuantity infiniteCurrencies purchaseOnly hideNewItems hideItemsWithZeroCost keepZeroQuantity onlyAcceptBasePrice displayQuantity buyPriceModifier sellPriceModifier hideTokenWhenClosed openTimes closedDays closedHolidays refreshItemsOnOpen refreshItemsDays refreshItemsHolidays logMerchantActivity cols rows restrictVaultAccess vaultExpansion baseExpansionCols baseExpansionRows vaultAccess logVaultActions vaultLogType'.split(' '), 'pile setting');
      if (settings.enabled === false) throw new Error('A newly created pile must be enabled');
      const tokenSettings = config(args.token_settings, 'name texture width height elevation rotation alpha hidden disposition'.split(' '), 'token setting');
      if (tokenSettings.texture) config(tokenSettings.texture, ['src', 'scaleX', 'scaleY'], 'token texture setting');
      const actorSettings = config(args.actor_settings, ['name', 'img'], 'actor setting');
      const scene = await runtime.document(args.scene_uuid, 'Scene');
      if (typeof scene.id !== 'string' || !scene.id) throw new Error('The Scene has no usable document ID');
      const existing = args.actor_uuid ? await runtime.document(args.actor_uuid, 'Actor') : null;
      if (existing && !args.position) throw new Error('Creating from an existing Actor requires an explicit position');
      if (existing && (args.name || args.folders)) throw new Error('name and folders apply only when creating a new Actor');
      if (existing?.prototypeToken?.actorLink && Object.keys(actorSettings).length) throw new Error('Actor overrides are not applied to an existing linked Actor');
      const position = args.position ? { x: runtime.finite(args.position.x, 'Position x'), y: runtime.finite(args.position.y, 'Position y') } : false;
      const options = { sceneId: scene.id, position, createActor: !existing,
        actor: existing?.uuid ?? args.name ?? 'New Item Pile', itemPileFlags: settings,
        tokenOverrides: { ...tokenSettings, ...(!position ? { actorLink: true } : {}) }, actorOverrides: actorSettings,
        folders: args.folders ?? false };
      return runtime.write(async () => {
        const result = await runtime.api.createItemPile(options);
        if (!result || typeof result.actorUuid !== 'string' || (position && typeof result.tokenUuid !== 'string')) runtime.unknown('Creation did not return the required Actor and Token UUIDs');
        const created = await runtime.document(result.actorUuid, 'Actor');
        if (existing && created.uuid !== existing.uuid) runtime.unknown('Creation returned a different Actor');
        const token = position ? await runtime.token(result.tokenUuid) : null;
        if (token && token.parent?.uuid !== scene.uuid) runtime.unknown('The created Token belongs to a different Scene');
        const effectiveActor = token ? await runtime.actor(token.uuid) : created;
        if (typeof effectiveActor.uuid !== 'string' || !effectiveActor.uuid || /\s/.test(effectiveActor.uuid)) runtime.unknown('The created pile has no usable inventory Actor UUID');
        const observed = await runtime.api.getActorFlagData(token ?? created);
        const matches = (actual, wanted) => wanted && typeof wanted === 'object'
          ? actual && typeof actual === 'object' && (!Array.isArray(wanted) || (Array.isArray(actual) && actual.length === wanted.length)) && Object.keys(wanted).every((key) => matches(actual[key], wanted[key]))
          : actual === wanted;
        if (!observed || observed.enabled !== true || !matches(observed, settings)) runtime.unknown('The created pile settings could not be verified');
        return { actor_uuid: effectiveActor.uuid, base_actor_uuid: created.uuid, token_uuid: token?.uuid ?? null, scene_uuid: scene.uuid, created_actor: !existing };
      });
    },
  },
  {
    id: 'convert_tokens',
    description: 'GM: convert explicit Token UUIDs into enabled Item Piles with allowlisted settings. Linked tokens also update their shared Actor. Token appearance overrides may be adjusted by Item Piles display rules.',
    readOnly: false, requiredMethods: ['turnTokensIntoItemPiles', 'getActorFlagData'],
    inputSchema: object({ token_uuids: tokenIds, settings, token_settings: tokenSettings }, ['token_uuids']),
    outputSchema: object({ token_uuids: tokenIds, enabled: { const: true } }),
    handler: async function (args, runtime) {
      runtime.requireGM();
      runtime.assertData(args);
      const config = (value, keys, label) => {
        value ??= {};
        if (typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
        for (const key of Object.keys(value)) if (!keys.includes(key)) throw new Error(`Unsupported ${label}: ${key}`);
        return JSON.parse(JSON.stringify(value));
      };
      const settings = config(args.settings, 'enabled type distance deleteWhenEmpty canStackItems canInspectItems displayItemTypes displayOne showItemName overrideSingleItemScale singleItemScale shareItemsEnabled shareCurrenciesEnabled takeAllEnabled splitAllEnabled activePlayers closed locked closedImage closedImages emptyImage emptyImages openedImage openedImages lockedImage lockedImages closeSound closeSounds openSound openSounds lockedSound lockedSounds unlockedSound unlockedSounds merchantImage infiniteQuantity infiniteCurrencies purchaseOnly hideNewItems hideItemsWithZeroCost keepZeroQuantity onlyAcceptBasePrice displayQuantity buyPriceModifier sellPriceModifier hideTokenWhenClosed openTimes closedDays closedHolidays refreshItemsOnOpen refreshItemsDays refreshItemsHolidays logMerchantActivity cols rows restrictVaultAccess vaultExpansion baseExpansionCols baseExpansionRows vaultAccess logVaultActions vaultLogType'.split(' '), 'pile setting');
      if (settings.enabled === false) throw new Error('Converted piles must be enabled');
      const tokenSettings = config(args.token_settings, 'name texture width height elevation rotation alpha hidden disposition'.split(' '), 'token setting');
      if (tokenSettings.texture) config(tokenSettings.texture, ['src', 'scaleX', 'scaleY'], 'token texture setting');
      if (!Array.isArray(args.token_uuids) || !args.token_uuids.length || args.token_uuids.length > 100) throw new Error('Provide 1 to 100 unique Token UUIDs');
      const tokens = [];
      for (const uuid of args.token_uuids) {
        const token = await runtime.token(uuid);
        if (tokens.some((value) => value.uuid === token.uuid)) throw new Error('Token UUIDs must be unique');
        if (!token.actor) throw new Error('Each Token must have an Actor');
        tokens.push(token);
      }
      return runtime.write(async () => {
        const result = await runtime.api.turnTokensIntoItemPiles(tokens, { pileSettings: JSON.parse(JSON.stringify(settings)), tokenSettings });
        if (!Array.isArray(result) || result.length !== tokens.length || tokens.some((token) => !result.includes(token.uuid))) runtime.unknown('Conversion did not confirm every requested Token');
        const matches = (actual, wanted) => wanted && typeof wanted === 'object'
          ? actual && typeof actual === 'object' && (!Array.isArray(wanted) || (Array.isArray(actual) && actual.length === wanted.length)) && Object.keys(wanted).every((key) => matches(actual[key], wanted[key]))
          : actual === wanted;
        for (const token of tokens) {
          const observed = await runtime.api.getActorFlagData(await runtime.token(token.uuid));
          if (!observed || observed.enabled !== true || !matches(observed, settings)) runtime.unknown('Converted pile settings could not be verified');
        }
        return { token_uuids: tokens.map((token) => token.uuid), enabled: true };
      });
    },
  },
  {
    id: 'revert_tokens',
    description: 'GM: disable Item Piles on explicit Token UUIDs and verify the resulting state. Linked tokens also disable the shared Actor; documents and inventory are retained.',
    readOnly: false, requiredMethods: ['revertTokensFromItemPiles', 'getActorFlagData'],
    inputSchema: object({ token_uuids: tokenIds, token_settings: tokenSettings }, ['token_uuids']),
    outputSchema: object({ token_uuids: tokenIds, enabled: { const: false } }),
    handler: async function (args, runtime) {
      runtime.requireGM();
      runtime.assertData(args);
      const tokenSettings = args.token_settings ?? {};
      if (!tokenSettings || typeof tokenSettings !== 'object' || Array.isArray(tokenSettings)) throw new Error('Token settings must be an object');
      for (const key of Object.keys(tokenSettings)) if (!'name texture width height elevation rotation alpha hidden disposition'.split(' ').includes(key)) throw new Error(`Unsupported token setting: ${key}`);
      if (tokenSettings.texture) for (const key of Object.keys(tokenSettings.texture)) if (!['src', 'scaleX', 'scaleY'].includes(key)) throw new Error(`Unsupported token texture setting: ${key}`);
      if (!Array.isArray(args.token_uuids) || !args.token_uuids.length || args.token_uuids.length > 100) throw new Error('Provide 1 to 100 unique Token UUIDs');
      const tokens = [];
      for (const uuid of args.token_uuids) {
        const token = await runtime.token(uuid);
        if (tokens.some((value) => value.uuid === token.uuid)) throw new Error('Token UUIDs must be unique');
        if (!token.actor) throw new Error('Each Token must have an Actor');
        tokens.push(token);
      }
      return runtime.write(async () => {
        const result = await runtime.api.revertTokensFromItemPiles(tokens, { tokenSettings: JSON.parse(JSON.stringify(tokenSettings)) });
        if (!Array.isArray(result) || result.length !== tokens.length || tokens.some((token) => !result.includes(token.uuid))) runtime.unknown('Reversion did not confirm every requested Token');
        for (const token of tokens) {
          const observed = await runtime.api.getActorFlagData(await runtime.token(token.uuid));
          if (!observed || observed.enabled !== false) runtime.unknown('Disabled pile state could not be verified');
        }
        return { token_uuids: tokens.map((token) => token.uuid), enabled: false };
      });
    },
  },
  {
    id: 'update_pile',
    description: 'GM: update allowlisted pile settings and verify requested values after the public API returns. actor_uuid accepts Actor or Token UUIDs; token_settings requires a Token UUID. Updates can affect all active tokens sharing the Actor.',
    readOnly: false, requiredMethods: ['updateItemPile', 'getActorFlagData'],
    inputSchema: object({ actor_uuid: uuid, settings: { ...settings, minProperties: 1 }, token_settings: tokenSettings }, ['actor_uuid', 'settings']),
    outputSchema: object({ actor_uuid: uuid, token_uuid: { type: ['string', 'null'] }, updated_settings: settings }),
    handler: async function (args, runtime) {
      runtime.requireGM();
      runtime.assertData(args);
      const config = (value, keys, label) => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
        for (const key of Object.keys(value)) if (!keys.includes(key)) throw new Error(`Unsupported ${label}: ${key}`);
        return JSON.parse(JSON.stringify(value));
      };
      const settings = config(args.settings, 'enabled type distance deleteWhenEmpty canStackItems canInspectItems displayItemTypes displayOne showItemName overrideSingleItemScale singleItemScale shareItemsEnabled shareCurrenciesEnabled takeAllEnabled splitAllEnabled activePlayers closed locked closedImage closedImages emptyImage emptyImages openedImage openedImages lockedImage lockedImages closeSound closeSounds openSound openSounds lockedSound lockedSounds unlockedSound unlockedSounds merchantImage infiniteQuantity infiniteCurrencies purchaseOnly hideNewItems hideItemsWithZeroCost keepZeroQuantity onlyAcceptBasePrice displayQuantity buyPriceModifier sellPriceModifier hideTokenWhenClosed openTimes closedDays closedHolidays refreshItemsOnOpen refreshItemsDays refreshItemsHolidays logMerchantActivity cols rows restrictVaultAccess vaultExpansion baseExpansionCols baseExpansionRows vaultAccess logVaultActions vaultLogType'.split(' '), 'pile setting');
      if (!Object.keys(settings).length) throw new Error('At least one pile setting is required');
      const tokenSettings = args.token_settings ? config(args.token_settings, 'name texture width height elevation rotation alpha hidden disposition'.split(' '), 'token setting') : false;
      if (tokenSettings?.texture) config(tokenSettings.texture, ['src', 'scaleX', 'scaleY'], 'token texture setting');
      const actor = await runtime.actor(args.actor_uuid);
      const token = tokenSettings ? await runtime.token(args.actor_uuid) : null;
      return runtime.write(async () => {
        const result = await runtime.api.updateItemPile(actor, JSON.parse(JSON.stringify(settings)), { tokenSettings: tokenSettings ? JSON.parse(JSON.stringify(tokenSettings)) : false });
        if (result === false || result === null) runtime.unknown('The update did not return a confirmation');
        const matches = (actual, wanted) => wanted && typeof wanted === 'object'
          ? actual && typeof actual === 'object' && (!Array.isArray(wanted) || (Array.isArray(actual) && actual.length === wanted.length)) && Object.keys(wanted).every((key) => matches(actual[key], wanted[key]))
          : actual === wanted;
        const observed = await runtime.api.getActorFlagData(await runtime.actor(args.actor_uuid));
        if (!matches(observed, settings)) runtime.unknown('The requested pile settings could not be verified');
        if (token) {
          const current = await runtime.token(token.uuid);
          if (!matches(current.toObject(), tokenSettings)) runtime.unknown('The requested Token settings could not be verified');
        }
        return { actor_uuid: actor.uuid, token_uuid: token?.uuid ?? null, updated_settings: settings };
      });
    },
  },
  {
    id: 'delete_pile',
    description: 'GM: delete one Item Piles Token and confirm its removal from its parent Scene. Actor-only piles are not deleted by this operation.',
    readOnly: false, requiredMethods: ['deleteItemPile', 'isValidItemPile'],
    inputSchema: object({ token_uuid: uuid }), outputSchema: object({ token_uuid: uuid, deleted: { const: true } }),
    handler: async function (args, runtime) {
      runtime.requireGM();
      const token = await runtime.token(args.token_uuid);
      if (!runtime.api.isValidItemPile(token)) throw new Error('The Token must be an enabled Item Pile');
      const scene = token.parent;
      if (scene?.documentName !== 'Scene' || typeof scene.tokens?.get !== 'function' || !scene.tokens.get(token.id)) throw new Error('The Token must belong to an available Scene collection');
      return runtime.write(async () => {
        const result = await runtime.api.deleteItemPile(token);
        if (result === false || result === null) runtime.unknown('Deletion did not return a confirmation');
        const observed = await runtime.document(scene.uuid, 'Scene');
        if (typeof observed.tokens?.get !== 'function' || observed.tokens.get(token.id)) runtime.unknown('The deleted Token is still present or its Scene cannot be inspected');
        return { token_uuid: token.uuid, deleted: true };
      });
    },
  },
  {
    id: 'split_pile',
    description: 'GM: split a lootable pile among explicit distinct recipient Actors. Requires shareCurrenciesEnabled or splitAllEnabled because upstream 3.3.4 otherwise can remove currencies without crediting recipients, including currencies inside Items. Item sharing still follows shareItemsEnabled. Source and recipient changes are sequential upstream; empty piles may be deleted. Uncertain results are never retried.',
    readOnly: false, requiredMethods: ['splitItemPileContents', 'isItemPileLootable', 'getActorFlagData'],
    inputSchema: object({ actor_uuid: uuid, recipient_uuids: tokenIds, instigator_uuid: uuid }, ['actor_uuid', 'recipient_uuids']),
    outputSchema: { ...object({ actor_uuid: uuid, recipient_uuids: tokenIds,
      pile_deltas: { type: 'object', additionalProperties: { $ref: '#/$defs/JsonValue' } },
      actor_deltas: { type: 'object', additionalProperties: { type: 'object', additionalProperties: { $ref: '#/$defs/JsonValue' } } },
    }), $defs: { JsonValue: jsonValue } },
    handler: async function (args, runtime) {
      runtime.requireGM();
      const actor = await runtime.actor(args.actor_uuid);
      if (!runtime.api.isItemPileLootable(actor)) throw new Error('The source must be a lootable Item Pile');
      if (!Array.isArray(args.recipient_uuids) || !args.recipient_uuids.length || args.recipient_uuids.length > 100) throw new Error('Provide 1 to 100 explicit recipient UUIDs');
      const recipients = [];
      for (const uuid of args.recipient_uuids) {
        const recipient = await runtime.actor(uuid);
        if (recipient.uuid === actor.uuid || recipients.some((value) => value.uuid === recipient.uuid)) throw new Error('Recipient Actors must be distinct and cannot be the source pile');
        recipients.push(recipient);
      }
      const instigator = args.instigator_uuid ? await runtime.actor(args.instigator_uuid) : false;
      const settings = await runtime.api.getActorFlagData(actor);
      // The upstream source always removes currencies, including embedded Item
      // attributes that the public getActorCurrencies API cannot inspect.
      if (settings?.shareCurrenciesEnabled !== true && settings?.splitAllEnabled !== true) {
        throw new Error('Enable shareCurrenciesEnabled or splitAllEnabled before splitting; upstream 3.3.4 otherwise may remove currencies without crediting recipients');
      }
      return runtime.write(async () => {
        const result = await runtime.api.splitItemPileContents(actor, { targets: recipients, instigator });
        const record = (value) => value && typeof value === 'object' && !Array.isArray(value);
        if (!record(result?.pileDeltas) || !record(result?.actorDeltas)
          || Object.keys(result.actorDeltas).length !== recipients.length
          || recipients.some((value) => !Object.hasOwn(result.actorDeltas, value.uuid) || !record(result.actorDeltas[value.uuid]))) {
          runtime.unknown('Split did not return deltas for the source and exactly the requested recipient Actors');
        }
        return { actor_uuid: actor.uuid, recipient_uuids: recipients.map((value) => value.uuid),
          pile_deltas: runtime.json(result.pileDeltas), actor_deltas: runtime.json(result.actorDeltas) };
      });
    },
  },
  {
    id: 'set_container_state',
    description: 'GM: explicitly open, close, lock, or unlock a container through its public API and verify both flags. Opening also unlocks; locking also closes. Public hooks and configured sounds still run.',
    readOnly: false, requiredMethods: ['isItemPileContainer', 'getActorFlagData', 'openItemPile', 'closeItemPile', 'lockItemPile', 'unlockItemPile'],
    inputSchema: object({ actor_uuid: uuid, action: { type: 'string', enum: ['open', 'close', 'lock', 'unlock'] }, interacting_token_uuid: uuid }, ['actor_uuid', 'action']),
    outputSchema: object({ actor_uuid: uuid, action: { type: 'string', enum: ['open', 'close', 'lock', 'unlock'] }, closed: boolean, locked: boolean }),
    handler: async function (args, runtime) {
      runtime.requireGM();
      const methods = { open: 'openItemPile', close: 'closeItemPile', lock: 'lockItemPile', unlock: 'unlockItemPile' };
      if (!Object.hasOwn(methods, args.action)) throw new Error('Choose open, close, lock, or unlock');
      const actor = await runtime.actor(args.actor_uuid);
      if (!runtime.api.isItemPileContainer(actor)) throw new Error('The target must be an enabled Item Piles container');
      const before = await runtime.api.getActorFlagData(actor);
      if (typeof before?.closed !== 'boolean' || typeof before?.locked !== 'boolean') throw new Error('The container has invalid state flags');
      const expected = { closed: before.closed, locked: before.locked };
      if (args.action === 'open') { expected.closed = false; expected.locked = false; }
      if (args.action === 'close') expected.closed = true;
      if (args.action === 'lock') { expected.closed = true; expected.locked = true; }
      if (args.action === 'unlock') expected.locked = false;
      const interacting = args.interacting_token_uuid ? await runtime.token(args.interacting_token_uuid) : false;
      return runtime.write(async () => {
        const result = await runtime.api[methods[args.action]](actor, interacting);
        if (result === false || result === null) runtime.unknown('The container action did not return a confirmation');
        const current = await runtime.actor(args.actor_uuid);
        const observed = await runtime.api.getActorFlagData(current);
        if (!runtime.api.isItemPileContainer(current) || observed?.closed !== expected.closed || observed?.locked !== expected.locked) runtime.unknown('The requested container state could not be verified');
        return { actor_uuid: actor.uuid, action: args.action, closed: observed.closed, locked: observed.locked };
      });
    },
  },
  {
    id: 'get_vault_grid',
    description: 'Read a vault grid, occupied item summaries, and actual free cells. free_spaces is free_cells.length; upstream_free_spaces preserves the upstream item-count estimate, which can differ for multi-cell items. grid is indexed [x][y].',
    readOnly: true, requiredMethods: ['isItemPileVault', 'getVaultGridData', 'getItemQuantity'],
    inputSchema: object({ actor_uuid: uuid }),
    outputSchema: object({ actor_uuid: uuid, cols: count, rows: count, enabled_cols: count, enabled_rows: count,
      total_spaces: count, enabled_spaces: count, free_spaces: count, upstream_free_spaces: count,
      free_cells: { type: 'array', items: object({ x: count, y: count }) },
      grid: { type: 'array', items: { type: 'array', items: { type: ['string', 'null'] } } },
      items: { type: 'array', items: object({ item: summary, placement }) },
    }),
    handler: async function (args, runtime) {
      const actor = await runtime.actor(args.actor_uuid);
      if (!runtime.api.isItemPileVault(actor)) throw new Error('The target must be an enabled Item Piles vault');
      const grid = await runtime.api.getVaultGridData(actor);
      const count = (value) => {
        if (!Number.isSafeInteger(value) || value < 0) throw new Error('Item Piles returned an invalid vault grid count');
        return value;
      };
      if (!grid || !Array.isArray(grid.freeCells) || !Array.isArray(grid.items) || !Array.isArray(grid.grid)
        || grid.grid.some((column) => !Array.isArray(column) || column.some((cell) => cell !== null && typeof cell !== 'string'))) throw new Error('Item Piles returned an invalid vault grid');
      return { actor_uuid: actor.uuid, cols: count(grid.cols), rows: count(grid.rows), enabled_cols: count(grid.enabledCols), enabled_rows: count(grid.enabledRows),
        total_spaces: count(grid.totalSpaces), enabled_spaces: count(grid.enabledSpaces), free_spaces: grid.freeCells.length, upstream_free_spaces: count(grid.freeSpaces),
        free_cells: grid.freeCells.map((cell) => ({ x: count(cell.x), y: count(cell.y) })), grid: runtime.json(grid.grid),
        items: grid.items.map((entry) => {
          const flags = entry.itemFlagData ?? {};
          return { item: runtime.itemSummary(entry.item), placement: { x: flags.x == null ? null : runtime.finite(flags.x), y: flags.y == null ? null : runtime.finite(flags.y),
            width: runtime.finite(flags.width ?? 1), height: runtime.finite(flags.height ?? 1), flipped: flags.flipped === true } };
        }),
      };
    },
  },
  {
    id: 'check_vault_fit',
    description: 'Calculate whether one existing Item can fit in a vault, without moving it. Reports either a new position or an existing stack item ID; the result does not reserve space.',
    readOnly: true, requiredMethods: ['isItemPileVault', 'canItemFitInVault'],
    inputSchema: object({ actor_uuid: uuid, item_uuid: uuid }),
    outputSchema: object({ actor_uuid: uuid, item_uuid: uuid, fits: boolean, merge_item_id: { type: ['string', 'null'] }, position: nullablePosition }),
    handler: async function (args, runtime) {
      const actor = await runtime.actor(args.actor_uuid);
      if (!runtime.api.isItemPileVault(actor)) throw new Error('The target must be an enabled Item Piles vault');
      const item = await runtime.item(args.item_uuid);
      const result = await runtime.api.canItemFitInVault(item, actor);
      const answer = { actor_uuid: actor.uuid, item_uuid: item.uuid, fits: result !== false, merge_item_id: null, position: null };
      if (result === false) return answer;
      if (typeof result === 'string' && result) { answer.merge_item_id = result; return answer; }
      if (!result || !Number.isSafeInteger(result.x) || result.x < 0 || !Number.isSafeInteger(result.y) || result.y < 0) throw new Error('Item Piles returned an invalid vault placement');
      answer.position = { x: result.x, y: result.y, flipped: result.flipped === true };
      return answer;
    },
  },
  {
    id: 'plan_vault_fit',
    description: 'Preview a multi-item vault fit using existing Item UUIDs and explicit quantities. Nonstackable quantities must be integers and expand into separate items, with at most 100 item placements considered. Nothing is moved, deleted, or reserved. merged_source_item_ids identifies inputs merged into stacks; upstream does not return complete existing-stack quantity updates, so this preview is not a write plan.',
    readOnly: true, requiredMethods: ['isItemPileVault', 'canItemStack', 'fitItemsIntoVault', 'getItemQuantity'],
    inputSchema: object({ actor_uuid: uuid, items: { type: 'array', minItems: 1, maxItems: 100,
      items: object({ item_uuid: uuid, quantity: { type: 'number', exclusiveMinimum: 0, maximum: Number.MAX_SAFE_INTEGER } }) } }),
    outputSchema: object({ actor_uuid: uuid, fits: boolean, preview_only: { const: true },
      placements: { type: 'array', items: object({ item: summary, position }) }, merged_source_item_ids: strings }),
    handler: async function (args, runtime) {
      const actor = await runtime.actor(args.actor_uuid);
      if (!runtime.api.isItemPileVault(actor)) throw new Error('The target must be an enabled Item Piles vault');
      const entries = await runtime.itemsFromRefs(args.items);
      const items = [];
      for (const entry of entries) {
        const stackable = await runtime.api.canItemStack(entry.item, actor);
        const copies = stackable ? 1 : entry.quantity;
        if (!Number.isSafeInteger(copies) || items.length + copies > 100) throw new Error('Nonstackable quantities must be integers; the preview is limited to 100 item placements');
        for (let index = 0; index < copies; index++) items.push(runtime.itemDataWithQuantity(entry.item, stackable ? entry.quantity : 1));
      }
      const result = await runtime.api.fitItemsIntoVault(items, actor);
      const answer = { actor_uuid: actor.uuid, fits: result !== false, preview_only: true, placements: [], merged_source_item_ids: [] };
      if (result === false) return answer;
      if (!result || !Array.isArray(result.updates) || !Array.isArray(result.deletions) || result.deletions.some((id) => typeof id !== 'string' || !id)) throw new Error('Item Piles returned an invalid vault fit preview');
      answer.merged_source_item_ids = [...result.deletions];
      answer.placements = result.updates.map((item) => {
        const flags = item.flags?.['item-piles']?.item;
        if (!flags || !Number.isSafeInteger(flags.x) || flags.x < 0 || !Number.isSafeInteger(flags.y) || flags.y < 0) throw new Error('Item Piles returned an invalid planned position');
        return { item: runtime.itemSummary(item), position: { x: flags.x, y: flags.y, flipped: flags.flipped === true } };
      });
      return answer;
    },
  },
];
