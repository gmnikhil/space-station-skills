# GitHub App setup

## Permissions

Configure the GitHub App with:

- Repository **Metadata:** Read
- Repository **Contents:** Read
- Repository **Pull requests:** Read and write
- User **Notifications:** Read and write

Existing installations and users must approve permission changes, then sign in again.

## Local origins and callback

The published web image uses these browser-facing localhost origins:

```text
APP_ORIGIN=http://localhost:5173
API_ORIGIN=http://localhost:3000
PREVIEW_ORIGIN=http://localhost:4000
```

Configure the GitHub App user-authorization callback as:

```text
http://localhost:3000/v1/auth/github/callback
```

Keep the preview origin separate. It renders untrusted exact-commit and Live preview content without application cookies.

## Webhook

GitHub cannot deliver a webhook to localhost. Expose local port 3000 through a public HTTPS tunnel and configure:

```text
https://YOUR-TUNNEL.example/v1/github/webhooks
```

Copy the generated local `GITHUB_WEBHOOK_SECRET` into the GitHub App webhook settings without posting it in chat or logs. Subscribe to:

- Pull requests
- Pull request reviews
- Pull request review comments
- Pull request review threads
- Issue comments
- Push
- Installation
- Installation repositories

Confirm `issue_comment` created/edited/deleted and `pull_request_review_thread` resolved/unresolved deliveries in the GitHub App delivery log.

## Secret handling

- Keep the GitHub private key, client secret, webhook secret, session keyring, and preview-signing secret only in the owner-readable local `.env`.
- Represent private-key PEM newlines as literal `\n` inside `.env`.
- Use the same preview-signing secret for API and preview; the Compose stack injects the same local configuration into both.
- Never commit, upload, echo, or paste `.env` values into an agent conversation.
