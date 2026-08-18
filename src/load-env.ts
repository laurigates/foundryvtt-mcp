/**
 * Loads `.env` into `process.env` as an import side effect.
 *
 * Import this **first**, before any module that reads configuration. ESM
 * evaluates a module's dependencies before its own body, so calling
 * `dotenv.config()` in an entrypoint's body runs *after* every imported module
 * has already been evaluated. `utils/logger.ts` builds its logger at module
 * scope from `config.logLevel`, which resolves the whole config eagerly — so
 * the entrypoint-body form validated configuration before `.env` was read, and
 * a `.env` in the working directory had no effect at all (#206).
 */

import dotenv from 'dotenv';

dotenv.config({ quiet: true });
