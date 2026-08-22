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
  await callTool('cycleo_list_races', { limit: 999 }, { api, token: 't', user: { id: 1 } });
  assert.deepEqual(calls.map((call) => call.path), ['/team', '/teams/42', '/today', '/races']);
  assert.equal(calls[3].query.limit, 50);
});
