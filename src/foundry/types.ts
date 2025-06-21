/**
 * @fileoverview TypeScript type definitions for FoundryVTT data structures
 *
 * This module contains comprehensive type definitions for all FoundryVTT entities
 * including actors, items, scenes, tokens, and other game objects. These types
 * provide type safety and intellisense when working with FoundryVTT data.
 *
 * @version 0.1.0
 * @author FoundryVTT MCP Team
 * @see {@link https://foundryvtt.com/api/} FoundryVTT API Documentation
 */

// FoundryVTT Data Types

/**
 * Represents an actor (character, NPC, or creature) in FoundryVTT
 *
 * Actors are the primary entities that represent characters, NPCs, monsters,
 * and other creatures in the game world. This interface covers the common
 * properties shared across different game systems.
 *
 * @interface FoundryActor
 * @example
 * ```typescript
 * const hero: FoundryActor = {
 *   _id: 'actor-123',
 *   name: 'Aragorn',
 *   type: 'character',
 *   hp: { value: 45, max: 45 },
 *   ac: { value: 16 },
 *   level: 5
 * };
 * ```
 */
export interface FoundryActor {
  _id: string;
  name: string;
  type: string;
  img?: string;
  data?: any;
  // Common actor properties
  hp?: {
    value: number;
    max: number;
    temp?: number;
  };
  ac?: {
    value: number;
  };
  attributes?: Record<string, any>;
  abilities?: Record<string, {
    value: number;
    mod: number;
    save?: number;
  }>;
  skills?: Record<string, {
    value: number;
    mod: number;
    proficient?: boolean;
  }>;
  level?: number;
  experience?: {
    value: number;
    max: number;
  };
  currency?: Record<string, number>;
  biography?: string;
  notes?: string;
}

/**
 * Represents an item (weapon, armor, spell, etc.) in FoundryVTT
 *
 * Items represent equipment, spells, features, and other objects that can be
 * owned by actors or exist independently in the game world.
 *
 * @interface FoundryItem
 * @example
 * ```typescript
 * const sword: FoundryItem = {
 *   _id: 'item-456',
 *   name: 'Longsword +1',
 *   type: 'weapon',
 *   rarity: 'uncommon',
 *   damage: { parts: [['1d8+1', 'slashing']] },
 *   price: { value: 315, denomination: 'gp' }
 * };
 * ```
 */
export interface FoundryItem {
  _id: string;
  name: string;
  type: string;
  img?: string;
  data?: any;
  // Common item properties
  description?: string;
  rarity?: string;
  price?: {
    value: number;
    denomination: string;
  };
  weight?: number;
  quantity?: number;
  equipped?: boolean;
  identified?: boolean;
  // Weapon properties
  damage?: {
    parts: Array<[string, string]>;
    versatile?: string;
  };
  range?: {
    value: number;
    long?: number;
    units: string;
  };
  // Armor properties
  armor?: {
    value: number;
    type: string;
    dex?: number;
  };
  // Spell properties
  level?: number;
  school?: string;
  components?: {
    vocal: boolean;
    somatic: boolean;
    material: boolean;
    value?: string;
  };
  duration?: {
    value: number;
    units: string;
  };
  itemRange?: {
    value: number;
    units: string;
  };
}

/**
 * Represents a scene (map/battleground) in FoundryVTT
 *
 * Scenes are the visual environments where gameplay takes place, containing
 * background images, tokens, lighting, walls, and other elements.
 *
 * @interface FoundryScene
 * @example
 * ```typescript
 * const dungeon: FoundryScene = {
 *   _id: 'scene-789',
 *   name: 'Ancient Tomb',
 *   active: true,
 *   width: 4000,
 *   height: 3000,
 *   grid: { size: 100, type: 1 }
 * };
 * ```
 */
export interface FoundryScene {
  _id: string;
  name: string;
  active: boolean;
  navigation: boolean;
  img?: string;
  background?: string;
  width: number;
  height: number;
  padding: number;
  initial?: {
    x: number;
    y: number;
    scale: number;
  };
  grid?: {
    type: number;
    size: number;
    color: string;
    alpha: number;
    distance: number;
    units: string;
  };
  shiftX: number;
  shiftY: number;
  description?: string;
  notes?: string;
  weather?: string;
  environment?: string;
  // Scene lighting
  globalLight: boolean;
  globalLightThreshold?: number;
  darkness: number;
  // Tokens and objects on the scene
  tokens?: FoundryToken[];
  walls?: FoundryWall[];
  lights?: FoundryLight[];
  sounds?: FoundrySound[];
  drawings?: FoundryDrawing[];
}

