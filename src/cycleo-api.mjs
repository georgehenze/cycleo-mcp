const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_MAX_RESPONSE_BYTES = 1024 * 1024;

export class CycleoApiError extends Error {
  constructor(message, status = 502, code = 'cycleo_api_error') {
    super(message);
    this.name = 'CycleoApiError';
    this.status = status;
    this.code = code;
  }
}

async function readCappedText(response, maxBytes) {
  const reader = response.body?.getReader?.();
  if (!reader) {
    const text = await response.text();
    if (Buffer.byteLength(text) > maxBytes) throw new CycleoApiError('Cycleo API response is too large', 502, 'cycleo_response_too_large');
    return text;
  }
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new CycleoApiError('Cycleo API response is too large', 502, 'cycleo_response_too_large');
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks).toString('utf8');
}

export class CycleoApi {
  constructor({ baseUrl = process.env.CYCLEO_API_BASE_URL, timeoutMs = DEFAULT_TIMEOUT_MS, maxResponseBytes } = {}) {
    if (!baseUrl) throw new Error('CYCLEO_API_BASE_URL is required');
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.timeoutMs = Number(process.env.CYCLEO_TIMEOUT_MS || timeoutMs);
    this.maxResponseBytes = Number(process.env.CYCLEO_MAX_RESPONSE_BYTES || maxResponseBytes || DEFAULT_MAX_RESPONSE_BYTES);
    if (!Number.isFinite(this.maxResponseBytes) || this.maxResponseBytes <= 0) throw new Error('CYCLEO_MAX_RESPONSE_BYTES must be a positive number');
  }

  async get(path, token, query = {}) {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: { accept: 'application/json', authorization: `Bearer ${token}`, 'x-cycleo-client': 'mcp' },
        signal: controller.signal
      });
      const raw = await readCappedText(response, this.maxResponseBytes);
      let body = null;
      try { body = raw ? JSON.parse(raw) : null; } catch { body = null; }
      if (!response.ok) {
        const error = body?.error;
        throw new CycleoApiError(error?.message || `Cycleo API returned HTTP ${response.status}`, response.status, error?.code);
      }
      return body?.data ?? body;
    } catch (error) {
      if (error.name === 'AbortError') throw new CycleoApiError('Cycleo API request timed out', 504, 'cycleo_timeout');
      if (error instanceof CycleoApiError) throw error;
      throw new CycleoApiError('Cycleo API is unavailable', 502, 'cycleo_unavailable');
    } finally {
      clearTimeout(timeout);
    }
  }

  me(token) { return this.get('/auth/me', token); }
}
