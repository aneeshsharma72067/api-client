/**
 * Content-type sniffing + safe pretty-printing for the response viewer.
 *
 * Everything in this module is pure: no DOM, no innerHTML — the viewer renders
 * tokenized output as React nodes to avoid HTML injection from response bodies.
 */

export type ResponseFormat = 'json' | 'xml' | 'html' | 'text';

const JSON_HINTS = ['application/json', '+json'];
const XML_HINTS = ['application/xml', 'text/xml', '+xml'];
const HTML_HINTS = ['text/html', 'application/xhtml'];

function headerLooks(contentType: string | undefined, hints: string[]): boolean {
  if (!contentType) return false;
  const lower = contentType.toLowerCase();
  return hints.some((h) => lower.includes(h));
}

/**
 * Detect a response's format from the Content-Type header, falling back to
 * a quick body sniff for missing/wrong headers.
 */
export function detectFormat(contentType: string | undefined, body: string): ResponseFormat {
  if (headerLooks(contentType, JSON_HINTS)) return 'json';
  if (headerLooks(contentType, HTML_HINTS)) return 'html';
  if (headerLooks(contentType, XML_HINTS)) return 'xml';
  const trimmed = body.trimStart();
  if (!trimmed) return 'text';
  const head = trimmed.slice(0, 256).toLowerCase();
  if (head.startsWith('{') || head.startsWith('[')) {
    // Cheap JSON probe: parse a short prefix only when the whole body is small.
    if (body.length < 200_000) {
      try {
        JSON.parse(body);
        return 'json';
      } catch {
        /* fall through */
      }
    } else {
      return 'json';
    }
  }
  if (head.startsWith('<!doctype html') || head.startsWith('<html')) return 'html';
  if (head.startsWith('<?xml')) return 'xml';
  if (head.startsWith('<')) return 'xml';
  return 'text';
}

export function tryPrettyJson(body: string): string | null {
  try {
    const parsed = JSON.parse(body);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return null;
  }
}

/**
 * Indent XML/HTML with a single pass over the string. Heuristic — won't
 * reformat already-pretty input, won't touch CDATA, comments are passed
 * through verbatim. Skips reformatting on inputs larger than 1MB so the UI
 * stays responsive on huge HTML dumps.
 */
export function tryPrettyXml(body: string, indent = '  '): string | null {
  if (body.length > 1_000_000) return null;
  const tokens = body
    .replace(/\r\n?/g, '\n')
    .replace(/>\s*</g, '><')
    .trim()
    .split(/(<[^>]+>)/g)
    .filter((s) => s.length > 0);
  if (tokens.length <= 1) return null;
  let depth = 0;
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (!token.startsWith('<')) {
      const text = token.trim();
      if (text) out.push(indent.repeat(depth) + escapeForPretty(text));
      continue;
    }
    if (token.startsWith('<!--') || token.startsWith('<![CDATA[') || token.startsWith('<!DOCTYPE') || token.startsWith('<?')) {
      out.push(indent.repeat(depth) + token);
      continue;
    }
    if (token.startsWith('</')) {
      depth = Math.max(0, depth - 1);
      out.push(indent.repeat(depth) + token);
      continue;
    }
    const selfClosing = token.endsWith('/>');
    out.push(indent.repeat(depth) + token);
    if (!selfClosing && !isVoidElement(token)) {
      // Pair detection: if the next token is the matching close, keep inline.
      const tagName = extractTagName(token);
      const next = tokens[i + 1];
      const after = tokens[i + 2];
      if (next && !next.startsWith('<') && after && after.startsWith('</') && extractTagName(after) === tagName) {
        out[out.length - 1] = `${indent.repeat(depth)}${token}${escapeForPretty(next.trim())}${after}`;
        i += 2;
        continue;
      }
      depth++;
    }
  }
  return out.join('\n');
}

function extractTagName(token: string): string {
  const match = /^<\/?([a-zA-Z][\w:-]*)/.exec(token);
  return match ? match[1].toLowerCase() : '';
}

const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link',
  'meta', 'param', 'source', 'track', 'wbr',
]);

function isVoidElement(token: string): boolean {
  return VOID_ELEMENTS.has(extractTagName(token));
}

function escapeForPretty(text: string): string {
  // Only collapse runs of whitespace; never touch entities or characters —
  // the viewer renders as text nodes so XSS is impossible.
  return text.replace(/\s+/g, ' ');
}

/**
 * Apply the best pretty-printer for the detected format. Returns `null` when
 * no transform was applied, so callers can fall back to the raw body.
 */
export function prettyPrint(body: string, format: ResponseFormat): string | null {
  switch (format) {
    case 'json':
      return tryPrettyJson(body);
    case 'xml':
    case 'html':
      return tryPrettyXml(body);
    default:
      return null;
  }
}

/* ----------------------------- JSON tokenizer ----------------------------- */

export type JsonTokenKind = 'key' | 'string' | 'number' | 'boolean' | 'null' | 'punct' | 'whitespace';

export interface JsonToken {
  kind: JsonTokenKind;
  text: string;
}

/**
 * Tokenize a pretty-printed JSON string for syntax highlighting.
 *
 * Inputs are assumed to be JSON.stringify output (no comments, no trailing
 * commas). Tokens are returned in source order so the renderer can map them
 * one-to-one to React spans, keeping output XSS-safe.
 */
export function tokenizeJson(text: string): JsonToken[] {
  const tokens: JsonToken[] = [];
  let i = 0;
  const len = text.length;
  while (i < len) {
    const ch = text[i];
    if (ch === ' ' || ch === '\n' || ch === '\t' || ch === '\r') {
      let j = i + 1;
      while (j < len) {
        const c = text[j];
        if (c !== ' ' && c !== '\n' && c !== '\t' && c !== '\r') break;
        j++;
      }
      tokens.push({ kind: 'whitespace', text: text.slice(i, j) });
      i = j;
      continue;
    }
    if (ch === '"') {
      let j = i + 1;
      while (j < len) {
        if (text[j] === '\\' && j + 1 < len) {
          j += 2;
          continue;
        }
        if (text[j] === '"') {
          j++;
          break;
        }
        j++;
      }
      const literal = text.slice(i, j);
      // A trailing colon after optional whitespace marks a key.
      let k = j;
      while (k < len && (text[k] === ' ' || text[k] === '\t')) k++;
      const isKey = text[k] === ':';
      tokens.push({ kind: isKey ? 'key' : 'string', text: literal });
      i = j;
      continue;
    }
    if (ch === '-' || (ch >= '0' && ch <= '9')) {
      let j = i + 1;
      while (j < len && /[0-9eE+\-.]/.test(text[j])) j++;
      tokens.push({ kind: 'number', text: text.slice(i, j) });
      i = j;
      continue;
    }
    if (text.startsWith('true', i) || text.startsWith('false', i)) {
      const literal = text.startsWith('true', i) ? 'true' : 'false';
      tokens.push({ kind: 'boolean', text: literal });
      i += literal.length;
      continue;
    }
    if (text.startsWith('null', i)) {
      tokens.push({ kind: 'null', text: 'null' });
      i += 4;
      continue;
    }
    tokens.push({ kind: 'punct', text: ch });
    i++;
  }
  return tokens;
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const k = 1024;
  const idx = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(k)));
  return `${(bytes / Math.pow(k, idx)).toFixed(idx === 0 ? 0 : 1)} ${units[idx]}`;
}
