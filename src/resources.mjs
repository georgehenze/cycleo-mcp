const JSON_MIME = 'application/json';

function invalidParams(message) {
  return Object.assign(new Error(message), { code: 'invalid_params', jsonRpcCode: -32602 });
}

function positiveId(raw, name) {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) throw invalidParams(`${name} must be a positive integer`);
  return value;
}

export const RESOURCE_DEFINITIONS = [
  { uri: 'cycleo://me', name: 'cycleo_me', title: 'My Cycleo context', description: 'The authenticated Cycleo user, team and league context.', mimeType: JSON_MIME },
  { uri: 'cycleo://team', name: 'cycleo_team', title: 'My Cycleo team', description: 'The authenticated user\'s current team roster.', mimeType: JSON_MIME },
  { uri: 'cycleo://overview', name: 'cycleo_overview', title: 'My Cycleo overview', description: 'The authenticated front-page overview.', mimeType: JSON_MIME },
  { uri: 'cycleo://races', name: 'cycleo_races', title: 'Visible Cycleo races', description: 'The first page of visible Cycleo races.', mimeType: JSON_MIME }
];

export const RESOURCE_TEMPLATES = [
  { uriTemplate: 'cycleo://teams/{teamId}', name: 'cycleo_team_by_id', title: 'Cycleo team by id', description: 'A visible Cycleo team and its current roster.', mimeType: JSON_MIME },
  { uriTemplate: 'cycleo://races/{raceId}', name: 'cycleo_race_by_id', title: 'Cycleo race by id', description: 'A visible Cycleo race and its read-only overview.', mimeType: JSON_MIME },
  { uriTemplate: 'cycleo://races/{raceId}/transfer-advice', name: 'cycleo_transfer_advice_by_race', title: 'TransferAI advice by race', description: 'Account-gated TransferAI advice for a visible Cycleo race.', mimeType: JSON_MIME },
  { uriTemplate: 'cycleo://riders/{riderId}', name: 'cycleo_rider_by_id', title: 'Cycleo rider by id', description: 'A visible Cycleo rider profile.', mimeType: JSON_MIME }
];

export async function readResource(uri, { api, token, user }) {
  if (typeof uri !== 'string' || uri === '') throw invalidParams('resource uri is required');
  const wrap = (data) => ({ contents: [{ uri, mimeType: JSON_MIME, text: JSON.stringify(data) }] });

  if (uri === 'cycleo://me') return wrap(user);
  if (uri === 'cycleo://team') return wrap(await api.get('/team', token));
  if (uri === 'cycleo://overview') return wrap(await api.get('/today', token));
  if (uri === 'cycleo://races') return wrap(await api.get('/races', token, { page: 1, limit: 20 }));

  let match;
  if ((match = /^cycleo:\/\/teams\/([^/]+)$/.exec(uri))) {
    return wrap(await api.get(`/teams/${positiveId(match[1], 'teamId')}`, token));
  }
  if ((match = /^cycleo:\/\/races\/([^/]+)\/transfer-advice$/.exec(uri))) {
    return wrap(await api.get(`/races/${positiveId(match[1], 'raceId')}/transfer-advice`, token));
  }
  if ((match = /^cycleo:\/\/races\/([^/]+)$/.exec(uri))) {
    return wrap(await api.get(`/races/${positiveId(match[1], 'raceId')}/overview`, token));
  }
  if ((match = /^cycleo:\/\/riders\/([^/]+)$/.exec(uri))) {
    return wrap(await api.get(`/riders/${positiveId(match[1], 'riderId')}`, token));
  }

  throw Object.assign(new Error(`Unknown resource: ${uri}`), { code: 'resource_not_found', jsonRpcCode: -32002 });
}
