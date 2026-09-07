# Cycleo OAuth integration boundary

The MCP service is a resource server. Cycleo remains the authorization server.
The Cycleo repository must provide:

- `/.well-known/oauth-authorization-server`
- `/oauth/authorize` with the dedicated Cycleo login and consent screen
- `/oauth/token` with authorization-code + PKCE-S256
- `/oauth/revoke`
- `cycleo:read` scope and the `https://mcp.cycleo.com` resource audience
- rotating refresh tokens, hashed at rest and revocable per connection

The authorization result must bind the OAuth session to one Cycleo user and
league. Before exposing tools, the MCP service exchanges that client-facing
token at `/oauth/token` using the OAuth token-exchange grant. Cycleo accepts
only an active `cycleo:read` token for the configured MCP resource and returns
a distinct, short-lived backend token restricted to the MCP GET allow-list.
Only that backend token is sent to `GET /auth/me` and the data routes; the
client-facing token never reaches `/api/v1`. The MCP caches the backend token
and identity for at most `AUTH_CACHE_TTL_MS` (default 30s), bounded by the
backend token's own lifetime. No password is sent to this repository.

In production (`MCP_AUTH_MODE=bearer`), the client supplies its bearer token on
every request. The local stored-token flow is disabled. `MCP_AUTH_MODE=local`
exists only for a single-user workstation and is enforced as loopback-only.

Production should use exact registered redirect URIs, issuer/resource checks,
single-use authorization codes and refresh-token reuse detection.
