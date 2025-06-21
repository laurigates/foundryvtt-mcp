/**
 * @fileoverview Configuration management for FoundryVTT MCP Server
 *
 * This module handles loading and validating configuration from environment variables
 * using Zod schemas for type safety and runtime validation.
 *
 * @version 0.1.0
 * @author FoundryVTT MCP Team
 */

import { z } from 'zod';

/**
 * Zod schema for validating server configuration
 *
 * Defines the structure and validation rules for all configuration options,
 * including server settings, FoundryVTT connection details, and caching options.
 */
const ConfigSchema = z.object({
  serverName: z.string().default('foundry-mcp-server'),
  serverVersion: z.string().default('0.1.0'),
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  nodeEnv: z.enum(['development', 'production', 'test']).default('development'),

  foundry: z.object({
    url: z.string().url('Invalid FoundryVTT URL'),
    apiKey: z.string().optional(),
    username: z.string().optional(),
    password: z.string().optional(),
    socketPath: z.string().default('/socket.io/'),
    timeout: z.number().default(10000),
    retryAttempts: z.number().default(3),
    retryDelay: z.number().default(1000),
  }),

  cache: z.object({
    enabled: z.boolean().default(true),
    ttlSeconds: z.number().default(300), // 5 minutes
    maxSize: z.number().default(1000),
  }),
});

/**
 * TypeScript type derived from the ConfigSchema
 *
 * This type provides compile-time type checking for configuration objects
 * and ensures consistency between the schema and type definitions.
 */
type Config = z.infer<typeof ConfigSchema>;

/**
 * Loads and validates configuration from environment variables
 *
 * Reads configuration from process.env, applies defaults where appropriate,
 * and validates the result against the ConfigSchema. Exits the process
 * with error details if validation fails.
 *
 * @returns Validated configuration object
 * @throws Process exits with code 1 if validation fails
 * @example
 * ```typescript
 * const config = loadConfig();
 * console.log(`Server: ${config.serverName} v${config.serverVersion}`);
 * console.log(`FoundryVTT URL: ${config.foundry.url}`);
 * ```
 */
function loadConfig(): Config {
  const rawConfig = {
    serverName: process.env.MCP_SERVER_NAME,
    serverVersion: process.env.MCP_SERVER_VERSION,
    logLevel: process.env.LOG_LEVEL,
    nodeEnv: process.env.NODE_ENV,

    foundry: {
      url: process.env.FOUNDRY_URL,
      apiKey: process.env.FOUNDRY_API_KEY,
      username: process.env.FOUNDRY_USERNAME,
      password: process.env.FOUNDRY_PASSWORD,
      socketPath: process.env.FOUNDRY_SOCKET_PATH,
      timeout: process.env.FOUNDRY_TIMEOUT ? parseInt(process.env.FOUNDRY_TIMEOUT) : undefined,
      retryAttempts: process.env.FOUNDRY_RETRY_ATTEMPTS ? parseInt(process.env.FOUNDRY_RETRY_ATTEMPTS) : undefined,
      retryDelay: process.env.FOUNDRY_RETRY_DELAY ? parseInt(process.env.FOUNDRY_RETRY_DELAY) : undefined,
    },

    cache: {
      enabled: process.env.CACHE_ENABLED !== undefined ? process.env.CACHE_ENABLED === 'true' : undefined,
      ttlSeconds: process.env.CACHE_TTL_SECONDS ? parseInt(process.env.CACHE_TTL_SECONDS) : undefined,
      maxSize: process.env.CACHE_MAX_SIZE ? parseInt(process.env.CACHE_MAX_SIZE) : undefined,
    },
  };

  try {
    return ConfigSchema.parse(rawConfig);
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error('Configuration validation failed:');
      error.errors.forEach(err => {
        console.error(`  ${err.path.join('.')}: ${err.message}`);
      });
      console.error('\nPlease check your environment variables and .env file.');
    }
    process.exit(1);
  }
}

/**
 * Global configuration instance
 *
 * This is the main configuration object used throughout the application.
 * It's loaded once at module initialization and contains all validated settings.
 *
 * @example
 * ```typescript
 * import { config } from './config/index.js';
 *
 * console.log(`Connecting to ${config.foundry.url}`);
 * if (config.foundry.apiKey) {
 *   console.log('Using local REST API module with API key');
 * } else {
 *   console.log('Using WebSocket connection with username/password');
 * }
 * ```
 */
export const config = loadConfig();

/**
 * Export the Config type for use in other modules
 *
 * @example
 * ```typescript
 * import type { Config } from './config/index.js';
 *
 * function processConfig(cfg: Config) {
 *   // Process configuration
 * }
 * ```
 */
export type { Config };
