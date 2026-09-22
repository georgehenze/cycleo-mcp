const MAX_LIMIT = 50;
const SERVER_TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

function invalidArguments(message) {
  return Object.assign(new Error(message), { code: 'invalid_params', jsonRpcCode: -32602 });
}

export const TOOL_DEFINITIONS = [
  { name: 'cycleo_get_current_time', title: 'Current Cycleo server time', description: 'Get the current server time as an ISO 8601 UTC timestamp, Unix timestamp, and local date/time with the server timezone.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'cycleo_get_my_context', title: 'My Cycleo context', description: 'Get the authenticated Cycleo user, team, league context and subscription status.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'cycleo_get_my_team', title: 'My Cycleo team', description: 'Get the authenticated Cycleo user\'s current team roster.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'cycleo_get_team', title: 'Cycleo team by ID', description: 'Get a visible Cycleo team and its current roster.', inputSchema: { type: 'object', required: ['teamId'], properties: { teamId: { type: 'integer', minimum: 1 } }, additionalProperties: false } },
  { name: 'cycleo_get_overview', title: 'My Cycleo overview', description: 'Get the authenticated Cycleo front-page overview.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'cycleo_list_races', title: 'List Cycleo races', description: 'List visible Cycleo races with optional paging.', inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: MAX_LIMIT }, page: { type: 'integer', minimum: 1 } }, additionalProperties: false } },
  { name: 'cycleo_get_race', title: 'Cycleo race overview', description: 'Get a visible Cycleo race and its read-only overview.', inputSchema: { type: 'object', required: ['raceId'], properties: { raceId: { type: 'integer', minimum: 1 } }, additionalProperties: false } },
  { name: 'cycleo_get_transfer_advice', title: 'TransferAI advice', description: 'Get account-gated TransferAI advice for a visible Cycleo race.', inputSchema: { type: 'object', required: ['raceId'], properties: { raceId: { type: 'integer', minimum: 1 }, limit: { type: 'integer', minimum: 1, maximum: MAX_LIMIT }, includeOwned: { type: 'boolean', default: false }, allowStarted: { type: 'boolean', default: false } }, additionalProperties: false } },
  { name: 'cycleo_search_entities', title: 'Search Cycleo', description: 'Search Cycleo riders, race editions and teams by name. Results are grouped by entity type; use a race result editionId with race tools and a team or rider result id with their tools. Each group returns at most six matches.', inputSchema: { type: 'object', required: ['query'], properties: { query: { type: 'string', minLength: 2, maxLength: 80 }, entityType: { type: 'string', enum: ['all', 'rider', 'race', 'team'], default: 'all' } }, additionalProperties: false } },
  { name: 'cycleo_search_riders', title: 'Search Cycleo riders', description: 'Search visible Cycleo riders by name or professional team. The query needs at least two characters; the Cycleo API returns at most six riders.', inputSchema: { type: 'object', required: ['query'], properties: { query: { type: 'string', minLength: 2, maxLength: 80 } }, additionalProperties: false } },
  { name: 'cycleo_get_rider', title: 'Cycleo rider profile', description: 'Get a visible Cycleo rider profile.', inputSchema: { type: 'object', required: ['riderId'], properties: { riderId: { type: 'integer', minimum: 1 } }, additionalProperties: false } },
  { name: 'cycleo_get_rider_startlist_races', title: 'Rider start-list races', description: 'List every current or upcoming not-yet-calculated Cycleo race whose start list includes this rider. Use cycleo_search_riders first when only a rider name is known.', inputSchema: { type: 'object', required: ['riderId'], properties: { riderId: { type: 'integer', minimum: 1 } }, additionalProperties: false } },
  { name: 'cycleo_get_rankings', title: 'Cycleo league standings', description: 'Get the authenticated league standings: the Cycleopunten ranking plus the medal and special rankings.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'cycleo_get_race_result', title: 'Cycleo race result', description: 'Get the authenticated league\'s calculated Cycleo result (points per team) for a visible race.', inputSchema: { type: 'object', required: ['raceId'], properties: { raceId: { type: 'integer', minimum: 1 } }, additionalProperties: false } },
  { name: 'cycleo_get_race_classification', title: 'Cycleo race classification', description: 'Get the league-enriched final rider classification for a visible race.', inputSchema: { type: 'object', required: ['raceId'], properties: { raceId: { type: 'integer', minimum: 1 } }, additionalProperties: false } },
  { name: 'cycleo_get_transfer_history', title: 'Cycleo transfer history', description: 'Get the completed transfer history for the authenticated league, most recent first.', inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: MAX_LIMIT }, page: { type: 'integer', minimum: 1 } }, additionalProperties: false } },
  { name: 'cycleo_get_transfer_statistics', title: 'Cycleo transfer statistics', description: 'Get current-season completed-transfer totals for the authenticated league, optionally for one user in that league.', inputSchema: { type: 'object', properties: { userId: { type: 'integer', minimum: 1 } }, additionalProperties: false } },
  { name: 'cycleo_get_transfer_radar', title: 'Cycleo transfer radar', description: 'Get the transfer radar (frequently transferred riders) for the authenticated league.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } }
];

