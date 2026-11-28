import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { resolveTransportPlan } from '../foundry/transport.js';
import type {
  ProviderConfig,
  RestApiProviderConfig,
  SocketIOProviderConfig,
} from '../providers/types.js';

const HttpUrl = z
  .string()
  .url()
  .refine(
    (value) => ['http:', 'https:'].includes(new URL(value).protocol),
    'Expected an HTTP(S) URL',
  );
const SocketProviderSchema = z
  .object({
    kind: z.literal('socketio'),
    baseUrl: HttpUrl,
    username: z.string().optional(),
    password: z.string().optional(),
    userId: z.string().optional(),
    restUrl: HttpUrl.optional(),
    restApiKey: z.string().min(1).optional(),
    socketPath: z.string().default('/socket.io/'),
    timeout: z.number().int().positive().default(10000),
    retryAttempts: z.number().int().nonnegative().default(3),
    retryDelay: z.number().int().nonnegative().default(1000),
  })
  .strict();
const LegacyRestProviderSchema = SocketProviderSchema.omit({
  restUrl: true,
  restApiKey: true,
}).extend({
  kind: z.literal('legacy-rest'),
  apiKey: z.string().min(1),
});
const RestApiProviderSchema = z
  .object({
    kind: z.literal('rest-api'),
    relayUrl: HttpUrl,
    apiKey: z.string().min(1),
    clientId: z.string().min(1),
    executeJsPath: z.string().startsWith('/').optional(),
    timeout: z.number().int().positive().default(10000),
    expectedWorldId: z.string().min(1).optional(),
    expectedOrigin: HttpUrl.optional(),
  })
  .strict();

const ProviderConfigSchema = z.discriminatedUnion('kind', [
  SocketProviderSchema,
  LegacyRestProviderSchema,
  RestApiProviderSchema,
  z
    .object({
      kind: z.literal('composite'),
      core: SocketProviderSchema,
      execution: RestApiProviderSchema,
    })
    .strict(),
]);

const TargetSchema = z
  .object({
    id: z
      .string()
      .regex(
        /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/,
        'Target IDs must be nonempty URL-safe identifiers',
      ),
    label: z.string().min(1).optional(),
    provider: ProviderConfigSchema,
    expectedWorldId: z.string().min(1).optional(),
    expectedOrigin: HttpUrl.optional(),
    writeEnabled: z.boolean().default(false),
    integrationsEnabled: z.boolean().default(true),
  })
  .strict()
  .superRefine((target, ctx) => {
    const socket =
      target.provider.kind === 'composite'
        ? target.provider.core
        : target.provider.kind === 'socketio'
          ? target.provider
          : undefined;
    if (socket && Boolean(socket.restUrl) !== Boolean(socket.restApiKey)) {
      ctx.addIssue({
        code: 'custom',
        path: ['provider'],
        message: 'Socket.IO bridge augmentation requires both restUrl and restApiKey',
      });
    }
    if (socket?.restUrl && !((socket.username || socket.userId) && socket.password)) {
      ctx.addIssue({
        code: 'custom',
        path: ['provider'],
        message: 'Socket.IO bridge augmentation requires native username or userId and password',
      });
    }
    if (
      target.provider.kind === 'composite' &&
      !target.expectedWorldId &&
      !target.provider.execution.expectedWorldId
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['expectedWorldId'],
        message: 'Composite targets require expectedWorldId to bind both connections to one world',
      });
    }
    const execution =
      target.provider.kind === 'composite'
        ? target.provider.execution
        : target.provider.kind === 'rest-api'
          ? target.provider
          : undefined;
    if (
      execution &&
      target.expectedWorldId &&
      execution.expectedWorldId &&
      target.expectedWorldId !== execution.expectedWorldId
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['expectedWorldId'],
        message: 'Target and provider expectedWorldId values must agree',
      });
    }
    if (
      execution &&
      target.expectedOrigin &&
      execution.expectedOrigin &&
      new URL(target.expectedOrigin).origin !== new URL(execution.expectedOrigin).origin
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['expectedOrigin'],
        message: 'Target and provider expectedOrigin values must agree',
      });
    }
  });

/** A relay target may declare its world on the provider instead of on the target. */
function providerWorldId(provider: z.infer<typeof ProviderConfigSchema>): string | undefined {
  if (provider.kind === 'rest-api') {
    return provider.expectedWorldId;
  }
  if (provider.kind === 'composite') {
    return provider.execution.expectedWorldId;
  }
  return undefined;
}

const TargetsFileSchema = z
  .object({ version: z.literal(1).default(1), targets: z.array(TargetSchema).min(1) })
  .strict()
  .superRefine((file, ctx) => {
    // A single target keeps the historical behaviour of pinning the world seen on
    // its first connection. With several targets an inferred identity could route
    // a write to the wrong world, so the configuration has to declare it.
    if (file.targets.length <= 1) {
      return;
    }
    file.targets.forEach((target, index) => {
      if (target.expectedWorldId || providerWorldId(target.provider)) {
        return;
      }
      ctx.addIssue({
        code: 'custom',
        path: ['targets', index, 'expectedWorldId'],
        message:
          'Every target in a multi-target configuration must declare expectedWorldId; world identity comes from configuration, not from the first world observed',
      });
    });
  });

