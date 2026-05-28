/**
 * Structural diff for two JSON values.
 *
 * Output is a flat list of changes keyed by JSON-pointer-style paths so the
 * renderer can group, filter, and link to the offending nodes without
 * re-walking either tree.
 */

export type DiffKind = 'added' | 'removed' | 'changed' | 'unchanged';

export interface DiffEntry {
  /** Slash-joined path; empty string is the root. */
  path: string;
  kind: DiffKind;
  /** Value present on the "left" / before side, if any. */
  before?: unknown;
  /** Value present on the "right" / after side, if any. */
  after?: unknown;
}

export interface DiffSummary {
  entries: DiffEntry[];
  added: number;
  removed: number;
  changed: number;
  unchanged: number;
}

const MAX_DEPTH = 64;

function isPrimitive(v: unknown): boolean {
  if (v === null) return true;
  const t = typeof v;
  return t === 'string' || t === 'number' || t === 'boolean';
}

function sameType(a: unknown, b: unknown): boolean {
  if (Array.isArray(a)) return Array.isArray(b);
  if (a === null) return b === null;
  if (b === null) return false;
  if (Array.isArray(b)) return false;
  return typeof a === typeof b;
}

function joinPath(parent: string, key: string | number): string {
  if (parent === '') return String(key);
  return `${parent}/${key}`;
}

function walk(before: unknown, after: unknown, path: string, depth: number, out: DiffEntry[]): void {
  if (depth > MAX_DEPTH) {
    out.push({ path, kind: 'changed', before, after });
    return;
  }
  if (before === undefined && after !== undefined) {
    out.push({ path, kind: 'added', after });
    return;
  }
  if (before !== undefined && after === undefined) {
    out.push({ path, kind: 'removed', before });
    return;
  }
  if (Object.is(before, after)) {
    out.push({ path, kind: 'unchanged', before, after });
    return;
  }
  if (!sameType(before, after)) {
    out.push({ path, kind: 'changed', before, after });
    return;
  }
  if (isPrimitive(before)) {
    if (before === after) {
      out.push({ path, kind: 'unchanged', before, after });
    } else {
      out.push({ path, kind: 'changed', before, after });
    }
    return;
  }
  if (Array.isArray(before) && Array.isArray(after)) {
    const len = Math.max(before.length, after.length);
    for (let i = 0; i < len; i++) {
      walk(before[i], after[i], joinPath(path, i), depth + 1, out);
    }
    return;
  }
  // Both are non-null objects.
  const a = before as Record<string, unknown>;
  const b = after as Record<string, unknown>;
  const keys = new Set<string>([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    walk(a[key], b[key], joinPath(path, key), depth + 1, out);
  }
}

export function diffJson(before: unknown, after: unknown): DiffSummary {
  const entries: DiffEntry[] = [];
  walk(before, after, '', 0, entries);
  let added = 0;
  let removed = 0;
  let changed = 0;
  let unchanged = 0;
  for (const e of entries) {
    if (e.kind === 'added') added++;
    else if (e.kind === 'removed') removed++;
    else if (e.kind === 'changed') changed++;
    else unchanged++;
  }
  return { entries, added, removed, changed, unchanged };
}

/**
 * Convenience: parse two text bodies as JSON and diff. Returns `null` when
 * either side isn't valid JSON so the caller can fall back to a text diff.
 */
export function diffJsonText(beforeText: string, afterText: string): DiffSummary | null {
  let before: unknown;
  let after: unknown;
  try {
    before = JSON.parse(beforeText);
    after = JSON.parse(afterText);
  } catch {
    return null;
  }
  return diffJson(before, after);
}
