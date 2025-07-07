/**
 * @fileoverview Resource definitions for FoundryVTT MCP Server
 * 
 * This module contains all resource schema definitions that provide
 * read-only access to FoundryVTT data.
 */

/**
 * Resource definitions for FoundryVTT data access
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
    uri: 'foundry://world/settings',
    name: 'Game Settings',
    description: 'Current world and game system settings',
    mimeType: 'application/json',
  },
  {
    uri: 'foundry://system/diagnostics',
    name: 'System Diagnostics',
    description: 'System health and diagnostic information',
    mimeType: 'application/json',
  },
];

/**
 * Get all resource definitions
 */
export function getAllResources() {
  return resourceDefinitions;
}