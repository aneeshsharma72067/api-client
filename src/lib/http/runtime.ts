/**
 * Runtime detection helpers and shared HTTP-transport settings.
 *
 * The app runs in three modes, in priority order:
 *   1. Tauri shell — `window.__TAURI__` is set; native Rust fetch handles CORS,
 *      timing, raw socket access.
 *   2. Vite dev server — `import.meta.env.DEV` is true; requests can be routed
 *      through the local /__proxy/* middleware to bypass the browser's
 *      same-origin restrictions.
 *   3. Plain browser build — no proxy, no native shell. Requests go directly;
 *      CORS failures are surfaced verbatim to the user.
 */

const TAURI_GLOBAL = "__TAURI__";

export function isTauri(): boolean {
  return typeof window !== "undefined" && (window as unknown as Record<string, unknown>)[TAURI_GLOBAL] !== undefined;
}

export function isDevServer(): boolean {
  return Boolean(import.meta.env?.DEV);
}

/** Path prefix served by the Vite dev middleware in vite.config.ts. */
export const DEV_PROXY_PREFIX = "/__proxy/";

const STORAGE_KEY = "api-client:use-dev-proxy";

/** User-facing preference. Defaults to enabled in dev, off elsewhere. */
export function getUseDevProxy(): boolean {
  if (typeof localStorage === "undefined") return isDevServer();
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw === null) return isDevServer();
  return raw === "1";
}

export function setUseDevProxy(enabled: boolean): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(STORAGE_KEY, enabled ? "1" : "0");
}

/** Whether the proxy switch should be exposed and functional. */
export function isDevProxyAvailable(): boolean {
  return isDevServer() && !isTauri();
}

/** Build the proxied URL the browser will hit. */
export function toProxyUrl(targetUrl: string): string {
  return `${DEV_PROXY_PREFIX}${targetUrl}`;
}
