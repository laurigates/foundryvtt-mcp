/**
 * Items API endpoints for the Foundry Local REST API
 */

export class ItemsAPI {

  /**
   * Search for items based on query parameters
   * GET /api/items?query=sword&type=weapon&rarity=rare&limit=20
   */
  searchItems(req, res) {
    try {
      const { query, type, rarity, limit = 50 } = req.query;

      // Collect items from both world items and actor items
      let items = [];

      // Add world items
      items.push(...Array.from(game.items.values()));

      // Add items from all actors
      game.actors.forEach(actor => {
        actor.items.forEach(item => {
          items.push({
            ...item,
            _ownerId: actor.id,
            _ownerName: actor.name
          });
        });
      });

      // Filter by type if specified
      if (type) {
        items = items.filter(item => item.type === type);
      }

      // Filter by rarity if specified
      if (rarity) {
        items = items.filter(item => {
          const itemRarity = item.system?.rarity?.toLowerCase() ||
                           item.system?.details?.rarity?.toLowerCase() ||
                           'common';
          return itemRarity === rarity.toLowerCase();
        });
      }

      // Filter by query if specified (search in name and description)
      if (query) {
        const searchQuery = query.toLowerCase();
        items = items.filter(item => {
          const name = item.name?.toLowerCase() || '';
          const description = item.system?.description?.value?.toLowerCase() || '';
          return name.includes(searchQuery) || description.includes(searchQuery);
        });
      }

      // Remove duplicates based on name and type
      const uniqueItems = [];
      const seen = new Set();

      items.forEach(item => {
        const key = `${item.name}-${item.type}`;
        if (!seen.has(key)) {
          seen.add(key);
          uniqueItems.push(item);
        }
      });

      // Limit results
      const limitedItems = uniqueItems.slice(0, parseInt(limit));

      // Format response
      const results = limitedItems.map(item => this.formatItemSummary(item));

      res.json({
        success: true,
        data: results,
        total: results.length,
        query: { query, type, rarity, limit }
      });

    } catch (error) {
      console.error('Foundry Local REST API | Error searching items:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: error.message
      });
    }
  }

  /**
   * Get detailed information about a specific item
   * GET /api/items/:id
   */
  getItem(req, res) {
    try {
      const { id } = req.params;

      // First check world items
      let item = game.items.get(id);
      let owner = null;

      // If not found in world items, search actor items
      if (!item) {
        for (const actor of game.actors.values()) {
          const actorItem = actor.items.get(id);
          if (actorItem) {
            item = actorItem;
            owner = { id: actor.id, name: actor.name };
            break;
          }
        }
      }

      if (!item) {
        return res.status(404).json({
          success: false,
          error: 'Item not found',
          message: `Item with ID ${id} does not exist`
        });
      }

      const itemData = this.formatItemDetail(item, owner);

      res.json({
        success: true,
        data: itemData
      });

    } catch (error) {
      console.error('Foundry Local REST API | Error getting item:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: error.message
      });
    }
  }

  /**
   * Format item data for summary view (search results)
   */
  formatItemSummary(item) {
    const system = item.system || {};

    return {
      id: item.id,
      name: item.name,
      type: item.type,
      img: item.img,
      rarity: system.rarity || system.details?.rarity || 'common',
      cost: {
        value: system.price?.value || system.cost || 0,
        denomination: system.price?.denomination || 'gp'
      },
      weight: system.weight || 0,
      quantity: system.quantity || 1,
      equipped: system.equipped || false,
      identified: system.identified !== false,
      attunement: system.attunement || 0,
      source: system.source || system.details?.source || null,
      owner: item._ownerName ? {
        id: item._ownerId,
        name: item._ownerName
      } : null,
      folder: item.folder?.name || null
    };
  }

  /**
   * Format item data for detailed view
   */
  formatItemDetail(item, owner = null) {
    const system = item.system || {};
    const summary = this.formatItemSummary(item);

    // Override owner if provided
    if (owner) {
      summary.owner = owner;
    }

    return {
      ...summary,
      // Additional detailed information
      description: {
        value: system.description?.value || '',
        chat: system.description?.chat || '',
        unidentified: system.description?.unidentified || ''
      },
      properties: this.formatItemProperties(item),
      damage: this.formatDamage(system),
      armor: this.formatArmor(system),
      weapon: this.formatWeapon(system),
      consumable: this.formatConsumable(system),
      spell: this.formatSpell(system),
      uses: {
        value: system.uses?.value || 0,
        max: system.uses?.max || 0,
        per: system.uses?.per || null,
        recovery: system.uses?.recovery || null
      },
      recharge: {
        value: system.recharge?.value || null,
        charged: system.recharge?.charged !== false
      },
      activation: {
        type: system.activation?.type || null,
        cost: system.activation?.cost || null,
        condition: system.activation?.condition || ''
      },
      duration: {
        value: system.duration?.value || null,
        units: system.duration?.units || null
      },
      range: {
        value: system.range?.value || null,
        long: system.range?.long || null,
        units: system.range?.units || null
      },
      target: {
        value: system.target?.value || null,
        width: system.target?.width || null,
        units: system.target?.units || null,
        type: system.target?.type || null
      },
      requirements: system.requirements || '',
      flags: item.flags,
      effects: Array.from(item.effects || []).map(effect => ({
        id: effect.id,
        name: effect.name || effect.label,
        icon: effect.icon,
        disabled: effect.disabled,
        transfer: effect.transfer,
        changes: effect.changes || []
      }))
    };
  }

  /**
   * Format item properties based on type
   */
  formatItemProperties(item) {
    const system = item.system || {};
    const properties = {};

    // Weapon properties
    if (system.properties) {
      Object.keys(system.properties).forEach(prop => {
        if (system.properties[prop]) {
          properties[prop] = true;
        }
      });
    }

    // Armor properties
    if (system.armor) {
      properties.armor = true;
    }

    // Magic item properties
    if (system.rarity && system.rarity !== 'common') {
      properties.magical = true;
    }

    // Consumable properties
    if (item.type === 'consumable') {
      properties.consumable = true;
    }

    return properties;
  }

  /**
   * Format damage information for weapons
   */
  formatDamage(system) {
    if (!system.damage) return null;

    const parts = system.damage.parts || [];
    const versatile = system.damage.versatile || '';

    return {
      parts: parts.map(([formula, type]) => ({
        formula,
        type
      })),
      versatile,
      base: system.damage.base || ''
    };
  }

  /**
   * Format armor information
   */
  formatArmor(system) {
    if (!system.armor) return null;

    return {
      type: system.armor.type || '',
      value: system.armor.value || 0,
      dex: system.armor.dex || null,
      magicalBonus: system.armor.magicalBonus || 0
    };
  }

  /**
   * Format weapon information
   */
  formatWeapon(system) {
    if (system.weaponType === undefined && system.actionType === undefined) return null;

    return {
      weaponType: system.weaponType || '',
      actionType: system.actionType || '',
      attack: {
        bonus: system.attack?.bonus || '',
        flat: system.attack?.flat || false
      },
      enchantment: system.enchantment || 0,
      proficient: system.proficient || false
    };
  }

  /**
   * Format consumable information
   */
  formatConsumable(system) {
    if (!system.consumableType && !system.consume) return null;

    return {
      type: system.consumableType || '',
      subtype: system.consumableSubtype || '',
      autoDestroy: system.autoDestroy !== false,
      consume: system.consume || null
    };
  }

  /**
   * Format spell information for spell items
   */
  formatSpell(system) {
    if (!system.level && system.level !== 0) return null;

    return {
      level: system.level,
      school: system.school || '',
      components: {
        vocal: system.components?.vocal || false,
        somatic: system.components?.somatic || false,
        material: system.components?.material || false,
        ritual: system.components?.ritual || false,
        concentration: system.components?.concentration || false
      },
      materials: {
        value: system.materials?.value || '',
        consumed: system.materials?.consumed || false,
        cost: system.materials?.cost || 0,
        supply: system.materials?.supply || 0
      },
      preparation: {
        mode: system.preparation?.mode || '',
        prepared: system.preparation?.prepared || false
      },
      scaling: {
        mode: system.scaling?.mode || '',
        formula: system.scaling?.formula || ''
      }
    };
  }
}
