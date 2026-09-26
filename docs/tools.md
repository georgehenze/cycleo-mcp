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
HTTP 429/502/503/504) are retried up to `CYCLEO_MAX_RETRIES` times (default 2).
Exponential backoff is capped at two seconds, but an explicit `Retry-After`
response header is honoured up to 30 seconds so the client actually backs off
while Cycleo is throttling. A 503 with code `maintenance` (Cycleo maintenance
mode) is not retried: tool calls return it as an `isError` result at once, and
if it happens during authentication the MCP response carries Cycleo's
`Retry-After`.

Accounts that Cycleo has flagged for a required password change get
`403 password_change_required` from every API route, including `/auth/me`, so
the MCP request fails with that code until the user sets a new password in
Cycleo.

A successful `tools/call` returns the Cycleo payload twice: as a JSON string in
`content[0].text` and as `structuredContent` for clients that consume typed
output. No `outputSchema` is published because the upstream response shapes are
not part of this repository's contract.

## Full tool list

| Tool | Cycleo route | Arguments |
| --- | --- | --- |
| `cycleo_get_current_time` | Server clock | `timeZone` (optional IANA timezone) |
| `cycleo_get_my_context` | `GET /auth/me` + `GET /sidebar/season` | — |
| `cycleo_get_my_team` | `GET /team` | — |
| `cycleo_get_team` | `GET /teams/{teamId}` | `teamId` |
| `cycleo_get_overview` | `GET /today` | — |
| `cycleo_list_races` | `GET /races` | `year`, `status`, `limit`, `page` |
| `cycleo_get_race` | `GET /races/{raceId}/overview` | `raceId` |
| `cycleo_get_transfer_advice` | `GET /races/{raceId}/transfer-advice` | `raceId`, `limit`, `includeOwned`, `allowStarted` |
| `cycleo_search_entities` | `GET /search` | `query`, `entityType` (optional: `all`, `rider`, `race`, `team`) |
| `cycleo_search_riders` | `GET /search` | `query` |
| `cycleo_get_rider` | `GET /riders/{riderId}` | `riderId` |
| `cycleo_get_rider_startlist_races` | `GET /riders/{riderId}/upcoming-races` | `riderId` |
| `cycleo_get_rankings` | `GET /rankings/cycleo-points` | — |
| `cycleo_get_race_result` | `GET /races/{raceId}/cycleo-result` | `raceId` |
| `cycleo_get_race_classification` | `GET /races/{raceId}/classification` | `raceId` |
| `cycleo_get_race_startlist` | `GET /races/{raceId}/startlist` | `raceId` |
| `cycleo_get_transfer_history` | `GET /transfers/history` | `limit`, `page` |
| `cycleo_get_transfer_statistics` | `GET /transfers/statistics` | `userId` (optional) |
| `cycleo_get_transfer_radar` | `GET /transfers/radar` | — |

All routes resolve identity and league from the bearer token
(`mobileApiRequireAuthenticatedUser`); no argument can widen that scope.

## Current time

`cycleo_get_current_time` does not call the Cycleo API. It returns the MCP
server's current clock as `utc` (ISO 8601), `unixSeconds`, and a local
`localDate`, `localTime` and `localDateTime` together with the IANA `timeZone`
used to format those local fields. Pass an optional `timeZone` such as
`Europe/Amsterdam` to format them in the client's timezone; when omitted, the
server's timezone is used. Invalid timezone identifiers are rejected as
invalid arguments. Use `utc` for an absolute instant; the UTC and Unix values
are unchanged by the requested timezone.

## Current team

`cycleo_get_my_team` calls the authenticated, user-scoped `GET /team` API
route. It returns the current roster with season points, rider factor, injury
status, and current or upcoming races. The tool accepts no arguments and cannot
request another user's team.

`cycleo_get_team` calls `GET /teams/{teamId}` for a positive numeric team ID.
The Cycleo API restricts the result to active, visible teams in the
authenticated user's league and returns `team_not_found` otherwise.

## Context, standings and results

