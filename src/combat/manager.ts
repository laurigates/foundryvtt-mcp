import { EventEmitter } from 'events';
import { logger } from '../utils/logger.js';
import { FoundryClient } from '../foundry/client.js';

export interface CombatState {
  id: string;
  round: number;
  turn: number;
  active: boolean;
  started: boolean;
  scene?: string;
  combatants: CombatantState[];
  currentCombatant?: CombatantState;
  turnStartTime?: Date;
  roundStartTime?: Date;
}

export interface CombatantState {
  id: string;
  name: string;
  initiative?: number;
  hp: {
    current: number;
    max: number;
    temp?: number;
  };
  ac?: number;
  conditions: string[];
  defeated: boolean;
  hidden: boolean;
  actorId?: string;
  tokenId?: string;
  turnTaken: boolean;
  actions: {
    action: boolean;
    bonus: boolean;
    movement: number;
    reaction: boolean;
  };
}

export interface CombatEvent {
  type: 'combat_start' | 'combat_end' | 'turn_start' | 'turn_end' | 'round_start' | 'round_end' | 'damage_dealt' | 'condition_applied' | 'initiative_changed';
  timestamp: Date;
  combat: CombatState;
  data?: unknown;
}

export class CombatManager extends EventEmitter {
  private currentCombat: CombatState | null = null;
  private foundryClient: FoundryClient;
  private combatHistory: CombatEvent[] = [];
  private turnTimer: NodeJS.Timeout | undefined;
  private readonly TURN_WARNING_TIME = 30000; // 30 seconds
  private readonly MAX_TURN_TIME = 120000; // 2 minutes

  constructor(foundryClient: FoundryClient) {
    super();
    this.foundryClient = foundryClient;
    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.on('combat_start', this.handleCombatStart.bind(this));
    this.on('turn_start', this.handleTurnStart.bind(this));
    this.on('turn_end', this.handleTurnEnd.bind(this));
    this.on('round_end', this.handleRoundEnd.bind(this));
  }

  /**
   * Destroy the combat manager and release resources
   */
  destroy(): void {
    if (this.turnTimer) {
      clearTimeout(this.turnTimer);
      this.turnTimer = undefined;
    }
    this.removeAllListeners();
    this.currentCombat = null;
    this.combatHistory = [];
    logger.info('Combat manager destroyed');
  }

  // Public API Methods
  getCurrentCombat(): CombatState | null {
    return this.currentCombat;
  }

  getCombatHistory(limit: number = 50): CombatEvent[] {
    return this.combatHistory.slice(-limit);
  }

  async startCombat(combatants: Partial<CombatantState>[]): Promise<CombatState> {
    logger.info('Starting new combat encounter');

    const combat: CombatState = {
      id: this.generateCombatId(),
      round: 1,
      turn: 0,
      active: true,
      started: false,
      combatants: await this.initializeCombatants(combatants),
      turnStartTime: new Date(),
      roundStartTime: new Date(),
    };

    // Sort by initiative
    combat.combatants.sort((a, b) => (b.initiative || 0) - (a.initiative || 0));

    this.currentCombat = combat;
    this.emitCombatEvent('combat_start', combat);

    return combat;
  }

  async rollInitiative(combatantId?: string): Promise<{ [key: string]: number }> {
    if (!this.currentCombat) {
      throw new Error('No active combat');
    }

    const results: { [key: string]: number } = {};
    const combatants = combatantId
      ? this.currentCombat.combatants.filter(c => c.id === combatantId)
      : this.currentCombat.combatants;

    for (const combatant of combatants) {
      // Roll 1d20 + initiative modifier (simplified)
      const roll = Math.floor(Math.random() * 20) + 1;
      const modifier = this.getInitiativeModifier(combatant);
      const total = roll + modifier;

      combatant.initiative = total;
      results[combatant.name] = total;

      logger.debug(`${combatant.name} rolled initiative: ${total} (${roll} + ${modifier})`);
    }

    // Re-sort combatants by initiative
    this.currentCombat.combatants.sort((a, b) => (b.initiative || 0) - (a.initiative || 0));

    this.emitCombatEvent('initiative_changed', this.currentCombat, results);

    return results;
  }

  async nextTurn(): Promise<CombatantState | null> {
    if (!this.currentCombat || !this.currentCombat.active) {
      throw new Error('No active combat');
    }

    // End current turn
    if (this.currentCombat.currentCombatant) {
      this.emitCombatEvent('turn_end', this.currentCombat);
    }

    // Clear turn timer
    if (this.turnTimer) {
      clearTimeout(this.turnTimer);
    }

    // Advance to next combatant
    this.currentCombat.turn++;

    // Check if we need to start a new round
    if (this.currentCombat.turn >= this.currentCombat.combatants.length) {
      this.currentCombat.turn = 0;
      this.currentCombat.round++;
      this.emitCombatEvent('round_end', this.currentCombat);

      // Reset turn actions for all combatants
      this.currentCombat.combatants.forEach(c => {
        c.turnTaken = false;
        c.actions = {
          action: false,
          bonus: false,
          movement: 0,
          reaction: false,
        };
      });
    }

    // Set current combatant
    const combatant = this.currentCombat.combatants[this.currentCombat.turn];
    if (combatant) {
      this.currentCombat.currentCombatant = combatant;
    }
    this.currentCombat.turnStartTime = new Date();

    if (!this.currentCombat.started) {
      this.currentCombat.started = true;
    }

    this.emitCombatEvent('turn_start', this.currentCombat);

    return this.currentCombat.currentCombatant || null;
  }

