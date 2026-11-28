import { DocumentProvider } from './document-provider.js';
import type { LegacyRestProviderConfig } from './types.js';

/** Historical /api/* contract, deliberately separate from the ThreeHats relay. */
export class LegacyRestProvider extends DocumentProvider {
  constructor(config: LegacyRestProviderConfig) {
    const legacy = { ...config, baseUrl: config.restUrl ?? config.baseUrl };
    // An explicitly selected provider cannot be changed by unused native credentials.
    delete legacy.restUrl;
    delete legacy.username;
    delete legacy.userId;
    delete legacy.password;
    super(legacy);
  }
}
