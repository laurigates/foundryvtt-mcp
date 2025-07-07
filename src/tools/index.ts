/**
 * @fileoverview Tools module entry point
 * 
 * Exports all tool definitions, handlers, and routing functionality
 * in a clean, organized interface.
 */

// Export tool and resource definitions
export { getAllTools } from './definitions.js';
export { getAllResources } from './resources.js';

// Export routing functions
export { routeToolRequest, routeResourceRequest } from './router.js';

// Export individual handlers for testing
export * from './handlers/dice.js';
export * from './handlers/actors.js';
export * from './handlers/items.js';
export * from './handlers/scenes.js';
export * from './handlers/generation.js';
export * from './handlers/diagnostics.js';
export * from './handlers/resources.js';
