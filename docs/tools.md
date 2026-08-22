# Read-only tool contract

Only the tools registered in `src/tools.mjs` are exposed. Every tool is
annotated read-only and has bounded arguments. Tool handlers call fixed GET
routes on Cycleo's versioned API; there is no arbitrary URL, SQL or mutation
tool.

The initial tool set is intentionally small. Add a tool only when its API
route, user/league scoping and response-size limits are documented and tested.

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