  async applyDamage(combatantId: string, damage: number, damageType?: string): Promise<CombatantState> {
    if (!this.currentCombat) {
      throw new Error('No active combat');
    }

    const combatant = this.currentCombat.combatants.find(c => c.id === combatantId);
    if (!combatant) {
      throw new Error(`Combatant ${combatantId} not found`);
    }

    // Apply damage to temp HP first, then regular HP
    let remainingDamage = damage;
    if (combatant.hp.temp && combatant.hp.temp > 0) {
      const tempDamage = Math.min(remainingDamage, combatant.hp.temp);
      combatant.hp.temp -= tempDamage;
      remainingDamage -= tempDamage;
    }

    combatant.hp.current = Math.max(0, combatant.hp.current - remainingDamage);

    // Check if combatant is defeated
    if (combatant.hp.current === 0) {
      combatant.defeated = true;
    }

    this.emitCombatEvent('damage_dealt', this.currentCombat, {
      combatantId,
      damage,
      damageType,
      newHP: combatant.hp.current,
      defeated: combatant.defeated
    });

    logger.info(`${combatant.name} took ${damage} ${damageType || 'damage'}, HP: ${combatant.hp.current}/${combatant.hp.max}`);

    return combatant;
  }

  async healCombatant(combatantId: string, healing: number): Promise<CombatantState> {
    if (!this.currentCombat) {
      throw new Error('No active combat');
    }

    const combatant = this.currentCombat.combatants.find(c => c.id === combatantId);
    if (!combatant) {
      throw new Error(`Combatant ${combatantId} not found`);
    }

    combatant.hp.current = Math.min(combatant.hp.max, combatant.hp.current + healing);

    if (combatant.hp.current > 0) {
      combatant.defeated = false;
    }

    logger.info(`${combatant.name} healed for ${healing}, HP: ${combatant.hp.current}/${combatant.hp.max}`);

    return combatant;
  }

  async applyCondition(combatantId: string, condition: string, duration?: number): Promise<CombatantState> {
    if (!this.currentCombat) {
      throw new Error('No active combat');
    }

    const combatant = this.currentCombat.combatants.find(c => c.id === combatantId);
    if (!combatant) {
      throw new Error(`Combatant ${combatantId} not found`);
    }

    if (!combatant.conditions.includes(condition)) {
      combatant.conditions.push(condition);

      this.emitCombatEvent('condition_applied', this.currentCombat, {
        combatantId,
        condition,
        duration
      });

      logger.info(`Applied ${condition} to ${combatant.name}`);
    }

    return combatant;
  }

  async removeCondition(combatantId: string, condition: string): Promise<CombatantState> {
    if (!this.currentCombat) {
      throw new Error('No active combat');
    }

    const combatant = this.currentCombat.combatants.find(c => c.id === combatantId);
    if (!combatant) {
      throw new Error(`Combatant ${combatantId} not found`);
    }

    const index = combatant.conditions.indexOf(condition);
    if (index > -1) {
      combatant.conditions.splice(index, 1);
      logger.info(`Removed ${condition} from ${combatant.name}`);
    }

    return combatant;
  }

  async endCombat(): Promise<CombatState> {
    if (!this.currentCombat) {
      throw new Error('No active combat');
    }

    this.currentCombat.active = false;

    if (this.turnTimer) {
      clearTimeout(this.turnTimer);
    }

    const endedCombat = { ...this.currentCombat };
    this.emitCombatEvent('combat_end', endedCombat);

    logger.info('Combat ended');
    this.currentCombat = null;

    return endedCombat;
  }

  // Event Handlers
  private handleCombatStart(event: CombatEvent): void {
    logger.info(`Combat started with ${event.combat.combatants.length} combatants`);
  }

  private handleTurnStart(event: CombatEvent): void {
    const combatant = event.combat.currentCombatant;
    if (combatant) {
      logger.info(`Turn ${event.combat.turn + 1}, Round ${event.combat.round}: ${combatant.name}'s turn`);

      // Set turn timer
      this.turnTimer = setTimeout(() => {
        this.emit('turn_warning', combatant);
      }, this.TURN_WARNING_TIME);
    }
  }

  private handleTurnEnd(event: CombatEvent): void {
    const combatant = event.combat.currentCombatant;
    if (combatant) {
      combatant.turnTaken = true;
      logger.debug(`${combatant.name} ended their turn`);
    }
  }

  private handleRoundEnd(event: CombatEvent): void {
    logger.info(`Round ${event.combat.round - 1} ended, starting Round ${event.combat.round}`);
  }

