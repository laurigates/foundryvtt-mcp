# `scripts/` Is Outside the Typecheck Surface — Smoke-Run It

`tsconfig.json` sets `include: ["src/**/*"]`, so **nothing under `scripts/`
is typechecked**. `bunx tsc --noEmit`, `just qa`, and CI all pass while a
helper script calls a nonexistent method or reads a property that doesn't
exist — the failure only appears at **runtime**, when you actually run the
script.

## The cost (real: PR #193)

`scripts/test-connection.ts` carried two latent bugs that the build never
caught because the file isn't in the `tsc` set:

| Bug | Why tsc would have caught it | Failed at |
|-----|------------------------------|-----------|
| `client.connectWebSocket()` | no such method on `FoundryClient` (it's `connect()`) | runtime → `is not a function` |
| `config.foundry.useRestModule` | property absent from the config type | runtime → silently `undefined`, drove wrong output |

Both shipped green through `just qa` and CI; only `bun run test-connection`
surfaced them.

## The habit

- **When editing anything under `scripts/`, run it** (`bun run <script>` /
  `bunx tsx scripts/<x>.ts`) before trusting it. The typechecker will not
  flag method/property typos there.
- **Don't assume `just qa` covers a script** — it covers `src/` only.

## Durable fix (preferred)

Bring `scripts/` into the typecheck surface so these fail at build, not
runtime. Either widen the main config or add a dedicated one:

```jsonc
// tsconfig.scripts.json
{ "extends": "./tsconfig.json", "include": ["scripts/**/*"] }
```

```just
# justfile — wire into qa
check-types-scripts:
    bunx tsc --noEmit -p tsconfig.scripts.json
```

Adding `scripts/` to the checked set will surface any remaining drift there
in one pass (expect a few fixes the first time) — that is the point.

## When this bites

Any repo whose `tsconfig` `include` is `src/**` while real, runnable code
lives in `scripts/`, `tools/`, `bin/`, or similar. The same gap applies to
the linter if its globs are `src`-only.
