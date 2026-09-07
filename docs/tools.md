# Read-only tool contract

Only the tools registered in `src/tools.mjs` are exposed. Every tool is
annotated read-only and has bounded arguments. Tool handlers call fixed GET
routes on Cycleo's versioned API; there is no arbitrary URL, SQL or mutation
tool.

The initial tool set is intentionally small. Add a tool only when its API
route, user/league scoping and response-size limits are documented and tested.
The server validates every call against the published input schema before any
API request is dispatched; invalid, missing and additional arguments produce a
JSON-RPC `-32602` error.

Every Cycleo API response is read through a byte cap (`CYCLEO_MAX_RESPONSE_BYTES`,
default 1 MiB); an over-limit response fails with `cycleo_response_too_large`
rather than being buffered in full. Transient upstream failures (network errors,
HTTP 429/502/503/504) are retried up to `CYCLEO_MAX_RETRIES` times (default 2)
with backoff.

A successful `tools/call` returns the Cycleo payload twice: as a JSON string in
`content[0].text` and as `structuredContent` for clients that consume typed
output. No `outputSchema` is published because the upstream response shapes are
not part of this repository's contract.

## Current team

`cycleo_get_my_team` calls the authenticated, user-scoped `GET /team` API
route. It returns the current roster with season points, rider factor, injury
status, and current or upcoming races. The tool accepts no arguments and cannot
request another user's team.

`cycleo_get_team` calls `GET /teams/{teamId}` for a positive numeric team ID.
The Cycleo API restricts the result to active, visible teams in the
authenticated user's league and returns `team_not_found` otherwise.

## TransferAI

`cycleo_get_transfer_advice` calls the account-gated
`GET /races/{raceId}/transfer-advice` route. It accepts a required positive
`raceId`, an optional `limit` from 1 through 50, and optional `includeOwned`
and `allowStarted` booleans. Omitted options preserve the API defaults. The
Cycleo API continues to enforce race visibility, league scoping, and the
account's TransferAI entitlement.
