import { ApiRequest, Collection, Environment, HistoryItem, Folder } from '@/types/api';

const DB_NAME = 'api-client-db';
const DB_VERSION = 2;

export interface WorkspaceMetaEntry {
  key: string;
  value: unknown;
}

interface DBSchema {
  requests: ApiRequest;
  collections: Collection;
  folders: Folder;
  environments: Environment;
  history: HistoryItem;
  'workspace-meta': WorkspaceMetaEntry;
}

type StoreName = keyof DBSchema;

let db: IDBDatabase | null = null;

export async function initDB(): Promise<IDBDatabase> {
  if (db) return db;

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const database = (event.target as IDBOpenDBRequest).result;

      if (!database.objectStoreNames.contains('requests')) {
        database.createObjectStore('requests', { keyPath: 'id' });
      }
      if (!database.objectStoreNames.contains('collections')) {
        database.createObjectStore('collections', { keyPath: 'id' });
      }
      if (!database.objectStoreNames.contains('folders')) {
        database.createObjectStore('folders', { keyPath: 'id' });
      }
      if (!database.objectStoreNames.contains('environments')) {
        database.createObjectStore('environments', { keyPath: 'id' });
      }
      if (!database.objectStoreNames.contains('history')) {
        const historyStore = database.createObjectStore('history', { keyPath: 'id' });
        historyStore.createIndex('timestamp', 'timestamp', { unique: false });
      }
      if (!database.objectStoreNames.contains('workspace-meta')) {
        database.createObjectStore('workspace-meta', { keyPath: 'key' });
      }
    };
  });
}

async function getStore<T extends StoreName>(
  storeName: T,
  mode: IDBTransactionMode = 'readonly'
): Promise<IDBObjectStore> {
  const database = await initDB();
  const transaction = database.transaction(storeName, mode);
  return transaction.objectStore(storeName);
}

export async function getAll<T extends StoreName>(storeName: T): Promise<DBSchema[T][]> {
  const store = await getStore(storeName);
  return new Promise((resolve, reject) => {
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function getById<T extends StoreName>(
  storeName: T,
  id: string
): Promise<DBSchema[T] | undefined> {
  const store = await getStore(storeName);
  return new Promise((resolve, reject) => {
    const request = store.get(id);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function save<T extends StoreName>(
  storeName: T,
  item: DBSchema[T]
): Promise<void> {
  const store = await getStore(storeName, 'readwrite');
  return new Promise((resolve, reject) => {
    const request = store.put(item);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function remove<T extends StoreName>(
  storeName: T,
  id: string
): Promise<void> {
  const store = await getStore(storeName, 'readwrite');
  return new Promise((resolve, reject) => {
    const request = store.delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function clearStore<T extends StoreName>(storeName: T): Promise<void> {
  const store = await getStore(storeName, 'readwrite');
  return new Promise((resolve, reject) => {
    const request = store.clear();
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

// Helper to generate unique IDs
export function generateId(): string {
  return crypto.randomUUID();
}

// Create default request
export function createDefaultRequest(): ApiRequest {
  return {
    id: generateId(),
    name: 'New Request',
    method: 'GET',
    url: '',
    headers: [],
    params: [],
    body: { type: 'none' },
    auth: { type: 'none' },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

// Create default collection
export function createDefaultCollection(name: string = 'New Collection'): Collection {
  return {
    id: generateId(),
    name,
    requests: [],
    folders: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

// Create default environment
export function createDefaultEnvironment(name: string = 'New Environment'): Environment {
  return {
    id: generateId(),
    name,
    variables: [],
    isActive: false,
  };
}
