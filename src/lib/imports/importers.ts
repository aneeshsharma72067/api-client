import YAML from 'yaml';
import type { ApiRequest } from '@/types/api';
import { importCurl, parseCurl } from './curl';
import { parseOpenApi } from './openapi';
import { parsePostman } from './postman';
import { parseHar } from './har';
import { emptyResult, type ImportFormat, type ImportResult } from './types';

export { parseCurl, importCurl } from './curl';
export { parseOpenApi } from './openapi';
export { parsePostman } from './postman';
export { parseHar } from './har';
export type { ImportFormat, ImportResult, ImportedFolder } from './types';
export { totalRequestCount } from './types';

/** Back-compat shim: existing callers that consume a plain ApiRequest[]. */
export function importOpenApi(doc: unknown): ApiRequest[] {
  const r = parseOpenApi(doc);
  return [...r.requests, ...r.folders.flatMap((f) => f.requests)];
}

/**
 * Parse raw text (JSON or YAML) into a structured object. Throws on syntax error.
 */
export function parseDocumentText(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('Empty document');
  try {
    return JSON.parse(trimmed);
  } catch {
    return YAML.parse(trimmed);
  }
}

/**
 * Detect the import format from raw text. Used by the modal's auto-detect tab.
 * Returns `null` when nothing recognizable is found.
 */
export function detectFormat(text: string): ImportFormat | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (/^\s*curl(\s|\\\n)/m.test(trimmed)) return 'curl';
  let doc: unknown;
  try {
    doc = parseDocumentText(trimmed);
  } catch {
    return null;
  }
  if (typeof doc !== 'object' || doc === null) return null;
  const obj = doc as Record<string, unknown>;
  if (obj.log && typeof obj.log === 'object' && Array.isArray((obj.log as { entries?: unknown }).entries)) {
    return 'har';
  }
  if (obj.info && typeof obj.info === 'object' && Array.isArray(obj.item)) return 'postman';
  if (obj.openapi || obj.swagger || obj.paths) return 'openapi';
  return null;
}

/**
 * Parse text using either an explicit format or auto-detection. Returns an
 * `ImportResult` with warnings instead of throwing for non-fatal cases.
 */
export function parseImport(text: string, format?: ImportFormat): ImportResult {
  const trimmed = text.trim();
  const resolved = format ?? detectFormat(trimmed);
  if (!resolved) {
    const empty = emptyResult('curl');
    empty.warnings.push('Could not detect format. Pick a tab manually.');
    return empty;
  }
  if (resolved === 'curl') return importCurl(trimmed);

  let doc: unknown;
  try {
    doc = parseDocumentText(trimmed);
  } catch (err) {
    const empty = emptyResult(resolved);
    empty.warnings.push(`Could not parse document: ${err instanceof Error ? err.message : String(err)}`);
    return empty;
  }
  switch (resolved) {
    case 'openapi':
      return parseOpenApi(doc);
    case 'postman':
      return parsePostman(doc);
    case 'har':
      return parseHar(doc);
  }
}
