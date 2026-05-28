import type { ApiRequest, AuthConfig, HttpMethod, KeyValuePair, RequestBody } from '@/types/api';
import { generateId } from '@/lib/storage';
import { emptyResult, type ImportResult } from './types';

const HTTP_METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

/**
 * Tokenize a single curl command using a small shell-like lexer.
 * Handles single- and double-quoted strings, ANSI-C `$'...'` strings,
 * backslash escapes inside double quotes, and unquoted whitespace.
 * Backslash-newline continuations are collapsed before tokenization.
 */
function tokenize(input: string): string[] {
  const src = input.replace(/\\\r?\n/g, ' ');
  const tokens: string[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      i++;
      continue;
    }
    let token = '';
    while (i < src.length) {
      const ch = src[i];
      if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') break;
      if (ch === '\'') {
        i++;
        while (i < src.length && src[i] !== '\'') {
          token += src[i++];
        }
        i++; // closing quote
        continue;
      }
      if (ch === '"') {
        i++;
        while (i < src.length && src[i] !== '"') {
          if (src[i] === '\\' && i + 1 < src.length) {
            const next = src[i + 1];
            if (next === '"' || next === '\\' || next === '$' || next === '`') {
              token += next;
              i += 2;
              continue;
            }
          }
          token += src[i++];
        }
        i++; // closing quote
        continue;
      }
      if (ch === '$' && src[i + 1] === '\'') {
        // ANSI-C quoted string ($'...'): decode common escapes.
        i += 2;
        while (i < src.length && src[i] !== '\'') {
          if (src[i] === '\\' && i + 1 < src.length) {
            const esc = src[i + 1];
            const map: Record<string, string> = { n: '\n', t: '\t', r: '\r', '\\': '\\', '\'': '\'', '"': '"' };
            token += map[esc] ?? esc;
            i += 2;
            continue;
          }
          token += src[i++];
        }
        i++;
        continue;
      }
      if (ch === '\\' && i + 1 < src.length) {
        token += src[i + 1];
        i += 2;
        continue;
      }
      token += src[i++];
    }
    tokens.push(token);
  }
  return tokens;
}

function splitUrlAndQuery(raw: string): { url: string; params: KeyValuePair[] } {
  const qIdx = raw.indexOf('?');
  if (qIdx < 0) return { url: raw, params: [] };
  const url = raw.slice(0, qIdx);
  const params: KeyValuePair[] = [];
  for (const part of raw.slice(qIdx + 1).split('&')) {
    if (!part) continue;
    const eq = part.indexOf('=');
    const key = decodeURIComponent(eq < 0 ? part : part.slice(0, eq));
    const value = eq < 0 ? '' : decodeURIComponent(part.slice(eq + 1));
    params.push({ id: generateId(), key, value, enabled: true });
  }
  return { url, params };
}

function detectAuthFromHeaders(headers: KeyValuePair[]): { auth: AuthConfig; stripped: KeyValuePair[] } {
  let auth: AuthConfig = { type: 'none' };
  const stripped: KeyValuePair[] = [];
  for (const h of headers) {
    if (h.key.toLowerCase() === 'authorization') {
      const value = h.value.trim();
      const bearer = /^Bearer\s+(.+)$/i.exec(value);
      if (bearer) {
        auth = { type: 'bearer', bearer: { token: bearer[1] } };
        continue;
      }
      const basic = /^Basic\s+(.+)$/i.exec(value);
      if (basic) {
        try {
          const decoded = atob(basic[1]);
          const colon = decoded.indexOf(':');
          if (colon >= 0) {
            auth = { type: 'basic', basic: { username: decoded.slice(0, colon), password: decoded.slice(colon + 1) } };
            continue;
          }
        } catch {
          // fall through: keep header
        }
      }
    }
    stripped.push(h);
  }
  return { auth, stripped };
}

interface ParsedTokens {
  url: string;
  method?: HttpMethod;
  headers: KeyValuePair[];
  bodyParts: string[];
  formParts: KeyValuePair[];
  urlEncodedParts: KeyValuePair[];
  basicUser?: string;
  basicPass?: string;
  isFormUrlEncoded: boolean;
}

function readArg(tokens: string[], i: number): string | undefined {
  return tokens[i + 1];
}

