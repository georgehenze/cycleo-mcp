import { createServer } from 'node:http';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { CycleoApi, CycleoApiError } from './cycleo-api.mjs';
import { TOOL_DEFINITIONS, callTool } from './tools.mjs';
import { RESOURCE_DEFINITIONS, RESOURCE_TEMPLATES, readResource } from './resources.mjs';
import { PROMPT_DEFINITIONS, getPrompt } from './prompts.mjs';

const port = Number(process.env.PORT || 8787);
const authMode = process.env.MCP_AUTH_MODE || 'bearer';
const listenHost = process.env.MCP_HOST || (authMode === 'local' ? '127.0.0.1' : '0.0.0.0');
const resource = process.env.OAUTH_RESOURCE || process.env.MCP_PUBLIC_URL || `http://localhost:${port}`;
const issuer = process.env.OAUTH_ISSUER || 'https://www.cycleo.com';
const clientId = process.env.OAUTH_CLIENT_ID || 'local-test';
const redirectUri = process.env.OAUTH_REDIRECT_URI || `${resource}/callback`;
const tokenStorePath = process.env.TOKEN_STORE_PATH || `${homedir()}/.cycleo-mcp/tokens.json`;
const oauthTimeoutMs = Number(process.env.OAUTH_TIMEOUT_MS || 10000);
const pendingTtlMs = 5 * 60 * 1000;
const sessionTtlMs = 60 * 60 * 1000;
const maxPending = 100;
const maxSessions = 1000;
const authCacheTtlMs = Number(process.env.AUTH_CACHE_TTL_MS ?? 30000);
const maxAuthCache = 5000;
const rateLimitPerMin = Number(process.env.RATE_LIMIT_PER_MIN ?? 120);
const rateLimitWindowMs = 60 * 1000;
const maxRateLimitKeys = 10000;
const maxStreamsPerSession = 4;
const accessLog = process.env.ACCESS_LOG !== 'off' && process.env.NODE_ENV !== 'test';
const supportedProtocolVersions = ['2025-11-25', '2025-06-18', '2025-03-26'];
const allowedOrigins = new Set((process.env.ALLOWED_ORIGINS || new URL(resource).origin).split(',').map((origin) => origin.trim()).filter(Boolean));
const allowedHosts = new Set((process.env.ALLOWED_HOSTS || new URL(resource).host).split(',').map((host) => host.trim().toLowerCase()).filter(Boolean));
const loopbackHosts = new Set(['127.0.0.1', '::1', 'localhost']);
const api = new CycleoApi();
const sessions = new Map();
const pending = new Map();
const authCache = new Map();
const rateBuckets = new Map();
const tokenExchangeGrant = 'urn:ietf:params:oauth:grant-type:token-exchange';
const accessTokenType = 'urn:ietf:params:oauth:token-type:access_token';

if (!['bearer', 'local'].includes(authMode)) throw new Error('MCP_AUTH_MODE must be bearer or local');
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer from 1 through 65535');
if (!Number.isFinite(oauthTimeoutMs) || oauthTimeoutMs <= 0) throw new Error('OAUTH_TIMEOUT_MS must be a positive number');
if (!Number.isFinite(authCacheTtlMs) || authCacheTtlMs < 0) throw new Error('AUTH_CACHE_TTL_MS must be zero or a positive number');
if (!Number.isFinite(rateLimitPerMin) || rateLimitPerMin < 0) throw new Error('RATE_LIMIT_PER_MIN must be zero or a positive number');
if (authMode === 'local' && !['127.0.0.1', '::1', 'localhost'].includes(listenHost)) {
  throw new Error('Local authentication mode must bind to a loopback host');
}

function send(response, status, body, headers = {}) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
  response.end(body === undefined ? '' : JSON.stringify(body));
}

function sendHtml(response, status, body) {
  response.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  response.end(body);
}

function sendRpcError(response, id, code, message, status = 200) {
  return send(response, status, { jsonrpc: '2.0', id, error: { code, message } });
}

