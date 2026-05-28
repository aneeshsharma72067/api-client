import type { ApiRequest, Environment } from '@/types/api';
import { getDir, removeEntry, writeTextFile, hasEntry } from './fs-access';
import { serializeRequest } from './yaml-codec';
import { serializeEnv } from './env-codec';
import { slug, resolveCollision } from './slug';
import { WorkspaceError } from './types';

const ENV_DIR = 'environments';

function basename(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? path : path.slice(i + 1);
}

function dirname(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
}

async function resolvePath(
  root: FileSystemDirectoryHandle,
  segments: string[],
  create: boolean,
): Promise<FileSystemDirectoryHandle> {
  let h = root;
  for (const seg of segments) {
    if (!seg) continue;
    h = await getDir(h, seg, create);
  }
  return h;
}

export async function ensureCollectionDir(
  root: FileSystemDirectoryHandle,
  name: string,
): Promise<string> {
  if (name === ENV_DIR) {
    throw new WorkspaceError('WriteFailed', `'${ENV_DIR}' is reserved`);
  }
  await getDir(root, name, true);
  return name;
}

export async function renameCollectionDir(
  root: FileSystemDirectoryHandle,
  oldName: string,
  newName: string,
): Promise<void> {
  if (oldName === newName) return;
  if (newName === ENV_DIR) {
    throw new WorkspaceError('WriteFailed', `'${ENV_DIR}' is reserved`);
  }
  if (await hasEntry(root, newName)) {
    throw new WorkspaceError('WriteFailed', `Cannot rename: '${newName}' already exists`);
  }
  // Only supported for empty collections this slice (FSA has no portable dir rename).
  const oldDir = await getDir(root, oldName, false);
  // @ts-expect-error AsyncIterable on directory handle not yet in lib
  for await (const _entry of oldDir.entries() as AsyncIterable<[string, FileSystemHandle]>) {
    void _entry;
    throw new WorkspaceError('WriteFailed', 'Renaming non-empty collections not supported yet');
  }
  await getDir(root, newName, true);
  await removeEntry(root, oldName, { recursive: true });
}

export async function deleteCollectionDir(
  root: FileSystemDirectoryHandle,
  name: string,
): Promise<void> {
  await removeEntry(root, name, { recursive: true });
}

export interface WriteRequestResult {
  path: string;
}

export async function writeRequest(
  root: FileSystemDirectoryHandle,
  req: ApiRequest,
  parentPath: string,
  prevPath?: string,
): Promise<WriteRequestResult> {
  const dir = await resolvePath(root, parentPath.split('/'), true);
  const text = serializeRequest(req);
  const baseSlug = slug(req.name);

  if (prevPath && dirname(prevPath) === parentPath) {
    const prevFile = basename(prevPath);
    const prevBaseSlug = prevFile.replace(/\.(yaml|yml)$/i, '');
    if (prevBaseSlug === baseSlug) {
      await writeTextFile(dir, prevFile, text);
      return { path: prevPath };
    }
    const nextFile = await resolveCollision(dir, baseSlug, '.yaml', prevFile);
    await writeTextFile(dir, nextFile, text);
    await removeEntry(dir, prevFile);
    return { path: parentPath ? `${parentPath}/${nextFile}` : nextFile };
  }

  if (prevPath) {
    const prevParent = dirname(prevPath);
    try {
      const prevDir = await resolvePath(root, prevParent.split('/'), false);
      await removeEntry(prevDir, basename(prevPath));
    } catch {
      /* ignore */
    }
  }

  const nextFile = await resolveCollision(dir, baseSlug, '.yaml');
  await writeTextFile(dir, nextFile, text);
  return { path: parentPath ? `${parentPath}/${nextFile}` : nextFile };
}

export async function deleteRequestFile(
  root: FileSystemDirectoryHandle,
  path: string,
): Promise<void> {
  const dir = await resolvePath(root, dirname(path).split('/'), false);
  await removeEntry(dir, basename(path));
}

export async function writeEnv(
  root: FileSystemDirectoryHandle,
  env: Environment,
  prevPath?: string,
): Promise<string> {
  const envDir = await getDir(root, ENV_DIR, true);
  const text = serializeEnv(env);
  const baseSlug = slug(env.name);

  if (prevPath) {
    const prevFile = basename(prevPath);
    const prevBaseSlug = prevFile.replace(/\.env$/i, '');
    if (prevBaseSlug === baseSlug) {
      await writeTextFile(envDir, prevFile, text);
      return `${ENV_DIR}/${prevFile}`;
    }
    const nextFile = await resolveCollision(envDir, baseSlug, '.env', prevFile);
    await writeTextFile(envDir, nextFile, text);
    await removeEntry(envDir, prevFile);
    return `${ENV_DIR}/${nextFile}`;
  }

  const nextFile = await resolveCollision(envDir, baseSlug, '.env');
  await writeTextFile(envDir, nextFile, text);
  return `${ENV_DIR}/${nextFile}`;
}

export async function deleteEnvFile(
  root: FileSystemDirectoryHandle,
  path: string,
): Promise<void> {
  const envDir = await getDir(root, ENV_DIR, false);
  await removeEntry(envDir, basename(path));
}