/**
 * Represents a token on a scene in FoundryVTT
 *
 * Tokens are the visual representations of actors placed on scenes.
 * They contain position, appearance, and gameplay-related information.
 *
 * @interface FoundryToken
 * @example
 * ```typescript
 * const heroToken: FoundryToken = {
 *   _id: 'token-123',
 *   name: 'Aragorn',
 *   x: 1000,
 *   y: 1500,
 *   actorId: 'actor-123',
 *   disposition: 1 // friendly
 * };
 * ```
 */
export interface FoundryToken {
  _id: string;
  name: string;
  img: string;
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
  rotation: number;
  actorId?: string;
  actorLink: boolean;
  disposition: number; // -1: hostile, 0: neutral, 1: friendly
  hidden: boolean;
  vision: boolean;
  dimSight: number;
  brightSight: number;
  // Token bars (usually HP, resources)
  bar1?: {
    attribute: string;
  };
  bar2?: {
    attribute: string;
  };
  // Status effects
  effects?: string[];
}

/**
 * Represents a wall segment in a FoundryVTT scene
 *
 * Walls control movement, vision, and sound propagation in scenes.
 * They define the physical boundaries and obstacles in the environment.
 *
 * @interface FoundryWall
 */
export interface FoundryWall {
  _id: string;
  c: [number, number, number, number]; // [x1, y1, x2, y2]
  move: number; // Movement restriction
  sense: number; // Vision restriction
  sound: number; // Sound restriction
  door: number; // Door type
  ds: number; // Door state
}

/**
 * Represents a light source in a FoundryVTT scene
 *
 * Light sources provide illumination and create atmospheric effects
 * in scenes, affecting token vision and creating ambiance.
 *
 * @interface FoundryLight
 */
export interface FoundryLight {
  _id: string;
  x: number;
  y: number;
  rotation: number;
  config: {
    bright: number;
    dim: number;
    angle: number;
    color?: string;
    alpha: number;
    animation?: {
      type: string;
      speed: number;
      intensity: number;
    };
  };
  hidden: boolean;
}

/**
 * Represents an ambient sound in a FoundryVTT scene
 *
 * Sound objects provide audio atmosphere and effects in scenes,
 * with positional audio and volume controls.
 *
 * @interface FoundrySound
 */
export interface FoundrySound {
  _id: string;
  x: number;
  y: number;
  radius: number;
  path: string;
  repeat: boolean;
  volume: number;
  hidden: boolean;
}

/**
 * Represents a drawing/annotation in a FoundryVTT scene
 *
 * Drawings allow GMs and players to add visual annotations,
 * shapes, and text directly onto scenes.
 *
 * @interface FoundryDrawing
 */
export interface FoundryDrawing {
  _id: string;
  type: string; // rectangle, ellipse, polygon, freehand, text
  x: number;
  y: number;
  width?: number;
  height?: number;
  points?: number[];
  shape?: any;
  fillType: number;
  fillColor?: string;
  strokeWidth: number;
  strokeColor?: string;
  text?: string;
  fontSize?: number;
  fontFamily?: string;
  textColor?: string;
  hidden: boolean;
  locked: boolean;
}

/**
 * Represents world information in FoundryVTT
 *
 * Contains metadata about the current game world including
 * system information, modules, and world settings.
 *
 * @interface FoundryWorld
 * @example
 * ```typescript
 * const world: FoundryWorld = {
 *   id: 'my-campaign',
 *   title: 'Adventures in Middle-earth',
 *   system: 'dnd5e',
 *   coreVersion: '11.315',
 *   playtime: 144000 // in seconds
 * };
 * ```
 */
export interface FoundryWorld {
  id: string;
  title: string;
  description: string;
  system: string;
  coreVersion: string;
  systemVersion: string;
  lastPlayed?: string;
  playtime: number;
  created: string;
  modified: string;
  // World settings
  background?: string;
  nextSession?: string;
  // Active modules
  modules?: Array<{
    id: string;
    title: string;
    active: boolean;
  }>;
}

export interface FoundryJournal {
  _id: string;
  name: string;
  content: string;
  img?: string;
  folder?: string;
  permission: Record<string, number>;
  // Journal entry metadata
  pages?: Array<{
    name: string;
    type: string; // text, image, pdf, video
    title: string;
    content?: string;
    src?: string;
  }>;
}

export interface FoundryMacro {
  _id: string;
  name: string;
  type: string; // script, chat
  scope: string; // global, actors, items
  command: string;
  img?: string;
  folder?: string;
  // Macro execution context
  author: string;
  ownership: Record<string, number>;
}

export interface FoundryPlaylist {
  _id: string;
  name: string;
  description?: string;
  mode: number; // 0: disabled, 1: sequential, 2: shuffle, 3: simultaneous
  playing: boolean;
  fade: number;
  folder?: string;
  sounds: Array<{
    _id: string;
    name: string;
    path: string;
    playing: boolean;
    repeat: boolean;
    volume: number;
    fade: number;
  }>;
}

