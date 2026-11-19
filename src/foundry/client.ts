/**
 * Compatibility exports for existing embedders and historical tests.
 * Application code uses provider interfaces and the session manager.
 */
export { DocumentProvider as FoundryClient } from '../providers/document-provider.js';
export type {
  AttributePatch,
  CompendiumSearchParams,
  FoundryClientConfig,
  SearchActorsParams,
  SearchItemsParams,
} from '../providers/types.js';
export { probeRestModule } from './rest-probe.js';
