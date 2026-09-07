const MAX_LIMIT = 50;

function invalidArguments(message) {
  return Object.assign(new Error(message), { code: 'invalid_params', jsonRpcCode: -32602 });
}

export const TOOL_DEFINITIONS = [
  { name: 'cycleo_get_my_context', title: 'My Cycleo context', description: 'Get the authenticated Cycleo user, team and league context.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'cycleo_get_my_team', title: 'My Cycleo team', description: 'Get the authenticated Cycleo user\'s current team roster.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'cycleo_get_team', title: 'Cycleo team by ID', description: 'Get a visible Cycleo team and its current roster.', inputSchema: { type: 'object', required: ['teamId'], properties: { teamId: { type: 'integer', minimum: 1 } }, additionalProperties: false } },
  { name: 'cycleo_get_overview', title: 'My Cycleo overview', description: 'Get the authenticated Cycleo front-page overview.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'cycleo_list_races', title: 'List Cycleo races', description: 'List visible Cycleo races with optional paging.', inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: MAX_LIMIT }, page: { type: 'integer', minimum: 1 } }, additionalProperties: false } },
  { name: 'cycleo_get_race', title: 'Cycleo race overview', description: 'Get a visible Cycleo race and its read-only overview.', inputSchema: { type: 'object', required: ['raceId'], properties: { raceId: { type: 'integer', minimum: 1 } }, additionalProperties: false } },
  { name: 'cycleo_get_transfer_advice', title: 'TransferAI advice', description: 'Get account-gated TransferAI advice for a visible Cycleo race.', inputSchema: { type: 'object', required: ['raceId'], properties: { raceId: { type: 'integer', minimum: 1 }, limit: { type: 'integer', minimum: 1, maximum: MAX_LIMIT }, includeOwned: { type: 'boolean', default: false }, allowStarted: { type: 'boolean', default: false } }, additionalProperties: false } },
  { name: 'cycleo_search_riders', title: 'Search Cycleo riders', description: 'Search visible Cycleo riders.', inputSchema: { type: 'object', required: ['query'], properties: { query: { type: 'string', minLength: 1, maxLength: 100 }, limit: { type: 'integer', minimum: 1, maximum: MAX_LIMIT } }, additionalProperties: false } },
  { name: 'cycleo_get_rider', title: 'Cycleo rider profile', description: 'Get a visible Cycleo rider profile.', inputSchema: { type: 'object', required: ['riderId'], properties: { riderId: { type: 'integer', minimum: 1 } }, additionalProperties: false } }
];

function integer(value, fallback = 1) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function limit(value) { return Math.min(MAX_LIMIT, integer(value, 20)); }

export function validateToolArguments(name, args) {
  const tool = TOOL_DEFINITIONS.find((definition) => definition.name === name);
  if (!tool) throw Object.assign(new Error(`Unknown tool: ${name}`), { code: 'unknown_tool', jsonRpcCode: -32602 });
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw invalidArguments('Tool arguments must be an object');

  const schema = tool.inputSchema;
  for (const required of schema.required || []) {
    if (!Object.hasOwn(args, required)) throw invalidArguments(`Missing required argument: ${required}`);
  }
  if (schema.additionalProperties === false) {
    for (const key of Object.keys(args)) {
      if (!Object.hasOwn(schema.properties, key)) throw invalidArguments(`Unknown argument: ${key}`);
    }
  }
  for (const [key, value] of Object.entries(args)) {
    const property = schema.properties[key];
    if (!property) continue;
    if (property.type === 'integer' && !Number.isInteger(value)) throw invalidArguments(`${key} must be an integer`);
    if (property.type === 'string' && typeof value !== 'string') throw invalidArguments(`${key} must be a string`);
    if (property.type === 'boolean' && typeof value !== 'boolean') throw invalidArguments(`${key} must be a boolean`);
    if (property.minimum !== undefined && value < property.minimum) throw invalidArguments(`${key} must be at least ${property.minimum}`);
    if (property.maximum !== undefined && value > property.maximum) throw invalidArguments(`${key} must be at most ${property.maximum}`);
    if (property.minLength !== undefined && value.trim().length < property.minLength) throw invalidArguments(`${key} must not be empty`);
    if (property.maxLength !== undefined && value.length > property.maxLength) throw invalidArguments(`${key} is too long`);
  }
  return args;
}

export async function callTool(name, args, { api, token, user }) {
  validateToolArguments(name, args);
  switch (name) {
    case 'cycleo_get_my_context': return user;
    case 'cycleo_get_my_team': return api.get('/team', token);
    case 'cycleo_get_team': return api.get(`/teams/${integer(args.teamId)}`, token);
    case 'cycleo_get_overview': return api.get('/today', token);
    case 'cycleo_list_races': return api.get('/races', token, { page: integer(args.page), limit: limit(args.limit) });
    case 'cycleo_get_race': return api.get(`/races/${integer(args.raceId)}/overview`, token);
    case 'cycleo_get_transfer_advice': return api.get(`/races/${integer(args.raceId)}/transfer-advice`, token, {
      limit: args.limit === undefined ? undefined : limit(args.limit),
      include_owned: args.includeOwned === true ? 1 : undefined,
      allow_started: args.allowStarted === true ? 1 : undefined
    });
    case 'cycleo_search_riders': return api.get('/search', token, { q: String(args.query).trim(), limit: limit(args.limit) });
    case 'cycleo_get_rider': return api.get(`/riders/${integer(args.riderId)}`, token);
    default: throw Object.assign(new Error(`Unknown tool: ${name}`), { code: 'unknown_tool', jsonRpcCode: -32602 });
  }
}