function validateOrigin(request) {
  const origin = request.headers.origin;
  if (origin && !allowedOrigins.has(origin)) {
    throw Object.assign(new Error('Origin is not allowed'), { status: 403, code: 'origin_not_allowed' });
  }
}

function validateHost(request) {
  const host = (request.headers.host || '').toLowerCase();
  if (!host) throw Object.assign(new Error('Host header is required'), { status: 400, code: 'missing_host' });
  const hostname = host.replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
  if (allowedHosts.has(host) || allowedHosts.has(hostname) || loopbackHosts.has(hostname)) return;
  throw Object.assign(new Error('Host is not allowed'), { status: 403, code: 'host_not_allowed' });
}

const corsAllowMethods = 'GET, POST, DELETE, OPTIONS';
const corsAllowHeaders = 'Authorization, Content-Type, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-Id';
const corsExposeHeaders = 'Mcp-Session-Id, Mcp-Protocol-Version, WWW-Authenticate';

function applyCors(request, response) {
  const origin = request.headers.origin;
  if (!origin || !allowedOrigins.has(origin)) return;
  response.setHeader('access-control-allow-origin', origin);
  response.setHeader('access-control-allow-credentials', 'true');
  response.setHeader('access-control-expose-headers', corsExposeHeaders);
  response.setHeader('vary', 'Origin');
}

function validateAccept(request) {
  const accept = (request.headers.accept || '').toLowerCase();
  if (!accept.includes('application/json') || !accept.includes('text/event-stream')) {
    throw Object.assign(new Error('Accept must include application/json and text/event-stream'), { status: 406, code: 'not_acceptable' });
  }
}

function validateContentType(request) {
  const contentType = request.headers['content-type'] || '';
  if (!contentType.toLowerCase().startsWith('application/json')) {
    throw Object.assign(new Error('Content-Type must be application/json'), { status: 415, code: 'unsupported_media_type' });
  }
}

function closeStream(entry) {
  if (entry.closed) return;
  entry.closed = true;
  clearInterval(entry.keepAlive);
  entry.session.streams?.delete(entry);
  try { entry.response.end(); } catch { /* already torn down */ }
}

function closeSessionStreams(session) {
  for (const entry of session.streams ? [...session.streams] : []) closeStream(entry);
}

function dropSession(sessionId, session) {
  closeSessionStreams(session);
  sessions.delete(sessionId);
}

function cleanState(now = Date.now()) {
  for (const [state, flow] of pending) {
    if (now - flow.created > pendingTtlMs) pending.delete(state);
  }
  for (const [sessionId, session] of sessions) {
    if (now - session.lastSeen > sessionTtlMs) dropSession(sessionId, session);
  }
  for (const [key, entry] of authCache) {
    if (entry.expires <= now) authCache.delete(key);
  }
  for (const [key, bucket] of rateBuckets) {
    if (now - bucket.windowStart > rateLimitWindowMs) rateBuckets.delete(key);
  }
}

function tokenKey(token) {
  return createHash('sha256').update(token).digest('base64url');
}

function enforceRateLimit(key, now = Date.now()) {
  if (rateLimitPerMin <= 0) return;
  let bucket = rateBuckets.get(key);
  if (!bucket || now - bucket.windowStart > rateLimitWindowMs) {
    if (rateBuckets.size >= maxRateLimitKeys) rateBuckets.delete(rateBuckets.keys().next().value);
    bucket = { windowStart: now, count: 0 };
    rateBuckets.set(key, bucket);
  }
  bucket.count += 1;
  if (bucket.count > rateLimitPerMin) {
    const retryAfter = Math.max(1, Math.ceil((bucket.windowStart + rateLimitWindowMs - now) / 1000));
    throw Object.assign(new Error('Rate limit exceeded'), { status: 429, code: 'rate_limited', retryAfter });
  }
}

function logRequest(request, response, startedAt) {
  if (!accessLog) return;
  const line = {
    at: new Date().toISOString(),
    method: request.method,
    path: (request.url || '/').split('?')[0],
    status: response.statusCode,
    ms: Math.round(performance.now() - startedAt)
  };
  process.stderr.write(`${JSON.stringify(line)}\n`);
}

