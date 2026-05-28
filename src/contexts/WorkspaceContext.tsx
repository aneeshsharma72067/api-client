import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import type { ApiRequest, Collection, Environment, Folder } from '@/types/api';
import {
  hasFSA,
  pickRoot,
  queryPermission,
  requestPermission,
} from '@/lib/workspace/fs-access';
import { scanRoot } from '@/lib/workspace/workspace-scan';
import {
  importCurl as libImportCurl,
  parseOpenApi as libParseOpenApi,
  parsePostman as libParsePostman,
  parseHar as libParseHar,
  totalRequestCount,
  type ImportResult,
} from '@/lib/imports/importers';
import {
  writeRequest,
  deleteRequestFile,
  writeEnv,
  deleteEnvFile,
  ensureCollectionDir,
  deleteCollectionDir,
  renameCollectionDir,
} from '@/lib/workspace/workspace-writer';
import {
  saveRootHandle,
  loadRootHandle,
  clearRootHandle,
  saveIdIndex,
  loadIdIndex,
  clearIdIndex,
} from '@/lib/workspace/handle-store';
import { WorkspaceError, type IdIndex, type WorkspaceStatus } from '@/lib/workspace/types';

export interface WorkspaceReplaceAllPayload {
  collections: Collection[];
  folders: Folder[];
  requests: ApiRequest[];
  environments: Environment[];
}

export interface WorkspaceOps {
  status: WorkspaceStatus;
  rootName: string | null;
  isSupported: boolean;
  isBound: boolean;
  open: () => Promise<void>;
  close: () => Promise<void>;
  reconnect: () => Promise<void>;
  onRequestCreated: (req: ApiRequest, collectionId?: string) => Promise<void>;
  onRequestUpdated: (prev: ApiRequest, next: ApiRequest) => Promise<void>;
  onRequestDeleted: (req: ApiRequest) => Promise<void>;
  onCollectionCreated: (c: Collection) => Promise<void>;
  onCollectionUpdated: (prev: Collection, next: Collection) => Promise<void>;
  onCollectionDeleted: (c: Collection) => Promise<void>;
  onEnvCreated: (env: Environment) => Promise<void>;
  onEnvUpdated: (prev: Environment, next: Environment) => Promise<void>;
  onEnvDeleted: (env: Environment) => Promise<void>;
  reload: () => Promise<void>;
  /** Commit a parsed import result. Writes to disk (if bound) and refreshes IDB. */
  applyImport: (result: ImportResult, collectionName: string) => Promise<{ written: number } | undefined>;
  // Convenience helpers for tests and headless flows.
  importCurl: (text: string, collectionName?: string) => Promise<void>;
  importOpenApi: (doc: unknown, collectionName?: string) => Promise<void>;
  importPostman: (doc: unknown, collectionName?: string) => Promise<void>;
  importHar: (doc: unknown, collectionName?: string) => Promise<void>;
  /** Set when ApiClientProvider mounts; workspace uses it to replace IDB state on open. */
  setReplaceAllSink: (sink: ((payload: WorkspaceReplaceAllPayload) => Promise<void>) | null) => void;
}

const WorkspaceContext = createContext<WorkspaceOps | null>(null);

