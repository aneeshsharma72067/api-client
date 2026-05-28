import type { ApiRequest, HttpMethod, KeyValuePair, RequestBody } from '@/types/api';
import { generateId } from '@/lib/storage';
import { emptyResult, type ImportResult } from './types';

type AnyObj = Record<string, unknown>;

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

function isObj(v: unknown): v is AnyObj {
  return typeof v === 'object' && v !== null;
}

function methodFrom(raw: unknown): HttpMethod {
  if (typeof raw !== 'string') return 'GET';
  const upper = raw.toUpperCase();
  return (HTTP_METHODS as readonly string[]).includes(upper) ? (upper as HttpMethod) : 'GET';
}

function mapKv(arr: unknown, enabled = true): KeyValuePair[] {
  if (!Array.isArray(arr)) return [];
  const out: KeyValuePair[] = [];
  for (const item of arr) {
    if (!isObj(item) || typeof item.name !== 'string') continue;
    out.push({
      id: generateId(),
      key: item.name,
      value: typeof item.value === 'string' ? item.value : '',
      enabled,
    });
  }
  return out;
}

function mapBody(post: unknown): RequestBody {
  if (!isObj(post)) return { type: 'none' };
  const mime = typeof post.mimeType === 'string' ? post.mimeType.toLowerCase() : '';
  if (mime.includes('json')) {
    return { type: 'json', raw: typeof post.text === 'string' ? post.text : '' };
  }
  if (mime.includes('x-www-form-urlencoded')) {
    return { type: 'x-www-form-urlencoded', urlencoded: mapKv(post.params) };
  }
  if (mime.includes('form-data')) {
    return { type: 'form-data', formData: mapKv(post.params) };
  }
  if (typeof post.text === 'string' && post.text) {
    return { type: 'raw', raw: post.text };
  }
  return { type: 'none' };
}

function dedupeKey(req: ApiRequest): string {
  return `${req.method} ${req.url}`;
}

export function parseHar(doc: unknown): ImportResult {
  const result = emptyResult('har');
  if (!isObj(doc) || !isObj(doc.log)) {
    result.warnings.push('Document is not a HAR file.');
    return result;
  }
  const entries = Array.isArray((doc.log as AnyObj).entries) ? ((doc.log as AnyObj).entries as unknown[]) : [];
  const seen = new Set<string>();
  for (const entry of entries) {
    if (!isObj(entry) || !isObj(entry.request)) continue;
    const rawReq = entry.request as AnyObj;
    const url = typeof rawReq.url === 'string' ? rawReq.url : '';
    if (!url) continue;
    const method = methodFrom(rawReq.method);
    let urlNoQuery = url;
    const qIdx = url.indexOf('?');
    if (qIdx >= 0) urlNoQuery = url.slice(0, qIdx);
    const headers = mapKv(rawReq.headers).filter((h) => !h.key.startsWith(':')); // strip HTTP/2 pseudo-headers
    const params = mapKv(rawReq.queryString);
    const body = mapBody(rawReq.postData);
    const now = Date.now();
    const req: ApiRequest = {
      id: generateId(),
      name: `${method} ${prettyPath(url)}`,
      method,
      url: urlNoQuery,
      headers,
      params,
      body,
      auth: { type: 'none' },
      createdAt: now,
      updatedAt: now,
    };
    const key = dedupeKey(req);
    if (seen.has(key)) continue;
    seen.add(key);
    result.requests.push(req);
  }
  if (result.requests.length === 0) {
    result.warnings.push('No requests found in HAR file.');
  }
  return result;
}

function prettyPath(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname || u.host;
  } catch {
    return url;
  }
}