export interface FoundryCombat {
  _id: string;
  scene?: string;
  active: boolean;
  round: number;
  turn: number;
  started: boolean;
  // Combat participants
  combatants: Array<{
    _id: string;
    tokenId: string;
    actorId?: string;
    name: string;
    img?: string;
    initiative?: number;
    hidden: boolean;
    defeated: boolean;
  }>;
  settings: {
    resource?: string;
    skipDefeated: boolean;
  };
}

/**
 * Represents the result of a dice roll in FoundryVTT
 *
 * Contains all information about a completed dice roll including
 * the formula used, total result, breakdown, and metadata.
 *
 * @interface DiceRoll
 * @example
 * ```typescript
 * const attackRoll: DiceRoll = {
 *   formula: '1d20+5',
 *   total: 18,
 *   breakdown: '13 + 5',
 *   reason: 'Sword attack',
 *   timestamp: '2024-01-15T10:30:00Z'
 * };
 * ```
 */
export interface DiceRoll {
  formula: string;
  total: number;
  breakdown: string;
  reason?: string;
  timestamp: string;
}

export interface FoundryUser {
  _id: string;
  name: string;
  role: number; // 1: Player, 2: Trusted Player, 3: Assistant GM, 4: GM
  active: boolean;
  color: string;
  avatar?: string;
  character?: string; // Actor ID
  // User permissions
  permissions: Record<string, boolean>;
}

// Search and filter interfaces
/**
 * Result structure for actor search operations
 *
 * Contains paginated search results for actor queries
 * along with metadata about the search.
 *
 * @interface ActorSearchResult
 * @example
 * ```typescript
 * const searchResult: ActorSearchResult = {
 *   actors: [],
 *   total: 25,
 *   page: 1,
 *   limit: 10
 * };
 * ```
 */
export interface ActorSearchResult {
  actors: FoundryActor[];
  total: number;
  page: number;
  limit: number;
}

/**
 * Result structure for item search operations
 *
 * Contains paginated search results for item queries
 * along with metadata about the search.
 *
 * @interface ItemSearchResult
 * @example
 * ```typescript
 * const searchResult: ItemSearchResult = {
 *   items: [],
 *   total: 42,
 *   page: 1,
 *   limit: 20
 * };
 * ```
 */
export interface ItemSearchResult {
  items: FoundryItem[];
  total: number;
  page: number;
  limit: number;
}

// API Response types
/**
 * Generic API response structure for FoundryVTT REST API
 *
 * Standardized response format for API calls including
 * success status, data payload, and error information.
 *
 * @interface FoundryAPIResponse
 * @template T - Type of the response data
 * @example
 * ```typescript
 * const response: FoundryAPIResponse<FoundryActor[]> = {
 *   success: true,
 *   data: [],
 *   message: 'Actors retrieved successfully'
 * };
 * ```
 */
export interface FoundryAPIResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

// WebSocket message types
/**
 * Structure for WebSocket messages exchanged with FoundryVTT
 *
 * Defines the format for real-time communication messages
 * between the MCP server and FoundryVTT.
 *
 * @interface FoundryWebSocketMessage
 * @example
 * ```typescript
 * const message: FoundryWebSocketMessage = {
 *   type: 'combatUpdate',
 *   data: { round: 3, turn: 2 },
 *   user: 'user-123',
 *   timestamp: '2024-01-15T10:30:00Z'
 * };
 * ```
 */
export interface FoundryWebSocketMessage {
  type: string;
  data?: any;
  user?: string;
  timestamp: string;
}

// Content generation types
/**
 * Structure for AI-generated NPC data
 *
 * Contains all information needed to create a complete NPC
 * including personality, appearance, and background details.
 *
 * @interface GeneratedNPC
 * @example
 * ```typescript
 * const npc: GeneratedNPC = {
 *   name: 'Thorin Ironforge',
 *   race: 'Dwarf',
 *   class: 'Fighter',
 *   personality: ['Gruff but loyal', 'Speaks little but acts decisively'],
 *   appearance: 'Short and stocky with a magnificent braided beard',
 *   motivations: ['Protect the clan honor', 'Forge the perfect weapon']
 * };
 * ```
 */
export interface GeneratedNPC {
  name: string;
  race: string;
  class?: string;
  level?: number;
  background?: string;
  personality: string[];
  appearance: string;
  motivations: string[];
  stats?: Record<string, number>;
  equipment?: string[];
}

export interface GeneratedLocation {
  name: string;
  type: string;
  description: string;
  features: string[];
  inhabitants?: string[];
  hooks?: string[];
  connections?: string[];
}

export interface GeneratedQuest {
  title: string;
  type: string; // main, side, personal, urgent
  giver: string;
  description: string;
  objectives: string[];
  rewards: string[];
  complications?: string[];
  timeLimit?: string;
}
