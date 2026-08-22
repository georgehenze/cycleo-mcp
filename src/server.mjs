import { createServer } from 'node:http';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { CycleoApi, CycleoApiError } from './cycleo-api.mjs';
import { TOOL_DEFINITIONS, callTool } from './tools.mjs';

const port = Number(process.env.PORT || 8787);
const resource = process.env.OAUTH_RESOURCE || process.env.MCP_PUBLIC_URL || `http://localhost:${port}`;
const issuer = process.env.OAUTH_ISSUER || 'https://www.cycleo.com';
const clientId = process.env.OAUTH_CLIENT_ID || 'local-test';
const redirectUri = process.env.OAUTH_REDIRECT_URI || `${resource}/callback`;
const tokenStorePath = process.env.TOKEN_STORE_PATH || `${homedir()}/.cycleo-mcp/tokens.json`;
const api = new CycleoApi();
const sessions = new Set();
const pending = new Map();

function send(response, status, body, headers = {}) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
  response.end(body === undefined ? '' : JSON.stringify(body));
}

function sendHtml(response, status, body) {
  response.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  response.end(body);
}

function tokenFrom(request) {
  const value = request.headers.authorization || '';
  const match = /^Bearer\s+([^\s]+)$/i.exec(value);
  return match?.[1] || null;
}

function tokenStore() {
  try { return JSON.parse(readFileSync(tokenStorePath, 'utf8')); } catch { return null; }
}

function saveTokenStore(tokens) {
  const directory = tokenStorePath.slice(0, tokenStorePath.lastIndexOf('/'));
  if (directory) mkdirSync(directory, { recursive: true, mode: 0o700 });
  writeFileSync(tokenStorePath, JSON.stringify(tokens), { mode: 0o600 });
  chmodSync(tokenStorePath, 0o600);
}

async function refreshStoredToken(tokens) {
  if (!tokens?.refresh_token) return null;
  const body = new URLSearchParams({ grant_type: 'refresh_token', client_id: clientId, refresh_token: tokens.refresh_token, resource });
  const response = await fetch(`${issuer}/oauth/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
  if (!response.ok) return null;
  const next = await response.json();
  const stored = { ...tokens, ...next, obtained_at: Date.now() };
  saveTokenStore(stored);
  return stored;
}

async function storedAccessToken() {
  let tokens = tokenStore();
  if (!tokens?.access_token) return null;
  if (tokens.obtained_at && tokens.expires_in && Date.now() >= tokens.obtained_at + (tokens.expires_in - 30) * 1000) tokens = await refreshStoredToken(tokens);
  return tokens?.access_token || null;
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
  const token = tokenFrom(request) || await storedAccessToken();
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
    if (url.pathname === '/connect') {
      const verifier = randomBytes(32).toString('base64url');
      const state = randomBytes(24).toString('base64url');
      const challenge = createHash('sha256').update(verifier).digest('base64url');
      pending.set(state, { verifier, created: Date.now() });
      const authorize = new URL(`${issuer}/oauth/authorize`);
      authorize.search = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: redirectUri, resource, scope: 'cycleo:read', state, code_challenge: challenge, code_challenge_method: 'S256' });
      response.writeHead(302, { location: authorize.toString(), 'cache-control': 'no-store' });
      return response.end();
    }
    if (url.pathname === '/callback') {
      if (url.searchParams.get('error')) {
        return sendHtml(response, 400, '<!doctype html><meta charset="utf-8"><title>Cycleo verbinding mislukt</title><h1>Verbinding mislukt</h1><p>De Cycleo-toegang is niet verleend. Je kunt dit venster sluiten.</p>');
      }
      if (!url.searchParams.get('code') || !url.searchParams.get('state')) {
        return sendHtml(response, 400, '<!doctype html><meta charset="utf-8"><title>Ongeldige callback</title><h1>Ongeldige callback</h1><p>De OAuth-callback bevat geen geldige autorisatie. Je kunt dit venster sluiten.</p>');
      }
      const state = url.searchParams.get('state');
      const flow = pending.get(state);
      if (!flow || Date.now() - flow.created > 5 * 60 * 1000) return sendHtml(response, 400, '<!doctype html><meta charset="utf-8"><title>Verbinding verlopen</title><h1>Verbinding verlopen</h1><p>Start de verbinding opnieuw.</p>');
      pending.delete(state);
      const body = new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId, code: url.searchParams.get('code'), redirect_uri: redirectUri, resource, code_verifier: flow.verifier });
      const tokenResponse = await fetch(`${issuer}/oauth/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
      if (!tokenResponse.ok) return sendHtml(response, 400, '<!doctype html><meta charset="utf-8"><title>Verbinding mislukt</title><h1>Verbinding mislukt</h1><p>De tokenuitwisseling is mislukt.</p>');
      const tokens = { ...(await tokenResponse.json()), obtained_at: Date.now() };
      saveTokenStore(tokens);
      return sendHtml(response, 200, '<!doctype html><meta charset="utf-8"><title>Cycleo verbonden</title><h1>Cycleo verbonden</h1><p>Je read-only Cycleo-verbinding is opgeslagen. Je kunt dit venster sluiten.</p>');
    }
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
