import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { MethodBadge } from '@/components/api/MethodBadge';
import { useWorkspaceContext } from '@/contexts/WorkspaceContext';
import {
  detectFormat,
  parseImport,
  totalRequestCount,
  type ImportFormat,
  type ImportResult,
} from '@/lib/imports/importers';
import { AlertCircle, FileUp, FolderTree, Loader2, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

type TabValue = ImportFormat | 'auto';

interface FormatTab {
  value: TabValue;
  label: string;
  description: string;
  placeholder: string;
  accepts: string;
}

const TABS: FormatTab[] = [
  {
    value: 'auto',
    label: 'Auto',
    description: 'Paste any supported format — we will detect it.',
    placeholder: 'Paste a curl command, OpenAPI spec, Postman collection, or HAR…',
    accepts: '.json,.yaml,.yml,.har,.txt',
  },
  {
    value: 'curl',
    label: 'cURL',
    description: 'Paste one or more curl commands, separated by newlines or semicolons.',
    placeholder: "curl -X POST https://api.example.com/users -H 'Content-Type: application/json' …",
    accepts: '.txt,.sh',
  },
  {
    value: 'openapi',
    label: 'OpenAPI',
    description: 'OpenAPI 3.x or Swagger 2.0 (JSON or YAML).',
    placeholder: '{ "openapi": "3.0.0", "paths": { … } }',
    accepts: '.json,.yaml,.yml',
  },
  {
    value: 'postman',
    label: 'Postman',
    description: 'Postman Collection v2.x JSON export.',
    placeholder: '{ "info": { … }, "item": [ … ] }',
    accepts: '.json',
  },
  {
    value: 'har',
    label: 'HAR',
    description: 'HTTP Archive (.har) captured from your browser dev tools.',
    placeholder: '{ "log": { "entries": [ … ] } }',
    accepts: '.har,.json',
  },
];

function formatLabel(format: ImportFormat): string {
  return TABS.find((t) => t.value === format)?.label ?? format;
}

export function ImportModal({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const workspace = useWorkspaceContext();
  const [tab, setTab] = useState<TabValue>('auto');
  const [text, setText] = useState('');
  const [collectionName, setCollectionName] = useState('');
  const [collectionTouched, setCollectionTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const activeTab = TABS.find((t) => t.value === tab) ?? TABS[0];

  // Live preview: parse on change, debounced via React's batched updates.
  const preview = useMemo<ImportResult | null>(() => {
    if (!text.trim()) return null;
    const explicit = tab === 'auto' ? undefined : tab;
    return parseImport(text, explicit);
  }, [text, tab]);

  const detected: ImportFormat | null = useMemo(() => {
    if (!text.trim()) return null;
    if (tab !== 'auto') return tab;
    return detectFormat(text);
  }, [text, tab]);

  // Auto-populate collection name from preview's suggestion until the user types one.
  useEffect(() => {
    if (collectionTouched) return;
    if (preview?.suggestedCollection) {
      setCollectionName(preview.suggestedCollection);
    }
  }, [preview?.suggestedCollection, collectionTouched]);

  // Reset everything when the dialog closes.
  useEffect(() => {
    if (!open) {
      setText('');
      setCollectionName('');
      setCollectionTouched(false);
      setTab('auto');
      setSubmitting(false);
    }
  }, [open]);

  const handleFile = useCallback(async (file: File) => {
    const content = await file.text();
    setText(content);
    if (!collectionTouched) {
      const stem = file.name.replace(/\.[^.]+$/, '');
      setCollectionName(stem);
    }
  }, [collectionTouched]);

  const handleFileInput = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (file) void handleFile(file);
      event.target.value = '';
    },
    [handleFile],
  );

  const handleSubmit = useCallback(async () => {
    if (!preview) return;
    const total = totalRequestCount(preview);
    if (total === 0) {
      toast.error('Nothing to import — the document yielded zero requests.');
      return;
    }
    if (!workspace.isBound) {
      toast.error('Open a workspace folder first to import.');
      return;
    }
    setSubmitting(true);
    try {
      const collection = collectionName.trim() || preview.suggestedCollection || 'Imported';
      const result = await workspace.applyImport(preview, collection);
      if (result) onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  }, [preview, workspace, collectionName, onOpenChange]);

  const total = preview ? totalRequestCount(preview) : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl gap-0 p-0">
        <DialogHeader className="border-b border-border px-6 py-4">
          <DialogTitle className="text-base font-semibold">Import requests</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Bring in collections from cURL, OpenAPI, Postman, or HAR captures.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as TabValue)} className="flex flex-col">
          <div className="border-b border-border bg-muted/30 px-6 py-3">
            <TabsList className="h-9 bg-background/50">
              {TABS.map((t) => (
                <TabsTrigger key={t.value} value={t.value} className="text-xs">
                  {t.value === 'auto' && <Sparkles className="mr-1.5 h-3 w-3" />}
                  {t.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

          <div className="grid grid-cols-1 gap-0 md:grid-cols-[1fr,360px]">
            {/* Left: editor */}
            <div className="flex flex-col border-r border-border">
              <TabsContent value={tab} forceMount className="mt-0 flex flex-1 flex-col px-6 py-4 data-[state=inactive]:hidden">
                <div className="flex items-start justify-between gap-3 pb-3">
                  <p className="text-xs text-muted-foreground">{activeTab.description}</p>
                  <div className="flex shrink-0 items-center gap-2">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept={activeTab.accepts}
                      className="hidden"
                      onChange={handleFileInput}
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => fileInputRef.current?.click()}
                      className="h-7 text-xs"
                    >
                      <FileUp className="mr-1.5 h-3 w-3" />
                      Open file
                    </Button>
                  </div>
                </div>
                <Textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder={activeTab.placeholder}
                  spellCheck={false}
                  className="min-h-[280px] flex-1 resize-none font-mono text-xs leading-relaxed"
                />
              </TabsContent>
            </div>

            {/* Right: preview */}
            <div className="flex flex-col bg-muted/20">
              <PreviewPanel preview={preview} detected={detected} explicit={tab} />
            </div>
          </div>
        </Tabs>

        <div className="border-t border-border px-6 py-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <label className="text-xs font-medium text-muted-foreground">Collection</label>
              <Input
                value={collectionName}
                onChange={(e) => {
                  setCollectionName(e.target.value);
                  setCollectionTouched(true);
                }}
                placeholder="Imported"
                className="h-8 w-64 text-sm"
              />
            </div>
            <div className="flex items-center gap-2">
              {!workspace.isBound && (
                <span className="flex items-center gap-1 text-xs text-amber-500">
                  <AlertCircle className="h-3 w-3" /> Open a workspace folder to enable import
                </span>
              )}
            </div>
          </div>
        </div>

        <DialogFooter className="border-t border-border px-6 py-3">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={submitting || total === 0 || !workspace.isBound}
          >
            {submitting ? (
              <>
                <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                Importing…
              </>
            ) : (
              `Import ${total || ''} request${total === 1 ? '' : 's'}`.trim()
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface PreviewPanelProps {
  preview: ImportResult | null;
  detected: ImportFormat | null;
  explicit: TabValue;
}

function PreviewPanel({ preview, detected, explicit }: PreviewPanelProps) {
  if (!preview) {
    return (
      <div className="flex h-full min-h-[360px] flex-col items-center justify-center gap-2 px-6 py-10 text-center text-xs text-muted-foreground">
        <FolderTree className="h-5 w-5 opacity-50" />
        <p>Preview will appear here once you paste content.</p>
      </div>
    );
  }
  const total = totalRequestCount(preview);
  return (
    <div className="flex h-full min-h-[360px] flex-col">
      <div className="border-b border-border px-4 py-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Preview</span>
          {detected && (
            <span className="rounded-sm bg-background px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {explicit === 'auto' ? 'detected ' : ''}{formatLabel(detected)}
            </span>
          )}
        </div>
        <p className="mt-1 text-sm font-medium text-foreground">
          {total} {total === 1 ? 'request' : 'requests'}
          {preview.folders.length > 0 && (
            <span className="text-muted-foreground"> · {preview.folders.length} folders</span>
          )}
        </p>
      </div>

      {preview.warnings.length > 0 && (
        <div className="border-b border-border bg-amber-500/5 px-4 py-2">
          {preview.warnings.map((w, i) => (
            <p key={i} className="flex items-start gap-1.5 text-[11px] text-amber-600 dark:text-amber-400">
              <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
              <span>{w}</span>
            </p>
          ))}
        </div>
      )}

      <ScrollArea className="flex-1">
        <div className="space-y-3 px-4 py-3">
          {preview.requests.length > 0 && (
            <PreviewGroup name="(top level)" requests={preview.requests} muted />
          )}
          {preview.folders.map((folder) => (
            <PreviewGroup key={folder.name} name={folder.name} requests={folder.requests} />
          ))}
          {total === 0 && (
            <p className="text-xs text-muted-foreground">No requests parsed.</p>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

interface PreviewGroupProps {
  name: string;
  requests: ImportResult['requests'];
  muted?: boolean;
}

function PreviewGroup({ name, requests, muted }: PreviewGroupProps) {
  if (requests.length === 0) return null;
  return (
    <div>
      <p
        className={cn(
          'mb-1 text-[10px] font-semibold uppercase tracking-wide',
          muted ? 'text-muted-foreground/70' : 'text-muted-foreground',
        )}
      >
        {name}
      </p>
      <ul className="space-y-0.5">
        {requests.map((req) => (
          <li key={req.id} className="flex items-center gap-2 rounded-sm px-1.5 py-1 hover:bg-background">
            <MethodBadge method={req.method} size="sm" />
            <span className="truncate text-xs text-foreground" title={req.name}>
              {req.name}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default ImportModal;
