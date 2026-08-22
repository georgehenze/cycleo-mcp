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
npm start
```

The local endpoint is `http://localhost:8787/mcp`. Set `CYCLEO_API_BASE_URL` to
a local Cycleo API when developing against a local checkout.

## Production boundary

The MCP server never receives or stores Cycleo passwords and never connects to
the Cycleo database. It accepts an OAuth bearer token, validates the identity
through `GET /auth/me`, and only forwards the allow-listed read routes in
`src/tools.mjs`.
