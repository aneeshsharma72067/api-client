import { getById, save, remove } from '@/lib/storage';
import type { IdIndex } from './types';

const KEY_ROOT = 'rootHandle';
const KEY_IDX = 'idIndex';

export async function saveRootHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  await save('workspace-meta', { key: KEY_ROOT, value: handle });
}

export async function loadRootHandle(): Promise<FileSystemDirectoryHandle | null> {
  const row = await getById('workspace-meta', KEY_ROOT);
  return (row?.value as FileSystemDirectoryHandle | undefined) ?? null;
}

export async function clearRootHandle(): Promise<void> {
  await remove('workspace-meta', KEY_ROOT);
}

export async function saveIdIndex(idx: IdIndex): Promise<void> {
  await save('workspace-meta', { key: KEY_IDX, value: idx });
}

export async function loadIdIndex(): Promise<IdIndex> {
  const row = await getById('workspace-meta', KEY_IDX);
  return (row?.value as IdIndex | undefined) ?? {};
}

export async function clearIdIndex(): Promise<void> {
  await remove('workspace-meta', KEY_IDX);
}