  // Helper Methods
  private async initializeCombatants(combatantData: Partial<CombatantState>[]): Promise<CombatantState[]> {
    const combatants: CombatantState[] = [];

    for (const data of combatantData) {
      const combatant: CombatantState = {
        id: data.id || this.generateCombatantId(),
        name: data.name || 'Unknown',
        initiative: data.initiative || 0,
        hp: data.hp || { current: 1, max: 1 },
        ac: data.ac || 10,
        conditions: data.conditions || [],
        defeated: data.defeated || false,
        hidden: data.hidden || false,
        actorId: data.actorId || '',
        tokenId: data.tokenId || '',
        turnTaken: false,
        actions: {
          action: false,
          bonus: false,
          movement: 0,
          reaction: false,
        }
      };

      combatants.push(combatant);
    }

    return combatants;
  }

  private getInitiativeModifier(_combatant: CombatantState): number {
    // Simplified initiative modifier calculation
    // In a real implementation, this would pull from the actual character sheet
    return Math.floor(Math.random() * 6) - 1; // -1 to +4
  }

  private generateCombatId(): string {
    return `combat_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private generateCombatantId(): string {
    return `combatant_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private emitCombatEvent(type: CombatEvent['type'], combat: CombatState, data?: unknown): void {
    const event: CombatEvent = {
      type,
      timestamp: new Date(),
      combat: { ...combat }, // Deep copy to prevent mutations
      data
    };

    this.combatHistory.push(event);

    // Keep history manageable
    if (this.combatHistory.length > 1000) {
      this.combatHistory = this.combatHistory.slice(-500);
    }

    this.emit(type, event);
    this.emit('combat_event', event);
  }

  // Analysis Methods
  getCombatStatistics(): {
    totalRounds: number;
    totalTurns: number;
    averageTurnTime: number;
    combatants: Array<{
      name: string;
      initiative: number;
      hp: { current: number; max: number };
      status: string[];
    }>;
  } | null {
    if (!this.currentCombat) {
      return null;
    }

    const stats = {
      totalRounds: this.currentCombat.round,
      totalTurns: this.currentCombat.round * this.currentCombat.combatants.length + this.currentCombat.turn,
      averageTurnTime: this.calculateAverageTurnTime(),
      combatants: this.currentCombat.combatants.map(c => ({
        name: c.name,
        initiative: c.initiative || 0,
        hp: { current: c.hp.current, max: c.hp.max },
        status: c.conditions
      })),
      activeEffects: this.currentCombat.combatants.reduce((acc, c) => acc + c.conditions.length, 0)
    };

    return stats;
  }

  private calculateAverageTurnTime(): number {
    const turnEvents = this.combatHistory.filter(e => e.type === 'turn_start');
    if (turnEvents.length < 2) {
      return 0;
    }

    let totalTime = 0;
    for (let i = 1; i < turnEvents.length; i++) {
      const currentEvent = turnEvents[i];
      const previousEvent = turnEvents[i - 1];
      if (currentEvent && previousEvent) {
        totalTime += currentEvent.timestamp.getTime() - previousEvent.timestamp.getTime();
      }
    }

    return Math.round(totalTime / (turnEvents.length - 1) / 1000); // seconds
  }

  suggestTacticalActions(combatantId: string): string[] {
    if (!this.currentCombat) {
      return ['No active combat'];
    }

    const combatant = this.currentCombat.combatants.find(c => c.id === combatantId);
    if (!combatant) {
      return ['Combatant not found'];
    }

    const suggestions: string[] = [];

    // HP-based suggestions
    const hpPercent = (combatant.hp.current / combatant.hp.max) * 100;
    if (hpPercent < 25) {
      suggestions.push('Consider healing or retreating - HP critically low');
      suggestions.push('Use defensive actions like Dodge or Shield');
    } else if (hpPercent < 50) {
      suggestions.push('Monitor HP carefully - consider healing');
    }

    // Condition-based suggestions
    if (combatant.conditions.includes('poisoned')) {
      suggestions.push('Remove poison condition if possible');
    }
    if (combatant.conditions.includes('prone')) {
      suggestions.push('Use movement to stand up from prone');
    }
    if (combatant.conditions.includes('grappled')) {
      suggestions.push('Attempt to escape grapple with Athletics or Acrobatics');
    }

    // Action economy suggestions
    if (!combatant.actions.action) {
      suggestions.push('Use your Action for Attack, Cast a Spell, or other actions');
    }
    if (!combatant.actions.bonus) {
      suggestions.push('Check for available Bonus Actions');
    }

    // Enemy analysis
    const enemies = this.currentCombat.combatants.filter(c => c.id !== combatantId && !c.defeated);
    const lowHpEnemies = enemies.filter(e => (e.hp.current / e.hp.max) < 0.3);
    if (lowHpEnemies.length > 0) {
      suggestions.push(`Focus fire on low HP enemies: ${lowHpEnemies.map(e => e.name).join(', ')}`);
    }

    if (suggestions.length === 0) {
      suggestions.push('Assess battlefield and choose optimal action');
    }

    return suggestions;
  }
}
