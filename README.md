# Cycleo MCP server

Distributable, read-only MCP adapter for Cycleo. The server exposes a small
allow-listed tool surface and calls Cycleo's versioned JSON API with the
user-scoped OAuth bearer token.

This repository contains the MCP resource server only. Cycleo remains the
authorization server and data owner; the `/oauth/*` integration is documented
in `docs/auth-integration.md` and must be wired before production use.

Cycleo users who want to connect from their own computer should follow the
[workstation setup guide](docs/workstation-setup.md). It uses the hosted MCP
endpoint; cloning or running this server locally is not required.

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
`Origin` header and defaults to the public resource origin. Requests from an
allow-listed `Origin` receive CORS response headers and `OPTIONS` preflight is
answered, so browser-based MCP clients can connect; any other `Origin` is
rejected with `403`. `ALLOWED_HOSTS` is the matching allow-list for the `Host`
header (DNS-rebinding protection); it defaults to the `OAUTH_RESOURCE` host and
always permits loopback hosts so the systemd health check keeps working.

Optional hardening/performance knobs:

- `CYCLEO_MAX_RESPONSE_BYTES` (default 1 MiB) caps each Cycleo API response.
- `CYCLEO_MAX_RETRIES` (default 2) retries transient Cycleo failures (network
  errors and HTTP 429/502/503/504) with exponential backoff and honours
  `Retry-After`.
- `AUTH_CACHE_TTL_MS` (default 30000) caches the `GET /auth/me` identity lookup
  so repeated MCP calls don't re-hit Cycleo — set to `0` to disable, and note a
  revoked token stays usable until the entry expires.
- `RATE_LIMIT_PER_MIN` (default 120) is a per-token fixed-window limit on `/mcp`
  requests; exceeding it returns `429` with a `Retry-After` header. Set to `0`
  to disable.
- `ACCESS_LOG` (default on) writes one JSON line per request to stderr; set to
  `off` to silence it.

On `SIGTERM`/`SIGINT` the server stops accepting connections, ends open SSE
streams and drains in-flight requests before exiting.

## Transport

`/mcp` is Streamable HTTP. `POST /mcp` carries the JSON-RPC request/response
traffic. `GET /mcp` opens the server-to-client `text/event-stream` channel for
an initialized session (identified by the `Mcp-Session-Id` header); it is held
open with periodic keep-alive comments, and a session may hold at most four
concurrent streams (a fifth returns `409`). `DELETE /mcp` terminates a session
and closes any streams it still holds; an expired or drained session does the
same, so keep-alive timers never outlive their session. Every session-scoped
response echoes the negotiated `MCP-Protocol-Version` header.

Protected-resource metadata (RFC 9728) is served both at
`/.well-known/oauth-protected-resource` and at the endpoint-suffixed
`/.well-known/oauth-protected-resource/mcp` that MCP clients probe.

The MCP server never receives Cycleo passwords and never connects to the Cycleo
database. It validates each request's identity through `GET /auth/me`, binds MCP
sessions to that user and league, and only forwards the allow-listed read routes
in `src/tools.mjs`, `src/resources.mjs` and `src/prompts.mjs`.

## Capabilities

The server advertises `tools`, `resources` and `prompts`.

- **Tools** (`src/tools.mjs`) — the allow-listed read actions: identity and
  season context, team and roster reads, race list/overview/result/
  classification, league standings, rider search and profiles, TransferAI
  advice, and transfer history/radar. See [`docs/tools.md`](docs/tools.md).
- **Resources** (`src/resources.mjs`) — `resources/list`, `resources/read` and
  `resources/templates/list` expose the same user- and league-scoped Cycleo
  data as addressable `cycleo://` URIs (`cycleo://team`, `cycleo://teams/{id}`,
  …). Reads dispatch the same fixed GET routes as the tools.
- **Prompts** (`src/prompts.mjs`) — `prompts/list` and `prompts/get` return
  read-only analysis prompts (`cycleo_team_review`, `cycleo_transfer_plan`,
  `cycleo_race_preview`) that steer a client toward the right tool calls.

See [`docs/resources-and-prompts.md`](docs/resources-and-prompts.md).

## CI/CD

GitHub Actions runs syntax checks, tests and the production dependency audit on
pushes and pull requests to `main`. CI covers Node 22 and 24.

The delivery workflow runs for version tags such as `v1.2.3` and manual
dispatches. After re-running all checks, it deploys over SSH to
`/var/www/cycleo.mcp/releases/<commit>` and atomically switches
`/var/www/cycleo.mcp/current`. It restarts `cycleo-mcp.service`, verifies the
loopback health endpoint and restores the previous release if verification
fails.

Server preparation, the hardened unit template, required GitHub environment
secrets and release procedure are documented in
[`docs/systemd-deployment.md`](docs/systemd-deployment.md).
