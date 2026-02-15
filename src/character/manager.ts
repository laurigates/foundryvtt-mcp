import { EventEmitter } from 'node:events';
import type { FoundryClient } from '../foundry/client.js';
import type { FoundryActor } from '../foundry/types.js';
import { logger } from '../utils/logger.js';

export interface CharacterAdvancement {
  actorId: string;
  fromLevel: number;
  toLevel: number;
  hitPointsGained: number;
  abilityScoreImprovements: Array<{
    ability: string;
    increase: number;
  }>;
  newSpellsLearned: string[];
  newFeatures: string[];
  skillProficiencies: string[];
  timestamp: Date;
}

export interface EquipmentTransaction {
  actorId: string;
  action: 'add' | 'remove' | 'equip' | 'unequip' | 'transfer';
  itemId: string;
  itemName: string;
  quantity?: number;
  targetActorId?: string; // For transfers
  timestamp: Date;
}

export interface ResourceManagement {
  actorId: string;
  resource: string;
  maxValue: number;
  currentValue: number;
  resetType: 'short_rest' | 'long_rest' | 'daily' | 'manual';
  lastReset?: Date;
}

export interface PartyComposition {
  actors: string[];
  averageLevel: number;
  encounterRating: string;
  roleBalance: {
    tank: number;
    healer: number;
    damage: number;
    support: number;
    control: number;
  };
  recommendations: string[];
}

export class CharacterManager extends EventEmitter {
  private foundryClient: FoundryClient;
  private advancementHistory: CharacterAdvancement[] = [];
  private equipmentHistory: EquipmentTransaction[] = [];
  private resourceTracking: Map<string, ResourceManagement[]> = new Map();

  constructor(foundryClient: FoundryClient) {
    super();
    this.foundryClient = foundryClient;
  }

  // Character Advancement
  async levelUpCharacter(
    actorId: string,
    options: {
      hitPointMethod?: 'roll' | 'average' | 'max';
      abilityScoreImprovements?: Array<{ ability: string; increase: number }>;
      newSpells?: string[];
      newFeatures?: string[];
      newSkills?: string[];
    } = {},
  ): Promise<CharacterAdvancement> {
    logger.info(`Starting level up process for actor ${actorId}`);

    const actor = await this.foundryClient.getActor(actorId);
    const currentLevel = actor.level || 1;
    const newLevel = currentLevel + 1;

    // Calculate HP gain
    const hitPointsGained = this.calculateHitPointGain(actor, options.hitPointMethod || 'average');

    // Process ability score improvements (every 4 levels in D&D 5e)
    const abilityImprovements = options.abilityScoreImprovements || [];
    if (newLevel % 4 === 0 && abilityImprovements.length === 0) {
      // Suggest ability score improvements
      abilityImprovements.push(...this.suggestAbilityImprovements(actor));
    }

    // Determine new spells and features based on class and level
    const newSpells = options.newSpells || this.determineNewSpells(actor, newLevel);
    const newFeatures = options.newFeatures || this.determineNewFeatures(actor, newLevel);
    const newSkills = options.newSkills || this.determineNewSkills(actor, newLevel);

    const advancement: CharacterAdvancement = {
      actorId,
      fromLevel: currentLevel,
      toLevel: newLevel,
      hitPointsGained,
      abilityScoreImprovements: abilityImprovements,
      newSpellsLearned: newSpells,
      newFeatures,
      skillProficiencies: newSkills,
      timestamp: new Date(),
    };

    this.advancementHistory.push(advancement);
    this.emit('character_level_up', advancement);

    logger.info(`${actor.name} leveled up from ${currentLevel} to ${newLevel}`);
    return advancement;
  }

  async calculateExperienceRequired(
    currentLevel: number,
    targetLevel?: number,
  ): Promise<{
    current: number;
    required: number;
    remaining: number;
    nextMilestone: number;
  }> {
    // D&D 5e experience table
    const xpTable = [
      0, 300, 900, 2700, 6500, 14000, 23000, 34000, 48000, 64000, 85000, 100000, 120000, 140000,
      165000, 195000, 225000, 265000, 305000, 355000,
    ];

    const currentXP = xpTable[Math.min(currentLevel - 1, xpTable.length - 1)] || 0;
    const target = targetLevel || currentLevel + 1;
    const requiredXP =
      xpTable[Math.min(target - 1, xpTable.length - 1)] || xpTable[xpTable.length - 1];
    const nextLevelXP =
      xpTable[Math.min(currentLevel, xpTable.length - 1)] || xpTable[xpTable.length - 1];

    return {
      current: currentXP,
      required: requiredXP || 0,
      remaining: (requiredXP || 0) - currentXP,
      nextMilestone: nextLevelXP || 0,
    };
  }

  // Equipment Management
  async addItemToCharacter(
    actorId: string,
    itemData: {
      name: string;
      type: string;
      quantity?: number;
      properties?: Record<string, unknown>;
      equipped?: boolean;
    },
  ): Promise<EquipmentTransaction> {
    logger.info(`Adding ${itemData.name} to actor ${actorId}`);

    const transaction: EquipmentTransaction = {
      actorId,
      action: 'add',
      itemId: this.generateItemId(),
      itemName: itemData.name,
      quantity: itemData.quantity || 1,
      timestamp: new Date(),
    };

    this.equipmentHistory.push(transaction);
    this.emit('equipment_changed', transaction);

    return transaction;
  }

