import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

let upstream;
let server;
let endpoint;

before(async () => {
  upstream = createServer((request, response) => {
    if (request.url === '/oauth/token') {
      let raw = '';
      request.on('data', (chunk) => { raw += chunk; });
      return request.on('end', () => {
        const subjectToken = new URLSearchParams(raw).get('subject_token');
        response.writeHead(200, { 'content-type': 'application/json' });
        return response.end(JSON.stringify({ access_token: `backend-${subjectToken}`, token_type: 'Bearer', expires_in: 60 }));
      });
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    if (request.url === '/auth/me') return response.end(JSON.stringify({ data: { id: 1, league_id: 10 } }));
    return response.end(JSON.stringify({ data: { ok: true } }));
  });
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));

  process.env.NODE_ENV = 'test';
  process.env.MCP_AUTH_MODE = 'bearer';
  process.env.CYCLEO_API_BASE_URL = `http://127.0.0.1:${upstream.address().port}`;
  process.env.OAUTH_ISSUER = `http://127.0.0.1:${upstream.address().port}`;
  process.env.RATE_LIMIT_PER_MIN = '3';
  ({ server } = await import(`../src/server.mjs?rate-limit-test=${Date.now()}`));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  endpoint = `http://127.0.0.1:${server.address().port}/mcp`;
});

after(async () => {
  delete process.env.RATE_LIMIT_PER_MIN;
  for (const httpServer of [server, upstream]) {
    httpServer.close();
    httpServer.closeAllConnections();
  }
});

function ping(token) {
  return fetch(endpoint, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, accept: 'application/json, text/event-stream', 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25' } })
  });
}

test('per-token rate limiting returns 429 with Retry-After', async () => {
  assert.equal((await ping('tenant-a')).status, 200);
  assert.equal((await ping('tenant-a')).status, 200);
  assert.equal((await ping('tenant-a')).status, 200);

  const limited = await ping('tenant-a');
  assert.equal(limited.status, 429);
  assert.equal((await limited.json()).error.code, 'rate_limited');
  assert.ok(Number(limited.headers.get('retry-after')) >= 1);

  assert.equal((await ping('tenant-b')).status, 200, 'a different token has its own budget');
});
