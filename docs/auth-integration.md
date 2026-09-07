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
league. The MCP service validates the resulting bearer token by calling
`GET /auth/me` before exposing tools, caching that identity per token for
`AUTH_CACHE_TTL_MS` (default 30s) so repeated MCP calls do not re-hit Cycleo. A
token revoked at the authorization server therefore keeps working until its
cache entry expires; lower or zero the TTL if faster revocation is required. No
password is sent to this repository.

In production (`MCP_AUTH_MODE=bearer`), the client supplies its bearer token on
every request. The local stored-token flow is disabled. `MCP_AUTH_MODE=local`
exists only for a single-user workstation and is enforced as loopback-only.

Production should use exact registered redirect URIs, issuer/resource checks,
single-use authorization codes and refresh-token reuse detection.
