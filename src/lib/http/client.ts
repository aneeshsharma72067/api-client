import { isTauri, isDevProxyAvailable, getUseDevProxy, toProxyUrl } from "./runtime";

/**
 * Normalized HTTP request shape consumed by `sendHttp`. Keep it transport-
 * agnostic so a future Tauri/Rust backend can implement the same contract.
 */
export interface HttpRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string | FormData;
}

export interface HttpResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  time: number;
  size: number;
  /** Which transport actually serviced the call. */
  transport: HttpTransport;
}

export type HttpTransport = "tauri" | "vite-proxy" | "fetch";

/** Subclass to give the UI a typed hook for the "fix this with proxy" toast. */
export class CorsBlockedError extends Error {
  readonly url: string;
  constructor(url: string, cause?: unknown) {
    super(
      "Request blocked by browser CORS policy. Enable 'Send via dev proxy' in the URL bar, " +
        "or run the Tauri build for a native HTTP client.",
    );
    this.name = "CorsBlockedError";
    this.url = url;
    if (cause !== undefined) (this as { cause?: unknown }).cause = cause;
  }
}

function looksLikeCorsFailure(error: unknown): boolean {
  if (!(error instanceof TypeError)) return false;
  const msg = error.message.toLowerCase();
  return (
    msg.includes("failed to fetch") ||
    msg.includes("networkerror") ||
    msg.includes("load failed") ||
    msg.includes("cors")
  );
}

function isAbsoluteHttpUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

export interface StreamingProgress {
  /** Bytes received so far. */
  loaded: number;
  /** Total bytes if known from Content-Length, otherwise undefined. */
  total?: number;
  /** Decoded text so far. */
  text: string;
}

export interface HttpRequestOptions {
  /** Optional progress callback. When set, the response is streamed and decoded incrementally. */
  onProgress?: (progress: StreamingProgress) => void;
  /** Abort signal forwarded to fetch. */
  signal?: AbortSignal;
}

async function sendViaFetch(
  req: HttpRequest,
  transport: HttpTransport,
  options: HttpRequestOptions = {},
): Promise<HttpResponse> {
  const start = performance.now();
  let fetchResponse: Response;
  try {
    fetchResponse = await fetch(req.url, {
      method: req.method,
      headers: req.headers,
      body: req.body,
      signal: options.signal,
    });
  } catch (err) {
    if (looksLikeCorsFailure(err)) {
      throw new CorsBlockedError(req.url, err);
    }
    throw err;
  }
  const headers: Record<string, string> = {};
  fetchResponse.headers.forEach((value, key) => {
    headers[key] = value;
  });

  let text: string;
  if (options.onProgress && fetchResponse.body) {
    const reader = fetchResponse.body.getReader();
    const decoder = new TextDecoder();
    const totalHeader = headers['content-length'];
    const total = totalHeader ? Number(totalHeader) : undefined;
    let loaded = 0;
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      loaded += value.byteLength;
      buffer += decoder.decode(value, { stream: true });
      options.onProgress({ loaded, total, text: buffer });
    }
    buffer += decoder.decode();
    text = buffer;
  } else {
    text = await fetchResponse.text();
  }

  const end = performance.now();
  return {
    status: fetchResponse.status,
    statusText: fetchResponse.statusText,
    headers,
    body: text,
    time: Math.round(end - start),
    size: new Blob([text]).size,
    transport,
  };
}

/**
 * Send an HTTP request, picking the best available transport for the current
 * runtime. Falls back to a plain `fetch` if no proxy or native bridge is
 * available; throws `CorsBlockedError` so the UI can show an actionable hint.
 */
export async function sendHttp(req: HttpRequest, options: HttpRequestOptions = {}): Promise<HttpResponse> {
  if (isTauri()) {
    // Native bridge lives behind a dynamic import so the browser build never
    // pulls in the Tauri API. Wired up when the Tauri scaffold lands.
    // For now, fall through to fetch — Tauri's webview shares browser CORS.
    return sendViaFetch(req, "fetch", options);
  }
  if (isAbsoluteHttpUrl(req.url) && isDevProxyAvailable() && getUseDevProxy()) {
    const proxied = { ...req, url: toProxyUrl(req.url) };
    return sendViaFetch(proxied, "vite-proxy", options);
  }
  return sendViaFetch(req, "fetch", options);
}
