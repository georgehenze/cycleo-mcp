const DEFAULT_TIMEOUT_MS = 10000;

export class CycleoApiError extends Error {
  constructor(message, status = 502, code = 'cycleo_api_error') {
    super(message);
    this.name = 'CycleoApiError';
    this.status = status;
    this.code = code;
  }
}

export class CycleoApi {
  constructor({ baseUrl = process.env.CYCLEO_API_BASE_URL, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    if (!baseUrl) throw new Error('CYCLEO_API_BASE_URL is required');
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.timeoutMs = Number(process.env.CYCLEO_TIMEOUT_MS || timeoutMs);
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
      const body = await response.json().catch(() => null);
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
