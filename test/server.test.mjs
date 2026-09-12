import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';

let upstream;
let server;
let endpoint;
const upstreamCalls = [];
let slowTeamRequestObserved;

before(async () => {
  upstream = createServer((request, response) => {
    upstreamCalls.push({ url: request.url, authorization: request.headers.authorization });
    if (request.url === '/oauth/token') {
      let raw = '';
      request.on('data', (chunk) => { raw += chunk; });
      return request.on('end', () => {
        const subjectToken = new URLSearchParams(raw).get('subject_token');
        if (subjectToken === 'mobile-token') {
          response.writeHead(400, { 'content-type': 'application/json' });
          return response.end(JSON.stringify({ error: 'invalid_grant' }));
        }
        response.writeHead(200, { 'content-type': 'application/json' });
        return response.end(JSON.stringify({ access_token: `backend-${subjectToken}`, token_type: 'Bearer', expires_in: 60 }));
      });
    }
    if (request.url === '/auth/me') {
      const id = request.headers.authorization === 'Bearer backend-other-token' ? 2 : 1;
      response.writeHead(200, { 'content-type': 'application/json' });
      return response.end(JSON.stringify({ data: { id, league_id: 10 } }));
    }
    if (request.url === '/team' && slowTeamRequestObserved) {
      slowTeamRequestObserved();
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    return response.end(JSON.stringify({ data: { ok: true } }));
  });
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));

  process.env.NODE_ENV = 'test';
  process.env.MCP_AUTH_MODE = 'bearer';
  process.env.CYCLEO_API_BASE_URL = `http://127.0.0.1:${upstream.address().port}`;
  process.env.OAUTH_ISSUER = `http://127.0.0.1:${upstream.address().port}`;
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

  const mobileToken = await post({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '2025-11-25' } }, { token: 'mobile-token' });
  assert.equal(mobileToken.status, 401);
  assert.equal((await mobileToken.json()).error.code, 'invalid_token');
});

test('MCP sessions are negotiated, user-bound, initialized and terminable', async () => {
  const initialized = await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } } });
  assert.equal(initialized.status, 200);
  const sessionId = initialized.headers.get('mcp-session-id');
  assert.ok(sessionId);
  assert.equal(initialized.headers.get('mcp-protocol-version'), '2025-11-25');
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
  assert.equal(listed.headers.get('mcp-protocol-version'), '2025-11-25');
  assert.ok((await listed.json()).result.tools.length > 0);

  const deleted = await fetch(endpoint, { method: 'DELETE', headers: { authorization: 'Bearer test-token', 'mcp-session-id': sessionId, 'mcp-protocol-version': '2025-11-25' } });
  assert.equal(deleted.status, 204);
  const expired = await post({ jsonrpc: '2.0', id: 6, method: 'tools/list' }, { sessionId, protocolVersion: '2025-11-25' });
  assert.equal(expired.status, 404);
});

test('JSON-RPC notifications are acknowledged without a response body', async () => {
  const idlessInitialize = await post({ jsonrpc: '2.0', method: 'initialize', params: { protocolVersion: '2025-11-25' } });
  assert.equal(idlessInitialize.status, 202);
  assert.equal(await idlessInitialize.text(), '');
  assert.equal(idlessInitialize.headers.get('mcp-session-id'), null, 'an initialize notification must not create a client session');
  assert.equal(idlessInitialize.headers.get('mcp-protocol-version'), null);

  const nullIdInitialize = await post({ jsonrpc: '2.0', id: null, method: 'initialize', params: { protocolVersion: '2025-11-25' } });
  assert.equal(nullIdInitialize.status, 200, 'an explicit null id remains a request, not an id-less notification');
  const nullIdSession = nullIdInitialize.headers.get('mcp-session-id');
  assert.ok(nullIdSession);
  await fetch(endpoint, { method: 'DELETE', headers: { authorization: 'Bearer test-token', 'mcp-session-id': nullIdSession } });

  const initialized = await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25' } });
  const sessionId = initialized.headers.get('mcp-session-id');

  const requestShapedNotification = await post({ jsonrpc: '2.0', id: 2, method: 'notifications/initialized' }, { sessionId });
  assert.equal((await requestShapedNotification.json()).error.code, -32002);
  const stillUninitialized = await post({ jsonrpc: '2.0', id: 3, method: 'tools/list' }, { sessionId });
  assert.equal((await stillUninitialized.json()).error.code, -32002, 'an id-bearing notification method must not mutate session state');

  await post({ jsonrpc: '2.0', method: 'notifications/initialized' }, { sessionId });

  const cancelled = await post({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 42, reason: 'user aborted' } }, { sessionId });
  assert.equal(cancelled.status, 202);
  assert.equal(await cancelled.text(), '', 'a notification never receives a JSON-RPC response');

  const unknown = await post({ jsonrpc: '2.0', method: 'notifications/progress', params: {} }, { sessionId });
  assert.equal(unknown.status, 202);
  assert.equal(await unknown.text(), '');
});

