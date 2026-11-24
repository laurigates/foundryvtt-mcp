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

/** An integer setting whose validation messages name its environment variable. */
function integerFromEnv(name: string) {
  const error = `${name} must be an integer`;
  return z.number({ error }).int({ error });
}

/**
 * Parse an integer environment variable. Anything other than an optionally
 * signed run of decimal digits becomes NaN, which the schema rejects;
 * parseInt would read '5abc' as 5 and '1.9' as 1 (#293).
 */
function parseIntegerEnv(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  return /^\s*[+-]?\d+\s*$/.test(value) ? Number(value) : Number.NaN;
}

/**
 * An optional http(s) URL setting whose validation messages name its
 * environment variable.
 */
function httpUrlFromEnv(name: string) {
  const error = `${name} must be an http:// or https:// URL`;
  return z.string({ error }).refine((value) => {
    try {
      const { protocol } = new URL(value);
      return protocol === 'http:' || protocol === 'https:';
    } catch {
      return false;
    }
  }, error);
}

/**
 * Zod schema for validating server configuration
 *
 * Defines the structure and validation rules for all configuration options,
 * including server settings, FoundryVTT connection details, and caching options.
 */
const ConfigSchema = z.object({
  serverName: z.string().default('foundryvtt-mcp'),
  serverVersion: z.string().default('0.1.0'),
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  nodeEnv: z.enum(['development', 'production', 'test']).default('development'),

  foundry: z.object({
    url: z
      .string()
      .url('Invalid FoundryVTT URL - must include protocol (http:// or https://)')
      .refine((url) => {
        try {
          const parsed = new URL(url);
          return parsed.protocol === 'http:' || parsed.protocol === 'https:';
        } catch {
          return false;
        }
      }, 'URL must use http:// or https:// protocol')
      .refine((url) => {
        try {
          const parsed = new URL(url);
          // Warning for localhost in production
          if (
            process.env.NODE_ENV === 'production' &&
            (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1')
          ) {
            console.warn('⚠️  Warning: Using localhost URL in production environment');
          }
          return true;
        } catch {
          return false;
        }
      }, 'URL validation failed'),
    apiKey: z.string().optional(),
    /**
     * The REST bridge server (foundryvtt-local-rest-api's Node server, :3030
     * by default). With FOUNDRY_API_KEY and Socket.IO credentials it enables
     * dual mode; see `src/foundry/transport.ts`.
     */
    restUrl: httpUrlFromEnv('FOUNDRY_REST_URL').optional(),
    username: z.string().optional(),
    password: z.string().optional(),
    userId: z.string().optional(),
    socketPath: z.string().default('/socket.io/'),
    timeout: integerFromEnv('FOUNDRY_TIMEOUT').default(10000),
    retryAttempts: integerFromEnv('FOUNDRY_RETRY_ATTEMPTS').default(3),
    retryDelay: integerFromEnv('FOUNDRY_RETRY_DELAY').default(1000),
    writeEnabled: z.boolean().default(false),
  }),

  cache: z.object({
    enabled: z.boolean().default(true),
    ttlSeconds: integerFromEnv('CACHE_TTL_SECONDS').default(300), // 5 minutes
    // A bound below 1 lets CacheService.set() insert past it (#267).
    maxSize: z
      .number({ error: 'CACHE_MAX_SIZE must be an integer of at least 1' })
      .int({ error: 'CACHE_MAX_SIZE must be an integer of at least 1' })
      .min(1, { error: 'CACHE_MAX_SIZE must be an integer of at least 1' })
      .default(1000),
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
 * and validates the result against the ConfigSchema. In test environments,
 * throws errors instead of exiting the process to allow proper test handling.
 *
 * @returns Validated configuration object
 * @throws Error in test environment, process exits with code 1 in production
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
      restUrl: process.env.FOUNDRY_REST_URL || undefined,
      username: process.env.FOUNDRY_USERNAME,
      password: process.env.FOUNDRY_PASSWORD,
      userId: process.env.FOUNDRY_USER_ID,
      socketPath: process.env.FOUNDRY_SOCKET_PATH,
      timeout: parseIntegerEnv(process.env.FOUNDRY_TIMEOUT),
      retryAttempts: parseIntegerEnv(process.env.FOUNDRY_RETRY_ATTEMPTS),
      retryDelay: parseIntegerEnv(process.env.FOUNDRY_RETRY_DELAY),
      writeEnabled:
        process.env.FOUNDRY_WRITE_ENABLED !== undefined
          ? process.env.FOUNDRY_WRITE_ENABLED === 'true'
          : undefined,
    },

    cache: {
      enabled:
        process.env.CACHE_ENABLED !== undefined ? process.env.CACHE_ENABLED === 'true' : undefined,
      ttlSeconds: parseIntegerEnv(process.env.CACHE_TTL_SECONDS),
      maxSize: parseIntegerEnv(process.env.CACHE_MAX_SIZE),
    },
  };

  try {
    return ConfigSchema.parse(rawConfig);
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error('❌ Configuration validation failed:');
      error.issues.forEach((err) => {
        console.error(`  ${err.path.join('.')}: ${err.message}`);

        // Provide specific guidance for common URL errors
        if (err.path.includes('url')) {
          console.error('  💡 URL Examples:');
          console.error('     • Local: http://localhost:30000');
          console.error('     • Reverse Proxy: https://foundry.example.com');
          console.error('     • Network IP: http://192.168.1.100:30000');
          console.error('     • Custom Port: https://foundry.example.com:8443');
        }
      });
      console.error('\n📋 Configuration Help:');
      console.error('  • Check your environment variables and .env file');
      console.error('  • Ensure FOUNDRY_URL includes protocol (http:// or https://)');
      console.error('  • For setup guidance, see: SETUP_GUIDE.md');
      console.error('  • Run the setup wizard: npm run setup');
    }

    // In test environment, throw error instead of exiting process
    if (process.env.NODE_ENV === 'test') {
      throw error;
    }

    process.exit(1);
  }
}

/**
 * Cached configuration instance
 */
let _config: Config | null = null;

/**
 * Gets the global configuration instance
 *
 * This loads and caches the configuration on first access, allowing tests
 * to set environment variables before triggering configuration validation.
 *
 * @returns Validated configuration object
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
export const config = new Proxy({} as Config, {
  get(_target, prop) {
    if (_config === null) {
      _config = loadConfig();
    }
    return _config[prop as keyof Config];
  },
});

/**
 * Resets the cached configuration - used for testing
 * @internal
 */
export function resetConfig(): void {
  _config = null;
}

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
