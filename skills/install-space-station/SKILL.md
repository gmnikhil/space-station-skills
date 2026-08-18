---
name: install-space-station
description: Installs, configures, starts, verifies, upgrades, or removes the public Space Station Docker stack. Use when someone wants to run Space Station locally from GHCR without installing application source or dependencies.
compatibility: Requires Docker with Compose. A GitHub App or personal access token login is required for real GitHub authentication and reviews.
---

# Install Space Station

Run the public GHCR release as three independently managed containers: web, API, and isolated preview.

## Security rules

- Never ask the user to paste credentials, private keys, signing keys, or `.env` contents into chat.
- Never print, read back, summarize, or expose values from `.env`.
- Never run `cat .env`, `env`, `printenv`, container-environment inspection, or `docker compose config` without `--quiet`.
- Never enable shell tracing while handling configuration.
- Never overwrite an existing `.env`; preserve it and ask before migration.
- Never pass secrets as command-line arguments.
- Use exact release versions. Do not install `latest` unless the user explicitly accepts a moving tag.

## Resolve paths

Resolve `SKILL_DIR` as the absolute directory containing this `SKILL.md`; skill scripts and assets are relative to that directory. Do not assume the current working directory.

Use the directory requested by the user as `INSTALL_DIR`. If none is given, propose `$HOME/.space-station` and confirm before creating it.

## Verify Docker

```bash
docker version >/dev/null
docker compose version >/dev/null
```

If Docker is unavailable, stop and ask the user to install or start Docker Desktop/Engine with Compose.

## Select an exact release

Use the exact version requested by the user. If none is given, propose `1.0.1` and confirm it. The public image is:

```text
ghcr.io/gmnikhil/space-station:<version>
```

No registry login is required.

## Bootstrap

For a fresh install, run:

```bash
"$SKILL_DIR/scripts/bootstrap.sh" "$INSTALL_DIR" "<version>"
```

The bootstrap script copies the bundled production Compose definition, creates an owner-only `.env` from bundled safe placeholders, and generates unique session, preview-signing, and webhook secrets without displaying them.

If `.env` already exists, bootstrap refuses to modify it. Preserve the existing installation and switch to validation or upgrade.

Ask the user to edit `$INSTALL_DIR/.env` locally and choose one of these authentication modes:

- `GITHUB_AUTH_METHODS=github_app` keeps the legacy GitHub App-only deployment.
- `GITHUB_AUTH_METHODS=github_app,personal_access_token` shows both login paths.
- `GITHUB_AUTH_METHODS=personal_access_token` enables PAT-only login and does not require GitHub App values.

In PAT mode, users can enter their own token in the browser; no deployment PAT is needed for that flow. For the optional shared/server-configured PAT button, set `GITHUB_PERSONAL_ACCESS_TOKEN` only in the private `.env` and set `GITHUB_CONFIGURED_PAT_LOGIN=true`. Every browser then uses that configured GitHub identity, so this mode is intended for a trusted single-user or tightly controlled deployment. Never put the PAT in a `VITE_*` variable, the web/preview role, a URL, or chat.

When `github_app` is enabled, populate these fields locally:

- `GITHUB_APP_ID`
- `GITHUB_PRIVATE_KEY`, with PEM newlines represented as literal `\n`
- `GITHUB_CLIENT_ID`
- `GITHUB_CLIENT_SECRET`
- `GITHUB_WEBHOOK_PUBLIC_URL` when using a tunnel

The user must copy the generated `GITHUB_WEBHOOK_SECRET` from their private local file into their GitHub App webhook settings. Do not display it. Use [GitHub App setup](references/github-app-setup.md) and [personal access token setup](references/personal-access-token.md) for permissions, callback, webhook events, token guidance, and localhost constraints.

Pause until the user confirms they finished editing. Never infer or fabricate credentials.

## Validate safely

```bash
"$SKILL_DIR/scripts/check-config.sh" "$INSTALL_DIR"
(
  cd "$INSTALL_DIR"
  docker compose -f compose.production.yml config --quiet
)
```

The checker reports field names only. If validation fails, never include expanded configuration or values in the response.

## Pull and start

```bash
(
  cd "$INSTALL_DIR"
  docker compose -f compose.production.yml pull
  docker compose -f compose.production.yml up -d
)
```

Wait for `web`, `api`, and `preview` to report healthy with `docker compose ps`. Do not inspect their environments. For failures, use bounded role logs such as `docker compose -f compose.production.yml logs --tail 100 api` and redact credential-like material before reporting.

Report:

- Web: `http://localhost:5173`
- API health: `http://localhost:3000/health`
- Preview health: `http://localhost:4000/health`

Webhook delivery to a local API requires a public HTTPS tunnel. Keep application and preview origins separate.

## Upgrade or rollback

Confirm the requested exact version, then update only the version field:

```bash
"$SKILL_DIR/scripts/set-version.sh" "$INSTALL_DIR" "<version>"
(
  cd "$INSTALL_DIR"
  docker compose -f compose.production.yml pull
  docker compose -f compose.production.yml up -d
)
```

Verify health again. Rollback uses the same procedure with the previous exact version.

## Stop

```bash
(
  cd "$INSTALL_DIR"
  docker compose -f compose.production.yml down
)
```

Preserve `.env` unless the user explicitly requests permanent removal and understands that its secrets will be lost.
