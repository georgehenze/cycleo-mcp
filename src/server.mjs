import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { CycleoApi, CycleoApiError } from './cycleo-api.mjs';
import { TOOL_DEFINITIONS, callTool } from './tools.mjs';

const port = Number(process.env.PORT || 8787);
const resource = process.env.OAUTH_RESOURCE || process.env.MCP_PUBLIC_URL || `http://localhost:${port}`;
const issuer = process.env.OAUTH_ISSUER || 'https://www.cycleo.com';
const api = new CycleoApi();
const sessions = new Set();

function send(response, status, body, headers = {}) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
  response.end(body === undefined ? '' : JSON.stringify(body));
}

function tokenFrom(request) {
  const value = request.headers.authorization || '';
  const match = /^Bearer\s+([^\s]+)$/i.exec(value);
  return match?.[1] || null;
}

async function readJson(request) {
  let raw = '';
  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > 1024 * 1024) throw Object.assign(new Error('Request too large'), { code: 'request_too_large' });
  }
  return raw ? JSON.parse(raw) : {};
}

async function authenticatedUser(request) {
  const token = tokenFrom(request);
  if (!token) throw Object.assign(new Error('Authentication required'), { status: 401, code: 'authentication_required' });
  const user = await api.me(token);
  return { token, user };
}

async function handleMcp(request, response) {
  const { token, user } = await authenticatedUser(request);
  const body = await readJson(request);
  const id = body.id ?? null;
  if (body.method === 'notifications/initialized') return send(response, 202);
  if (body.method === 'initialize') {
    const sessionId = randomUUID();
    sessions.add(sessionId);
    return send(response, 200, { jsonrpc: '2.0', id, result: { protocolVersion: body.params?.protocolVersion || '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'cycleo-mcp', version: '0.1.0' } } }, { 'mcp-session-id': sessionId });
  }
  if (body.method === 'tools/list') return send(response, 200, { jsonrpc: '2.0', id, result: { tools: TOOL_DEFINITIONS.map((tool) => ({ ...tool, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true } })) } });
  if (body.method === 'tools/call') {
    const result = await callTool(body.params?.name, body.params?.arguments || {}, { api, token, user });
    return send(response, 200, { jsonrpc: '2.0', id, result: { content: [result], isError: false } });
  }
  return send(response, 200, { jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } });
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
    if (url.pathname === '/healthz') return send(response, 200, { ok: true, service: 'cycleo-mcp' });
    if (url.pathname === '/.well-known/oauth-protected-resource') return send(response, 200, { resource, authorization_servers: [issuer], scopes_supported: ['cycleo:read'], resource_documentation: `${resource}/docs` });
    if (url.pathname !== '/mcp') return send(response, 404, { error: 'not_found' });
    if (request.method !== 'POST') return send(response, 405, { error: 'method_not_allowed' }, { allow: 'POST' });
    return await handleMcp(request, response);
  } catch (error) {
    const status = error.status || (error instanceof SyntaxError ? 400 : 500);
    if (status === 401) return send(response, 401, { error: { code: error.code, message: error.message } }, { 'www-authenticate': `Bearer resource_metadata="${resource}/.well-known/oauth-protected-resource", scope="cycleo:read"` });
    if (error instanceof CycleoApiError) return send(response, status, { error: { code: error.code, message: error.message } });
    return send(response, status, { error: { code: error.code || 'server_error', message: status === 500 ? 'Internal server error' : error.message } });
  }
});

server.listen(port, () => console.log(`Cycleo MCP listening on ${port}`));
