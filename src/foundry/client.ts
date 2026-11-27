/**
 * Compatibility exports for existing embedders and historical tests.
 * Application code uses provider interfaces and the session manager.
 */
export {
  DocumentProvider as FoundryClient,
  overlayDerivedValues,
} from '../providers/document-provider.js';
export { worldActorToFoundry, worldItemToFoundry, worldInfoToFoundry } from './native-mappers.js';
export type {
  AttributePatch,
  CompendiumSearchParams,
  ConnectionReport,
  FoundryClientConfig,
  RestPause,
  RestState,
  SearchActorsParams,
  SearchItemsParams,
} from '../providers/types.js';
export { probeRestModule } from './rest-probe.js';
