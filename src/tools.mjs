const MAX_LIMIT = 50;

const text = (value) => ({ type: 'text', text: JSON.stringify(value) });

export const TOOL_DEFINITIONS = [
  { name: 'cycleo_get_my_context', description: 'Get the authenticated Cycleo user, team and league context.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'cycleo_get_my_team', description: 'Get the authenticated Cycleo user\'s current team roster.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'cycleo_get_team', description: 'Get a visible Cycleo team and its current roster.', inputSchema: { type: 'object', required: ['teamId'], properties: { teamId: { type: 'integer', minimum: 1 } }, additionalProperties: false } },
  { name: 'cycleo_get_overview', description: 'Get the authenticated Cycleo front-page overview.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'cycleo_list_races', description: 'List visible Cycleo races with optional paging.', inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: MAX_LIMIT }, page: { type: 'integer', minimum: 1 } }, additionalProperties: false } },
  { name: 'cycleo_get_race', description: 'Get a visible Cycleo race and its read-only overview.', inputSchema: { type: 'object', required: ['raceId'], properties: { raceId: { type: 'integer', minimum: 1 } }, additionalProperties: false } },
  { name: 'cycleo_search_riders', description: 'Search visible Cycleo riders.', inputSchema: { type: 'object', required: ['query'], properties: { query: { type: 'string', minLength: 1, maxLength: 100 }, limit: { type: 'integer', minimum: 1, maximum: MAX_LIMIT } }, additionalProperties: false } },
  { name: 'cycleo_get_rider', description: 'Get a visible Cycleo rider profile.', inputSchema: { type: 'object', required: ['riderId'], properties: { riderId: { type: 'integer', minimum: 1 } }, additionalProperties: false } }
];

function integer(value, fallback = 1) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function limit(value) { return Math.min(MAX_LIMIT, integer(value, 20)); }

export async function callTool(name, args, { api, token, user }) {
  switch (name) {
    case 'cycleo_get_my_context': return text(user);
    case 'cycleo_get_my_team': return text(await api.get('/team', token));
    case 'cycleo_get_team': return text(await api.get(`/teams/${integer(args.teamId)}`, token));
    case 'cycleo_get_overview': return text(await api.get('/today', token));
    case 'cycleo_list_races': return text(await api.get('/races', token, { page: integer(args.page), limit: limit(args.limit) }));
    case 'cycleo_get_race': return text(await api.get(`/races/${integer(args.raceId)}/overview`, token));
    case 'cycleo_search_riders': return text(await api.get('/search', token, { q: String(args.query).trim(), limit: limit(args.limit) }));
    case 'cycleo_get_rider': return text(await api.get(`/riders/${integer(args.riderId)}`, token));
    default: throw Object.assign(new Error(`Unknown tool: ${name}`), { code: 'unknown_tool' });
  }
}
