# Documentation Automation Setup

This repository builds and deploys its documentation with one GitHub Actions workflow, `docs.yml`.

## 📋 Workflow

### `docs.yml` - GitHub Pages Deployment
- ✅ Deploys to GitHub Pages automatically
- ✅ Validates the docs build on pull requests (build only, no deploy)
- ✅ Clean URLs (e.g., `https://username.github.io/repo/`)
- ✅ Fast CDN delivery
- ✅ Automatic HTTPS
- ❌ Requires GitHub Pages to be enabled

**Setup:**
1. Go to Repository Settings → Pages
2. Set Source to "GitHub Actions"
3. The workflow deploys on every push to main (and on manual `workflow_dispatch`
   runs). Pull requests run the `build` job only — they check out, install, run
   TypeDoc and `bun run docs:check`, then stop; the Pages steps and the `deploy`
   job are skipped.

> **Branch protection:** do not add this workflow's `build` or `deploy` job as a
> required status check. Both `on:` triggers are `paths`-filtered, so a PR that
> touches nothing under `src/**`, `README.md`, `typedoc.json`, `package.json`, or
> this workflow never reports a status at all and a required check would wait
> forever. `deploy` is additionally *skipped* on pull requests by design.

## 🚀 Quick Start

### Use GitHub Pages
1. Enable GitHub Pages:
   - Go to **Settings** → **Pages**
   - Set Source to "GitHub Actions"
2. Documentation will be available at `https://[username].github.io/[repository]/`

## 🔧 Customization

### Modify Documentation Generation
Edit the TypeDoc command in `docs.yml`:
```yaml
npx typedoc src/foundry/client.ts src/foundry/types.ts src/config/index.ts src/utils/logger.ts \
  --out build/docs \
  --name "Your Custom Title" \
  --readme README.md \
  --skipErrorChecking \
  --cleanOutputDir
```

### Change Trigger Conditions
Modify the `on:` section in `docs.yml`:
```yaml
on:
  push:
    branches: [ main ]
    paths:
      - 'src/**'
      - 'README.md'
```

### Add More Files
Include additional TypeScript files in the documentation:
```yaml
npx typedoc src/index.ts src/additional-file.ts \
  # ... rest of command
```

## 🛠️ Local Development

Generate documentation locally:
```bash
npm run docs        # Generate docs
npm run docs:serve  # Generate and serve locally
```

## 📁 File Structure

```
.github/
├── workflows/
│   └── docs.yml           # GitHub Pages deployment
└── DOCUMENTATION.md       # This file

build/docs/                # Generated TypeDoc site (gitignored; built and deployed by docs.yml)
├── index.html             # Main documentation page
├── classes/               # Class documentation
├── interfaces/            # Interface documentation
└── ...                    # Other generated files

docs/                      # Hand-written docs, committed: ADRs, PRDs, PRPs, guides, blueprint
```

TypeDoc must never write into `docs/`: its `cleanOutputDir` option defaults to
`true` and would delete the hand-written files there. `typedoc.json`, the
`docs` script in `package.json`, and `docs.yml` all use `build/docs`, and
`src/__tests__/docs-output.test.ts` fails if they drift apart.

## 🔍 Troubleshooting

### Pull Request Run Shows Skipped Steps
This is expected. On a `pull_request` event, `Setup Pages`, `Upload
documentation artifact`, and the whole `deploy` job are skipped — a PR
validates the docs build and never deploys. A skipped job does not fail the
workflow, so the run is green on `build` alone.

### Documentation Not Updating
1. Check that `docs.yml` has the permissions it needs. It scopes them per job:
   `build` gets `contents: read` + `pages: write` (needed by
   `actions/configure-pages`), `deploy` gets `contents: read` + `pages: write` +
   `id-token: write` (needed by `actions/deploy-pages`).
2. Ensure the triggering paths match your changes
3. Review workflow logs in the Actions tab

### GitHub Pages Not Working
1. Verify Pages is enabled in repository settings with Source set to "GitHub Actions".
   In the legacy "Deploy from a branch" mode, Pages publishes `main:/docs`, which
   holds no `index.html`, so the site root returns 404.
2. Check that `docs.yml` workflow completed successfully
3. Ensure repository is public (for free GitHub accounts)

### TypeScript Errors
`docs.yml` uses `--skipErrorChecking` to handle incomplete files. If you need stricter checking:
1. Remove the `--skipErrorChecking` flag
2. Fix any TypeScript compilation errors
3. Or exclude problematic files with `--exclude`

## 📞 Support

For issues with the documentation automation:
1. Check the workflow logs in the Actions tab
2. Review the TypeDoc configuration in `typedoc.json`
3. Test documentation generation locally with `npm run docs`
