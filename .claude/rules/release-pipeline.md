---
paths:
  - "**/release-please.yml"
  - "**/release-please-config.json"
  - "**/.release-please-manifest.json"
---

# Release Pipeline

Releases via **release-please** + npm publish (`.github/workflows/release-please.yml`).

## Auth: gitops-managed GitHub App, never a PAT

The workflow mints a short-lived token from the **Release Please GitHub App**:

```yaml
- uses: actions/create-github-app-token@v3
  id: app-token
  with:
    app-id: ${{ vars.RELEASE_PLEASE_APP_ID }}
    private-key: ${{ secrets.RELEASE_PLEASE_PRIVATE_KEY }}
- uses: googleapis/release-please-action@v5
  with:
    token: ${{ steps.app-token.outputs.token }}
```

`RELEASE_PLEASE_APP_ID` (var) + `RELEASE_PLEASE_PRIVATE_KEY` (secret) are
distributed by **gitops** to every repo flagged `release_please = true` in
`laurigates/gitops/repositories.tf`. Do **not** reintroduce a standalone PAT
(`RELEASE_PLEASE_TOKEN`) — a PAT expires silently and stalls releases until
someone notices npm has gone stale (this exact failure cost ~3 months once).

## Failure modes

| Run-log symptom | Cause | Fix |
|---|---|---|
| `release-please failed: Bad credentials` | App creds missing/expired, or repo not `release_please = true` in gitops | Confirm `gh variable list` / `gh secret list` show the App ID + private key; if absent, flip the gitops flag and let Scalr apply |
| `resource not accessible by integration` | Release Please App not installed on this repo | Add the repo to the App installation (GitHub → Settings → Installed GitHub Apps) |

Tag scheme: `foundryvtt-mcp-v<version>` (package name as component). Health
check: `just release-status`.
