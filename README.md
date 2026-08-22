# Cycleo MCP server

Distributable, read-only MCP adapter for Cycleo. The server exposes a small
allow-listed tool surface and calls Cycleo's versioned JSON API with the
user-scoped OAuth bearer token.

This repository contains the MCP resource server only. Cycleo remains the
authorization server and data owner; the `/oauth/*` integration is documented
in `docs/auth-integration.md` and must be wired before production use.

## Local run

```sh
cp .env.example .env
npm run start:local
```

The local endpoint is `http://localhost:8787/mcp`. Open
`http://localhost:8787/connect` once to sign in through Cycleo. The server
stores only the OAuth token set locally with restrictive file permissions and
refreshes access tokens automatically. Set `CYCLEO_API_BASE_URL` to a local
Cycleo API when developing against a local checkout.

Local mode is explicit (`MCP_AUTH_MODE=local`) and the server refuses to start
unless `MCP_HOST` is a loopback host. The default token file is
`~/.cycleo-mcp/tokens.json`; override it with `TOKEN_STORE_PATH` when needed.

## Production boundary

Production must use `MCP_AUTH_MODE=bearer`. In that mode `/connect` and
`/callback` are disabled, no token is loaded from disk, and every MCP request
must provide its own OAuth bearer token. Set `MCP_PUBLIC_URL`, `OAUTH_RESOURCE`
and `CYCLEO_API_BASE_URL` to their HTTPS production values. `OAUTH_CLIENT_ID`,
`OAUTH_REDIRECT_URI` and `TOKEN_STORE_PATH` are local-mode settings.
`ALLOWED_ORIGINS` is a comma-separated allow-list for clients that send an
`Origin` header and defaults to the public resource origin.

The MCP server never receives Cycleo passwords and never connects to the Cycleo
database. It validates each request's identity through `GET /auth/me`, binds MCP
sessions to that user and league, and only forwards the allow-listed read routes
in `src/tools.mjs`.

## CI/CD

GitHub Actions runs syntax checks, tests and the production dependency audit on
pushes and pull requests to `main`. CI covers Node 20.6, 22 and 24.

The delivery workflow runs for version tags such as `v1.2.3` and manual
dispatches. After re-running all checks, it deploys over SSH to
`/var/www/cycleo.mcp/releases/<commit>` and atomically switches
`/var/www/cycleo.mcp/current`. It restarts `cycleo-mcp.service`, verifies the
loopback health endpoint and restores the previous release if verification
fails.

Server preparation, the hardened unit template, required GitHub environment
secrets and release procedure are documented in
[`docs/systemd-deployment.md`](docs/systemd-deployment.md).