export interface TargetConfig {
  id: string;
  label?: string;
  provider: ProviderConfig;
  expectedWorldId?: string;
  expectedOrigin?: string;
  writeEnabled: boolean;
  integrationsEnabled: boolean;
}

export interface LegacyFoundryConfig {
  url: string;
  apiKey?: string | undefined;
  restUrl?: string | undefined;
  username?: string | undefined;
  password?: string | undefined;
  userId?: string | undefined;
  socketPath: string;
  timeout: number;
  retryAttempts: number;
  retryDelay: number;
  writeEnabled: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Resolve only explicitly declared credential references. Never interpolate arbitrary JSON. */
function resolveProviderSecrets(input: unknown, env: NodeJS.ProcessEnv): unknown {
  if (!isRecord(input)) {
    return input;
  }
  const result = { ...input };
  for (const field of ['username', 'password', 'apiKey', 'restApiKey']) {
    const reference = result[`${field}Env`];
    if (reference === undefined) {
      continue;
    }
    if (result[field] !== undefined) {
      throw new Error(
        `Provider ${field} cannot specify both a literal and an environment reference`,
      );
    }
    if (typeof reference !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(reference)) {
      throw new Error(`Invalid environment reference for provider ${field}`);
    }
    const value = env[reference];
    if (!value) {
      throw new Error(`Environment variable ${reference} is required for provider ${field}`);
    }
    result[field] = value;
    delete result[`${field}Env`];
  }
  if (result.kind === 'composite') {
    result.core = resolveProviderSecrets(result.core, env);
    result.execution = resolveProviderSecrets(result.execution, env);
  }
  return result;
}

function socketConfig(
  input: z.infer<typeof SocketProviderSchema>,
  writeEnabled: boolean,
): SocketIOProviderConfig {
  return {
    kind: 'socketio',
    baseUrl: input.baseUrl,
    socketPath: input.socketPath,
    timeout: input.timeout,
    retryAttempts: input.retryAttempts,
    retryDelay: input.retryDelay,
    writeEnabled,
    ...(input.username !== undefined ? { username: input.username } : {}),
    ...(input.password !== undefined ? { password: input.password } : {}),
    ...(input.userId !== undefined ? { userId: input.userId } : {}),
    ...(input.restUrl !== undefined ? { restUrl: input.restUrl } : {}),
    ...(input.restApiKey !== undefined ? { restApiKey: input.restApiKey } : {}),
  };
}

function relayConfig(
  input: z.infer<typeof RestApiProviderSchema>,
  target: z.infer<typeof TargetSchema>,
): RestApiProviderConfig {
  const worldId = target.expectedWorldId ?? input.expectedWorldId;
  const origin = target.expectedOrigin ?? input.expectedOrigin;
  return {
    kind: 'rest-api',
    relayUrl: input.relayUrl,
    apiKey: input.apiKey,
    clientId: input.clientId,
    timeout: input.timeout,
    writeEnabled: target.writeEnabled,
    ...(input.executeJsPath !== undefined ? { executeJsPath: input.executeJsPath } : {}),
    ...(worldId !== undefined ? { expectedWorldId: worldId } : {}),
    ...(origin !== undefined ? { expectedOrigin: origin } : {}),
  };
}

function parseTargets(input: unknown, env: NodeJS.ProcessEnv): TargetConfig[] {
  const wrapped: unknown = Array.isArray(input) ? { version: 1, targets: input } : input;
  let resolved = wrapped;
  if (isRecord(wrapped) && Array.isArray(wrapped.targets)) {
    resolved = {
      ...wrapped,
      targets: wrapped.targets.map((target: unknown) => {
        if (!isRecord(target)) {
          return target;
        }
        return {
          ...target,
          provider: resolveProviderSecrets(target.provider, env),
        };
      }),
    };
  }
  const parsed = TargetsFileSchema.parse(resolved);
  const ids = new Set<string>();
  return parsed.targets.map((target) => {
    if (ids.has(target.id)) {
      throw new Error(`Duplicate target ID: ${target.id}`);
    }
    ids.add(target.id);
    const provider: ProviderConfig =
      target.provider.kind === 'composite'
        ? {
            kind: 'composite',
            core: socketConfig(target.provider.core, target.writeEnabled),
            execution: relayConfig(target.provider.execution, target),
          }
        : target.provider.kind === 'rest-api'
          ? relayConfig(target.provider, target)
          : target.provider.kind === 'legacy-rest'
            ? {
                ...socketConfig({ ...target.provider, kind: 'socketio' }, target.writeEnabled),
                kind: 'legacy-rest',
                apiKey: target.provider.apiKey,
              }
            : socketConfig(target.provider, target.writeEnabled);
    return {
      id: target.id,
      provider,
      writeEnabled: target.writeEnabled,
      integrationsEnabled: target.integrationsEnabled,
      ...(target.label !== undefined ? { label: target.label } : {}),
      ...(target.expectedWorldId !== undefined ? { expectedWorldId: target.expectedWorldId } : {}),
      ...(target.expectedOrigin !== undefined ? { expectedOrigin: target.expectedOrigin } : {}),
    };
  });
}

/** Return undefined when the existing single-world environment configuration should be used. */
export function loadTargetConfiguration(
  env: NodeJS.ProcessEnv = process.env,
): TargetConfig[] | undefined {
  const inline = env.FOUNDRY_TARGETS_JSON;
  const path = env.FOUNDRY_TARGETS_FILE;
  if (inline !== undefined && path !== undefined) {
    throw new Error('Configure either FOUNDRY_TARGETS_JSON or FOUNDRY_TARGETS_FILE, not both');
  }
  if (inline === undefined && path === undefined) {
    return undefined;
  }
  let input: unknown;
  try {
    input = JSON.parse(inline ?? readFileSync(path ?? '', 'utf8'));
  } catch {
    // JSON parsers may echo an offending token. Do not expose credential-bearing input.
    throw new Error(
      `Unable to read target configuration from ${inline !== undefined ? 'FOUNDRY_TARGETS_JSON' : 'FOUNDRY_TARGETS_FILE'}: expected readable JSON`,
    );
  }
  return parseTargets(input, env);
}

/** Compatibility conversion only: existing variables describe exactly one target. */
export function normalizeLegacyTarget(
  foundry: LegacyFoundryConfig,
  env: NodeJS.ProcessEnv = process.env,
): TargetConfig {
  const { url, apiKey, restUrl, writeEnabled, ...socket } = foundry;
  const plan = resolveTransportPlan(foundry);
  const kind = env.FOUNDRY_PROVIDER ?? (plan.mode === 'rest' ? 'legacy-rest' : 'socketio');
  const direct = {
    kind: 'socketio',
    baseUrl: url,
    ...socket,
    ...(plan.mode === 'dual' ? { restUrl, restApiKey: apiKey } : {}),
  };
  const relay = {
    kind: 'rest-api',
    relayUrl: env.FOUNDRY_REST_RELAY_URL,
    apiKey: env.FOUNDRY_REST_API_KEY,
    clientId: env.FOUNDRY_REST_CLIENT_ID,
    timeout: foundry.timeout,
    ...(env.FOUNDRY_REST_EXECUTE_JS_PATH
      ? { executeJsPath: env.FOUNDRY_REST_EXECUTE_JS_PATH }
      : {}),
  };
  let provider: unknown;
  if (kind === 'socketio') {
    provider = direct;
  } else if (kind === 'legacy-rest') {
    provider = { kind, baseUrl: plan.restBaseUrl ?? url, ...socket, apiKey };
  } else if (kind === 'rest-api') {
    provider = relay;
  } else if (kind === 'composite') {
    provider = { kind, core: direct, execution: relay };
  } else {
    throw new Error(`Unsupported FOUNDRY_PROVIDER: ${kind}`);
  }
  const [target] = parseTargets(
    [
      {
        id: env.FOUNDRY_TARGET_ID ?? 'default',
        provider,
        writeEnabled,
        ...(env.FOUNDRY_EXPECTED_WORLD_ID
          ? { expectedWorldId: env.FOUNDRY_EXPECTED_WORLD_ID }
          : {}),
        ...(env.FOUNDRY_EXPECTED_ORIGIN ? { expectedOrigin: env.FOUNDRY_EXPECTED_ORIGIN } : {}),
      },
    ],
    env,
  );
  if (!target) {
    throw new Error('A default target could not be configured');
  }
  return target;
}

/** This projection exists for old configuration consumers, never for target selection. */
export function legacyConfigForTarget(target: TargetConfig): LegacyFoundryConfig {
  const provider = target.provider.kind === 'composite' ? target.provider.core : target.provider;
  return {
    url: provider.kind === 'rest-api' ? provider.relayUrl : provider.baseUrl,
    socketPath:
      provider.kind === 'rest-api' ? '/socket.io/' : (provider.socketPath ?? '/socket.io/'),
    timeout: provider.timeout ?? 10000,
    retryAttempts: provider.kind === 'rest-api' ? 0 : (provider.retryAttempts ?? 3),
    retryDelay: provider.kind === 'rest-api' ? 0 : (provider.retryDelay ?? 1000),
    writeEnabled: target.writeEnabled,
    ...(provider.kind === 'socketio' && provider.restApiKey !== undefined
      ? { apiKey: provider.restApiKey, restUrl: provider.restUrl }
      : 'apiKey' in provider
        ? { apiKey: provider.apiKey }
        : {}),
    ...('username' in provider && provider.username !== undefined
      ? { username: provider.username }
      : {}),
    ...('password' in provider && provider.password !== undefined
      ? { password: provider.password }
      : {}),
    ...('userId' in provider && provider.userId !== undefined ? { userId: provider.userId } : {}),
  };
}