export function useWorkspaceContext(): WorkspaceOps {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error('useWorkspaceContext must be inside WorkspaceProvider');
  return ctx;
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const supported = hasFSA();
  const [status, setStatus] = useState<WorkspaceStatus>(supported ? 'idle' : 'unsupported');
  const [rootName, setRootName] = useState<string | null>(null);

  const rootRef = useRef<FileSystemDirectoryHandle | null>(null);
  const idIndexRef = useRef<IdIndex>({});
  const replaceAllSinkRef = useRef<((p: WorkspaceReplaceAllPayload) => Promise<void>) | null>(null);

  const persistIndex = useCallback(async () => {
    await saveIdIndex(idIndexRef.current);
  }, []);

  const handleFSAError = useCallback((err: unknown) => {
    if (err instanceof WorkspaceError) {
      if (err.kind === 'PermissionDenied') {
        setStatus('permission-lost');
        toast.error('Workspace permission lost. Click Reconnect.');
        return;
      }
      if (err.kind === 'NotFound') {
        toast.error(err.message);
        return;
      }
      toast.error(err.message);
      return;
    }
    toast.error(String(err));
  }, []);

  const finalizeOpen = useCallback(
    async (handle: FileSystemDirectoryHandle, prevIndex: IdIndex) => {
      const scan = await scanRoot(handle, prevIndex);
      rootRef.current = handle;
      idIndexRef.current = scan.idIndex;
      await persistIndex();
      const sink = replaceAllSinkRef.current;
      if (sink) {
        await sink({
          collections: scan.collections,
          folders: scan.folders,
          requests: scan.requests,
          environments: scan.environments,
        });
      }
      setRootName(handle.name);
      setStatus('bound');
      if (scan.parseErrors.length) {
        toast.warning(
          `Skipped ${scan.parseErrors.length} file(s) with parse errors: ${scan.parseErrors.map(e => e.path).join(', ')}`,
        );
      }
      toast.success(`Workspace opened: ${handle.name}`);
    },
    [persistIndex],
  );

  const open = useCallback(async () => {
    if (!supported) {
      toast.error('Workspace requires Chrome or Edge');
      return;
    }
    try {
      const handle = await pickRoot();
      const prev = await loadIdIndex();
      await saveRootHandle(handle);
      await finalizeOpen(handle, prev);
    } catch (err) {
      if (err instanceof WorkspaceError && err.kind === 'NotFound' && err.message === 'Picker dismissed') return;
      handleFSAError(err);
    }
  }, [supported, finalizeOpen, handleFSAError]);

  const reconnect = useCallback(async () => {
    if (!supported) return;
    try {
      const handle = rootRef.current ?? (await loadRootHandle());
      if (!handle) {
        await open();
        return;
      }
      const perm = await requestPermission(handle, 'readwrite');
      if (perm !== 'granted') {
        toast.error('Permission denied');
        setStatus('denied');
        return;
      }
      const prev = await loadIdIndex();
      await finalizeOpen(handle, prev);
    } catch (err) {
      handleFSAError(err);
    }
  }, [supported, open, finalizeOpen, handleFSAError]);

  const close = useCallback(async () => {
    rootRef.current = null;
    idIndexRef.current = {};
    await clearRootHandle();
    await clearIdIndex();
    setRootName(null);
    setStatus(supported ? 'idle' : 'unsupported');
  }, [supported]);

  // Auto-reopen on boot
  useEffect(() => {
    if (!supported) return;
    let cancelled = false;
    (async () => {
      const handle = await loadRootHandle();
      if (!handle || cancelled) return;
      const perm = await queryPermission(handle, 'readwrite');
      if (cancelled) return;
      if (perm === 'granted') {
        try {
          const prev = await loadIdIndex();
          await finalizeOpen(handle, prev);
        } catch (err) {
          handleFSAError(err);
        }
      } else if (perm === 'prompt') {
        rootRef.current = handle;
        setRootName(handle.name);
        setStatus('prompt');
      } else {
        setStatus('denied');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [supported, finalizeOpen, handleFSAError]);

  // --- write-through ops ---
  // These do nothing if no workspace is bound. ApiClient calls them after IDB writes.

  const guard = useCallback(<T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    if (!rootRef.current) return Promise.resolve(undefined);
    return fn().catch((err) => {
      handleFSAError(err);
      return undefined;
    });
  }, [handleFSAError]);

  const collectionPathById = useCallback((id: string): string | undefined => {
    return idIndexRef.current[id];
  }, []);

  const onRequestCreated = useCallback(
    async (req: ApiRequest, collectionId?: string) => {
      await guard(async () => {
        const root = rootRef.current!;
        const parentPath = collectionId ? collectionPathById(collectionId) : undefined;
        if (!parentPath) {
          // Orphan request — write to top-level "_inbox" collection
          await ensureCollectionDir(root, '_inbox');
          const res = await writeRequest(root, req, '_inbox');
          idIndexRef.current[req.id] = res.path;
        } else {
          const res = await writeRequest(root, req, parentPath);
          idIndexRef.current[req.id] = res.path;
        }
        await persistIndex();
      });
    },
    [guard, collectionPathById, persistIndex],
  );

  const onRequestUpdated = useCallback(
    async (prev: ApiRequest, next: ApiRequest) => {
      await guard(async () => {
        const root = rootRef.current!;
        const prevPath = idIndexRef.current[next.id];
        if (!prevPath) {
          // Not on disk yet — treat as create in '_inbox'
          await ensureCollectionDir(root, '_inbox');
          const res = await writeRequest(root, next, '_inbox');
          idIndexRef.current[next.id] = res.path;
        } else {
          const parentPath = prevPath.includes('/') ? prevPath.slice(0, prevPath.lastIndexOf('/')) : '';
          const res = await writeRequest(root, next, parentPath, prevPath);
          idIndexRef.current[next.id] = res.path;
        }
        await persistIndex();
      });
      void prev;
    },
    [guard, persistIndex],
  );

  const onRequestDeleted = useCallback(
    async (req: ApiRequest) => {
      await guard(async () => {
        const path = idIndexRef.current[req.id];
        if (!path) return;
        await deleteRequestFile(rootRef.current!, path);
        delete idIndexRef.current[req.id];
        await persistIndex();
      });
    },
    [guard, persistIndex],
  );

  const onCollectionCreated = useCallback(
    async (c: Collection) => {
      await guard(async () => {
        const path = await ensureCollectionDir(rootRef.current!, c.name);
        idIndexRef.current[c.id] = path;
        await persistIndex();
      });
    },
    [guard, persistIndex],
  );

  const onCollectionUpdated = useCallback(
    async (prev: Collection, next: Collection) => {
      await guard(async () => {
        if (prev.name === next.name) return;
        const prevPath = idIndexRef.current[next.id] ?? prev.name;
        await renameCollectionDir(rootRef.current!, prevPath, next.name);
        idIndexRef.current[next.id] = next.name;
        await persistIndex();
      });
    },
    [guard, persistIndex],
  );

  const onCollectionDeleted = useCallback(
    async (c: Collection) => {
      await guard(async () => {
        const path = idIndexRef.current[c.id] ?? c.name;
        await deleteCollectionDir(rootRef.current!, path);
        delete idIndexRef.current[c.id];
        // Drop any descendants from index
        for (const [id, p] of Object.entries(idIndexRef.current)) {
          if (p === path || p.startsWith(`${path}/`)) delete idIndexRef.current[id];
        }
        await persistIndex();
      });
    },
    [guard, persistIndex],
  );

  const onEnvCreated = useCallback(
    async (env: Environment) => {
      await guard(async () => {
        const path = await writeEnv(rootRef.current!, env);
        idIndexRef.current[env.id] = path;
        await persistIndex();
      });
    },
    [guard, persistIndex],
  );

  const onEnvUpdated = useCallback(
    async (prev: Environment, next: Environment) => {
      await guard(async () => {
        const prevPath = idIndexRef.current[next.id];
        const path = await writeEnv(rootRef.current!, next, prevPath);
        idIndexRef.current[next.id] = path;
        await persistIndex();
      });
      void prev;
    },
    [guard, persistIndex],
  );

  const onEnvDeleted = useCallback(
    async (env: Environment) => {
      await guard(async () => {
        const path = idIndexRef.current[env.id];
        if (!path) return;
        await deleteEnvFile(rootRef.current!, path);
        delete idIndexRef.current[env.id];
        await persistIndex();
      });
    },
    [guard, persistIndex],
  );

  const reload = useCallback(async () => {
    await guard(async () => {
      const root = rootRef.current!;
      const prev = idIndexRef.current;
      const scan = await scanRoot(root, prev);
      idIndexRef.current = scan.idIndex;
      await persistIndex();
      const sink = replaceAllSinkRef.current;
      if (sink) {
        await sink({
          collections: scan.collections,
          folders: scan.folders,
          requests: scan.requests,
          environments: scan.environments,
        });
      }
      if (scan.parseErrors.length) {
        toast.warning(
          `Skipped ${scan.parseErrors.length} file(s) with parse errors: ${scan.parseErrors
            .map((e) => e.path)
            .join(', ')}`,
        );
      }
      toast.success(`Workspace reloaded: ${root.name}`);
    });
  }, [guard, persistIndex]);

  const applyImport = useCallback(
    async (result: ImportResult, collectionName: string): Promise<{ written: number } | undefined> => {
      if (!rootRef.current) {
        toast.error('Open a workspace folder first to import.');
        return undefined;
      }
      try {
        const root = rootRef.current;
        const total = totalRequestCount(result);
        await ensureCollectionDir(root, collectionName);

        for (const req of result.requests) {
          const res = await writeRequest(root, req, collectionName);
          idIndexRef.current[req.id] = res.path;
        }
        for (const folder of result.folders) {
          const parentPath = `${collectionName}/${folder.name}`;
          for (const req of folder.requests) {
            const res = await writeRequest(root, req, parentPath);
            idIndexRef.current[req.id] = res.path;
          }
        }
        await persistIndex();

        // Re-scan so IDB mirrors disk (folders, IDs reconciled, etc.).
        const scan = await scanRoot(root, idIndexRef.current);
        idIndexRef.current = scan.idIndex;
        await persistIndex();
        const sink = replaceAllSinkRef.current;
        if (sink) {
          await sink({
            collections: scan.collections,
            folders: scan.folders,
            requests: scan.requests,
            environments: scan.environments,
          });
        }
        toast.success(`Imported ${total} request(s) into ${collectionName}`);
        return { written: total };
      } catch (err) {
        handleFSAError(err);
        return undefined;
      }
    },
    [persistIndex, handleFSAError],
  );

  const importCurl = useCallback(
    async (text: string, collectionName?: string) => {
      const result = libImportCurl(text);
      await applyImport(result, collectionName ?? '_imports');
    },
    [applyImport],
  );

  const importOpenApi = useCallback(
    async (doc: unknown, collectionName?: string) => {
      const result = libParseOpenApi(doc);
      await applyImport(result, collectionName ?? result.suggestedCollection ?? '_openapi');
    },
    [applyImport],
  );

  const importPostman = useCallback(
    async (doc: unknown, collectionName?: string) => {
      const result = libParsePostman(doc);
      await applyImport(result, collectionName ?? result.suggestedCollection ?? '_postman');
    },
    [applyImport],
  );

  const importHar = useCallback(
    async (doc: unknown, collectionName?: string) => {
      const result = libParseHar(doc);
      await applyImport(result, collectionName ?? '_har');
    },
    [applyImport],
  );

  const setReplaceAllSink = useCallback(
    (sink: ((p: WorkspaceReplaceAllPayload) => Promise<void>) | null) => {
      replaceAllSinkRef.current = sink;
    },
    [],
  );

  const value = useMemo<WorkspaceOps>(
    () => ({
      status,
      rootName,
      isSupported: supported,
      isBound: status === 'bound',
      open,
      close,
      reconnect,
      onRequestCreated,
      onRequestUpdated,
      onRequestDeleted,
      onCollectionCreated,
      onCollectionUpdated,
      onCollectionDeleted,
      onEnvCreated,
      onEnvUpdated,
      onEnvDeleted,
      reload,
      applyImport,
      importCurl,
      importOpenApi,
      importPostman,
      importHar,
      setReplaceAllSink,
    }),
    [
      status,
      rootName,
      supported,
      open,
      close,
      reconnect,
      onRequestCreated,
      onRequestUpdated,
      onRequestDeleted,
      onCollectionCreated,
      onCollectionUpdated,
      onCollectionDeleted,
      onEnvCreated,
      onEnvUpdated,
      onEnvDeleted,
      reload,
      applyImport,
      importCurl,
      importOpenApi,
      importPostman,
      importHar,
      setReplaceAllSink,
    ],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}
