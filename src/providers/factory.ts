import { CompositeProvider } from './composite.js';
import { LegacyRestProvider } from './legacy-rest.js';
import { RestApiProvider } from './rest-api.js';
import { SocketIOProvider } from './socketio.js';
import type { FoundryProvider, ProviderConfig } from './types.js';

export function createProvider(config: ProviderConfig): FoundryProvider {
  switch (config.kind) {
    case 'socketio':
      return new SocketIOProvider(config);
    case 'legacy-rest':
      return new LegacyRestProvider(config);
    case 'rest-api':
      return new RestApiProvider(config);
    case 'composite':
      return new CompositeProvider(config);
  }
}
