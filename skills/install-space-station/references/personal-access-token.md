# Personal access token setup

## Choose a deployment mode

Set `GITHUB_AUTH_METHODS` in the private `.env` before starting the stack:

- `github_app` keeps the legacy App-only login.
- `github_app,personal_access_token` shows both login paths.
- `personal_access_token` enables PAT-only login and does not require GitHub App fields.

In PAT mode, a user can enter a token in the browser. The token is sent only to the
same-origin API, sealed into the finite encrypted session, and never passed to the
web or preview container. Do not put a user PAT in a `VITE_*` variable, URL,
Compose command, document, browser storage, or cross-tab message.

## Token guidance

Prefer an expiring fine-grained token restricted to the repositories that need
review. Recommended permissions are:

- Metadata: Read
- Contents: Read
- Pull requests: Read and write
- Notifications: Read and write when using the inbox

Classic tokens remain compatible when GitHub accepts them. GitHub is authoritative
for token validity, repository access, expiry, and revocation.

## Optional server-configured PAT

A trusted single-user deployment can offer a shared server-configured login button:

```text
GITHUB_AUTH_METHODS=personal_access_token
GITHUB_CONFIGURED_PAT_LOGIN=true
GITHUB_PERSONAL_ACCESS_TOKEN=<enter locally; never share it>
```

Keep `GITHUB_PERSONAL_ACCESS_TOKEN` only in the owner-readable `.env`. Compose
passes the local environment file to the API role; it is not passed to the web or
preview role. Every browser uses the same configured GitHub identity, so do not
enable this option for an unrestricted multi-user deployment. The installer and
agent must never display or request the value in chat.

A browser-entered PAT does not require `GITHUB_PERSONAL_ACCESS_TOKEN`; leave the
configured-login flag disabled for that flow.

## Revoke or roll back

To disable PAT login, set `GITHUB_AUTH_METHODS=github_app` and recreate the API,
preview, and web roles. Existing PAT sessions must authenticate again and never
fall back to a GitHub App identity. To revoke a token, use GitHub's token settings;
then restart or recreate the affected deployment as appropriate.
