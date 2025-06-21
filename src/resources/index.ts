import { Resource } from '@modelcontextprotocol/sdk/types.js';

export const resourceDefinitions: Resource[] = [
  {
    uri: 'foundry://world/info',
    name: 'World Information',
    description: 'Current world/campaign information including title, system, and settings',
    mimeType: 'application/json'
  },

  {
    uri: 'foundry://world/actors',
    name: 'All Actors',
    description: 'Complete list of all actors in the world (characters, NPCs, monsters)',
    mimeType: 'application/json'
  },

  {
    uri: 'foundry://world/items',
    name: 'All Items',
    description: 'Complete list of all items, equipment, and spells in the world',
    mimeType: 'application/json'
  },

  {
    uri: 'foundry://world/scenes',
    name: 'All Scenes',
    description: 'List of all scenes/maps in the world',
    mimeType: 'application/json'
  },

  {
    uri: 'foundry://world/journals',
    name: 'Journal Entries',
    description: 'All journal entries, notes, and handouts',
    mimeType: 'application/json'
  },

  {
    uri: 'foundry://world/macros',
    name: 'Macros',
    description: 'Available macros and scripts',
    mimeType: 'application/json'
  },

  {
    uri: 'foundry://scene/current',
    name: 'Current Scene',
    description: 'Information about the currently active scene',
    mimeType: 'application/json'
  },

  {
    uri: 'foundry://combat/current',
    name: 'Current Combat',
    description: 'Active combat encounter state and initiative order',
    mimeType: 'application/json'
  },

  {
    uri: 'foundry://users/online',
    name: 'Online Users',
    description: 'Currently connected users and their status',
    mimeType: 'application/json'
  },

  {
    uri: 'foundry://system/info',
    name: 'Game System',
    description: 'Information about the current game system and its rules',
    mimeType: 'application/json'
  },

  {
    uri: 'foundry://compendium/spells',
    name: 'Spell Compendium',
    description: 'All available spells from compendium packs',
    mimeType: 'application/json'
  },

  {
    uri: 'foundry://compendium/monsters',
    name: 'Monster Compendium',
    description: 'All available monsters and NPCs from compendium packs',
    mimeType: 'application/json'
  },

  {
    uri: 'foundry://compendium/items',
    name: 'Item Compendium',
    description: 'All available items and equipment from compendium packs',
    mimeType: 'application/json'
  },

  {
    uri: 'foundry://playlists/all',
    name: 'Audio Playlists',
    description: 'All available audio playlists and currently playing tracks',
    mimeType: 'application/json'
  },

  {
    uri: 'foundry://settings/game',
    name: 'Game Settings',
    description: 'Current world and system settings configuration',
    mimeType: 'application/json'
  }
];
