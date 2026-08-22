# Read-only tool contract

Only the tools registered in `src/tools.mjs` are exposed. Every tool is
annotated read-only and has bounded arguments. Tool handlers call fixed GET
routes on Cycleo's versioned API; there is no arbitrary URL, SQL or mutation
tool.

The initial tool set is intentionally small. Add a tool only when its API
route, user/league scoping and response-size limits are documented and tested.
