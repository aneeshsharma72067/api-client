import { hasEntry } from './fs-access';

export function slug(name: string): string {
  const cleaned = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return cleaned || 'untitled';
}

export async function resolveCollision(
  dir: FileSystemDirectoryHandle,
  baseSlug: string,
  ext: string,
  ignore?: string,
): Promise<string> {
  const first = `${baseSlug}${ext}`;
  if (first !== ignore && !(await hasEntry(dir, first))) return first;
  let n = 2;
  while (true) {
    const candidate = `${baseSlug}-${n}${ext}`;
    if (candidate !== ignore && !(await hasEntry(dir, candidate))) return candidate;
    n++;
    if (n > 9999) throw new Error('Too many filename collisions');
  }
}
