# Space Station Skills

Standalone [Agent Skills](https://agentskills.io/) for installing and using Space Station.

## Included skills

- `install-space-station` — installs and operates the public GHCR stack with Docker Compose while keeping runtime secrets local.
- `space-station-review` — reviews GitHub pull requests through a running Space Station instance, including exact-commit previews, visual anchors, screenshots, replies, and resolution markers.

## Install for Pi

Copy either or both skill directories into the cross-agent global skill location:

```bash
mkdir -p ~/.agents/skills
cp -R skills/install-space-station ~/.agents/skills/
cp -R skills/space-station-review ~/.agents/skills/
```

Restart Pi, then invoke:

```text
/skill:install-space-station
/skill:space-station-review
```

Pi can also load this checkout directly:

```bash
pi --skill "$PWD/skills"
```

Skills contain no credentials. The installer creates an owner-readable local `.env`, generates local signing material without displaying it, and requires users to enter their own GitHub App values outside the agent conversation.

## Verify

Requires Bun only for contributor tests and the review helper:

```bash
bun test
```
