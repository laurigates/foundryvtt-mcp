import { DocumentProvider } from './document-provider.js';
import type { LegacyRestProviderConfig } from './types.js';

/** Historical /api/* contract, deliberately separate from the ThreeHats relay. */
export class LegacyRestProvider extends DocumentProvider {
  constructor(config: LegacyRestProviderConfig) {
    super(config);
  }
}
