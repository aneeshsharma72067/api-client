import type { ApiRequest, AuthConfig, HttpMethod, KeyValuePair, RequestBody } from '@/types/api';
import { generateId } from '@/lib/storage';
import { emptyResult, type ImportedFolder, type ImportResult } from './types';

type AnyObj = Record<string, unknown>;

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

function isObj(v: unknown): v is AnyObj {
  return typeof v === 'object' && v !== null;
}

function buildUrl(rawUrl: unknown): { url: string; params: KeyValuePair[]; pathVars: KeyValuePair[] } {
  if (typeof rawUrl === 'string') {
    return { url: rawUrl, params: [], pathVars: [] };
  }
  if (!isObj(rawUrl)) return { url: '', params: [], pathVars: [] };
  if (typeof rawUrl.raw === 'string' && rawUrl.raw) {
    const params: KeyValuePair[] = [];
    if (Array.isArray(rawUrl.query)) {
      for (const q of rawUrl.query) {
        if (!isObj(q) || typeof q.key !== 'string') continue;
        params.push({
          id: generateId(),
          key: q.key,
          value: typeof q.value === 'string' ? q.value : '',
          enabled: q.disabled !== true,
        });
      }
    }
    const pathVars: KeyValuePair[] = [];
    if (Array.isArray(rawUrl.variable)) {
      for (const v of rawUrl.variable) {
        if (!isObj(v) || typeof v.key !== 'string') continue;
        pathVars.push({
          id: generateId(),
          key: v.key,
          value: typeof v.value === 'string' ? v.value : '',
          enabled: true,
        });
      }
    }
    const qIdx = rawUrl.raw.indexOf('?');
    const urlNoQuery = qIdx < 0 ? rawUrl.raw : rawUrl.raw.slice(0, qIdx);
    return { url: urlNoQuery, params, pathVars };
  }
  const protocol = typeof rawUrl.protocol === 'string' ? `${rawUrl.protocol}://` : '';
  const host = Array.isArray(rawUrl.host) ? rawUrl.host.join('.') : '';
  const port = typeof rawUrl.port === 'string' && rawUrl.port ? `:${rawUrl.port}` : '';
  const path = Array.isArray(rawUrl.path) ? `/${rawUrl.path.join('/')}` : '';
  return { url: `${protocol}${host}${port}${path}`, params: [], pathVars: [] };
}

function mapHeaders(raw: unknown): KeyValuePair[] {
  if (!Array.isArray(raw)) return [];
  const out: KeyValuePair[] = [];
  for (const h of raw) {
    if (!isObj(h) || typeof h.key !== 'string') continue;
    out.push({
      id: generateId(),
      key: h.key,
      value: typeof h.value === 'string' ? h.value : '',
      enabled: h.disabled !== true,
      description: typeof h.description === 'string' ? h.description : undefined,
    });
  }
  return out;
}

