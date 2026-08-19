---
paths:
  - "src/index.ts"
  - "src/load-env.ts"
  - "src/config/**"
  - "src/utils/logger.ts"
  - "scripts/**"
---

# `dotenv.config()` in an Entrypoint's Body Is Already Too Late

ESM evaluates a module's **imports before its own body**. So an entrypoint
that imports its dependencies and *then* calls `dotenv.config()` has already
run every one of those modules against a `process.env` that never saw `.env`.
Any module reading configuration at **module scope** locks in the pre-dotenv
values, and nothing about the code looks wrong — the import is right there,
the dependency is installed, the call is present.

## The cost (real: issue #206, fixed in #210)

`src/index.ts` called `dotenv.config({ quiet: true })` in its body.
`src/utils/logger.ts` builds its logger at module scope:

```ts
export const logger = new Logger(config.logLevel);   // ← resolves the WHOLE config
```

`config` is a lazy Proxy, so it is only *meant* to resolve on first access —
but that access is this line, during import evaluation. Configuration was
therefore validated before `.env` was read, and startup died with
`Configuration validation failed` while the help text told the user to check
the `.env` file it had just ignored. `scripts/test-connection.ts` carried the
identical defect.

The reporter diagnosed it as a missing `dotenv` dependency. It was not:
`dotenv` has been imported since the initial commit and is in every published
tarball. **The symptom of "env file not loaded" is identical whether the
loader is absent or merely late** — which is why the wrong cause is the
natural guess.

## The rule

- **Load env via a side-effect import placed first**, not a call in the body:

  ```ts
  // Must precede every other import: see src/load-env.ts (#206).
  import './load-env.js';
  import { config } from './config/index.js';
  ```

  `src/load-env.ts` exists solely to call `dotenv.config()` at module scope.
  Imports are evaluated in source order, so anything below it sees a populated
  `process.env`.

- **Every entrypoint needs it** — `src/index.ts` and any runnable file under
  `scripts/`. A new script that reads config and forgets the import is the
  same bug again.

- **Be wary of module-scope config reads.** `logger.ts` is the one here; a new
  one re-arms the trap for any future entrypoint. Prefer resolving config
  inside a function.

## Verify it, and verify it the only way that works

A unit test cannot cover this: the defect is in module evaluation order **in a
real process**, and any test that imports the modules has already perturbed
that order. The gate is `bun run smoke:dotenv` (`scripts/smoke-dotenv.js`,
wired into `test.yml`), which spawns the built server from a scratch directory
whose only configuration is a `.env` file, with every `FOUNDRY_*` variable
stripped from the inherited environment.

**Strip the inherited variables, or the test passes for free** — an inherited
`FOUNDRY_URL` makes the server start whether or not the file was ever read,
which is exactly the false green this test exists to prevent. The test was
control-tested against the pre-fix entrypoint and fails there with the
reported error.

## When this bites elsewhere

Any ESM project (TypeScript or plain `"type": "module"`) whose entrypoint
loads env in its body. CommonJS hides it — `require()` is synchronous and
in-order, so the same code works — which is why the pattern survives being
copied out of older projects. The tell is a config error naming a variable
that is plainly present in `.env`.
