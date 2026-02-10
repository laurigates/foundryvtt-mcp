/**
 * Resource definitions for FoundryVTT MCP Server
 */

export const resourceDefinitions = [
  {
    uri: 'foundry://actors',
    name: 'All Actors',
    description: 'List of all actors in the current world',
    mimeType: 'application/json',
  },
  {
    uri: 'foundry://items',
    name: 'All Items',
    description: 'List of all items in the current world',
    mimeType: 'application/json',
  },
  {
    uri: 'foundry://scenes',
    name: 'All Scenes',
    description: 'List of all scenes in the current world',
    mimeType: 'application/json',
  },
  {
    uri: 'foundry://scenes/current',
    name: 'Current Scene',
    description: 'Information about the currently active scene',
    mimeType: 'application/json',
  },
  {
    uri: 'foundry://journals',
    name: 'All Journals',
    description: 'List of all journal entries in the current world',
    mimeType: 'application/json',
  },
  {
    uri: 'foundry://users',
    name: 'Users',
    description: 'List of users and their online status',
    mimeType: 'application/json',
  },
  {
    uri: 'foundry://combat',
    name: 'Active Combat',
    description: 'Current active combat encounter state',
    mimeType: 'application/json',
  },
  {
    uri: 'foundry://world/settings',
    name: 'Game Settings',
    description: 'Current world and game system settings',
    mimeType: 'application/json',
  },
  {
    uri: 'foundry://system/diagnostics',
    name: 'System Diagnostics',
    description: 'System health and diagnostic information (requires REST API module)',
    mimeType: 'application/json',
  },
];

export function getAllResources() {
  return resourceDefinitions;
}
