import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

let upstream;
let server;
let endpoint;
const upstreamCalls = [];

before(async () => {
  upstream = createServer((request, response) => {
    upstreamCalls.push({ url: request.url, authorization: request.headers.authorization });
    if (request.url === '/auth/me') {
      const id = request.headers.authorization === 'Bearer other-token' ? 2 : 1;
      response.writeHead(200, { 'content-type': 'application/json' });
      return response.end(JSON.stringify({ data: { id, league_id: 10 } }));
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    return response.end(JSON.stringify({ data: { ok: true } }));
  });
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));

  process.env.NODE_ENV = 'test';
  process.env.MCP_AUTH_MODE = 'bearer';
  process.env.CYCLEO_API_BASE_URL = `http://127.0.0.1:${upstream.address().port}`;
  ({ server } = await import(`../src/server.mjs?server-test=${Date.now()}`));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  endpoint = `http://127.0.0.1:${server.address().port}/mcp`;
});

after(async () => {
  for (const httpServer of [server, upstream]) {
    httpServer.close();
    httpServer.closeAllConnections();
  }
});

function post(body, { token = 'test-token', sessionId, protocolVersion, origin } = {}) {
  const headers = {
    accept: 'application/json, text/event-stream',
    'content-type': 'application/json'
  };
  if (token) headers.authorization = `Bearer ${token}`;
  if (sessionId) headers['mcp-session-id'] = sessionId;
  if (protocolVersion) headers['mcp-protocol-version'] = protocolVersion;
  if (origin) headers.origin = origin;
  return fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(body) });
}

test('bearer mode requires per-request authentication and hides local OAuth', async () => {
  const unauthenticated = await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25' } }, { token: null });
  assert.equal(unauthenticated.status, 401);

  const connect = await fetch(endpoint.replace('/mcp', '/connect'), { redirect: 'manual' });
  assert.equal(connect.status, 404);
});

test('MCP sessions are negotiated, user-bound, initialized and terminable', async () => {
  const initialized = await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } } });
  assert.equal(initialized.status, 200);
  const sessionId = initialized.headers.get('mcp-session-id');
  assert.ok(sessionId);
  assert.equal((await initialized.json()).result.protocolVersion, '2025-11-25');

  const missingSession = await post({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  assert.equal(missingSession.status, 400);

  const tooEarly = await post({ jsonrpc: '2.0', id: 3, method: 'tools/list' }, { sessionId });
  assert.equal((await tooEarly.json()).error.code, -32002);

  const notification = await post({ jsonrpc: '2.0', method: 'notifications/initialized' }, { sessionId, protocolVersion: '2025-11-25' });
  assert.equal(notification.status, 202);
  assert.equal(await notification.text(), '');

  const wrongUser = await post({ jsonrpc: '2.0', id: 4, method: 'tools/list' }, { token: 'other-token', sessionId, protocolVersion: '2025-11-25' });
  assert.equal(wrongUser.status, 404);

  const listed = await post({ jsonrpc: '2.0', id: 5, method: 'tools/list' }, { sessionId, protocolVersion: '2025-11-25' });
  assert.equal(listed.status, 200);
  assert.ok((await listed.json()).result.tools.length > 0);

  const deleted = await fetch(endpoint, { method: 'DELETE', headers: { authorization: 'Bearer test-token', 'mcp-session-id': sessionId, 'mcp-protocol-version': '2025-11-25' } });
  assert.equal(deleted.status, 204);
  const expired = await post({ jsonrpc: '2.0', id: 6, method: 'tools/list' }, { sessionId, protocolVersion: '2025-11-25' });
  assert.equal(expired.status, 404);
});

test('transport and tool validation reject unsafe requests before dispatch', async () => {
  const forbiddenOrigin = await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25' } }, { origin: 'https://attacker.example' });
  assert.equal(forbiddenOrigin.status, 403);

  const unacceptable = await fetch(endpoint, {
    method: 'POST',
    headers: { authorization: 'Bearer test-token', accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '2025-11-25' } })
  });
  assert.equal(unacceptable.status, 406);

  const initialized = await post({ jsonrpc: '2.0', id: 3, method: 'initialize', params: { protocolVersion: '2025-11-25' } });
  const sessionId = initialized.headers.get('mcp-session-id');
  await post({ jsonrpc: '2.0', method: 'notifications/initialized' }, { sessionId });
  const callsBefore = upstreamCalls.length;
  const invalid = await post({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'cycleo_get_team', arguments: {} } }, { sessionId });
  const invalidBody = await invalid.json();
  assert.equal(invalidBody.error.code, -32602);
  assert.equal(upstreamCalls.length, callsBefore + 1, 'only the per-request /auth/me call is allowed');
});
