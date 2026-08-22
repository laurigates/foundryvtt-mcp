# Documentation Automation Setup

This repository includes several GitHub Actions workflows for automated documentation generation and deployment.

## 📋 Available Workflows

### 1. `docs.yml` - GitHub Pages Deployment
**Recommended for public repositories**

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

### 2. `update-docs.yml` - Repository Commit
**Works for all repositories (public/private)**

- ✅ Works without GitHub Pages
- ✅ Documentation stored in repository
- ✅ Version-controlled docs
- ✅ Browse docs directly in GitHub
- ❌ Larger repository size
- ❌ No clean hosting URL

**Setup:**
- No additional setup required
- Automatically commits to `docs/` folder

### 3. `setup-docs.yml` - One-time Setup
**Initial setup helper**

- Generates initial documentation
- Creates `.nojekyll` file for GitHub Pages
- Provides setup instructions

## 🚀 Quick Start

### Option A: Use GitHub Pages (Recommended)
1. Run the setup workflow manually:
   - Go to **Actions** → **Setup Documentation Site** → **Run workflow**
2. Enable GitHub Pages:
   - Go to **Settings** → **Pages**
   - Set Source to "GitHub Actions"
3. Documentation will be available at `https://[username].github.io/[repository]/`

### Option B: Repository-only Documentation
1. The `update-docs.yml` workflow is already active
2. Documentation will be automatically updated in the `docs/` folder
3. Browse documentation by navigating to the `docs/` folder in GitHub

## 🔧 Customization

### Modify Documentation Generation
Edit the TypeDoc command in the workflows:
```yaml
npx typedoc src/foundry/client.ts src/foundry/types.ts src/config/index.ts src/utils/logger.ts \
  --out docs \
  --name "Your Custom Title" \
  --readme README.md \
  --skipErrorChecking \
  --cleanOutputDir
```

### Change Trigger Conditions
Modify the `on:` section in workflow files:
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
│   ├── docs.yml           # GitHub Pages deployment
│   ├── update-docs.yml    # Repository commit workflow
│   └── setup-docs.yml     # One-time setup helper
└── DOCUMENTATION.md       # This file

docs/                      # Generated documentation
├── index.html             # Main documentation page
├── classes/               # Class documentation
├── interfaces/            # Interface documentation
└── ...                    # Other generated files
```

## 🔍 Troubleshooting

### Pull Request Run Shows Skipped Steps
This is expected. On a `pull_request` event, `Setup Pages`, `Upload
documentation artifact`, and the whole `deploy` job are skipped — a PR
validates the docs build and never deploys. A skipped job does not fail the
workflow, so the run is green on `build` alone.

### Documentation Not Updating
1. Check that workflows have proper permissions. `docs.yml` scopes them per job:
   `build` gets `contents: read` + `pages: write` (needed by
   `actions/configure-pages`), `deploy` gets `contents: read` + `pages: write` +
   `id-token: write` (needed by `actions/deploy-pages`).
2. Ensure the triggering paths match your changes
3. Review workflow logs in the Actions tab

### GitHub Pages Not Working
1. Verify Pages is enabled in repository settings
2. Check that `docs.yml` workflow completed successfully
3. Ensure repository is public (for free GitHub accounts)

### TypeScript Errors
The workflows use `--skipErrorChecking` to handle incomplete files. If you need stricter checking:
1. Remove the `--skipErrorChecking` flag
2. Fix any TypeScript compilation errors
3. Or exclude problematic files with `--exclude`

## 📞 Support

For issues with the documentation automation:
1. Check the workflow logs in the Actions tab
2. Review the TypeDoc configuration in `typedoc.json`
3. Test documentation generation locally with `npm run docs`