function mapBody(raw: unknown): RequestBody {
  if (!isObj(raw)) return { type: 'none' };
  const mode = typeof raw.mode === 'string' ? raw.mode : '';
  switch (mode) {
    case 'raw': {
      const text = typeof raw.raw === 'string' ? raw.raw : '';
      const lang =
        isObj(raw.options) && isObj((raw.options as AnyObj).raw)
          ? ((raw.options as AnyObj).raw as AnyObj).language
          : undefined;
      const isJson = lang === 'json' || /^[\s\n]*[{[]/.test(text);
      return { type: isJson ? 'json' : 'raw', raw: text };
    }
    case 'urlencoded': {
      const items = Array.isArray(raw.urlencoded) ? raw.urlencoded : [];
      const pairs: KeyValuePair[] = [];
      for (const it of items) {
        if (!isObj(it) || typeof it.key !== 'string') continue;
        pairs.push({
          id: generateId(),
          key: it.key,
          value: typeof it.value === 'string' ? it.value : '',
          enabled: it.disabled !== true,
        });
      }
      return { type: 'x-www-form-urlencoded', urlencoded: pairs };
    }
    case 'formdata': {
      const items = Array.isArray(raw.formdata) ? raw.formdata : [];
      const pairs: KeyValuePair[] = [];
      for (const it of items) {
        if (!isObj(it) || typeof it.key !== 'string') continue;
        pairs.push({
          id: generateId(),
          key: it.key,
          value: typeof it.value === 'string' ? it.value : '',
          enabled: it.disabled !== true,
        });
      }
      return { type: 'form-data', formData: pairs };
    }
    default:
      return { type: 'none' };
  }
}

function mapAuth(raw: unknown): AuthConfig {
  if (!isObj(raw)) return { type: 'none' };
  const type = typeof raw.type === 'string' ? raw.type : '';
  // Postman v2.1 stores each auth's config under a key matching its type as an array of {key,value}.
  const readKv = (key: string): Record<string, string> => {
    const arr = (raw as AnyObj)[key];
    const out: Record<string, string> = {};
    if (Array.isArray(arr)) {
      for (const item of arr) {
        if (isObj(item) && typeof item.key === 'string') {
          out[item.key] = typeof item.value === 'string' ? item.value : '';
        }
      }
    }
    return out;
  };
  if (type === 'bearer') {
    const kv = readKv('bearer');
    return { type: 'bearer', bearer: { token: kv.token ?? '' } };
  }
  if (type === 'basic') {
    const kv = readKv('basic');
    return { type: 'basic', basic: { username: kv.username ?? '', password: kv.password ?? '' } };
  }
  if (type === 'apikey') {
    const kv = readKv('apikey');
    const addTo: 'header' | 'query' = kv.in === 'query' ? 'query' : 'header';
    return { type: 'apiKey', apiKey: { key: kv.key ?? '', value: kv.value ?? '', addTo } };
  }
  return { type: 'none' };
}

function methodFrom(raw: unknown): HttpMethod {
  if (typeof raw !== 'string') return 'GET';
  const upper = raw.toUpperCase();
  return (HTTP_METHODS as readonly string[]).includes(upper) ? (upper as HttpMethod) : 'GET';
}

function buildRequest(name: string, rawReq: AnyObj, fallbackAuth: AuthConfig): ApiRequest {
  const { url, params } = buildUrl(rawReq.url);
  const headers = mapHeaders(rawReq.header);
  const body = mapBody(rawReq.body);
  const auth = rawReq.auth ? mapAuth(rawReq.auth) : fallbackAuth;
  const method = methodFrom(rawReq.method);
  const now = Date.now();
  return {
    id: generateId(),
    name: name || `${method} ${url}`,
    method,
    url,
    headers,
    params,
    body,
    auth,
    createdAt: now,
    updatedAt: now,
  };
}

interface WalkState {
  topLevel: ApiRequest[];
  folders: Map<string, ApiRequest[]>;
}

function walkItems(items: unknown[], state: WalkState, folderName: string | null, parentAuth: AuthConfig): void {
  for (const item of items) {
    if (!isObj(item)) continue;
    const name = typeof item.name === 'string' ? item.name : 'Untitled';
    const auth = item.auth ? mapAuth(item.auth) : parentAuth;
    if (Array.isArray(item.item)) {
      const next = folderName ? `${folderName}/${name}` : name;
      walkItems(item.item, state, next, auth);
      continue;
    }
    if (!isObj(item.request)) continue;
    const req = buildRequest(name, item.request as AnyObj, auth);
    if (folderName) {
      const list = state.folders.get(folderName) ?? [];
      list.push(req);
      state.folders.set(folderName, list);
    } else {
      state.topLevel.push(req);
    }
  }
}

export function parsePostman(doc: unknown): ImportResult {
  const result = emptyResult('postman');
  if (!isObj(doc)) {
    result.warnings.push('Document is not a Postman collection.');
    return result;
  }
  const info = isObj(doc.info) ? (doc.info as AnyObj) : undefined;
  if (info && typeof info.name === 'string') result.suggestedCollection = info.name;
  const schema = info && typeof info.schema === 'string' ? info.schema : '';
  if (schema && !schema.includes('v2')) {
    result.warnings.push(`Detected Postman schema ${schema}; only v2.x is supported.`);
  }
  const items = Array.isArray(doc.item) ? doc.item : [];
  const fallbackAuth = doc.auth ? mapAuth(doc.auth) : ({ type: 'none' } as AuthConfig);
  const state: WalkState = { topLevel: [], folders: new Map() };
  walkItems(items, state, null, fallbackAuth);
  result.requests = state.topLevel;
  const folders: ImportedFolder[] = [];
  for (const [name, requests] of state.folders) folders.push({ name, requests });
  result.folders = folders.sort((a, b) => a.name.localeCompare(b.name));
  return result;
}
