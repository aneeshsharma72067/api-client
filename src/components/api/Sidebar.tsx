import { useState } from 'react';
import { Collection, ApiRequest, HistoryItem } from '@/types/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { MethodBadge } from './MethodBadge';
import { FolderPlus, Plus, Search, History, FolderOpen, ChevronRight, ChevronDown, Trash2, Moon, Sun, GitCompare } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTheme } from '@/hooks/useTheme';
import { formatDistanceToNow } from 'date-fns';
import { WorkspaceStatus } from '@/components/workspace/WorkspaceStatus';

interface SidebarProps {
  collections: Collection[];
  requests: Map<string, ApiRequest>;
  history: HistoryItem[];
  activeRequestId: string | null;
  onSelectRequest: (request: ApiRequest) => void;
  onCreateRequest: (collectionId?: string) => void;
  onCreateCollection: () => void;
  onDeleteCollection: (id: string) => void;
  onSelectHistory: (item: HistoryItem) => void;
  onCompareHistory: (a: HistoryItem, b: HistoryItem) => void;
}

export function Sidebar({
  collections,
  requests,
  history,
  activeRequestId,
  onSelectRequest,
  onCreateRequest,
  onCreateCollection,
  onDeleteCollection,
  onSelectHistory,
  onCompareHistory,
}: SidebarProps) {
  const [search, setSearch] = useState('');
  const [expandedCollections, setExpandedCollections] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState<'collections' | 'history'>('collections');
  const [compareMode, setCompareMode] = useState(false);
  const [comparePicks, setComparePicks] = useState<string[]>([]);
  const { theme, toggleTheme } = useTheme();

  const toggleComparePick = (item: HistoryItem) => {
    setComparePicks((prev) => {
      if (prev.includes(item.id)) return prev.filter((id) => id !== item.id);
      if (prev.length >= 2) return [prev[1], item.id];
      const next = [...prev, item.id];
      if (next.length === 2) {
        const a = history.find((h) => h.id === next[0]);
        const b = history.find((h) => h.id === next[1]);
        if (a && b) {
          onCompareHistory(a, b);
          setComparePicks([]);
          setCompareMode(false);
        }
      }
      return next;
    });
  };

  const toggleCollection = (id: string) => {
    setExpandedCollections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const filteredHistory = history.filter((item) =>
    item.request.name.toLowerCase().includes(search.toLowerCase()) ||
    item.request.url.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="w-72 h-full flex flex-col bg-sidebar border-r border-sidebar-border">
      <div className="p-3 border-b border-sidebar-border">
        <div className="flex items-center justify-between mb-2">
          <h1 className="font-semibold text-lg text-sidebar-foreground">API Client</h1>
          <Button variant="ghost" size="icon" onClick={toggleTheme} className="h-8 w-8">
            {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
        </div>
        <div className="mb-2"><WorkspaceStatus /></div>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-9 bg-background"
          />
        </div>
      </div>

      <div className="flex border-b border-sidebar-border">
        <button
          className={cn(
            'flex-1 py-2 text-sm font-medium transition-colors',
            activeTab === 'collections'
              ? 'text-sidebar-primary border-b-2 border-sidebar-primary'
              : 'text-sidebar-foreground hover:text-foreground'
          )}
          onClick={() => setActiveTab('collections')}
        >
          <FolderOpen className="h-4 w-4 inline mr-1.5" />
          Collections
        </button>
        <button
          className={cn(
            'flex-1 py-2 text-sm font-medium transition-colors',
            activeTab === 'history'
              ? 'text-sidebar-primary border-b-2 border-sidebar-primary'
              : 'text-sidebar-foreground hover:text-foreground'
          )}
          onClick={() => setActiveTab('history')}
        >
          <History className="h-4 w-4 inline mr-1.5" />
          History
        </button>
      </div>

      <ScrollArea className="flex-1">
        {activeTab === 'collections' && (
          <div className="p-2">
            <div className="flex gap-1 mb-2">
              <Button variant="ghost" size="sm" onClick={onCreateCollection} className="flex-1 justify-start gap-2 h-8">
                <FolderPlus className="h-4 w-4" /> New Collection
              </Button>
              <Button variant="ghost" size="sm" onClick={() => onCreateRequest()} className="h-8 px-2">
                <Plus className="h-4 w-4" />
              </Button>
            </div>

            {collections.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No collections yet</p>
            ) : (
              <div className="space-y-1">
                {collections.map((collection) => (
                  <div key={collection.id}>
                    <div
                      className="flex items-center gap-1 p-2 rounded-md hover:bg-sidebar-accent cursor-pointer group"
                      onClick={() => toggleCollection(collection.id)}
                    >
                      {expandedCollections.has(collection.id) ? (
                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      )}
                      <FolderOpen className="h-4 w-4 text-sidebar-primary" />
                      <span className="text-sm font-medium flex-1 truncate">{collection.name}</span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 opacity-0 group-hover:opacity-100"
                        onClick={(e) => { e.stopPropagation(); onDeleteCollection(collection.id); }}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                    {expandedCollections.has(collection.id) && (
                      <div className="ml-4 space-y-0.5">
                        {collection.requests.map((reqId) => {
                          const req = requests.get(reqId);
                          if (!req) return null;
                          return (
                            <div
                              key={req.id}
                              className={cn(
                                'flex items-center gap-2 p-2 rounded-md cursor-pointer transition-colors',
                                activeRequestId === req.id
                                  ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                                  : 'hover:bg-sidebar-accent/50'
                              )}
                              onClick={() => onSelectRequest(req)}
                            >
                              <MethodBadge method={req.method} size="sm" />
                              <span className="text-sm truncate">{req.name}</span>
                            </div>
                          );
                        })}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="w-full justify-start gap-2 h-8 text-muted-foreground"
                          onClick={() => onCreateRequest(collection.id)}
                        >
                          <Plus className="h-3 w-3" /> Add Request
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'history' && (
          <div className="p-2 space-y-1">
            <div className="mb-1 flex items-center justify-between gap-1 px-1">
              <Button
                variant={compareMode ? 'secondary' : 'ghost'}
                size="sm"
                className="h-7 gap-1.5 text-[11px]"
                onClick={() => {
                  setCompareMode((v) => !v);
                  setComparePicks([]);
                }}
              >
                <GitCompare className="h-3 w-3" />
                {compareMode ? `Compare (${comparePicks.length}/2)` : 'Compare'}
              </Button>
              {compareMode && comparePicks.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-[11px] text-muted-foreground"
                  onClick={() => setComparePicks([])}
                >
                  Clear
                </Button>
              )}
            </div>
            {filteredHistory.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No history yet</p>
            ) : (
              filteredHistory.map((item) => {
                const picked = comparePicks.includes(item.id);
                return (
                  <div
                    key={item.id}
                    className={cn(
                      'flex items-center gap-2 p-2 rounded-md cursor-pointer transition-colors',
                      compareMode
                        ? picked
                          ? 'bg-primary/10 ring-1 ring-primary/40 hover:bg-primary/15'
                          : 'hover:bg-sidebar-accent/60'
                        : 'hover:bg-sidebar-accent',
                    )}
                    onClick={() => (compareMode ? toggleComparePick(item) : onSelectHistory(item))}
                  >
                    {compareMode && (
                      <span
                        className={cn(
                          'flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border text-[9px] font-semibold',
                          picked
                            ? 'border-primary bg-primary text-primary-foreground'
                            : 'border-border text-muted-foreground',
                        )}
                      >
                        {picked ? comparePicks.indexOf(item.id) + 1 : ''}
                      </span>
                    )}
                    <MethodBadge method={item.request.method} size="sm" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm truncate">{item.request.url || 'Untitled'}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatDistanceToNow(item.timestamp, { addSuffix: true })}
                      </p>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
