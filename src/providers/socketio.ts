import type { AxiosRequestConfig, AxiosResponse } from 'axios';
import { DocumentProvider } from './document-provider.js';
import { ProviderError } from './errors.js';
import type { FoundryClientConfig, SocketIOProviderConfig } from './types.js';

/** Native document access. Runtime module execution is a separate capability. */
export class SocketIOProvider extends DocumentProvider {
  constructor(config: SocketIOProviderConfig) {
    const native: FoundryClientConfig = { ...config };
    // A historical apiKey alone must never select a different provider.
    delete native.apiKey;
    if (config.restUrl !== undefined || config.restApiKey !== undefined) {
      if (!config.restUrl || !config.restApiKey) {
        throw new Error('The native provider requires restUrl and restApiKey together');
      }
      if (!(config.username || config.userId) || !config.password) {
        throw new Error('A native provider with a REST bridge still requires native credentials');
      }
      native.apiKey = config.restApiKey;
    }
    super(native);
  }

  override async get<T = unknown>(
    url: string,
    config?: AxiosRequestConfig,
  ): Promise<AxiosResponse<T>> {
    if (this.getTransportMode() === 'dual') {
      return this.restGet<T>(url, config);
    }
    throw new ProviderError(
      'unsupported_operation',
      'The native Socket.IO provider does not expose the historical HTTP diagnostics service',
    );
  }
}
