import { WorkspaceError } from './types';

type FSAHandle = FileSystemDirectoryHandle & {
  queryPermission?: (d: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>;
  requestPermission?: (d: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>;
};

export function hasFSA(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

export async function pickRoot(): Promise<FileSystemDirectoryHandle> {
  if (!hasFSA()) throw new WorkspaceError('BrowserUnsupported', 'File System Access API unavailable');
  try {
    // @ts-expect-error showDirectoryPicker not in TS lib
    const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
    return handle as FileSystemDirectoryHandle;
  } catch (err) {
    if ((err as DOMException)?.name === 'AbortError') {
      throw new WorkspaceError('NotFound', 'Picker dismissed', { cause: err });
    }
    throw new WorkspaceError('PermissionDenied', 'Could not pick directory', { cause: err });
  }
}

export async function queryPermission(
  handle: FileSystemDirectoryHandle,
  mode: 'read' | 'readwrite' = 'readwrite',
): Promise<PermissionState> {
  const h = handle as FSAHandle;
  if (!h.queryPermission) return 'granted';
  return h.queryPermission({ mode });
}

export async function requestPermission(
  handle: FileSystemDirectoryHandle,
  mode: 'read' | 'readwrite' = 'readwrite',
): Promise<PermissionState> {
  const h = handle as FSAHandle;
  if (!h.requestPermission) return 'granted';
  return h.requestPermission({ mode });
}

export async function readTextFile(
  dir: FileSystemDirectoryHandle,
  name: string,
): Promise<{ text: string; mtime: number; size: number }> {
  try {
    const fileHandle = await dir.getFileHandle(name);
    const file = await fileHandle.getFile();
    const text = await file.text();
    return { text, mtime: file.lastModified, size: file.size };
  } catch (err) {
    if ((err as DOMException)?.name === 'NotAllowedError') {
      throw new WorkspaceError('PermissionDenied', `Permission lost for ${name}`, { path: name, cause: err });
    }
    throw new WorkspaceError('NotFound', `Cannot read ${name}`, { path: name, cause: err });
  }
}

export async function writeTextFile(
  dir: FileSystemDirectoryHandle,
  name: string,
  text: string,
): Promise<{ mtime: number; size: number }> {
  try {
    const fileHandle = await dir.getFileHandle(name, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(text);
    await writable.close();
    const file = await fileHandle.getFile();
    return { mtime: file.lastModified, size: file.size };
  } catch (err) {
    if ((err as DOMException)?.name === 'NotAllowedError') {
      throw new WorkspaceError('PermissionDenied', `Permission lost while writing ${name}`, { path: name, cause: err });
    }
    throw new WorkspaceError('WriteFailed', `Cannot write ${name}`, { path: name, cause: err });
  }
}

export async function removeEntry(
  dir: FileSystemDirectoryHandle,
  name: string,
  opts: { recursive?: boolean } = {},
): Promise<void> {
  try {
    await dir.removeEntry(name, { recursive: !!opts.recursive });
  } catch (err) {
    if ((err as DOMException)?.name === 'NotFoundError') return;
    if ((err as DOMException)?.name === 'NotAllowedError') {
      throw new WorkspaceError('PermissionDenied', `Permission lost while removing ${name}`, { path: name, cause: err });
    }
    throw new WorkspaceError('WriteFailed', `Cannot remove ${name}`, { path: name, cause: err });
  }
}

export async function getDir(
  parent: FileSystemDirectoryHandle,
  name: string,
  create = false,
): Promise<FileSystemDirectoryHandle> {
  try {
    return await parent.getDirectoryHandle(name, { create });
  } catch (err) {
    if ((err as DOMException)?.name === 'NotFoundError') {
      throw new WorkspaceError('NotFound', `Directory ${name} not found`, { path: name, cause: err });
    }
    throw new WorkspaceError('WriteFailed', `Cannot open dir ${name}`, { path: name, cause: err });
  }
}

export async function hasEntry(
  dir: FileSystemDirectoryHandle,
  name: string,
): Promise<boolean> {
  try {
    await dir.getFileHandle(name);
    return true;
  } catch {
    try {
      await dir.getDirectoryHandle(name);
      return true;
    } catch {
      return false;
    }
  }
}

export interface WalkEntry {
  path: string;
  kind: 'file' | 'directory';
  handle: FileSystemHandle;
  parent: FileSystemDirectoryHandle;
}

export async function* walk(
  root: FileSystemDirectoryHandle,
  prefix = '',
): AsyncGenerator<WalkEntry> {
  // @ts-expect-error AsyncIterable on directory handle not yet in lib
  for await (const [name, handle] of root.entries() as AsyncIterable<[string, FileSystemHandle]>) {
    if (name.startsWith('.')) continue;
    const path = prefix ? `${prefix}/${name}` : name;
    if (handle.kind === 'file') {
      yield { path, kind: 'file', handle, parent: root };
    } else {
      yield { path, kind: 'directory', handle, parent: root };
      yield* walk(handle as FileSystemDirectoryHandle, path);
    }
  }
}