function integer(value, fallback = 1) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function limit(value) { return Math.min(MAX_LIMIT, integer(value, 20)); }

function currentTime(now = new Date()) {
  const dateParts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: SERVER_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(now).filter(({ type }) => type !== 'literal').map(({ type, value }) => [type, value]));
  const timeParts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: SERVER_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(now).filter(({ type }) => type !== 'literal').map(({ type, value }) => [type, value]));
  const localDate = `${dateParts.year}-${dateParts.month}-${dateParts.day}`;
  const localTime = `${timeParts.hour}:${timeParts.minute}:${timeParts.second}`;
  return {
    utc: now.toISOString(),
    unixSeconds: Math.floor(now.getTime() / 1000),
    timeZone: SERVER_TIME_ZONE,
    localDate,
    localTime,
    localDateTime: `${localDate}T${localTime}`
  };
}

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
    if (property.enum && !property.enum.includes(value)) throw invalidArguments(`${key} must be one of: ${property.enum.join(', ')}`);
    if (property.minimum !== undefined && value < property.minimum) throw invalidArguments(`${key} must be at least ${property.minimum}`);
    if (property.maximum !== undefined && value > property.maximum) throw invalidArguments(`${key} must be at most ${property.maximum}`);
    if (property.minLength !== undefined && value.trim().length < property.minLength) {
      throw invalidArguments(property.minLength === 1 ? `${key} must not be empty` : `${key} must be at least ${property.minLength} characters`);
    }
    if (property.maxLength !== undefined && value.length > property.maxLength) throw invalidArguments(`${key} is too long`);
  }
  return args;
}

export async function callTool(name, args, { api, token, user }) {
  validateToolArguments(name, args);
  switch (name) {
    case 'cycleo_get_current_time': return currentTime();
    case 'cycleo_get_my_context': {
      const season = await api.get('/sidebar/season', token).catch(() => null);
      return { ...user, season };
    }
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
    case 'cycleo_search_entities': {
      const apiType = { all: '', rider: 'renner', race: 'wedstrijd', team: 'ploeg' }[args.entityType || 'all'];
      const results = await api.get('/search', token, { q: String(args.query).trim(), type: apiType });
      return {
        riders: results?.riders ?? [],
        races: results?.races ?? [],
        teams: results?.teams ?? []
      };
    }
    case 'cycleo_search_riders': {
      // The Cycleo /search route ignores `limit`, always returns at most six
      // riders, and also returns races and teams unless the type is pinned.
      const results = await api.get('/search', token, { q: String(args.query).trim(), type: 'renner' });
      return { riders: results?.riders ?? [] };
    }
    case 'cycleo_get_rider': return api.get(`/riders/${integer(args.riderId)}`, token);
    case 'cycleo_get_rider_startlist_races': return api.get(`/riders/${integer(args.riderId)}/upcoming-races`, token);
    case 'cycleo_get_rankings': return api.get('/rankings/cycleo-points', token);
    case 'cycleo_get_race_result': return api.get(`/races/${integer(args.raceId)}/cycleo-result`, token);
    case 'cycleo_get_race_classification': return api.get(`/races/${integer(args.raceId)}/classification`, token);
    case 'cycleo_get_transfer_history': return api.get('/transfers/history', token, { page: integer(args.page), limit: limit(args.limit) });
    case 'cycleo_get_transfer_statistics': return api.get('/transfers/statistics', token, { user_id: args.userId === undefined ? undefined : integer(args.userId) });
    case 'cycleo_get_transfer_radar': return api.get('/transfers/radar', token);
    default: throw Object.assign(new Error(`Unknown tool: ${name}`), { code: 'unknown_tool', jsonRpcCode: -32602 });
  }
}
