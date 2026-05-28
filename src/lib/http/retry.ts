import type { ResponseAttempt, RetryConfig } from '@/types/api';
import { sendHttp, type HttpRequest, type HttpResponse, type HttpRequestOptions, CorsBlockedError } from './client';

/**
 * Send an HTTP request with retry and exponential backoff. Captures per-attempt
 * status/latency so the UI can render a timeline. Network errors and
 * `retryStatuses` trigger another attempt up to `maxAttempts`.
 *
 * The final attempt's response is returned. When every attempt fails with a
 * network error, the last error is thrown so the caller's catch path runs.
 */
export interface RetryResult {
  response: HttpResponse;
  attempts: ResponseAttempt[];
}

const DEFAULT_RETRY_STATUSES = [408, 425, 429, 500, 502, 503, 504];

export function defaultRetryConfig(): RetryConfig {
  return {
    enabled: false,
    maxAttempts: 3,
    baseDelayMs: 500,
    retryStatuses: DEFAULT_RETRY_STATUSES,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffMs(base: number, attemptIndex: number): number {
  const exp = base * Math.pow(2, attemptIndex);
  // Small random jitter (±10%) avoids retry-storm sync across clients.
  const jitter = (Math.random() * 0.2 - 0.1) * exp;
  return Math.max(0, Math.round(exp + jitter));
}

export async function sendWithRetry(
  request: HttpRequest,
  config: RetryConfig,
  options: HttpRequestOptions = {},
): Promise<RetryResult> {
  const attempts: ResponseAttempt[] = [];
  const maxAttempts = Math.max(1, config.enabled ? config.maxAttempts : 1);
  let lastError: unknown = null;
  let lastResponse: HttpResponse | null = null;

  for (let i = 0; i < maxAttempts; i++) {
    const delay = i === 0 ? 0 : backoffMs(config.baseDelayMs, i - 1);
    if (delay > 0) await sleep(delay);

    const start = performance.now();
    try {
      const response = await sendHttp(request, options);
      const time = Math.round(performance.now() - start);
      attempts.push({
        index: i + 1,
        status: response.status,
        time,
        delay,
        ok: response.status > 0 && response.status < 400,
      });
      lastResponse = response;
      const shouldRetry = config.enabled && i + 1 < maxAttempts && config.retryStatuses.includes(response.status);
      if (!shouldRetry) {
        return { response, attempts };
      }
    } catch (err) {
      const time = Math.round(performance.now() - start);
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      attempts.push({
        index: i + 1,
        status: 0,
        time,
        delay,
        ok: false,
        error: errorMessage,
      });
      lastError = err;
      // CORS failures will not change on retry — surface immediately.
      if (err instanceof CorsBlockedError) {
        throw Object.assign(err, { attempts });
      }
      const shouldRetry = config.enabled && i + 1 < maxAttempts;
      if (!shouldRetry) {
        const wrapped = err instanceof Error ? err : new Error(errorMessage);
        throw Object.assign(wrapped, { attempts });
      }
    }
  }

  if (lastResponse) return { response: lastResponse, attempts };
  const wrapped = lastError instanceof Error ? lastError : new Error('Request failed');
  throw Object.assign(wrapped, { attempts });
}
