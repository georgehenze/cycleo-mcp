import test from 'node:test';
import assert from 'node:assert/strict';
import { TOOL_DEFINITIONS, callTool } from '../src/tools.mjs';

test('all initial tools are explicitly read-only', () => {
  assert.ok(TOOL_DEFINITIONS.length > 0);
  for (const tool of TOOL_DEFINITIONS) assert.equal(tool.inputSchema.additionalProperties, false);
});

test('tool handlers only call allow-listed GET routes', async () => {
  const calls = [];
  const api = { get: async (path, token, query) => { calls.push({ path, token, query }); return { path }; } };
  await callTool('cycleo_get_my_team', {}, { api, token: 't', user: { id: 1 } });
  await callTool('cycleo_get_team', { teamId: 42 }, { api, token: 't', user: { id: 1 } });
  await callTool('cycleo_get_overview', {}, { api, token: 't', user: { id: 1 } });
  await callTool('cycleo_list_races', { limit: 50 }, { api, token: 't', user: { id: 1 } });
  await callTool('cycleo_get_transfer_advice', { raceId: 2981, limit: 12, includeOwned: true, allowStarted: true }, { api, token: 't', user: { id: 1 } });
  await callTool('cycleo_get_rankings', {}, { api, token: 't', user: { id: 1 } });
  await callTool('cycleo_get_race_result', { raceId: 2981 }, { api, token: 't', user: { id: 1 } });
  await callTool('cycleo_get_race_classification', { raceId: 2981 }, { api, token: 't', user: { id: 1 } });
  await callTool('cycleo_get_transfer_history', {}, { api, token: 't', user: { id: 1 } });
  await callTool('cycleo_get_transfer_radar', {}, { api, token: 't', user: { id: 1 } });
  assert.deepEqual(calls.map((call) => call.path), [
    '/team', '/teams/42', '/today', '/races', '/races/2981/transfer-advice',
    '/rankings/cycleo-points', '/races/2981/cycleo-result', '/races/2981/classification',
    '/transfers/history', '/transfers/radar'
  ]);
  assert.equal(calls[3].query.limit, 50);
  assert.deepEqual(calls[4].query, { limit: 12, include_owned: 1, allow_started: 1 });
});

test('cycleo_get_my_context enriches identity with the season snapshot', async () => {
  const calls = [];
  const api = { get: async (path) => { calls.push(path); return { season: 2026 }; } };
  const result = await callTool('cycleo_get_my_context', {}, { api, token: 't', user: { id: 7, leagueId: 3 } });
  assert.deepEqual(calls, ['/sidebar/season']);
  assert.equal(result.id, 7);
  assert.deepEqual(result.season, { season: 2026 });
});

test('cycleo_get_my_context still returns identity when the season snapshot fails', async () => {
  const api = { get: async () => { throw new Error('upstream down'); } };
  const result = await callTool('cycleo_get_my_context', {}, { api, token: 't', user: { id: 7 } });
  assert.equal(result.id, 7);
  assert.equal(result.season, null);
});

test('tool handlers reject arguments outside their published schemas', async () => {
  const context = { api: { get: async () => assert.fail('invalid calls must not reach the API') }, token: 't', user: { id: 1 } };
  await assert.rejects(callTool('cycleo_get_team', {}, context), { code: 'invalid_params' });
  await assert.rejects(callTool('cycleo_get_team', { teamId: '42' }, context), { code: 'invalid_params' });
  await assert.rejects(callTool('cycleo_list_races', { limit: 51 }, context), { code: 'invalid_params' });
  await assert.rejects(callTool('cycleo_search_riders', { query: '   ' }, context), { code: 'invalid_params' });
  await assert.rejects(callTool('cycleo_get_my_team', { unexpected: true }, context), { code: 'invalid_params' });
  await assert.rejects(callTool('cycleo_get_race_result', {}, context), { code: 'invalid_params' });
  await assert.rejects(callTool('cycleo_get_rankings', { raceId: 1 }, context), { code: 'invalid_params' });
});

test('TransferAI preserves API defaults when optional arguments are omitted', async () => {
  const calls = [];
  const api = { get: async (path, token, query) => { calls.push({ path, token, query }); return { path }; } };
  await callTool('cycleo_get_transfer_advice', { raceId: 2981 }, { api, token: 't', user: { id: 1 } });
  assert.deepEqual(calls[0], {
    path: '/races/2981/transfer-advice',
    token: 't',
    query: { limit: undefined, include_owned: undefined, allow_started: undefined }
  });
});
