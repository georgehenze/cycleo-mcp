import test from 'node:test';
import assert from 'node:assert/strict';
import { RESOURCE_DEFINITIONS, RESOURCE_TEMPLATES, readResource } from '../src/resources.mjs';

test('resource definitions and templates are JSON and well-formed', () => {
  assert.ok(RESOURCE_DEFINITIONS.length > 0);
  for (const resource of RESOURCE_DEFINITIONS) {
    assert.match(resource.uri, /^cycleo:\/\//);
    assert.equal(resource.mimeType, 'application/json');
  }
  for (const template of RESOURCE_TEMPLATES) {
    assert.match(template.uriTemplate, /^cycleo:\/\/.*\{.+\}/);
    assert.equal(template.mimeType, 'application/json');
  }
});

test('resource reads only reach allow-listed GET routes', async () => {
  const calls = [];
  const api = { get: async (path, token, query) => { calls.push({ path, query }); return { path }; } };
  const context = { api, token: 't', user: { id: 5, league_id: 3 } };

  const me = await readResource('cycleo://me', context);
  assert.deepEqual(JSON.parse(me.contents[0].text), { id: 5, league_id: 3 });

  await readResource('cycleo://team', context);
  await readResource('cycleo://overview', context);
  await readResource('cycleo://races', context);
  await readResource('cycleo://rankings', context);
  await readResource('cycleo://transfers/history', context);
  await readResource('cycleo://transfers/radar', context);
  await readResource('cycleo://teams/42', context);
  await readResource('cycleo://races/2981', context);
  await readResource('cycleo://races/2981/transfer-advice', context);
  await readResource('cycleo://races/2981/result', context);
  await readResource('cycleo://races/2981/classification', context);
  await readResource('cycleo://riders/7', context);

  assert.deepEqual(calls.map((call) => call.path), [
    '/team', '/today', '/races', '/rankings/cycleo-points', '/transfers/history', '/transfers/radar',
    '/teams/42', '/races/2981/overview', '/races/2981/transfer-advice',
    '/races/2981/cycleo-result', '/races/2981/classification', '/riders/7'
  ]);
});

test('resource reads reject malformed and unknown uris before any API call', async () => {
  const context = { api: { get: async () => assert.fail('unknown resources must not reach the API') }, token: 't', user: { id: 1 } };
  await assert.rejects(readResource('', context), { jsonRpcCode: -32602 });
  await assert.rejects(readResource('cycleo://teams/0', context), { jsonRpcCode: -32602 });
  await assert.rejects(readResource('cycleo://teams/abc', context), { jsonRpcCode: -32602 });
  await assert.rejects(readResource('cycleo://unknown', context), { jsonRpcCode: -32002 });
});