`cycleo_list_races` accepts an optional `year` (2000–2100; defaults to the
current year) and `status` (`all`, `upcoming`, `active`, `completed` or
`cancelled`; defaults to `all`), along with `limit` and `page`. Upcoming races
have not started, active races include today, and completed races ended before
today. The tool caps `limit` at 50 to keep responses bounded.

`cycleo_get_my_context` returns the `GET /auth/me` identity (user, team,
league, entitlements, `subscription` status) and attaches a `season` snapshot
from `GET /sidebar/season` (points remaining, race progress, transfers used
and remaining). If the snapshot call fails the tool still returns the identity
with `season: null`.

`subscription` (`status`, `active`, `type`, `startDate`, `endDate`) comes
straight through from `/auth/me` — the tool does not call a separate
entitlements endpoint, so it stays whatever shape the Cycleo API returns.

`cycleo_get_rankings` calls `GET /rankings/cycleo-points` for the authenticated
league: the Cycleopunten table plus the medal table and the embedded special
rankings (prediction, transfermeister, and the Coppa rankings).

`cycleo_get_race_result` (`GET /races/{raceId}/cycleo-result`) returns the
league's calculated Cycleo points per team for one race;
`cycleo_get_race_classification` (`GET /races/{raceId}/classification`) returns
the final rider classification enriched with league ownership. Both take a
positive `raceId` and stay within the caller's league.

`cycleo_get_race_startlist` (`GET /races/{raceId}/startlist`) returns the full
start list, including bib numbers, withdrawal status, pro teams and current
ownership in the authenticated user's league. It also includes rider stats and
transfer context. The endpoint is not paginated. When only a race name is
known, use `cycleo_search_entities` with `entityType=race` and pass the matched
edition's `editionId` as `raceId`.

## Rider search

`cycleo_search_entities` resolves names to IDs for follow-up questions. It
returns up to six riders, race editions and teams per category by default;
`entityType` can limit the search to `rider`, `race` or `team`. Rider and team
results use `id` with their corresponding tools. Race matches contain both the
race definition `id` and the season-specific `editionId`; use `editionId` with
race tools such as `cycleo_get_race` and `cycleo_get_transfer_advice`. Team
matches are restricted to visible teams in the authenticated user's league.

`cycleo_search_riders` calls `GET /search` with the query pinned to
`type=renner`. The Cycleo API requires at least two characters (shorter queries
return nothing), matches on rider name and professional team, ignores any
`limit`, and returns at most six riders. The tool therefore takes only `query`
(2–80 characters) and returns `{ riders: [...] }`; races and teams from the
shared search route are not exposed.

## Rider start-list races

`cycleo_get_rider_startlist_races` answers “Which races is this rider on the
start list for?” directly. First call `cycleo_search_entities` (or the
backward-compatible `cycleo_search_riders`) when the question
contains a name, then pass the selected result's `id` as `riderId`. The tool
returns every current or upcoming not-yet-calculated race where the rider has
a non-withdrawn start-list entry; it does not infer a programme from race
calendars.

## Transfers

`cycleo_get_transfer_history` (`GET /transfers/history`) and
`cycleo_get_transfer_radar` (`GET /transfers/radar`) are league-scoped read
views of completed transfers and of the most-transferred riders. The game has
no rider prices, so there is no market or valuation tool.

`cycleo_get_transfer_history` always sends `limit` (default 20, max 50) and
`page` (default 1); the full league history for an admin spans a whole season
and would otherwise exceed `CYCLEO_MAX_RESPONSE_BYTES`. Results are newest
first.

`cycleo_get_transfer_statistics` returns the current-season completed-transfer
total and counts per active user in the authenticated league. Pass `userId` to
return the count for one user; IDs outside the authenticated league return an
empty user list. The tool never accepts a league ID.

## TransferAI

`cycleo_get_transfer_advice` calls the account-gated
`GET /races/{raceId}/transfer-advice` route. It accepts a required positive
`raceId`, an optional `limit` from 1 through 50, and optional `includeOwned`
and `allowStarted` booleans. Omitted options preserve the API defaults. The
Cycleo API continues to enforce race visibility, league scoping, and the
account's TransferAI entitlement.