async function oauthFetch(url, options) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), oauthTimeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error.name === 'AbortError') throw Object.assign(new Error('OAuth request timed out'), { status: 504, code: 'oauth_timeout' });
    throw Object.assign(new Error('OAuth server is unavailable'), { status: 502, code: 'oauth_unavailable' });
  } finally {
    clearTimeout(timeout);
  }
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
  const response = await oauthFetch(`${issuer}/oauth/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
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

async function exchangeAccessToken(token) {
  const body = new URLSearchParams({
    grant_type: tokenExchangeGrant,
    subject_token: token,
    subject_token_type: accessTokenType,
    resource: api.baseUrl
  });
  const response = await oauthFetch(`${issuer}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body
  });
  let payload = null;
  try { payload = await response.json(); } catch { /* handled below */ }
  if (!response.ok) {
    const authenticationFailure = response.status === 400 || response.status === 401;
    throw Object.assign(new Error(authenticationFailure ? 'Invalid MCP access token' : 'OAuth token exchange failed'), {
      status: authenticationFailure ? 401 : 502,
      code: authenticationFailure ? 'invalid_token' : 'oauth_exchange_failed'
    });
  }
  if (typeof payload?.access_token !== 'string' || payload.access_token === '') {
    throw Object.assign(new Error('OAuth token exchange returned an invalid access token'), { status: 502, code: 'oauth_exchange_failed' });
  }
  const expiresIn = Number(payload.expires_in);
  return {
    token: payload.access_token,
    expiresIn: Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 60
  };
}

const maxRequestBytes = 1024 * 1024;

async function readJson(request) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.byteLength;
    if (total > maxRequestBytes) throw Object.assign(new Error('Request too large'), { status: 413, code: 'request_too_large' });
    chunks.push(chunk);
  }
  return total ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
}

async function authenticatedUser(request) {
  const subjectToken = tokenFrom(request) || (authMode === 'local' ? await storedAccessToken() : null);
  if (!subjectToken) throw Object.assign(new Error('Authentication required'), { status: 401, code: 'authentication_required' });
  const key = tokenKey(subjectToken);
  enforceRateLimit(key);
  const cached = authCache.get(key);
  if (cached && cached.expires > Date.now()) return { token: cached.apiToken, user: cached.user, key };
  const exchange = await exchangeAccessToken(subjectToken);
  const user = await api.me(exchange.token);
  if (user?.id === undefined || user?.id === null) throw new CycleoApiError('Cycleo API returned an invalid user identity');
  if (authCacheTtlMs > 0) {
    if (authCache.size >= maxAuthCache) authCache.delete(authCache.keys().next().value);
    const exchangeTtlMs = Math.max(1000, (exchange.expiresIn - 5) * 1000);
    authCache.set(key, { apiToken: exchange.token, user, expires: Date.now() + Math.min(authCacheTtlMs, exchangeTtlMs) });
  }
  return { token: exchange.token, user, key };
}

function userKey(user) {
  return `${user?.id ?? ''}:${user?.league_id ?? user?.league?.id ?? ''}`;
}

function requireSession(request, user) {
  cleanState();
  const sessionId = request.headers['mcp-session-id'];
  if (typeof sessionId !== 'string') throw Object.assign(new Error('MCP-Session-Id is required'), { status: 400, code: 'missing_mcp_session' });
  const session = sessions.get(sessionId);
  if (!session || session.userKey !== userKey(user)) throw Object.assign(new Error('MCP session not found'), { status: 404, code: 'invalid_mcp_session' });
  const protocolVersion = request.headers['mcp-protocol-version'];
  if (protocolVersion && (protocolVersion !== session.protocolVersion || !supportedProtocolVersions.includes(protocolVersion))) {
    throw Object.assign(new Error('Unsupported MCP protocol version'), { status: 400, code: 'unsupported_protocol_version' });
  }
  session.lastSeen = Date.now();
  return { sessionId, session };
}

