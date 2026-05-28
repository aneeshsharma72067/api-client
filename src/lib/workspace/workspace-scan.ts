import type { ApiRequest, Collection, Environment, Folder } from '@/types/api';
import { generateId } from '@/lib/storage';
import { readTextFile } from './fs-access';
import { parseRequest } from './yaml-codec';
import { parseEnv } from './env-codec';
import { WorkspaceError, type IdIndex } from './types';

const ENV_DIR = 'environments';

export interface ScanResult {
  collections: Collection[];
  folders: Folder[];
  requests: ApiRequest[];
  environments: Environment[];
  idIndex: IdIndex;
  parseErrors: { path: string; message: string }[];
}

function reuseOrNewId(idIndex: IdIndex, path: string): string {
  const existing = Object.entries(idIndex).find(([, p]) => p === path);
  if (existing) return existing[0];
  return generateId();
}

async function scanRequestsInDir(
  dir: FileSystemDirectoryHandle,
  prefix: string,
  collectionId: string,
  parentFolderId: string | null,
  out: ScanResult,
  prevIndex: IdIndex,
): Promise<{ requestIds: string[]; folderIds: string[] }> {
  const requestIds: string[] = [];
  const folderIds: string[] = [];
  // @ts-expect-error AsyncIterable on directory handle not yet in lib
  for await (const [name, handle] of dir.entries() as AsyncIterable<[string, FileSystemHandle]>) {
    if (name.startsWith('.')) continue;
    const path = `${prefix}/${name}`;
    if (handle.kind === 'file') {
      if (!name.toLowerCase().endsWith('.yaml') && !name.toLowerCase().endsWith('.yml')) continue;
      try {
        const id = reuseOrNewId(prevIndex, path);
        const { text, mtime } = await readTextFile(dir, name);
        const req = parseRequest(text, path, id, mtime);
        out.requests.push(req);
        out.idIndex[req.id] = path;
        requestIds.push(req.id);
      } catch (err) {
        const message = err instanceof WorkspaceError ? err.message : String(err);
        out.parseErrors.push({ path, message });
      }
    } else {
      const folderId = reuseOrNewId(prevIndex, path);
      const folder: Folder = {
        id: folderId,
        name,
        parentId: parentFolderId,
        collectionId,
        requests: [],
        folders: [],
      };
      out.folders.push(folder);
      out.idIndex[folderId] = path;
      folderIds.push(folderId);
      const child = await scanRequestsInDir(
        handle as FileSystemDirectoryHandle,
        path,
        collectionId,
        folderId,
        out,
        prevIndex,
      );
      folder.requests = child.requestIds;
      folder.folders = child.folderIds;
    }
  }
  return { requestIds, folderIds };
}

export async function scanRoot(
  root: FileSystemDirectoryHandle,
  prevIndex: IdIndex = {},
): Promise<ScanResult> {
  const result: ScanResult = {
    collections: [],
    folders: [],
    requests: [],
    environments: [],
    idIndex: {},
    parseErrors: [],
  };

  // @ts-expect-error AsyncIterable on directory handle not yet in lib
  for await (const [name, handle] of root.entries() as AsyncIterable<[string, FileSystemHandle]>) {
    if (name.startsWith('.')) continue;
    if (handle.kind === 'file') continue;

    if (name === ENV_DIR) {
      const envDir = handle as FileSystemDirectoryHandle;
      // @ts-expect-error AsyncIterable on directory handle not yet in lib
      for await (const [envName, envHandle] of envDir.entries() as AsyncIterable<[string, FileSystemHandle]>) {
        if (envHandle.kind !== 'file') continue;
        if (!envName.toLowerCase().endsWith('.env')) continue;
        const path = `${ENV_DIR}/${envName}`;
        try {
          const id = reuseOrNewId(prevIndex, path);
          const { text } = await readTextFile(envDir, envName);
          const env = parseEnv(text, envName, id);
          result.environments.push(env);
          result.idIndex[env.id] = path;
        } catch (err) {
          const message = err instanceof WorkspaceError ? err.message : String(err);
          result.parseErrors.push({ path, message });
        }
      }
      continue;
    }

    const collectionId = reuseOrNewId(prevIndex, name);
    const collection: Collection = {
      id: collectionId,
      name,
      requests: [],
      folders: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    result.collections.push(collection);
    result.idIndex[collectionId] = name;
    const child = await scanRequestsInDir(
      handle as FileSystemDirectoryHandle,
      name,
      collectionId,
      null,
      result,
      prevIndex,
    );
    collection.requests = child.requestIds;
    collection.folders = child.folderIds;
  }

  // Activate first env if any (active state not persisted on disk this slice)
  if (result.environments.length > 0) {
    result.environments[0] = { ...result.environments[0], isActive: true };
  }

  return result;
}
