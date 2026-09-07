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

## Full tool list

| Tool | Cycleo route | Arguments |
| --- | --- | --- |
| `cycleo_get_my_context` | `GET /auth/me` + `GET /sidebar/season` | — |
| `cycleo_get_my_team` | `GET /team` | — |
| `cycleo_get_team` | `GET /teams/{teamId}` | `teamId` |
| `cycleo_get_overview` | `GET /today` | — |
| `cycleo_list_races` | `GET /races` | `limit`, `page` |
| `cycleo_get_race` | `GET /races/{raceId}/overview` | `raceId` |
| `cycleo_get_transfer_advice` | `GET /races/{raceId}/transfer-advice` | `raceId`, `limit`, `includeOwned`, `allowStarted` |
| `cycleo_search_riders` | `GET /search` | `query`, `limit` |
| `cycleo_get_rider` | `GET /riders/{riderId}` | `riderId` |
| `cycleo_get_rankings` | `GET /rankings/cycleo-points` | — |
| `cycleo_get_race_result` | `GET /races/{raceId}/cycleo-result` | `raceId` |
| `cycleo_get_race_classification` | `GET /races/{raceId}/classification` | `raceId` |
| `cycleo_get_transfer_history` | `GET /transfers/history` | — |
| `cycleo_get_transfer_radar` | `GET /transfers/radar` | — |

All routes resolve identity and league from the bearer token
(`mobileApiRequireAuthenticatedUser`); no argument can widen that scope.

## Current team

`cycleo_get_my_team` calls the authenticated, user-scoped `GET /team` API
route. It returns the current roster with season points, rider factor, injury
status, and current or upcoming races. The tool accepts no arguments and cannot
request another user's team.

`cycleo_get_team` calls `GET /teams/{teamId}` for a positive numeric team ID.
The Cycleo API restricts the result to active, visible teams in the
authenticated user's league and returns `team_not_found` otherwise.

## Context, standings and results

`cycleo_get_my_context` returns the `GET /auth/me` identity (user, team,
league, entitlements) and attaches a `season` snapshot from
`GET /sidebar/season` (points remaining, race progress, transfers used and
remaining). If the snapshot call fails the tool still returns the identity with
`season: null`.

`cycleo_get_rankings` calls `GET /rankings/cycleo-points` for the authenticated
league: the Cycleopunten table plus the medal table and the embedded special
rankings (prediction, transfermeister, and the Coppa rankings).

`cycleo_get_race_result` (`GET /races/{raceId}/cycleo-result`) returns the
league's calculated Cycleo points per team for one race;
`cycleo_get_race_classification` (`GET /races/{raceId}/classification`) returns
the final rider classification enriched with league ownership. Both take a
positive `raceId` and stay within the caller's league.

## Transfers

`cycleo_get_transfer_history` (`GET /transfers/history`) and
`cycleo_get_transfer_radar` (`GET /transfers/radar`) are league-scoped read
views of completed transfers and of the most-transferred riders. The game has
no rider prices, so there is no market or valuation tool.

## TransferAI

`cycleo_get_transfer_advice` calls the account-gated
`GET /races/{raceId}/transfer-advice` route. It accepts a required positive
`raceId`, an optional `limit` from 1 through 50, and optional `includeOwned`
and `allowStarted` booleans. Omitted options preserve the API defaults. The
Cycleo API continues to enforce race visibility, league scoping, and the
account's TransferAI entitlement.
