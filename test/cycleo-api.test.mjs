import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { CycleoApi, CycleoApiError } from '../src/cycleo-api.mjs';

let upstream;
let baseUrl;
const attempts = new Map();
let retryAfterAttempts = 0;
let retryAfterObserved;

before(async () => {
  upstream = createServer((request, response) => {
    if (request.url === '/slow') return;
    if (request.url === '/retry-after') {
      retryAfterAttempts += 1;
      response.writeHead(503, { 'content-type': 'application/json', 'retry-after': '2' });
      response.end(JSON.stringify({ error: { code: 'unavailable', message: 'try later' } }));
      retryAfterObserved?.();
      return;
    }
    if (request.url.startsWith('/flaky')) {
      const seen = (attempts.get(request.url) ?? 0) + 1;
      attempts.set(request.url, seen);
      const failFor = Number(new URL(request.url, baseUrl).searchParams.get('fail') || 0);
      if (seen <= failFor) {
        response.writeHead(503, { 'content-type': 'application/json', 'retry-after': '0' });
        return response.end(JSON.stringify({ error: { code: 'unavailable', message: 'try later' } }));
      }
      response.writeHead(200, { 'content-type': 'application/json' });
      return response.end(JSON.stringify({ data: { attempts: seen } }));
    }
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

test('Cycleo API client retries transient failures then gives up', async () => {
  const client = new CycleoApi({ baseUrl, maxRetries: 2 });

  const recovered = await client.get('/flaky?fail=2', 'secret');
  assert.equal(recovered.attempts, 3, 'succeeds on the third attempt');

  await assert.rejects(client.get('/flaky?fail=9', 'secret'), { status: 503, code: 'unavailable' });
  assert.equal(attempts.get('/flaky?fail=9'), 3, 'one initial call plus two retries');
});

test('Cycleo API client stops an in-flight request when its signal is aborted', async () => {
  const client = new CycleoApi({ baseUrl, timeoutMs: 5000 });
  const controller = new AbortController();
  const pending = client.get('/slow', 'secret', {}, { signal: controller.signal });
  setTimeout(() => controller.abort(), 20);
  await assert.rejects(pending, (error) => {
    assert.ok(error instanceof CycleoApiError);
    assert.equal(error.code, 'cycleo_cancelled');
    return true;
  });
});

test('Cycleo API client stops Retry-After backoff when its signal is aborted', async () => {
  const client = new CycleoApi({ baseUrl, timeoutMs: 5000, maxRetries: 1 });
  const controller = new AbortController();
  const responseObserved = new Promise((resolve) => { retryAfterObserved = resolve; });
  retryAfterAttempts = 0;
  const started = Date.now();
  const pending = client.get('/retry-after', 'secret', {}, { signal: controller.signal });
  await responseObserved;
  await new Promise((resolve) => setTimeout(resolve, 25));
  controller.abort();
  await assert.rejects(pending, (error) => {
    assert.ok(error instanceof CycleoApiError);
    assert.equal(error.code, 'cycleo_cancelled');
    return true;
  });
  retryAfterObserved = undefined;
  assert.ok(Date.now() - started < 500, 'cancellation must not wait for the two-second Retry-After delay');
  assert.equal(retryAfterAttempts, 1, 'cancellation prevents the retry attempt');
});
