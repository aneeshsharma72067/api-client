import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ApiClientProvider, useApiClientContext } from '@/contexts/ApiClientContext';
import { Sidebar } from '@/components/api/Sidebar';
import { RequestBuilder } from '@/components/api/RequestBuilder';
import { ResponseViewer } from '@/components/api/ResponseViewer';
import { MethodBadge } from '@/components/api/MethodBadge';
import { KeyValueEditor } from '@/components/api/KeyValueEditor';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { useIsMobile } from '@/hooks/use-mobile';
import { toast } from '@/hooks/use-toast';
import { Loader2, Menu, Copy, Trash2, Settings2, Globe, History as HistoryIcon } from 'lucide-react';
import type { ApiRequest, ApiResponse, KeyValuePair, HistoryItem } from '@/types/api';

type EnvironmentDraft = {
  id: string | null;
  name: string;
  variables: KeyValuePair[];
};

const clonePairs = (pairs: KeyValuePair[]) => pairs.map((pair) => ({ ...pair }));

const Index = () => (
  <ApiClientProvider>
    <ApiClientApp />
  </ApiClientProvider>
);

export default Index;

function ApiClientApp() {
  const {
    requests,
    collections,
    history,
    activeRequest,
    activeResponse,
    isLoading,
    isInitialized,
    setActiveRequest,
    createRequest,
    updateRequest,
    deleteRequest,
    duplicateRequest,
    createCollection,
    deleteCollection,
    updateCollection,
    sendRequest,
    environments,
    activeEnvironment,
    setActiveEnvironment,
    createEnvironment,
    updateEnvironment,
    deleteEnvironment,
    globalVariables,
    updateGlobalVariables,
    clearHistory,
  } = useApiClientContext();

  const isMobile = useIsMobile();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [requestName, setRequestName] = useState('');
  const [responsePreview, setResponsePreview] = useState<ApiResponse | null>(null);
  const [isHistoryPreview, setIsHistoryPreview] = useState(false);
  const [envDialogOpen, setEnvDialogOpen] = useState(false);
  const [envDraft, setEnvDraft] = useState<EnvironmentDraft | null>(null);
  const [globalsDialogOpen, setGlobalsDialogOpen] = useState(false);
  const [globalDraft, setGlobalDraft] = useState<KeyValuePair[]>([]);

  const initializingRef = useRef(false);

  const requestValues = useMemo(
    () => Array.from(requests.values()).sort((a, b) => b.updatedAt - a.updatedAt),
    [requests],
  );

  useEffect(() => {
    if (!isInitialized || initializingRef.current) {
      return;
    }

    const activeId = activeRequest?.id ?? null;
    const hasActive = activeId ? requests.has(activeId) : false;

    if (activeId && hasActive) {
      return;
    }

    const fallback = requestValues[0];
    if (fallback) {
      setActiveRequest(fallback);
      setResponsePreview(null);
      setIsHistoryPreview(false);
      return;
    }

    initializingRef.current = true;
    createRequest()
      .then((newRequest) => {
        setActiveRequest(newRequest);
        setResponsePreview(null);
        setIsHistoryPreview(false);
      })
      .finally(() => {
        initializingRef.current = false;
      });
  }, [
    isInitialized,
    activeRequest,
    requestValues,
    requests,
    createRequest,
    setActiveRequest,
  ]);

  useEffect(() => {
    if (activeRequest) {
      setRequestName(activeRequest.name);
    }
  }, [activeRequest]);

  useEffect(() => {
    if (isHistoryPreview) {
      return;
    }
    setResponsePreview(activeResponse ?? null);
  }, [activeResponse, isHistoryPreview]);

  useEffect(() => {
    if (!envDialogOpen) {
      setEnvDraft(null);
      return;
    }

    if (envDraft) {
      return;
    }

    if (activeEnvironment) {
      setEnvDraft({
        id: activeEnvironment.id,
        name: activeEnvironment.name,
        variables: clonePairs(activeEnvironment.variables),
      });
      return;
    }

    if (environments.length > 0) {
      const first = environments[0];
      setEnvDraft({
        id: first.id,
        name: first.name,
        variables: clonePairs(first.variables),
      });
      return;
    }

    setEnvDraft({
      id: null,
      name: 'New Environment',
      variables: [],
    });
  }, [envDialogOpen, envDraft, activeEnvironment, environments]);

  useEffect(() => {
    if (globalsDialogOpen) {
      setGlobalDraft(clonePairs(globalVariables));
    }
  }, [globalsDialogOpen, globalVariables]);

  const handleSelectRequest = useCallback(
    (request: ApiRequest) => {
      setActiveRequest(request);
      setResponsePreview(null);
      setIsHistoryPreview(false);
      if (isMobile) {
        setSidebarOpen(false);
      }
    },
    [setActiveRequest, isMobile],
  );

  const handleCreateRequest = useCallback(
    async (collectionId?: string) => {
      const newRequest = await createRequest(collectionId);
      setActiveRequest(newRequest);
      setResponsePreview(null);
      setIsHistoryPreview(false);
      if (isMobile) {
        setSidebarOpen(false);
      }
    },
    [createRequest, setActiveRequest, isMobile],
  );

  const handleSendRequest = useCallback(async () => {
    if (!activeRequest) return;
    setIsHistoryPreview(false);
    await sendRequest(activeRequest);
  }, [activeRequest, sendRequest]);

  const handleRequestUpdate = useCallback(
    (request: ApiRequest) => {
      setIsHistoryPreview(false);
      updateRequest(request);
    },
    [updateRequest],
  );

  const handleDuplicateRequest = useCallback(async () => {
    if (!activeRequest) return;
    const duplicate = await duplicateRequest(activeRequest.id);
    if (!duplicate) return;

    const parentCollection = collections.find((collection) =>
      collection.requests.includes(activeRequest.id),
    );
    if (parentCollection) {
      await updateCollection({
        ...parentCollection,
        requests: [...parentCollection.requests, duplicate.id],
      });
    }

    setActiveRequest(duplicate);
    setResponsePreview(null);
    setIsHistoryPreview(false);
    toast({ title: 'Request duplicated' });
  }, [activeRequest, duplicateRequest, collections, updateCollection, setActiveRequest]);

  const handleDeleteRequest = useCallback(async () => {
    if (!activeRequest) return;
    const confirmed = window.confirm('Delete this request?');
    if (!confirmed) return;
    setIsHistoryPreview(false);
    setResponsePreview(null);
    await deleteRequest(activeRequest.id);
    toast({ title: 'Request deleted' });
  }, [activeRequest, deleteRequest]);

  const handleSelectHistory = useCallback(
    (item: HistoryItem) => {
      setActiveRequest(item.request);
      setResponsePreview(item.response);
      setIsHistoryPreview(true);
      if (isMobile) {
        setSidebarOpen(false);
      }
    },
    [setActiveRequest, isMobile],
  );

  const handleClearHistory = useCallback(async () => {
    if (history.length === 0) return;
    const confirmed = window.confirm('Clear request history?');
    if (!confirmed) return;
    await clearHistory();
    if (isHistoryPreview) {
      setIsHistoryPreview(false);
      setResponsePreview(null);
    }
    toast({ title: 'History cleared' });
  }, [history.length, clearHistory, isHistoryPreview]);

  const commitRequestName = useCallback(() => {
    if (!activeRequest) return;
    const trimmed = requestName.trim() || 'Untitled Request';
    setRequestName(trimmed);
    if (trimmed !== activeRequest.name) {
      updateRequest({ ...activeRequest, name: trimmed });
    }
  }, [activeRequest, requestName, updateRequest]);

  const handleCreateCollection = useCallback(async () => {
    const collection = await createCollection();
    toast({ title: 'Collection created', description: collection.name });
  }, [createCollection]);

  const handleDeleteCollection = useCallback(
    async (collectionId: string) => {
      const confirmed = window.confirm(
        'Delete this collection and all of its requests?',
      );
      if (!confirmed) return;
      await deleteCollection(collectionId);
      setIsHistoryPreview(false);
      setResponsePreview(null);
      toast({ title: 'Collection deleted' });
    },
    [deleteCollection],
  );

  const handleEnvironmentSelection = useCallback(
    (value: string) => {
      if (value === 'new') {
        setEnvDraft({
          id: null,
          name: 'New Environment',
          variables: [],
        });
        return;
      }

      const selected = environments.find((env) => env.id === value);
      if (selected) {
        setEnvDraft({
          id: selected.id,
          name: selected.name,
          variables: clonePairs(selected.variables),
        });
      }
    },
    [environments],
  );

  const handleEnvironmentSave = useCallback(async () => {
    if (!envDraft) return;
    const trimmedName = envDraft.name.trim() || 'New Environment';

    if (envDraft.id) {
      const original = environments.find((env) => env.id === envDraft.id);
      if (!original) return;
      await updateEnvironment({
        ...original,
        name: trimmedName,
        variables: envDraft.variables,
      });
      toast({ title: 'Environment updated' });
    } else {
      const created = await createEnvironment(trimmedName);
      await updateEnvironment({
        ...created,
        name: trimmedName,
        variables: envDraft.variables,
      });
      toast({ title: 'Environment created' });
      if (!activeEnvironment) {
        await setActiveEnvironment(created.id);
      }
    }

    setEnvDialogOpen(false);
  }, [
    envDraft,
    environments,
    updateEnvironment,
    createEnvironment,
    activeEnvironment,
    setActiveEnvironment,
  ]);

  const handleEnvironmentDelete = useCallback(async () => {
    if (!envDraft?.id) return;
    const confirmed = window.confirm('Delete this environment?');
    if (!confirmed) return;

    await deleteEnvironment(envDraft.id);
    if (activeEnvironment?.id === envDraft.id) {
      await setActiveEnvironment(null);
    }
    toast({ title: 'Environment deleted' });
    setEnvDialogOpen(false);
  }, [envDraft, deleteEnvironment, activeEnvironment, setActiveEnvironment]);

  const handleGlobalsSave = useCallback(() => {
    updateGlobalVariables(globalDraft);
    toast({ title: 'Globals updated' });
    setGlobalsDialogOpen(false);
  }, [globalDraft, updateGlobalVariables]);

  const handleEnvironmentToggle = useCallback(
    (value: string) => {
      setIsHistoryPreview(false);
      if (value === 'none') {
        void setActiveEnvironment(null);
        return;
      }
      void setActiveEnvironment(value);
    },
    [setActiveEnvironment],
  );

  if (!isInitialized || !activeRequest) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
          <span>Loading workspace…</span>
        </div>
      </div>
    );
  }

  const sidebar = (
    <Sidebar
      collections={collections}
      requests={requests}
      history={history}
      activeRequestId={activeRequest.id}
      onSelectRequest={handleSelectRequest}
      onCreateRequest={handleCreateRequest}
      onCreateCollection={handleCreateCollection}
      onDeleteCollection={handleDeleteCollection}
      onSelectHistory={handleSelectHistory}
    />
  );

  const environmentSelector = (
    <Select
      value={activeEnvironment?.id ?? 'none'}
      onValueChange={handleEnvironmentToggle}
    >
      <SelectTrigger className="hidden h-9 w-[200px] shrink-0 md:flex">
        <SelectValue placeholder="No environment" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="none">No environment</SelectItem>
        {environments.map((env) => (
          <SelectItem key={env.id} value={env.id}>
            {env.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  const topBar = (menuTrigger?: ReactNode) => (
    <div className="flex items-center gap-3 border-b border-border bg-background/80 px-3 py-3 md:px-6">
      {menuTrigger}
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <MethodBadge method={activeRequest.method} />
        <Input
          value={requestName}
          onChange={(event) => setRequestName(event.target.value)}
          onBlur={commitRequestName}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              commitRequestName();
            }
          }}
          placeholder="Request name"
          className="h-9"
        />
      </div>
      <div className="ml-auto flex items-center gap-2">
        {environmentSelector}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setEnvDialogOpen(true)}
          title="Manage environments"
        >
          <Settings2 className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setGlobalsDialogOpen(true)}
          title="Global variables"
        >
          <Globe className="h-4 w-4" />
        </Button>
        <Separator orientation="vertical" className="hidden h-6 sm:block" />
        <Button
          variant="ghost"
          size="icon"
          onClick={handleClearHistory}
          disabled={history.length === 0}
          title="Clear history"
        >
          <HistoryIcon className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={handleDuplicateRequest}
          title="Duplicate request"
        >
          <Copy className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={handleDeleteRequest}
          title="Delete request"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );

  const mainContent = (
    <div className="flex flex-1 flex-col bg-muted/20">
      <ResizablePanelGroup direction="horizontal" className="flex-1">
        <ResizablePanel defaultSize={55} minSize={35}>
          <div className="h-full border-r border-border">
            <RequestBuilder
              request={activeRequest}
              isLoading={isLoading}
              onUpdate={handleRequestUpdate}
              onSend={handleSendRequest}
            />
          </div>
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize={45} minSize={30}>
          <div className="h-full">
            <ResponseViewer response={responsePreview} isLoading={isLoading} />
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );

  return (
    <div className="flex h-screen bg-background text-foreground">
      {!isMobile && sidebar}
      <div className="flex flex-1 flex-col">
        {isMobile ? (
          <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
            {topBar(
              <SheetTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="md:hidden"
                  title="Toggle sidebar"
                >
                  <Menu className="h-5 w-5" />
                </Button>
              </SheetTrigger>,
            )}
            {mainContent}
            <SheetContent side="left" className="w-72 p-0">
              {sidebar}
            </SheetContent>
          </Sheet>
        ) : (
          <>
            {topBar()}
            {mainContent}
          </>
        )}
      </div>

      <Dialog open={envDialogOpen} onOpenChange={setEnvDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Environments</DialogTitle>
            <DialogDescription>
              Organize variables for different deployment targets.
            </DialogDescription>
          </DialogHeader>
          {envDraft ? (
            <div className="space-y-5">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <Select
                  value={envDraft.id ?? 'new'}
                  onValueChange={handleEnvironmentSelection}
                >
                  <SelectTrigger className="h-9 w-[220px]">
                    <SelectValue placeholder="Select environment" />
                  </SelectTrigger>
                  <SelectContent>
                    {environments.map((env) => (
                      <SelectItem key={env.id} value={env.id}>
                        {env.name}
                      </SelectItem>
                    ))}
                    <SelectItem value="new">+ New environment</SelectItem>
                  </SelectContent>
                </Select>
                {envDraft.id && (
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={handleEnvironmentDelete}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Delete
                  </Button>
                )}
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-muted-foreground">
                  Name
                </label>
                <Input
                  value={envDraft.name}
                  onChange={(event) =>
                    setEnvDraft((previous) =>
                      previous
                        ? { ...previous, name: event.target.value }
                        : previous,
                    )
                  }
                  placeholder="Environment name"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-muted-foreground">
                  Variables
                </label>
                <ScrollArea className="max-h-[320px] pr-2">
                  <KeyValueEditor
                    items={envDraft.variables}
                    onChange={(items) =>
                      setEnvDraft((previous) =>
                        previous
                          ? { ...previous, variables: items }
                          : previous,
                      )
                    }
                    keyPlaceholder="Variable"
                    valuePlaceholder="Value"
                  />
                </ScrollArea>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Loading environment…</span>
            </div>
          )}
          <DialogFooter>
            <Button variant="secondary" onClick={() => setEnvDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleEnvironmentSave} disabled={!envDraft}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={globalsDialogOpen} onOpenChange={setGlobalsDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Global variables</DialogTitle>
            <DialogDescription>
              These variables are available to every request.
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[360px] pr-2">
            <KeyValueEditor
              items={globalDraft}
              onChange={setGlobalDraft}
              keyPlaceholder="Variable"
              valuePlaceholder="Value"
              showDescription
            />
          </ScrollArea>
          <DialogFooter>
            <Button
              variant="secondary"
              onClick={() => setGlobalsDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button onClick={handleGlobalsSave}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
