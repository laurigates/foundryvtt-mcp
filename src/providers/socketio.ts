import type { AxiosRequestConfig, AxiosResponse } from 'axios';
import { DocumentProvider } from './document-provider.js';
import { ProviderError } from './errors.js';
import type { FoundryClientConfig, SocketIOProviderConfig } from './types.js';

/** Native document access. Runtime module execution is a separate capability. */
export class SocketIOProvider extends DocumentProvider {
  constructor(config: SocketIOProviderConfig) {
    const native: FoundryClientConfig = { ...config };
    delete native.apiKey;
    super(native);
  }

  override async get<T = unknown>(
    _url: string,
    _config?: AxiosRequestConfig,
  ): Promise<AxiosResponse<T>> {
    throw new ProviderError(
      'unsupported_operation',
      'The native Socket.IO provider does not expose the historical HTTP diagnostics service',
    );
  }
}