// Register an in-flight request so a later notifications/cancelled can abort it.
// Requests without an id (which the spec forbids for cancellable requests, but
// be defensive) get a live signal that simply never fires.
function trackRequest(session, id) {
  const controller = new AbortController();
  if (id === null || id === undefined) return { signal: controller.signal, release() {} };
  const inFlight = session.inFlight || (session.inFlight = new Map());
  inFlight.set(id, controller);
  return {
    signal: controller.signal,
    release() { inFlight.delete(id); }
  };
}

// A view of the Cycleo API client that threads a cancellation signal into every
// upstream GET, so aborting the signal stops work that is still in flight.
function cancellableApi(signal) {
  return { get: (path, token, query) => api.get(path, token, query, { signal }) };
}

async function handleMcp(request, response) {
  const { token, user } = await authenticatedUser(request);
  const body = await readJson(request);
  const id = body.id ?? null;
  // JSON-RPC notifications carry no id and must never receive a response, not
  // even an error one; they are acknowledged with a bare 202.
  const isNotification = body !== null && typeof body === 'object' && !Array.isArray(body)
    && body.id === undefined && typeof body.method === 'string';
  if (!body || typeof body !== 'object' || Array.isArray(body) || body.jsonrpc !== '2.0' || typeof body.method !== 'string') {
    return isNotification ? send(response, 202) : sendRpcError(response, id, -32600, 'Invalid Request');
  }
  if (body.method === 'initialize') {
    if (isNotification) return send(response, 202);
    if (typeof body.params?.protocolVersion !== 'string') return sendRpcError(response, id, -32602, 'protocolVersion is required');
    cleanState();
    if (sessions.size >= maxSessions) throw Object.assign(new Error('Too many active MCP sessions'), { status: 503, code: 'session_capacity_reached' });
    const protocolVersion = supportedProtocolVersions.includes(body.params.protocolVersion) ? body.params.protocolVersion : supportedProtocolVersions[0];
    const sessionId = randomUUID();
    sessions.set(sessionId, { userKey: userKey(user), protocolVersion, initialized: false, lastSeen: Date.now() });
    return send(response, 200, { jsonrpc: '2.0', id, result: { protocolVersion, capabilities: { tools: {}, resources: {}, prompts: {} }, serverInfo: { name: 'cycleo-mcp', version: '0.1.0' } } }, { 'mcp-session-id': sessionId, 'mcp-protocol-version': protocolVersion });
  }
  const { session } = requireSession(request, user);
  response.setHeader('mcp-protocol-version', session.protocolVersion);
  if (isNotification) {
    if (body.method === 'notifications/initialized') {
      session.initialized = true;
    } else if (body.method === 'notifications/cancelled') {
      const cancelledId = body.params?.requestId;
      if (cancelledId !== undefined) session.inFlight?.get(cancelledId)?.abort(new DOMException('Cancelled by client', 'AbortError'));
    }
    return send(response, 202);
  }
  if (!session.initialized && body.method !== 'ping') return sendRpcError(response, id, -32002, 'MCP session is not initialized');
  if (body.method === 'ping') return send(response, 200, { jsonrpc: '2.0', id, result: {} });
  if (body.method === 'tools/list') return send(response, 200, { jsonrpc: '2.0', id, result: { tools: TOOL_DEFINITIONS.map((tool) => ({ ...tool, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true } })) } });
  if (body.method === 'tools/call') {
    const { signal, release } = trackRequest(session, id);
    try {
      const data = await callTool(body.params?.name, body.params?.arguments ?? {}, { api: cancellableApi(signal), token, user });
      if (signal.aborted) return response.end();
      const structuredContent = data !== null && typeof data === 'object' && !Array.isArray(data) ? data : { data };
      return send(response, 200, { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent, isError: false } });
    } catch (error) {
      // The client cancelled this request: MCP says not to answer it at all.
      if (signal.aborted) return response.end();
      if (error.jsonRpcCode) return sendRpcError(response, id, error.jsonRpcCode, error.message);
      if (error instanceof CycleoApiError) {
        return send(response, 200, { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify({ error: { code: error.code, message: error.message } }) }], isError: true } });
      }
      throw error;
    } finally {
      release();
    }
  }
  if (body.method === 'resources/list') return send(response, 200, { jsonrpc: '2.0', id, result: { resources: RESOURCE_DEFINITIONS } });
  if (body.method === 'resources/templates/list') return send(response, 200, { jsonrpc: '2.0', id, result: { resourceTemplates: RESOURCE_TEMPLATES } });
  if (body.method === 'resources/read') {
    const { signal, release } = trackRequest(session, id);
    try {
      const result = await readResource(body.params?.uri, { api: cancellableApi(signal), token, user });
      if (signal.aborted) return response.end();
      return send(response, 200, { jsonrpc: '2.0', id, result });
    } catch (error) {
      if (signal.aborted) return response.end();
      if (error.jsonRpcCode) return sendRpcError(response, id, error.jsonRpcCode, error.message);
      if (error instanceof CycleoApiError) return sendRpcError(response, id, error.status === 404 ? -32002 : -32603, error.message);
      throw error;
    } finally {
      release();
    }
  }
  if (body.method === 'prompts/list') return send(response, 200, { jsonrpc: '2.0', id, result: { prompts: PROMPT_DEFINITIONS } });
  if (body.method === 'prompts/get') {
    try {
      return send(response, 200, { jsonrpc: '2.0', id, result: getPrompt(body.params?.name, body.params?.arguments ?? {}) });
    } catch (error) {
      if (error.jsonRpcCode) return sendRpcError(response, id, error.jsonRpcCode, error.message);
      throw error;
    }
  }
  return sendRpcError(response, id, -32601, 'Method not found');
}

