# Contributing

## Before You Start

- **Read the architecture boundaries** in [AGENTS.md](AGENTS.md) and the ADRs
  they link ([`docs/adrs/`](docs/adrs/README.md)). They apply to human and
  AI-assisted contributions alike. In short: Socket.IO is the primary
  transport and carries every write; the companion bridge
  [laurigates/foundryvtt-local-rest-api](https://github.com/laurigates/foundryvtt-local-rest-api)
  is the augment; code that runs inside Foundry is a named operation in a
  companion module, never arbitrary JavaScript; `src/foundry/capabilities.ts`
  is the one capability table; the server is Node only
  ([ADR-011](docs/adrs/0011-dual-mode-transport.md),
  [ADR-015](docs/adrs/0015-extension-boundaries.md)).
- **Discuss design changes first.** A change to transports, the capability
  model, the runtime or the extension format starts as an issue, or a draft
  PR containing only an ADR, before code.
- **Branch from current `main`.** A long-lived branch that conflicts with
  `main` will be asked to restart from it rather than be rebased.

## Pull Request Size

- **One concern per PR**: a bug fix, a feature slice, or a refactor, not a
  mix. Split a large change into a sequence that each builds and passes on
  its own.
- Keep a PR small enough to review in one sitting. Generated files and
  lockfiles aside, a diff of thousands of lines is a sign it needs splitting.
- A PR that changes behaviour for existing configurations says so in its
  description, with what each existing configuration does afterwards.
- `just qa` passes before you ask for review. Claims about a live Foundry
  world say which build they ran on; "verified" means run, not read.

## Getting Started

1. Fork the repository
2. Create a feature branch from the latest upstream `main`: `git switch -c feature/amazing-feature upstream/main`
3. Make your changes and add tests
4. Commit: `git commit -m 'feat: add amazing feature'`
5. Push: `git push origin feature/amazing-feature`
6. Open a Pull Request

## Code Style

- TypeScript strict mode
- Follow existing naming conventions
- Add JSDoc comments for public APIs
- Write tests for new functionality
- Use [conventional commits](https://www.conventionalcommits.org/)

## Development

See [docs/guides/development.md](docs/guides/development.md) for project structure, testing, and build instructions.
