import { describe, expect, it } from 'vitest';
import type {
  DiceRoll,
  FoundryActor,
  FoundryAPIResponse,
  FoundryCombat,
  FoundryItem,
  FoundryScene,
  FoundryUser,
  GeneratedLocation,
  GeneratedNPC,
  GeneratedQuest,
} from '../types';

describe('FoundryVTT Types', () => {
  describe('FoundryActor', () => {
    it('should have required properties', () => {
      const actor: FoundryActor = {
        _id: 'actor-123',
        name: 'Test Actor',
        type: 'character',
      };

      expect(actor._id).toBe('actor-123');
      expect(actor.name).toBe('Test Actor');
      expect(actor.type).toBe('character');
    });

    it('should support optional properties', () => {
      const actor: FoundryActor = {
        _id: 'actor-123',
        name: 'Test Actor',
        type: 'character',
        img: '/path/to/image.png',
        hp: { value: 25, max: 30, temp: 5 },
        ac: { value: 15 },
        level: 5,
        experience: { value: 6500, max: 14000 },
        currency: { gp: 100, sp: 50 },
        biography: 'A brave adventurer',
        notes: 'Player notes here',
      };

      expect(actor.img).toBe('/path/to/image.png');
      expect(actor.hp?.value).toBe(25);
      expect(actor.level).toBe(5);
      expect(actor.currency?.gp).toBe(100);
    });
  });

  describe('FoundryItem', () => {
    it('should support weapon properties', () => {
      const weapon: FoundryItem = {
        _id: 'item-123',
        name: 'Longsword',
        type: 'weapon',
        damage: {
          parts: [['1d8', 'slashing']],
          versatile: '1d10',
        },
        range: {
          value: 5,
          units: 'ft',
        },
      };

      expect(weapon.damage?.parts[0]).toEqual(['1d8', 'slashing']);
      expect(weapon.damage?.versatile).toBe('1d10');
      expect(weapon.range?.value).toBe(5);
    });

    it('should support spell properties', () => {
      const spell: FoundryItem = {
        _id: 'spell-123',
        name: 'Fireball',
        type: 'spell',
        level: 3,
        school: 'evocation',
        components: {
          vocal: true,
          somatic: true,
          material: true,
          value: 'A tiny ball of bat guano and sulfur',
        },
        duration: {
          value: 0,
          units: 'instantaneous',
        },
      };

      expect(spell.level).toBe(3);
      expect(spell.school).toBe('evocation');
      expect(spell.components?.vocal).toBe(true);
      expect(spell.components?.value).toContain('bat guano');
    });
  });

  describe('FoundryScene', () => {
    it('should have required grid and dimensions', () => {
      const scene: FoundryScene = {
        _id: 'scene-123',
        name: 'Test Scene',
        active: true,
        navigation: true,
        width: 4000,
        height: 3000,
        padding: 0.25,
        shiftX: 0,
        shiftY: 0,
        globalLight: false,
        darkness: 0,
      };

      expect(scene.width).toBe(4000);
      expect(scene.height).toBe(3000);
      expect(scene.active).toBe(true);
      expect(scene.globalLight).toBe(false);
    });

    it('should support optional grid configuration', () => {
      const scene: FoundryScene = {
        _id: 'scene-123',
        name: 'Test Scene',
        active: true,
        navigation: true,
        width: 4000,
        height: 3000,
        padding: 0.25,
        shiftX: 0,
        shiftY: 0,
        globalLight: false,
        darkness: 0,
        grid: {
          type: 1,
          size: 100,
          color: '#000000',
          alpha: 0.2,
          distance: 5,
          units: 'ft',
        },
      };

      expect(scene.grid?.size).toBe(100);
      expect(scene.grid?.distance).toBe(5);
      expect(scene.grid?.units).toBe('ft');
    });
  });

  describe('FoundryCombat', () => {
    it('should track combat state and participants', () => {
      const combat: FoundryCombat = {
        _id: 'combat-123',
        scene: 'scene-123',
        active: true,
        round: 3,
        turn: 1,
        started: true,
        combatants: [
          {
            _id: 'combatant-1',
            tokenId: 'token-1',
            actorId: 'actor-1',
            name: 'Hero',
            initiative: 18,
            hidden: false,
            defeated: false,
          },
          {
            _id: 'combatant-2',
            tokenId: 'token-2',
            actorId: 'actor-2',
            name: 'Goblin',
            initiative: 12,
            hidden: false,
            defeated: true,
          },
        ],
        settings: {
          resource: 'attributes.hp',
          skipDefeated: true,
        },
      };

      expect(combat.round).toBe(3);
      expect(combat.turn).toBe(1);
      expect(combat.combatants).toHaveLength(2);
      expect(combat.combatants[0].initiative).toBe(18);
      expect(combat.combatants[1].defeated).toBe(true);
    });
  });

  describe('FoundryUser', () => {
    it('should have role-based permissions', () => {
      const user: FoundryUser = {
        _id: 'user-123',
        name: 'GameMaster',
        role: 4, // GM
        active: true,
        color: '#ff0000',
        permissions: {
          ACTOR_CREATE: true,
          ITEM_CREATE: true,
          SCENE_CREATE: true,
        },
      };

      expect(user.role).toBe(4);
      expect(user.permissions.ACTOR_CREATE).toBe(true);
      expect(user.color).toBe('#ff0000');
    });
  });

  describe('FoundryAPIResponse', () => {
    it('should handle successful responses', () => {
      const response: FoundryAPIResponse<FoundryActor[]> = {
        success: true,
        data: [
          {
            _id: 'actor-1',
            name: 'Hero',
            type: 'character',
          },
        ],
      };

      expect(response.success).toBe(true);
      expect(response.data).toHaveLength(1);
      expect(response.data?.[0].name).toBe('Hero');
    });

    it('should handle error responses', () => {
      const response: FoundryAPIResponse = {
        success: false,
        error: 'Not found',
        message: 'The requested resource was not found',
      };

      expect(response.success).toBe(false);
      expect(response.error).toBe('Not found');
      expect(response.message).toContain('not found');
    });
  });

  describe('DiceRoll', () => {
    it('should capture dice roll results', () => {
      const roll: DiceRoll = {
        formula: '2d6+3',
        total: 11,
        breakdown: '(4 + 5) + 3',
        reason: 'Attack roll',
        timestamp: '2024-01-01T12:00:00.000Z',
      };

      expect(roll.formula).toBe('2d6+3');
      expect(roll.total).toBe(11);
      expect(roll.breakdown).toContain('4 + 5');
      expect(roll.reason).toBe('Attack roll');
    });
  });

  describe('Generated Content Types', () => {
    it('should structure generated NPCs', () => {
      const npc: GeneratedNPC = {
        name: 'Elara Moonwhisper',
        race: 'Elf',
        class: 'Wizard',
        level: 8,
        background: 'Sage',
        personality: ['Curious', 'Methodical', 'Secretive'],
        appearance: 'Tall elf with silver hair and piercing blue eyes',
        motivations: ['Seek ancient knowledge', 'Protect the library'],
        stats: {
          str: 8,
          dex: 14,
          con: 12,
          int: 18,
          wis: 15,
          cha: 10,
        },
        equipment: ['Spellbook', 'Component pouch', 'Quarterstaff'],
      };

      expect(npc.name).toBe('Elara Moonwhisper');
      expect(npc.personality).toContain('Curious');
      expect(npc.stats?.int).toBe(18);
      expect(npc.equipment).toContain('Spellbook');
    });

    it('should structure generated locations', () => {
      const location: GeneratedLocation = {
        name: 'The Whispering Woods',
        type: 'Forest',
        description: 'An ancient forest where the trees seem to murmur secrets',
        features: ['Ancient oak trees', 'Hidden clearings', 'Stone circles'],
        inhabitants: ['Wood elves', 'Awakened trees', 'Forest spirits'],
        hooks: ['Missing travelers', 'Strange lights at night'],
        connections: ['Village of Millbrook', 'The Old Road'],
      };

      expect(location.name).toBe('The Whispering Woods');
      expect(location.features).toContain('Ancient oak trees');
      expect(location.hooks).toContain('Missing travelers');
    });

    it('should structure generated quests', () => {
      const quest: GeneratedQuest = {
        title: 'The Lost Artifact',
        type: 'main',
        giver: 'Elder Thornwick',
        description: 'Retrieve the stolen Crystal of Ages from the goblin caves',
        objectives: [
          'Find the goblin cave entrance',
          'Navigate the cave system',
          'Defeat the goblin chief',
          'Recover the Crystal of Ages',
        ],
        rewards: ['500 gold pieces', 'Magic weapon', 'Village recognition'],
        complications: ['Cave-ins', 'Additional goblin reinforcements'],
        timeLimit: '3 days before the ritual',
      };

      expect(quest.title).toBe('The Lost Artifact');
      expect(quest.type).toBe('main');
      expect(quest.objectives).toHaveLength(4);
      expect(quest.rewards).toContain('Magic weapon');
      expect(quest.complications).toContain('Cave-ins');
    });
  });
});
