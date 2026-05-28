import { useMemo, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { MethodBadge } from '@/components/api/MethodBadge';
import { diffJsonText, type DiffEntry, type DiffSummary } from '@/lib/response/json-diff';
import type { HistoryItem } from '@/types/api';
import { cn } from '@/lib/utils';
import { ArrowRight, FileQuestion, Minus, Plus, Pencil } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

interface CompareDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  left: HistoryItem | null;
  right: HistoryItem | null;
}

export function CompareDialog({ open, onOpenChange, left, right }: CompareDialogProps) {
  const [showUnchanged, setShowUnchanged] = useState(false);
  const summary = useMemo<DiffSummary | null>(() => {
    if (!left?.response || !right?.response) return null;
    return diffJsonText(left.response.body, right.response.body);
  }, [left, right]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl gap-0 p-0">
        <DialogHeader className="border-b border-border px-6 py-4">
          <DialogTitle className="text-base font-semibold">Compare responses</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Pick two history entries from the sidebar — view a structural JSON diff or side-by-side text.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-0">
          <CompareSummary label="A" item={left} />
          <CompareSummary label="B" item={right} />
        </div>

        <Tabs defaultValue="diff" className="flex flex-col">
          <div className="border-y border-border bg-muted/30 px-6 py-2">
            <TabsList className="h-8 bg-background/60">
              <TabsTrigger value="diff" className="text-xs">JSON diff</TabsTrigger>
              <TabsTrigger value="side" className="text-xs">Side-by-side</TabsTrigger>
            </TabsList>
            {summary && (
              <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
                <DiffCount kind="added" count={summary.added} />
                <DiffCount kind="removed" count={summary.removed} />
                <DiffCount kind="changed" count={summary.changed} />
                <DiffCount kind="unchanged" count={summary.unchanged} />
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-auto h-6 px-2 text-[11px]"
                  onClick={() => setShowUnchanged((v) => !v)}
                >
                  {showUnchanged ? 'Hide unchanged' : 'Show unchanged'}
                </Button>
              </div>
            )}
          </div>

          <TabsContent value="diff" className="m-0">
            <ScrollArea className="h-[420px]">
              <DiffList summary={summary} showUnchanged={showUnchanged} />
            </ScrollArea>
          </TabsContent>

          <TabsContent value="side" className="m-0">
            <SideBySide left={left} right={right} />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function CompareSummary({ label, item }: { label: string; item: HistoryItem | null }) {
  if (!item) {
    return (
      <div className="flex h-24 items-center justify-center gap-2 border-r border-border bg-muted/20 px-6 text-xs text-muted-foreground last:border-r-0">
        <FileQuestion className="h-4 w-4" />
        <span>Select {label} from the history tab</span>
      </div>
    );
  }
  const { request, response, timestamp } = item;
  return (
    <div className="flex flex-col gap-1 border-r border-border bg-background px-6 py-3 last:border-r-0">
      <div className="flex items-center gap-2">
        <span className="rounded-sm bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        <MethodBadge method={request.method} size="sm" />
        <span className="truncate text-xs font-medium" title={request.url}>
          {request.url || request.name}
        </span>
      </div>
      <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
        <span>{response?.status ?? '—'}</span>
        <span>{formatDistanceToNow(timestamp, { addSuffix: true })}</span>
      </div>
    </div>
  );
}

function DiffCount({ kind, count }: { kind: DiffEntry['kind']; count: number }) {
  const palette: Record<DiffEntry['kind'], string> = {
    added: 'text-emerald-500',
    removed: 'text-destructive',
    changed: 'text-amber-500',
    unchanged: 'text-muted-foreground',
  };
  const label: Record<DiffEntry['kind'], string> = {
    added: 'added',
    removed: 'removed',
    changed: 'changed',
    unchanged: 'unchanged',
  };
  return (
    <span className={cn('flex items-center gap-1', palette[kind])}>
      <span className="font-mono">{count}</span>
      <span>{label[kind]}</span>
    </span>
  );
}

function DiffList({ summary, showUnchanged }: { summary: DiffSummary | null; showUnchanged: boolean }) {
  if (!summary) {
    return (
      <div className="flex h-full items-center justify-center px-6 py-10 text-center text-xs text-muted-foreground">
        Either response is not valid JSON. Try the side-by-side view.
      </div>
    );
  }
  const filtered = summary.entries.filter((e) => showUnchanged || e.kind !== 'unchanged');
  if (filtered.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-6 py-10 text-center text-xs text-muted-foreground">
        No differences found.
      </div>
    );
  }
  return (
    <ul className="divide-y divide-border">
      {filtered.map((entry) => (
        <DiffRow key={`${entry.kind}-${entry.path}`} entry={entry} />
      ))}
    </ul>
  );
}

function DiffRow({ entry }: { entry: DiffEntry }) {
  const palette = {
    added: { icon: Plus, tone: 'text-emerald-500', bg: 'bg-emerald-500/5' },
    removed: { icon: Minus, tone: 'text-destructive', bg: 'bg-destructive/5' },
    changed: { icon: Pencil, tone: 'text-amber-500', bg: 'bg-amber-500/5' },
    unchanged: { icon: ArrowRight, tone: 'text-muted-foreground', bg: 'bg-transparent' },
  }[entry.kind];
  const Icon = palette.icon;
  return (
    <li className={cn('flex items-start gap-3 px-6 py-2 text-xs font-mono', palette.bg)}>
      <Icon className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', palette.tone)} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[11px] text-muted-foreground">/{entry.path || '(root)'}</p>
        <div className="mt-0.5 grid grid-cols-2 gap-3">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground/70">before</p>
            <p className={cn('truncate', entry.kind === 'added' && 'text-muted-foreground')}>
              {formatValue(entry.before)}
            </p>
          </div>
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground/70">after</p>
            <p className={cn('truncate', entry.kind === 'removed' && 'text-muted-foreground')}>
              {formatValue(entry.after)}
            </p>
          </div>
        </div>
      </div>
    </li>
  );
}

function formatValue(v: unknown): string {
  if (v === undefined) return '—';
  if (v === null) return 'null';
  if (typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function SideBySide({ left, right }: { left: HistoryItem | null; right: HistoryItem | null }) {
  return (
    <div className="grid h-[420px] grid-cols-2 gap-0">
      <SidePane label="A" item={left} />
      <SidePane label="B" item={right} />
    </div>
  );
}

function SidePane({ label, item }: { label: string; item: HistoryItem | null }) {
  return (
    <div className="flex min-w-0 flex-col border-r border-border last:border-r-0">
      <div className="border-b border-border bg-muted/20 px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <ScrollArea className="flex-1">
        <pre className="min-w-max p-3 font-mono text-[11px] leading-relaxed">
          {item?.response?.body ?? '(no body)'}
        </pre>
      </ScrollArea>
    </div>
  );
}