function validateStreamAccept(request) {
  const accept = (request.headers.accept || '').toLowerCase();
  if (!accept.includes('text/event-stream') && !accept.includes('*/*')) {
    throw Object.assign(new Error('Accept must include text/event-stream'), { status: 406, code: 'not_acceptable' });
  }
}

async function handleMcpStream(request, response) {
  validateStreamAccept(request);
  const { user } = await authenticatedUser(request);
  const { session } = requireSession(request, user);

  const streams = session.streams || (session.streams = new Set());
  if (streams.size >= maxStreamsPerSession) {
    throw Object.assign(new Error('This MCP session already has the maximum number of open streams'), { status: 409, code: 'stream_limit_reached' });
  }

  response.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-store',
    'mcp-protocol-version': session.protocolVersion,
    connection: 'keep-alive'
  });
  response.write(': open\n\n');

  const entry = { response, session, keepAlive: null, closed: false };
  entry.keepAlive = setInterval(() => {
    session.lastSeen = Date.now();
    response.write(': keep-alive\n\n');
  }, 25000);
  entry.keepAlive.unref?.();
  streams.add(entry);

  const close = () => closeStream(entry);
  request.on('close', close);
  response.on('close', close);
  response.on('error', close);
}

const server = createServer(async (request, response) => {
  const startedAt = performance.now();
  response.on('finish', () => logRequest(request, response, startedAt));
  try {
    const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
    applyCors(request, response);
    validateOrigin(request);
    validateHost(request);
    if (request.method === 'OPTIONS') {
      return send(response, 204, undefined, {
        'access-control-allow-methods': corsAllowMethods,
        'access-control-allow-headers': corsAllowHeaders,
        'access-control-max-age': '600'
      });
    }
    if (url.pathname === '/healthz') return send(response, 200, { ok: true, service: 'cycleo-mcp' });
    if (url.pathname === '/.well-known/oauth-protected-resource' || url.pathname === '/.well-known/oauth-protected-resource/mcp') {
      return send(response, 200, { resource, authorization_servers: [issuer], scopes_supported: ['cycleo:read'] });
    }
    if (url.pathname === '/connect') {
      if (authMode !== 'local') return send(response, 404, { error: 'not_found' });
      if (request.method !== 'GET') return send(response, 405, { error: 'method_not_allowed' }, { allow: 'GET' });
      cleanState();
      if (pending.size >= maxPending) return send(response, 429, { error: 'too_many_pending_connections' });
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
      if (authMode !== 'local') return send(response, 404, { error: 'not_found' });
      if (request.method !== 'GET') return send(response, 405, { error: 'method_not_allowed' }, { allow: 'GET' });
      cleanState();
      if (url.searchParams.get('error')) {
        pending.delete(url.searchParams.get('state'));
        return sendHtml(response, 400, '<!doctype html><meta charset="utf-8"><title>Cycleo verbinding mislukt</title><h1>Verbinding mislukt</h1><p>De Cycleo-toegang is niet verleend. Je kunt dit venster sluiten.</p>');
      }
      if (!url.searchParams.get('code') || !url.searchParams.get('state')) {
        return sendHtml(response, 400, '<!doctype html><meta charset="utf-8"><title>Ongeldige callback</title><h1>Ongeldige callback</h1><p>De OAuth-callback bevat geen geldige autorisatie. Je kunt dit venster sluiten.</p>');
      }
      const state = url.searchParams.get('state');
      const flow = pending.get(state);
      if (!flow) return sendHtml(response, 400, '<!doctype html><meta charset="utf-8"><title>Verbinding verlopen</title><h1>Verbinding verlopen</h1><p>Start de verbinding opnieuw.</p>');
      pending.delete(state);
      const body = new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId, code: url.searchParams.get('code'), redirect_uri: redirectUri, resource, code_verifier: flow.verifier });
      const tokenResponse = await oauthFetch(`${issuer}/oauth/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
      if (!tokenResponse.ok) return sendHtml(response, 400, '<!doctype html><meta charset="utf-8"><title>Verbinding mislukt</title><h1>Verbinding mislukt</h1><p>De tokenuitwisseling is mislukt.</p>');
      const tokens = { ...(await tokenResponse.json()), obtained_at: Date.now() };
      saveTokenStore(tokens);
      return sendHtml(response, 200, '<!doctype html><meta charset="utf-8"><title>Cycleo verbonden</title><h1>Cycleo verbonden</h1><p>Je read-only Cycleo-verbinding is opgeslagen. Je kunt dit venster sluiten.</p>');
    }
    if (url.pathname !== '/mcp') return send(response, 404, { error: 'not_found' });
    if (request.method === 'DELETE') {
      const { user } = await authenticatedUser(request);
      const { sessionId, session } = requireSession(request, user);
      response.setHeader('mcp-protocol-version', session.protocolVersion);
      dropSession(sessionId, session);
      return send(response, 204);
    }
    if (request.method === 'GET') return await handleMcpStream(request, response);
    if (request.method !== 'POST') return send(response, 405, { error: 'method_not_allowed' }, { allow: 'GET, POST, DELETE' });
    validateAccept(request);
    validateContentType(request);
    return await handleMcp(request, response);
  } catch (error) {
    const status = error.status || (error instanceof SyntaxError ? 400 : 500);
    if (error instanceof SyntaxError) return sendRpcError(response, null, -32700, 'Parse error', 400);
    if (status === 401) return send(response, 401, { error: { code: error.code, message: error.message } }, { 'www-authenticate': `Bearer resource_metadata="${resource}/.well-known/oauth-protected-resource", scope="cycleo:read"` });
    const headers = error.retryAfter ? { 'retry-after': String(error.retryAfter) } : {};
    if (error instanceof CycleoApiError) return send(response, status, { error: { code: error.code, message: error.message } }, headers);
    return send(response, status, { error: { code: error.code || 'server_error', message: status === 500 ? 'Internal server error' : error.message } }, headers);
  }
});

// Bound how long a client may take to send a request; the SSE response stream
// stays open regardless because requestTimeout only covers request receipt.
server.headersTimeout = 10_000;
server.requestTimeout = 30_000;

function shutdown(signal) {
  console.log(`Cycleo MCP received ${signal}, draining connections`);
  server.close(() => process.exit(0));
  server.closeIdleConnections?.();
  for (const session of sessions.values()) closeSessionStreams(session);
  setTimeout(() => process.exit(0), 15000).unref();
}

if (process.env.NODE_ENV !== 'test') {
  server.listen(port, listenHost, () => console.log(`Cycleo MCP listening on ${listenHost}:${port} (${authMode} auth)`));
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => shutdown(signal));
}

export { server };
