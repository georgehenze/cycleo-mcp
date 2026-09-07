# Resources and prompts

The server advertises `resources` and `prompts` alongside `tools`. Both surfaces
are read-only, reuse the identity and league scoping from `GET /auth/me`, and —
for resources — dispatch the same fixed Cycleo GET routes as `src/tools.mjs`.
There is no `subscribe` or `listChanged` support.

## Resources

`resources/list` returns fixed, no-argument resources:

| URI | Cycleo route |
| --- | --- |
| `cycleo://me` | *(none — the authenticated identity)* |
| `cycleo://team` | `GET /team` |
| `cycleo://overview` | `GET /today` |
| `cycleo://races` | `GET /races` (first page) |

`resources/templates/list` returns the id-addressed templates:

| URI template | Cycleo route |
| --- | --- |
| `cycleo://teams/{teamId}` | `GET /teams/{teamId}` |
| `cycleo://races/{raceId}` | `GET /races/{raceId}/overview` |
| `cycleo://races/{raceId}/transfer-advice` | `GET /races/{raceId}/transfer-advice` |
| `cycleo://riders/{riderId}` | `GET /riders/{riderId}` |

`resources/read` accepts one `uri`. Every result is a single
`application/json` text content holding the API response. Ids must be positive
integers; a malformed URI returns JSON-RPC `-32602` and an unknown URI returns
`-32002`, both before any API request. Cycleo visibility, league scoping and the
TransferAI entitlement are still enforced by the API.

## Prompts

`prompts/list` / `prompts/get` return read-only analysis prompts. Each renders a
single `user` message that points the client at the relevant tools; the server
never executes anything on the user's behalf.

| Prompt | Arguments | Purpose |
| --- | --- | --- |
| `cycleo_team_review` | — | Review the current roster. |
| `cycleo_transfer_plan` | `raceId` (required), `limit` (1–50, optional) | TransferAI-guided transfer shortlist for a race. |
| `cycleo_race_preview` | `raceId` (required) | Summarise a race and its effect on the user's team. |

Arguments are validated (`raceId`/`limit` must be positive integers, `limit`
capped at 50); invalid or missing arguments and unknown prompt names return
JSON-RPC `-32602`.