  async equipItem(actorId: string, itemId: string): Promise<EquipmentTransaction> {
    const transaction: EquipmentTransaction = {
      actorId,
      action: 'equip',
      itemId,
      itemName: 'Unknown Item', // Would be retrieved from actual item data
      timestamp: new Date(),
    };

    this.equipmentHistory.push(transaction);
    this.emit('equipment_changed', transaction);

    logger.info(`Equipped item ${itemId} on actor ${actorId}`);
    return transaction;
  }

  async transferItem(
    fromActorId: string,
    toActorId: string,
    itemId: string,
    quantity?: number,
  ): Promise<EquipmentTransaction> {
    const transaction: EquipmentTransaction = {
      actorId: fromActorId,
      action: 'transfer',
      itemId,
      itemName: 'Unknown Item',
      quantity: quantity || 1,
      targetActorId: toActorId,
      timestamp: new Date(),
    };

    this.equipmentHistory.push(transaction);
    this.emit('equipment_changed', transaction);

    logger.info(`Transferred item ${itemId} from ${fromActorId} to ${toActorId}`);
    return transaction;
  }

  // Resource Management
  async trackResource(
    actorId: string,
    resourceName: string,
    config: {
      maxValue: number;
      currentValue?: number;
      resetType: 'short_rest' | 'long_rest' | 'daily' | 'manual';
    },
  ): Promise<ResourceManagement> {
    const resource: ResourceManagement = {
      actorId,
      resource: resourceName,
      maxValue: config.maxValue,
      currentValue: config.currentValue ?? config.maxValue,
      resetType: config.resetType,
      lastReset: new Date(),
    };

    if (!this.resourceTracking.has(actorId)) {
      this.resourceTracking.set(actorId, []);
    }

    const resources = this.resourceTracking.get(actorId);
    if (!resources) {
      throw new Error(`Resources not found for actor ${actorId}`);
    }
    const existingIndex = resources.findIndex((r) => r.resource === resourceName);

    if (existingIndex >= 0) {
      resources[existingIndex] = resource;
    } else {
      resources.push(resource);
    }

    this.emit('resource_tracked', resource);
    return resource;
  }

  async useResource(
    actorId: string,
    resourceName: string,
    amount: number = 1,
  ): Promise<ResourceManagement | null> {
    const resources = this.resourceTracking.get(actorId);
    if (!resources) {
      return null;
    }

    const resource = resources.find((r) => r.resource === resourceName);
    if (!resource) {
      return null;
    }

    if (resource.currentValue >= amount) {
      resource.currentValue -= amount;
      this.emit('resource_used', { resource, amountUsed: amount });
      logger.info(
        `${actorId} used ${amount} ${resourceName} (${resource.currentValue}/${resource.maxValue} remaining)`,
      );
    } else {
      logger.warn(
        `${actorId} attempted to use ${amount} ${resourceName} but only has ${resource.currentValue}`,
      );
    }

    return resource;
  }

  async restoreResources(
    actorId: string,
    restType: 'short_rest' | 'long_rest',
  ): Promise<ResourceManagement[]> {
    const resources = this.resourceTracking.get(actorId) || [];
    const restoredResources: ResourceManagement[] = [];

    // Process resource restoration
    for (const resource of resources) {
      if (
        (restType === 'short_rest' && resource.resetType === 'short_rest') ||
        (restType === 'long_rest' &&
          (resource.resetType === 'long_rest' || resource.resetType === 'short_rest'))
      ) {
        resource.currentValue = resource.maxValue;
        resource.lastReset = new Date();
        restoredResources.push(resource);
      }
    }

    if (restoredResources.length > 0) {
      this.emit('resources_restored', { actorId, restType, resources: restoredResources });
      logger.info(
        `Restored ${restoredResources.length} resources for ${actorId} after ${restType} rest`,
      );
    }

    return restoredResources;
  }

  // Helper methods for the character advancement system
  private calculateHitPointGain(_actor: FoundryActor, method: 'roll' | 'average' | 'max'): number {
    const hitDie = 8; // Default d8, would be determined by class
    switch (method) {
      case 'roll':
        return Math.floor(Math.random() * hitDie) + 1;
      case 'average':
        return Math.floor(hitDie / 2) + 1;
      case 'max':
        return hitDie;
      default:
        return Math.floor(hitDie / 2) + 1;
    }
  }

  private suggestAbilityImprovements(
    _actor: FoundryActor,
  ): Array<{ ability: string; increase: number }> {
    // Simple suggestion logic - would be more sophisticated in practice
    return [
      { ability: 'strength', increase: 1 },
      { ability: 'constitution', increase: 1 },
    ];
  }

  private determineNewSpells(_actor: FoundryActor, _level: number): string[] {
    // Would integrate with spell system
    return [];
  }

  private determineNewFeatures(_actor: FoundryActor, _level: number): string[] {
    // Would integrate with class feature system
    return [];
  }

  private determineNewSkills(_actor: FoundryActor, _level: number): string[] {
    // Would integrate with skill system
    return [];
  }

  private generateItemId(): string {
    return `item_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}
