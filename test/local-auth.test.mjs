import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let upstream;
let server;
let baseUrl;
let temporaryDirectory;
let tokenStorePath;

before(async () => {
  upstream = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    if (request.url === '/oauth/token') return response.end(JSON.stringify({ access_token: 'stored-token', refresh_token: 'refresh-token', expires_in: 3600 }));
    if (request.url === '/api/auth/me' && request.headers.authorization === 'Bearer stored-token') {
      return response.end(JSON.stringify({ data: { id: 7, league_id: 3 } }));
    }
    response.statusCode = 401;
    return response.end(JSON.stringify({ error: { code: 'unauthorized', message: 'Unauthorized' } }));
  });
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  const upstreamUrl = `http://127.0.0.1:${upstream.address().port}`;

  temporaryDirectory = await mkdtemp(join(tmpdir(), 'cycleo-mcp-test-'));
  tokenStorePath = join(temporaryDirectory, 'tokens.json');
  process.env.NODE_ENV = 'test';
  process.env.MCP_AUTH_MODE = 'local';
  process.env.MCP_HOST = '127.0.0.1';
  process.env.CYCLEO_API_BASE_URL = `${upstreamUrl}/api`;
  process.env.OAUTH_ISSUER = upstreamUrl;
  process.env.OAUTH_RESOURCE = 'http://localhost:8787';
  process.env.OAUTH_REDIRECT_URI = 'http://localhost:8787/callback';
  process.env.TOKEN_STORE_PATH = tokenStorePath;
  ({ server } = await import(`../src/server.mjs?local-auth-test=${Date.now()}`));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  for (const httpServer of [server, upstream]) {
    httpServer.close();
    httpServer.closeAllConnections();
  }
  await rm(temporaryDirectory, { recursive: true });
});

test('local mode stores OAuth tokens securely and permits tokenless loopback use', async () => {
  const connect = await fetch(`${baseUrl}/connect`, { redirect: 'manual' });
  assert.equal(connect.status, 302);
  const authorizationUrl = new URL(connect.headers.get('location'));
  const state = authorizationUrl.searchParams.get('state');
  assert.ok(state);

  const callback = await fetch(`${baseUrl}/callback?code=test-code&state=${encodeURIComponent(state)}`);
  assert.equal(callback.status, 200);
  assert.equal(JSON.parse(await readFile(tokenStorePath, 'utf8')).access_token, 'stored-token');
  assert.equal((await stat(tokenStorePath)).mode & 0o777, 0o600);

  const initialized = await fetch(`${baseUrl}/mcp`, {
    method: 'POST',
    headers: { accept: 'application/json, text/event-stream', 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'local-test', version: '1' } } })
  });
  assert.equal(initialized.status, 200);
  assert.ok(initialized.headers.get('mcp-session-id'));
});