function parseSingleCommand(cmd: string): ApiRequest | null {
  const tokens = tokenize(cmd).filter(Boolean);
  if (tokens.length === 0) return null;
  if (tokens[0] !== 'curl') return null;

  const state: ParsedTokens = {
    url: '',
    headers: [],
    bodyParts: [],
    formParts: [],
    urlEncodedParts: [],
    isFormUrlEncoded: false,
  };

  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i];
    switch (t) {
      case '-X':
      case '--request': {
        const m = readArg(tokens, i)?.toUpperCase();
        if (m && (HTTP_METHODS as string[]).includes(m)) state.method = m as HttpMethod;
        i++;
        break;
      }
      case '-H':
      case '--header': {
        const raw = readArg(tokens, i);
        i++;
        if (!raw) break;
        const colon = raw.indexOf(':');
        if (colon < 0) break;
        const key = raw.slice(0, colon).trim();
        const value = raw.slice(colon + 1).trim();
        if (key) state.headers.push({ id: generateId(), key, value, enabled: true });
        break;
      }
      case '-d':
      case '--data':
      case '--data-raw':
      case '--data-binary':
      case '--data-ascii': {
        const v = readArg(tokens, i);
        i++;
        if (v !== undefined) state.bodyParts.push(v);
        break;
      }
      case '--data-urlencoded': {
        const v = readArg(tokens, i);
        i++;
        if (v !== undefined) {
          state.isFormUrlEncoded = true;
          const eq = v.indexOf('=');
          if (eq >= 0) {
            state.urlEncodedParts.push({
              id: generateId(),
              key: v.slice(0, eq),
              value: v.slice(eq + 1),
              enabled: true,
            });
          } else {
            state.bodyParts.push(v);
          }
        }
        break;
      }
      case '-F':
      case '--form': {
        const v = readArg(tokens, i);
        i++;
        if (v !== undefined) {
          const eq = v.indexOf('=');
          if (eq >= 0) {
            state.formParts.push({
              id: generateId(),
              key: v.slice(0, eq),
              value: v.slice(eq + 1),
              enabled: true,
            });
          }
        }
        break;
      }
      case '-u':
      case '--user': {
        const v = readArg(tokens, i);
        i++;
        if (v) {
          const colon = v.indexOf(':');
          state.basicUser = colon < 0 ? v : v.slice(0, colon);
          state.basicPass = colon < 0 ? '' : v.slice(colon + 1);
        }
        break;
      }
      case '--url': {
        const v = readArg(tokens, i);
        i++;
        if (v) state.url = v;
        break;
      }
      case '-A':
      case '--user-agent': {
        const v = readArg(tokens, i);
        i++;
        if (v) state.headers.push({ id: generateId(), key: 'User-Agent', value: v, enabled: true });
        break;
      }
      case '-e':
      case '--referer': {
        const v = readArg(tokens, i);
        i++;
        if (v) state.headers.push({ id: generateId(), key: 'Referer', value: v, enabled: true });
        break;
      }
      case '-b':
      case '--cookie': {
        const v = readArg(tokens, i);
        i++;
        if (v) state.headers.push({ id: generateId(), key: 'Cookie', value: v, enabled: true });
        break;
      }
      default:
        if (t.startsWith('-')) {
          // Skip unknown flags that take an argument (best-effort: skip next token if it isn't a flag).
          const next = tokens[i + 1];
          if (next !== undefined && !next.startsWith('-')) i++;
        } else if (!state.url && /^https?:\/\//i.test(t)) {
          state.url = t;
        } else if (!state.url) {
          state.url = t;
        }
        break;
    }
  }

  if (!state.url) return null;

  const { url, params } = splitUrlAndQuery(state.url);

  // Body & method inference
  let body: RequestBody = { type: 'none' };
  if (state.formParts.length > 0) {
    body = { type: 'form-data', formData: state.formParts };
  } else if (state.isFormUrlEncoded || state.urlEncodedParts.length > 0) {
    body = { type: 'x-www-form-urlencoded', urlencoded: state.urlEncodedParts };
  } else if (state.bodyParts.length > 0) {
    const raw = state.bodyParts.join('&');
    const looksJson = /^[\s\n]*[{[]/.test(raw);
    body = { type: looksJson ? 'json' : 'raw', raw };
  }

  const inferredMethod: HttpMethod =
    state.method ??
    (body.type !== 'none' ? 'POST' : 'GET');

  // Auth: prefer -u flag, fall back to Authorization header detection.
  let auth: AuthConfig = { type: 'none' };
  let finalHeaders = state.headers;
  if (state.basicUser !== undefined) {
    auth = { type: 'basic', basic: { username: state.basicUser, password: state.basicPass ?? '' } };
  } else {
    const detected = detectAuthFromHeaders(state.headers);
    auth = detected.auth;
    finalHeaders = detected.stripped;
  }

  // Set Content-Type for JSON if body parsed as JSON and no explicit header.
  if (body.type === 'json' && !finalHeaders.some((h) => h.key.toLowerCase() === 'content-type')) {
    finalHeaders = [
      ...finalHeaders,
      { id: generateId(), key: 'Content-Type', value: 'application/json', enabled: true },
    ];
  }

  const now = Date.now();
  return {
    id: generateId(),
    name: `${inferredMethod} ${prettyPath(url)}`,
    method: inferredMethod,
    url,
    headers: finalHeaders,
    params,
    body,
    auth,
    createdAt: now,
    updatedAt: now,
  };
}

function prettyPath(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname || u.host;
  } catch {
    return url;
  }
}

/**
 * Split a multi-command paste on top-level `curl` occurrences (not those inside
 * quotes or after a backslash-newline). Returns one segment per command.
 */
function splitCommands(text: string): string[] {
  const collapsed = text.replace(/\\\r?\n/g, ' ');
  const segments: string[] = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < collapsed.length; i++) {
    const ch = collapsed[i];
    if (ch === '\'' && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    if (!inSingle && !inDouble && (ch === '\n' || ch === ';')) {
      if (current.trim()) segments.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) segments.push(current.trim());
  return segments.filter((s) => s.startsWith('curl'));
}

export function parseCurl(text: string): ApiRequest[] {
  return splitCommands(text)
    .map(parseSingleCommand)
    .filter((r): r is ApiRequest => r !== null);
}

export function importCurl(text: string): ImportResult {
  const result = emptyResult('curl');
  const reqs = parseCurl(text);
  if (reqs.length === 0) {
    result.warnings.push('No valid curl commands detected.');
  }
  result.requests = reqs;
  return result;
}
