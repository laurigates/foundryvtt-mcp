/**
 * @fileoverview Content generation tool handlers
 * 
 * Handles NPC generation, loot generation, and rule lookups.
 */

import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { FoundryClient } from '../../foundry/client.js';
import { logger } from '../../utils/logger.js';

/**
 * Handles NPC generation requests
 */
export async function handleGenerateNPC(args: any, _foundryClient: FoundryClient) {
  const { level = 1, race, class: characterClass } = args;

  try {
    logger.info('Generating NPC', { level, race, characterClass });

    // Generate basic NPC data
    const npcName = generateRandomName();
    const npcRace = race || getRandomRace();
    const npcClass = characterClass || getRandomClass();
    const stats = generateAbilityScores();
    const hp = Math.max(1, Math.floor(Math.random() * (level * 8)) + level);

    return {
      content: [
        {
          type: 'text',
          text: `🧙 **Generated NPC**
**Name:** ${npcName}
**Race:** ${npcRace}
**Class:** ${npcClass}
**Level:** ${level}
**Hit Points:** ${hp}

**Ability Scores:**
**STR:** ${stats.str} | **DEX:** ${stats.dex} | **CON:** ${stats.con}
**INT:** ${stats.int} | **WIS:** ${stats.wis} | **CHA:** ${stats.cha}

**Background:** ${generateBackground(npcRace, npcClass)}`,
        },
      ],
    };
  } catch (error) {
    logger.error('Failed to generate NPC:', error);
    throw new McpError(
      ErrorCode.InternalError,
      `Failed to generate NPC: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Handles loot generation requests
 */
export async function handleGenerateLoot(args: any, _foundryClient: FoundryClient) {
  const { challengeRating = 1, treasureType = 'individual' } = args;

  try {
    logger.info('Generating loot', { challengeRating, treasureType });

    const loot = generateLootForCR(challengeRating, treasureType);

    return {
      content: [
        {
          type: 'text',
          text: `💰 **Generated Loot**
**Challenge Rating:** ${challengeRating}
**Treasure Type:** ${treasureType}

**Currency:**
${loot.currency.map(c => `- ${c.amount} ${c.type}`).join('\n')}

**Items:**
${loot.items.map(item => `- ${item.name} (${item.rarity})`).join('\n')}

**Total Estimated Value:** ${loot.totalValue} gp`,
        },
      ],
    };
  } catch (error) {
    logger.error('Failed to generate loot:', error);
    throw new McpError(
      ErrorCode.InternalError,
      `Failed to generate loot: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Handles rule lookup requests
 */
export async function handleLookupRule(args: any, _foundryClient: FoundryClient) {
  const { query, system = 'D&D 5e' } = args;

  if (!query || typeof query !== 'string') {
    throw new McpError(ErrorCode.InvalidParams, 'Query is required and must be a string');
  }

  try {
    logger.info('Looking up rule', { query, system });

    const ruleInfo = lookupGameRule(query, system);

    return {
      content: [
        {
          type: 'text',
          text: `📖 **Rule Lookup: ${query}**
**System:** ${system}

**Rule:** ${ruleInfo.title}
**Description:** ${ruleInfo.description}

**Mechanics:** ${ruleInfo.mechanics}

**Source:** ${ruleInfo.source}`,
        },
      ],
    };
  } catch (error) {
    logger.error('Failed to lookup rule:', error);
    throw new McpError(
      ErrorCode.InternalError,
      `Failed to lookup rule: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

// Helper functions for content generation

function generateRandomName(): string {
  const firstNames = ['Aerdrie', 'Berris', 'Cithreth', 'Drannor', 'Enna', 'Galinndan', 'Halimath', 'Immeral', 'Jallarzi', 'Keth'];
  const lastNames = ['Amakir', 'Amakiir', 'Galanodel', 'Holimion', 'Liadon', 'Meliamne', 'Nailo', 'Siannodel', 'Xiloscient', 'Yellowleaf'];
  
  return `${firstNames[Math.floor(Math.random() * firstNames.length)]} ${lastNames[Math.floor(Math.random() * lastNames.length)]}`;
}

function getRandomRace(): string {
  const races = ['Human', 'Elf', 'Dwarf', 'Halfling', 'Dragonborn', 'Gnome', 'Half-Elf', 'Half-Orc', 'Tiefling'];
  return races[Math.floor(Math.random() * races.length)] || 'Human';
}

function getRandomClass(): string {
  const classes = ['Fighter', 'Wizard', 'Cleric', 'Rogue', 'Ranger', 'Paladin', 'Barbarian', 'Bard', 'Druid', 'Monk', 'Sorcerer', 'Warlock'];
  return classes[Math.floor(Math.random() * classes.length)] || 'Fighter';
}

function generateAbilityScores() {
  const rollStat = () => {
    const rolls = Array.from({ length: 4 }, () => Math.floor(Math.random() * 6) + 1);
    rolls.sort((a, b) => b - a);
    return rolls.slice(0, 3).reduce((sum, roll) => sum + roll, 0);
  };

  return {
    str: rollStat(),
    dex: rollStat(),
    con: rollStat(),
    int: rollStat(),
    wis: rollStat(),
    cha: rollStat(),
  };
}

function generateBackground(race: string, characterClass: string): string {
  const backgrounds = [
    `A former ${characterClass.toLowerCase()} who seeks redemption for past mistakes.`,
    `A ${race.toLowerCase()} ${characterClass.toLowerCase()} from a distant land, traveling to spread their knowledge.`,
    `Once a member of a secret organization, now working independently.`,
    `A scholar turned adventurer after discovering an ancient mystery.`,
    `A protector of the innocent, dedicated to fighting against evil.`,
  ];
  
  return backgrounds[Math.floor(Math.random() * backgrounds.length)] || 'A mysterious wanderer with an unknown past.';
}

function generateLootForCR(cr: number, _type: string) {
  const baseValue = Math.floor(cr * 100 * (0.5 + Math.random()));
  
  return {
    currency: [
      { amount: Math.floor(baseValue * 0.1), type: 'gp' as const },
      { amount: Math.floor(baseValue * 0.05), type: 'sp' as const },
      { amount: Math.floor(baseValue * 0.02), type: 'cp' as const },
    ],
    items: [
      { name: 'Healing Potion' as const, rarity: 'Common' as const },
      { name: 'Silver Ring' as const, rarity: 'Common' as const },
    ],
    totalValue: baseValue,
  };
}

function lookupGameRule(query: string, system: string) {
  // Mock rule lookup - in a real implementation, this would query actual rule databases
  return {
    title: `${query} Rule`,
    description: `Rules and mechanics for ${query} in ${system}.`,
    mechanics: `Detailed explanation of how ${query} works mechanically.`,
    source: `${system} Core Rulebook`,
  };
}