import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { CycleoApi, CycleoApiError } from '../src/cycleo-api.mjs';

let upstream;
let baseUrl;

before(async () => {
  upstream = createServer((request, response) => {
    if (request.url === '/slow') return;
    response.writeHead(request.url === '/fail' ? 403 : 200, { 'content-type': 'application/json' });
    if (request.url === '/fail') return response.end(JSON.stringify({ error: { code: 'forbidden', message: 'Not visible' } }));
    if (request.url === '/huge') return response.end(JSON.stringify({ data: { blob: 'x'.repeat(200000) } }));
    return response.end(JSON.stringify({ data: { url: request.url, authorization: request.headers.authorization, client: request.headers['x-cycleo-client'] } }));
  });
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${upstream.address().port}`;
});

after(() => {
  upstream.close();
  upstream.closeAllConnections();
});

test('Cycleo API client forwards authentication and bounded query values', async () => {
  const client = new CycleoApi({ baseUrl });
  const result = await client.get('/races', 'secret', { page: 2, empty: '' });
  assert.deepEqual(result, { url: '/races?page=2', authorization: 'Bearer secret', client: 'mcp' });
});

test('Cycleo API client preserves API errors and enforces timeouts', async () => {
  const client = new CycleoApi({ baseUrl, timeoutMs: 20 });
  await assert.rejects(client.get('/fail', 'secret'), (error) => {
    assert.ok(error instanceof CycleoApiError);
    assert.equal(error.status, 403);
    assert.equal(error.code, 'forbidden');
    return true;
  });
  await assert.rejects(client.get('/slow', 'secret'), { status: 504, code: 'cycleo_timeout' });
});

test('Cycleo API client caps oversized responses', async () => {
  const client = new CycleoApi({ baseUrl, maxResponseBytes: 4096 });
  await assert.rejects(client.get('/huge', 'secret'), { status: 502, code: 'cycleo_response_too_large' });
  const ok = await client.get('/races', 'secret');
  assert.equal(ok.url, '/races');
});
