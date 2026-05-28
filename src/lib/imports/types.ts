import type { ApiRequest } from '@/types/api';

export type ImportFormat = 'curl' | 'openapi' | 'postman' | 'har';

/**
 * Output of an importer. A flat list of requests, optionally grouped into
 * named folders so the modal can preview structure before committing.
 */
export interface ImportedFolder {
  /** Folder name relative to the destination collection. */
  name: string;
  /** Requests directly inside this folder (not nested folders this slice). */
  requests: ApiRequest[];
}

export interface ImportResult {
  format: ImportFormat;
  /** Suggested collection name (e.g. OpenAPI info.title). */
  suggestedCollection?: string;
  /** Top-level requests (no folder). */
  requests: ApiRequest[];
  /** Optional folder grouping (used by OpenAPI tags / Postman folders). */
  folders: ImportedFolder[];
  /** Non-fatal warnings surfaced in the preview UI. */
  warnings: string[];
}

export function emptyResult(format: ImportFormat): ImportResult {
  return { format, requests: [], folders: [], warnings: [] };
}

export function totalRequestCount(result: ImportResult): number {
  return result.requests.length + result.folders.reduce((n, f) => n + f.requests.length, 0);
}