test('resources and prompts are advertised and served over JSON-RPC', async () => {
  const initialized = await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25' } });
  const sessionId = initialized.headers.get('mcp-session-id');
  assert.deepEqual((await initialized.json()).result.capabilities, { tools: {}, resources: {}, prompts: {} });
  await post({ jsonrpc: '2.0', method: 'notifications/initialized' }, { sessionId });

  const resources = await post({ jsonrpc: '2.0', id: 2, method: 'resources/list' }, { sessionId });
  assert.ok((await resources.json()).result.resources.some((resource) => resource.uri === 'cycleo://team'));

  const templates = await post({ jsonrpc: '2.0', id: 3, method: 'resources/templates/list' }, { sessionId });
  assert.ok((await templates.json()).result.resourceTemplates.some((template) => template.uriTemplate === 'cycleo://teams/{teamId}'));

  const read = await post({ jsonrpc: '2.0', id: 4, method: 'resources/read', params: { uri: 'cycleo://team' } }, { sessionId });
  const contents = (await read.json()).result.contents[0];
  assert.equal(contents.uri, 'cycleo://team');
  assert.equal(contents.mimeType, 'application/json');

  const unknown = await post({ jsonrpc: '2.0', id: 5, method: 'resources/read', params: { uri: 'cycleo://nope' } }, { sessionId });
  assert.equal((await unknown.json()).error.code, -32002);

  const prompts = await post({ jsonrpc: '2.0', id: 6, method: 'prompts/list' }, { sessionId });
  assert.ok((await prompts.json()).result.prompts.some((prompt) => prompt.name === 'cycleo_transfer_plan'));

  const prompt = await post({ jsonrpc: '2.0', id: 7, method: 'prompts/get', params: { name: 'cycleo_transfer_plan', arguments: { raceId: '2981' } } }, { sessionId });
  assert.match((await prompt.json()).result.messages[0].content.text, /race 2981/);

  const badPrompt = await post({ jsonrpc: '2.0', id: 8, method: 'prompts/get', params: { name: 'cycleo_transfer_plan', arguments: {} } }, { sessionId });
  assert.equal((await badPrompt.json()).error.code, -32602);
});

test('successful tool calls return both text and structured content', async () => {
  const initialized = await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25' } });
  const sessionId = initialized.headers.get('mcp-session-id');
  await post({ jsonrpc: '2.0', method: 'notifications/initialized' }, { sessionId });

  const called = await post({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'cycleo_get_my_team', arguments: {} } }, { sessionId });
  const result = (await called.json()).result;
  assert.equal(result.isError, false);
  assert.deepEqual(result.structuredContent, { ok: true });
  assert.equal(result.content[0].text, JSON.stringify({ ok: true }));
  const toolCall = upstreamCalls.find((call) => call.url === '/team');
  assert.equal(toolCall.authorization, 'Bearer backend-test-token', 'the client-facing token never reaches the Cycleo API');
});

test('requests with an unrecognised Host header are rejected', async () => {
  const { port } = server.address();
  const spoofed = await new Promise((resolve, reject) => {
    const clientRequest = httpRequest({
      host: '127.0.0.1',
      port,
      path: '/mcp',
      method: 'POST',
      headers: { host: 'evil.example', authorization: 'Bearer test-token', accept: 'application/json, text/event-stream', 'content-type': 'application/json' }
    }, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(raw) }));
    });
    clientRequest.on('error', reject);
    clientRequest.end(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25' } }));
  });
  assert.equal(spoofed.status, 403);
  assert.equal(spoofed.body.error.code, 'host_not_allowed');
});

test('protected-resource metadata is served at the root and the /mcp-suffixed path', async () => {
  for (const path of ['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp']) {
    const metadata = await fetch(endpoint.replace('/mcp', path));
    assert.equal(metadata.status, 200);
    const body = await metadata.json();
    assert.ok(body.resource);
    assert.deepEqual(body.scopes_supported, ['cycleo:read']);
  }
});

test('CORS preflight and headers are served for allow-listed origins only', async () => {
  const origin = 'http://localhost:8787';

  const preflight = await fetch(endpoint, { method: 'OPTIONS', headers: { origin } });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), origin);
  assert.match(preflight.headers.get('access-control-allow-methods') || '', /GET/);
  assert.match(preflight.headers.get('access-control-allow-headers') || '', /mcp-session-id/i);

  const forbidden = await fetch(endpoint, { method: 'OPTIONS', headers: { origin: 'https://attacker.example' } });
  assert.equal(forbidden.status, 403);
  assert.equal(forbidden.headers.get('access-control-allow-origin'), null);

  const rpc = await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25' } }, { origin });
  assert.equal(rpc.headers.get('access-control-allow-origin'), origin);
  assert.match(rpc.headers.get('access-control-expose-headers') || '', /mcp-session-id/i);
});

