import type { Environment, KeyValuePair } from '@/types/api';
import { generateId } from '@/lib/storage';

function stripQuotes(v: string): string {
  if (v.length >= 2) {
    const first = v[0];
    const last = v[v.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return v.slice(1, -1);
    }
  }
  return v;
}

export function parseEnv(text: string, filename: string, idHint?: string): Environment {
  const variables: KeyValuePair[] = [];
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const rawValue = trimmed.slice(eq + 1).trim();
    if (!key) continue;
    variables.push({
      id: generateId(),
      key,
      value: stripQuotes(rawValue),
      enabled: true,
    });
  }
  const name = filename.replace(/\.env$/i, '');
  return {
    id: idHint ?? generateId(),
    name: name || 'env',
    variables,
    isActive: false,
  };
}

export function serializeEnv(env: Environment): string {
  const lines: string[] = [];
  for (const v of env.variables) {
    if (!v.enabled || !v.key) continue;
    const needsQuotes = /[\s#"'=]/.test(v.value);
    const value = needsQuotes ? `"${v.value.replace(/"/g, '\\"')}"` : v.value;
    lines.push(`${v.key}=${value}`);
  }
  return lines.join('\n') + (lines.length ? '\n' : '');
}
