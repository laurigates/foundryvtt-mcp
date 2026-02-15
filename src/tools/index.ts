/**
 * Tools module entry point
 */

// Export tool and resource definitions
export { getAllTools } from './definitions.js';
export * from './handlers/actors.js';
export * from './handlers/chat.js';
export * from './handlers/combat.js';
export * from './handlers/diagnostics.js';
// Export individual handlers for testing
export * from './handlers/dice.js';
export * from './handlers/generation.js';
export * from './handlers/items.js';
export * from './handlers/journals.js';
export * from './handlers/resources.js';
export * from './handlers/scenes.js';
export * from './handlers/users.js';
export * from './handlers/world.js';
export { getAllResources } from './resources.js';
// Export routing functions
export { routeResourceRequest, routeToolRequest } from './router.js';
