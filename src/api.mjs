import { setTimeout as delay } from 'node:timers/promises';

const API_ROOT = 'https://api.deepseek.com/v1/tools/';
const ERROR_MESSAGES = {
  400: 'DeepSeek rejected the request parameters.',
  401: 'DeepSeek rejected the API key. Reconfigure the key.',
  402: 'The DeepSeek account has insufficient balance.',
  403: 'DeepSeek security policy rejected this page.',
  404: 'DeepSeek could not extract usable content. The page may be unavailable, blocked, or unsupported.',
  408: 'DeepSeek timed out reading the request.',
  413: 'DeepSeek rejected the request size.',
  429: 'DeepSeek rate limit exceeded. Wait before trying again.',
};

export class ApiError extends Error {
  constructor(message, { status = null, code = 'upstream_error', attempts = 0 } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.attempts = attempts;
  }
}

export class Gate {
  #active = 0;
  #waiting = [];
  constructor(limit) { this.limit = limit; }

  async run(operation, signal) {
    signal?.throwIfAborted();
    if (this.#active < this.limit) {
      this.#active += 1;
    } else {
      await new Promise((resolve, reject) => {
        const waiter = { resolve, reject, signal, abort: undefined };
        waiter.abort = () => {
          this.#waiting = this.#waiting.filter(entry => entry !== waiter);
          reject(signal.reason);
        };
        signal?.addEventListener('abort', waiter.abort, { once: true });
        this.#waiting.push(waiter);
      });
    }
    try {
      signal?.throwIfAborted();
      return await operation();
    } finally {
      const waiter = this.#waiting.shift();
      if (waiter) {
        waiter.signal?.removeEventListener('abort', waiter.abort);
        waiter.resolve();
      } else {
        this.#active -= 1;
      }
    }
  }
}

export function createApi({ getKey, fetchImpl = globalThis.fetch, timeoutMs = 45000, maxRetries = 1, sleep = delay } = {}) {
  const gates = { search: new Gate(4), fetch: new Gate(2) };

  return async function request(endpoint, body, callerSignal) {
    if (!gates[endpoint]) throw new ApiError('Unsupported endpoint.', { code: 'invalid_endpoint' });
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const signal = callerSignal ? AbortSignal.any([timeoutSignal, callerSignal]) : timeoutSignal;
    let attempts = 0;
    try {
      return await gates[endpoint].run(async () => {
        const key = await getKey();
        for (;;) {
          signal.throwIfAborted();
          attempts += 1;
          let response;
          try {
            response = await fetchImpl(`${API_ROOT}${endpoint}`, {
              method: 'POST',
              headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
              redirect: 'error',
              signal,
            });
          } catch {
            signal.throwIfAborted();
            throw new ApiError('Cannot reach api.deepseek.com. Check your network or HTTPS proxy. This ambiguous failure was not automatically retried.', { code: 'network_error', attempts });
          }
          if (!response.ok) {
            const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
            const retryAfter = response.headers.get('retry-after');
            await response.body?.cancel();
            if (retryable && attempts <= maxRetries) {
              let waitMs = 750;
              if (retryAfter) {
                const seconds = Number(retryAfter);
                waitMs = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retryAfter) - Date.now();
              }
              if (Number.isFinite(waitMs) && waitMs >= 0 && waitMs <= 5000) {
                await sleep(Math.max(250, waitMs), undefined, { signal });
                continue;
              }
            }
            throw new ApiError(ERROR_MESSAGES[response.status] || `DeepSeek returned HTTP ${response.status}.`, {
              status: response.status, code: 'http_error', attempts,
            });
          }
          let data;
          try { data = await response.json(); } catch {
            signal.throwIfAborted();
            throw new ApiError('DeepSeek returned invalid JSON. This successful HTTP response was not retried.', { code: 'invalid_response', attempts });
          }
          if (!data || typeof data !== 'object' || Array.isArray(data)) {
            throw new ApiError('DeepSeek returned an unexpected response shape.', { code: 'invalid_response', attempts });
          }
          if (endpoint === 'search' && (!Array.isArray(data.results) || data.results.some(result => !result || typeof result !== 'object' || typeof result.url !== 'string'))) {
            throw new ApiError('DeepSeek search response has no valid results array.', { code: 'invalid_response', attempts });
          }
          if (endpoint === 'fetch' && typeof data.content !== 'string') {
            throw new ApiError('DeepSeek fetch response has no content string.', { code: 'invalid_response', attempts });
          }
          return { data, attempts };
        }
      }, signal);
    } catch (error) {
      if (signal.aborted) {
        throw new ApiError(callerSignal?.aborted ? 'The caller cancelled this request.' : 'The request exceeded the 45-second total deadline. It was not automatically retried.', {
          code: callerSignal?.aborted ? 'cancelled' : 'timeout', attempts,
        });
      }
      throw error;
    }
  };
}
