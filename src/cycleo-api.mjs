const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_MAX_RESPONSE_BYTES = 1024 * 1024;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_BASE_MS = 150;
const MAX_RETRY_DELAY_MS = 2000;
const MAX_RETRY_AFTER_MS = 30000;
const RETRYABLE_STATUS = new Set([429, 502, 503, 504]);

export class CycleoApiError extends Error {
  constructor(message, status = 502, code = 'cycleo_api_error', { retryable = false, retryAfterMs } = {}) {
    super(message);
    this.name = 'CycleoApiError';
    this.status = status;
    this.code = code;
    this.retryable = retryable;
    this.retryAfterMs = retryAfterMs;
  }
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    let timeout;
    const cancelled = () => {
      clearTimeout(timeout);
      reject(new CycleoApiError('Cycleo API request was cancelled', 499, 'cycleo_cancelled'));
    };
    if (signal?.aborted) return cancelled();
    timeout = setTimeout(() => {
      signal?.removeEventListener('abort', cancelled);
      resolve();
    }, ms);
    signal?.addEventListener('abort', cancelled, { once: true });
  });
}

function retryAfterMsFrom(header) {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(header);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
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
  constructor({ baseUrl = process.env.CYCLEO_API_BASE_URL, timeoutMs = DEFAULT_TIMEOUT_MS, maxResponseBytes, maxRetries } = {}) {
    if (!baseUrl) throw new Error('CYCLEO_API_BASE_URL is required');
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.timeoutMs = Number(process.env.CYCLEO_TIMEOUT_MS || timeoutMs);
    this.maxResponseBytes = Number(process.env.CYCLEO_MAX_RESPONSE_BYTES || maxResponseBytes || DEFAULT_MAX_RESPONSE_BYTES);
    if (!Number.isFinite(this.maxResponseBytes) || this.maxResponseBytes <= 0) throw new Error('CYCLEO_MAX_RESPONSE_BYTES must be a positive number');
    this.maxRetries = Number(process.env.CYCLEO_MAX_RETRIES ?? maxRetries ?? DEFAULT_MAX_RETRIES);
    if (!Number.isInteger(this.maxRetries) || this.maxRetries < 0) throw new Error('CYCLEO_MAX_RETRIES must be a non-negative integer');
    this.retryBaseMs = Number(process.env.CYCLEO_RETRY_BASE_MS || DEFAULT_RETRY_BASE_MS);
  }

  async #attempt(url, token, signal) {
    const timeoutController = new AbortController();
    const timeout = setTimeout(() => timeoutController.abort(), this.timeoutMs);
    const signals = signal ? [timeoutController.signal, signal] : [timeoutController.signal];
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: { accept: 'application/json', authorization: `Bearer ${token}`, 'x-cycleo-client': 'mcp' },
        signal: AbortSignal.any(signals)
      });
      const raw = await readCappedText(response, this.maxResponseBytes);
      let body = null;
      try { body = raw ? JSON.parse(raw) : null; } catch { body = null; }
      if (!response.ok) {
        const error = body?.error;
        throw new CycleoApiError(error?.message || `Cycleo API returned HTTP ${response.status}`, response.status, error?.code, {
          retryable: RETRYABLE_STATUS.has(response.status),
          retryAfterMs: retryAfterMsFrom(response.headers.get('retry-after'))
        });
      }
      return body?.data ?? body;
    } catch (error) {
      if (signal?.aborted) throw new CycleoApiError('Cycleo API request was cancelled', 499, 'cycleo_cancelled');
      if (error.name === 'AbortError') throw new CycleoApiError('Cycleo API request timed out', 504, 'cycleo_timeout');
      if (error instanceof CycleoApiError) throw error;
      throw new CycleoApiError('Cycleo API is unavailable', 502, 'cycleo_unavailable', { retryable: true });
    } finally {
      clearTimeout(timeout);
    }
  }

  async get(path, token, query = {}, { signal } = {}) {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    }

    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.#attempt(url, token, signal);
      } catch (error) {
        if (signal?.aborted || !error.retryable || attempt >= this.maxRetries) throw error;
        // Exponential backoff is capped tightly, but an explicit server-provided
        // Retry-After is honoured up to a much larger ceiling so we actually
        // back off while Cycleo is throttling.
        const backoff = Math.min(MAX_RETRY_DELAY_MS, this.retryBaseMs * 2 ** attempt) + Math.random() * 50;
        const delay = error.retryAfterMs === undefined
          ? backoff
          : Math.min(MAX_RETRY_AFTER_MS, error.retryAfterMs);
        await sleep(delay, signal);
      }
    }
  }

  me(token) { return this.get('/auth/me', token); }
}