test('GET /mcp opens an SSE stream for an initialized session', async () => {
  const missingSession = await fetch(endpoint, { method: 'GET', headers: { authorization: 'Bearer test-token', accept: 'text/event-stream' } });
  assert.equal(missingSession.status, 400);
  await missingSession.body?.cancel();

  const initialized = await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25' } });
  const sessionId = initialized.headers.get('mcp-session-id');
  await post({ jsonrpc: '2.0', method: 'notifications/initialized' }, { sessionId });

  const controller = new AbortController();
  const stream = await fetch(endpoint, {
    method: 'GET',
    headers: { authorization: 'Bearer test-token', accept: 'text/event-stream', 'mcp-session-id': sessionId, 'mcp-protocol-version': '2025-11-25' },
    signal: controller.signal
  });
  assert.equal(stream.status, 200);
  assert.match(stream.headers.get('content-type') || '', /text\/event-stream/);

  assert.equal(stream.headers.get('mcp-protocol-version'), '2025-11-25');
  const chunk = await stream.body.getReader().read();
  assert.match(new TextDecoder().decode(chunk.value), /: open/);
  controller.abort();
});

test('a session may not hold more than four concurrent SSE streams', async () => {
  const initialized = await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25' } });
  const sessionId = initialized.headers.get('mcp-session-id');
  await post({ jsonrpc: '2.0', method: 'notifications/initialized' }, { sessionId });

  const openStream = () => {
    const controller = new AbortController();
    return fetch(endpoint, {
      method: 'GET',
      headers: { authorization: 'Bearer test-token', accept: 'text/event-stream', 'mcp-session-id': sessionId, 'mcp-protocol-version': '2025-11-25' },
      signal: controller.signal
    }).then((response) => ({ response, controller }));
  };

  const held = [];
  for (let i = 0; i < 4; i += 1) {
    const opened = await openStream();
    assert.equal(opened.response.status, 200);
    held.push(opened);
  }

  const rejected = await openStream();
  assert.equal(rejected.response.status, 409);
  assert.equal((await rejected.response.json()).error.code, 'stream_limit_reached');

  for (const { controller } of held) controller.abort();
});

test('deleting a session ends its open SSE streams and frees their slots', async () => {
  const initialized = await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25' } });
  const sessionId = initialized.headers.get('mcp-session-id');
  await post({ jsonrpc: '2.0', method: 'notifications/initialized' }, { sessionId });

  const streamHeaders = { authorization: 'Bearer test-token', accept: 'text/event-stream', 'mcp-session-id': sessionId, 'mcp-protocol-version': '2025-11-25' };
  const controller = new AbortController();
  const stream = await fetch(endpoint, { method: 'GET', headers: streamHeaders, signal: controller.signal });
  const reader = stream.body.getReader();
  await reader.read();

  const deleted = await fetch(endpoint, { method: 'DELETE', headers: { authorization: 'Bearer test-token', 'mcp-session-id': sessionId, 'mcp-protocol-version': '2025-11-25' } });
  assert.equal(deleted.status, 204);

  let done = false;
  for (let i = 0; i < 5 && !done; i += 1) done = (await reader.read()).done;
  assert.ok(done, 'the server closed the SSE response when the session was deleted');

  controller.abort();
});

test('deleting a session cancels an in-flight tool request', async () => {
  const initialized = await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25' } });
  const sessionId = initialized.headers.get('mcp-session-id');
  await post({ jsonrpc: '2.0', method: 'notifications/initialized' }, { sessionId });

  const requestReached = new Promise((resolve) => { slowTeamRequestObserved = resolve; });
  const toolCall = post({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'cycleo_get_my_team', arguments: {} } }, { sessionId });
  await requestReached;

  const deleted = await fetch(endpoint, { method: 'DELETE', headers: { authorization: 'Bearer test-token', 'mcp-session-id': sessionId, 'mcp-protocol-version': '2025-11-25' } });
  assert.equal(deleted.status, 204);

  const response = await toolCall;
  assert.equal(response.status, 200);
  assert.equal(await response.text(), '', 'a request cancelled by session teardown must not produce a JSON-RPC response');
  slowTeamRequestObserved = undefined;
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
  assert.equal(upstreamCalls.length, callsBefore, 'a rejected tool call reaches neither the tool route nor a fresh /auth/me');
});

test('identity lookups are cached briefly instead of re-hitting /auth/me per request', async () => {
  const initialized = await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25' } });
  const sessionId = initialized.headers.get('mcp-session-id');
  await post({ jsonrpc: '2.0', method: 'notifications/initialized' }, { sessionId });

  const before = upstreamCalls.filter((call) => call.url === '/auth/me').length;
  for (let i = 0; i < 3; i += 1) {
    await post({ jsonrpc: '2.0', id: 10 + i, method: 'tools/list' }, { sessionId });
  }
  const after = upstreamCalls.filter((call) => call.url === '/auth/me').length;
  assert.equal(after, before, 'cached identity serves repeated requests');
});
