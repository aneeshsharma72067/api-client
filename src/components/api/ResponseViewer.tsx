import { useMemo, useState, useCallback, type ReactNode } from 'react';
import { ApiResponse } from '@/types/api';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Toggle } from '@/components/ui/toggle';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import {
  Clock,
  Database,
  FileText,
  Copy,
  Download,
  WrapText,
  Eye,
  AlertTriangle,
} from 'lucide-react';
import {
  detectFormat,
  prettyPrint,
  tokenizeJson,
  formatBytes,
  type JsonToken,
  type ResponseFormat,
} from '@/lib/response/format';
import { auditHeaders, type AuditFinding, type AuditReport, type AuditSeverity } from '@/lib/response/header-audit';
import { diagnose, type Diagnostic } from '@/lib/response/error-rules';
import type { ResponseAttempt } from '@/types/api';
import { CheckCircle2, Info, Lightbulb, Shield, ShieldAlert, ShieldCheck } from 'lucide-react';
import { VirtualBody } from '@/components/response/VirtualBody';

const VIRTUALIZE_THRESHOLD = 100 * 1024; // 100 KB → use line virtualization

interface ResponseViewerProps {
  response: ApiResponse | null;
  isLoading: boolean;
  streamingProgress?: { loaded: number; total?: number } | null;
}

/** Hard cap on what the DOM is asked to render at once — keeps huge HTML pages from
 *  destroying the layout. The full body is kept in memory for copy/download. */
const RENDER_CAP_BYTES = 512 * 1024; // 512 KB

function formatTime(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

function getStatusClass(status: number): string {
  if (status >= 200 && status < 300) return 'status-success';
  if (status >= 300 && status < 400) return 'status-redirect';
  if (status >= 400 && status < 500) return 'status-client-error';
  if (status >= 500) return 'status-server-error';
  return 'text-muted-foreground';
}

const FORMAT_LABEL: Record<ResponseFormat, string> = {
  json: 'JSON',
  xml: 'XML',
  html: 'HTML',
  text: 'Text',
};

const EXT_FOR_FORMAT: Record<ResponseFormat, string> = {
  json: 'json',
  xml: 'xml',
  html: 'html',
  text: 'txt',
};

export function ResponseViewer({ response, isLoading, streamingProgress }: ResponseViewerProps) {
  if (isLoading) {
    const pct =
      streamingProgress?.total && streamingProgress.total > 0
        ? Math.min(100, Math.round((streamingProgress.loaded / streamingProgress.total) * 100))
        : null;
    return (
      <div className="flex h-full items-center justify-center bg-card">
        <div className="w-64 space-y-3 text-center">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">
            {streamingProgress
              ? `Streaming ${formatBytes(streamingProgress.loaded)}${
                  streamingProgress.total ? ` / ${formatBytes(streamingProgress.total)}` : ''
                }`
              : 'Sending request…'}
          </p>
          {pct !== null && (
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-border">
              <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
            </div>
          )}
        </div>
      </div>
    );
  }

  if (!response) {
    return (
      <div className="flex h-full items-center justify-center bg-card">
        <div className="max-w-sm space-y-2 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-muted">
            <FileText className="h-8 w-8 text-muted-foreground" />
          </div>
          <h3 className="font-medium">No response yet</h3>
          <p className="text-sm text-muted-foreground">
            Enter a URL and click Send to make a request.
          </p>
        </div>
      </div>
    );
  }

  return <ResponseBody response={response} />;
}

function ResponseBody({ response }: { response: ApiResponse }) {
  const contentType = response.headers['content-type'] ?? response.headers['Content-Type'];
  const format = useMemo(() => detectFormat(contentType, response.body), [contentType, response.body]);
  const [prettyOn, setPrettyOn] = useState(true);
  const [wrap, setWrap] = useState(false);
  const [forceFull, setForceFull] = useState(false);
  const diagnostic = useMemo(() => diagnose(response), [response]);
  const audit = useMemo(() => auditHeaders(response.headers), [response.headers]);
  const attempts = response.attempts ?? [];
  const hasMultipleAttempts = attempts.length > 1;

  const prettyText = useMemo(
    () => (prettyOn ? prettyPrint(response.body, format) : null),
    [prettyOn, response.body, format],
  );
  const displayText = prettyText ?? response.body;
  const isTruncated = !forceFull && displayText.length > RENDER_CAP_BYTES;
  const renderText = isTruncated ? displayText.slice(0, RENDER_CAP_BYTES) : displayText;

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(displayText);
      toast.success('Response copied');
    } catch {
      toast.error('Clipboard unavailable');
    }
  }, [displayText]);

  const handleDownload = useCallback(() => {
    const blob = new Blob([response.body], {
      type: contentType ?? 'application/octet-stream',
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `response-${Date.now()}.${EXT_FOR_FORMAT[format]}`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }, [response.body, contentType, format]);

  return (
    <div className="flex h-full min-w-0 flex-col bg-card">
      <StatusBar response={response} format={format} />

      <Tabs defaultValue="body" className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center justify-between border-b border-border bg-transparent px-3">
          <TabsList className="h-10 justify-start rounded-none bg-transparent p-0">
            <TabsTrigger
              value="body"
              className="rounded-b-none px-3 data-[state=active]:bg-muted"
            >
              Body
            </TabsTrigger>
            <TabsTrigger
              value="headers"
              className="rounded-b-none px-3 data-[state=active]:bg-muted"
            >
              Headers ({Object.keys(response.headers).length})
            </TabsTrigger>
            <TabsTrigger
              value="security"
              className="rounded-b-none px-3 data-[state=active]:bg-muted"
            >
              Security
              <SecurityGradeChip grade={audit.grade} />
            </TabsTrigger>
            {hasMultipleAttempts && (
              <TabsTrigger
                value="attempts"
                className="rounded-b-none px-3 data-[state=active]:bg-muted"
              >
                Attempts ({attempts.length})
              </TabsTrigger>
            )}
          </TabsList>

          <BodyToolbar
            format={format}
            prettyOn={prettyOn}
            onTogglePretty={setPrettyOn}
            wrap={wrap}
            onToggleWrap={setWrap}
            onCopy={handleCopy}
            onDownload={handleDownload}
            canPretty={prettyText !== null || format === 'json'}
          />
        </div>

        <TabsContent value="body" className="m-0 flex min-h-0 flex-1 flex-col">
          {diagnostic && <DiagnosticBanner diagnostic={diagnostic} />}
          {isTruncated && (
            <TruncationBanner
              shownBytes={RENDER_CAP_BYTES}
              totalBytes={displayText.length}
              onShowFull={() => setForceFull(true)}
              onDownload={handleDownload}
            />
          )}
          {renderText.length > VIRTUALIZE_THRESHOLD ? (
            <div className="flex-1 min-h-0 min-w-0">
              <VirtualBody
                text={renderText}
                format={prettyOn && format === 'json' ? 'json' : 'text'}
                wrap={wrap}
              />
            </div>
          ) : (
            <ScrollArea className="flex-1">
              <div className="min-w-0">
                <BodyContent text={renderText} format={prettyOn ? format : 'text'} wrap={wrap} />
              </div>
            </ScrollArea>
          )}
        </TabsContent>

        <TabsContent value="headers" className="m-0 min-h-0 flex-1">
          <ScrollArea className="h-full">
            <div className="space-y-1 p-4">
              {Object.entries(response.headers).map(([key, value]) => (
                <div
                  key={key}
                  className="grid grid-cols-[minmax(140px,200px),1fr] gap-3 border-b border-border/50 py-1 font-mono text-xs"
                >
                  <span className="font-medium text-primary">{key}</span>
                  <span className="break-all text-muted-foreground">{value}</span>
                </div>
              ))}
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="security" className="m-0 min-h-0 flex-1">
          <ScrollArea className="h-full">
            <SecurityPanel report={audit} />
          </ScrollArea>
        </TabsContent>

        {hasMultipleAttempts && (
          <TabsContent value="attempts" className="m-0 min-h-0 flex-1">
            <ScrollArea className="h-full">
              <AttemptsPanel attempts={attempts} />
            </ScrollArea>
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

function SecurityGradeChip({ grade }: { grade: AuditReport['grade'] }) {
  const palette: Record<AuditReport['grade'], string> = {
    A: 'bg-emerald-500/15 text-emerald-500',
    B: 'bg-emerald-500/10 text-emerald-500',
    C: 'bg-amber-500/15 text-amber-500',
    D: 'bg-amber-500/15 text-amber-500',
    F: 'bg-destructive/15 text-destructive',
  };
  return (
    <span
      className={cn(
        'ml-1.5 rounded-sm px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
        palette[grade],
      )}
    >
      {grade}
    </span>
  );
}

function SecurityPanel({ report }: { report: AuditReport }) {
  return (
    <div className="space-y-3 p-4">
      <div className="flex items-center gap-3 rounded-md border border-border bg-muted/30 p-3">
        <Shield className="h-5 w-5 text-primary" />
        <div className="flex-1">
          <p className="text-sm font-medium">Security headers score</p>
          <p className="text-xs text-muted-foreground">
            {report.findings.length} checks run · grade {report.grade} · {report.score}/100
          </p>
        </div>
        <SecurityGradeChip grade={report.grade} />
      </div>
      <ul className="space-y-1.5">
        {report.findings.map((finding) => (
          <FindingRow key={finding.id} finding={finding} />
        ))}
      </ul>
    </div>
  );
}

function FindingRow({ finding }: { finding: AuditFinding }) {
  const tone: Record<AuditSeverity, { icon: typeof Shield; cls: string; ring: string }> = {
    good: { icon: ShieldCheck, cls: 'text-emerald-500', ring: 'border-emerald-500/30 bg-emerald-500/5' },
    info: { icon: Info, cls: 'text-muted-foreground', ring: 'border-border bg-muted/20' },
    warning: { icon: ShieldAlert, cls: 'text-amber-500', ring: 'border-amber-500/30 bg-amber-500/5' },
    critical: { icon: ShieldAlert, cls: 'text-destructive', ring: 'border-destructive/30 bg-destructive/5' },
  };
  const t = tone[finding.severity];
  const Icon = t.icon;
  return (
    <li className={cn('flex items-start gap-3 rounded-md border p-3', t.ring)}>
      <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', t.cls)} />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium">{finding.title}</p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">{finding.detail}</p>
        {finding.value && (
          <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground" title={finding.value}>
            {finding.header}: {finding.value}
          </p>
        )}
      </div>
    </li>
  );
}

function AttemptsPanel({ attempts }: { attempts: ResponseAttempt[] }) {
  const maxTime = Math.max(1, ...attempts.map((a) => a.time));
  return (
    <div className="space-y-2 p-4">
      <p className="text-xs text-muted-foreground">
        Showing {attempts.length} attempt(s). Bar length is request time relative to the slowest attempt.
      </p>
      <ul className="space-y-1.5">
        {attempts.map((a) => (
          <li key={a.index} className="rounded-md border border-border bg-muted/20 p-2">
            <div className="flex items-center gap-3 text-[11px]">
              <span className="font-mono font-semibold text-muted-foreground">#{a.index}</span>
              <span
                className={cn(
                  'rounded-sm px-1.5 py-0.5 font-mono font-medium',
                  a.ok
                    ? 'bg-emerald-500/15 text-emerald-500'
                    : a.status === 0
                    ? 'bg-destructive/15 text-destructive'
                    : 'bg-amber-500/15 text-amber-500',
                )}
              >
                {a.status === 0 ? 'NETWORK' : a.status}
              </span>
              <span className="text-muted-foreground">{a.time} ms</span>
              {a.delay > 0 && (
                <span className="text-muted-foreground">+ {a.delay} ms backoff</span>
              )}
              {a.error && <span className="ml-auto truncate text-destructive">{a.error}</span>}
            </div>
            <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-border">
              <div
                className={cn(
                  'h-full',
                  a.ok ? 'bg-emerald-500' : a.status === 0 ? 'bg-destructive' : 'bg-amber-500',
                )}
                style={{ width: `${Math.max(2, Math.round((a.time / maxTime) * 100))}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function DiagnosticBanner({ diagnostic }: { diagnostic: Diagnostic }) {
  const tone =
    diagnostic.level === 'error'
      ? 'border-destructive/30 bg-destructive/5 text-destructive'
      : diagnostic.level === 'warning'
      ? 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300'
      : 'border-border bg-muted/30 text-foreground';
  return (
    <div className={cn('flex items-start gap-3 border-b px-4 py-3 text-xs', tone)}>
      <Lightbulb className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="font-medium">{diagnostic.title}</p>
        <p className="mt-0.5 text-[11px] opacity-90">{diagnostic.detail}</p>
        {diagnostic.suggestions.length > 0 && (
          <ul className="mt-1.5 space-y-0.5">
            {diagnostic.suggestions.map((s, i) => (
              <li key={i} className="flex items-start gap-1.5 text-[11px] opacity-90">
                <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0" />
                <span>{s}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

interface BodyContentProps {
  text: string;
  format: ResponseFormat;
  wrap: boolean;
}

function BodyContent({ text, format, wrap }: BodyContentProps) {
  const wrapClass = wrap ? 'whitespace-pre-wrap break-words' : 'whitespace-pre';
  // Tokenize unconditionally; tokenizer is cheap and stable across renders.
  const jsonTokens = useMemo(
    () => (format === 'json' ? tokenizeJson(text) : null),
    [text, format],
  );

  if (jsonTokens) {
    return (
      <pre
        className={cn(
          'min-w-max p-4 font-mono text-xs leading-relaxed',
          wrap && 'min-w-0',
          wrapClass,
        )}
      >
        {jsonTokens.map((token, i) => (
          <JsonTokenSpan key={i} token={token} />
        ))}
      </pre>
    );
  }

  return (
    <pre
      className={cn(
        'min-w-max p-4 font-mono text-xs leading-relaxed text-foreground',
        wrap && 'min-w-0',
        wrapClass,
      )}
    >
      {text}
    </pre>
  );
}

function JsonTokenSpan({ token }: { token: JsonToken }): ReactNode {
  switch (token.kind) {
    case 'key':
      return <span className="json-key">{token.text}</span>;
    case 'string':
      return <span className="json-string">{token.text}</span>;
    case 'number':
      return <span className="json-number">{token.text}</span>;
    case 'boolean':
      return <span className="json-boolean">{token.text}</span>;
    case 'null':
      return <span className="json-null">{token.text}</span>;
    case 'punct':
      return <span className="text-muted-foreground">{token.text}</span>;
    default:
      return token.text;
  }
}

interface BodyToolbarProps {
  format: ResponseFormat;
  prettyOn: boolean;
  onTogglePretty: (v: boolean) => void;
  wrap: boolean;
  onToggleWrap: (v: boolean) => void;
  onCopy: () => void;
  onDownload: () => void;
  canPretty: boolean;
}

function BodyToolbar({
  format,
  prettyOn,
  onTogglePretty,
  wrap,
  onToggleWrap,
  onCopy,
  onDownload,
  canPretty,
}: BodyToolbarProps) {
  return (
    <TooltipProvider delayDuration={150}>
      <div className="flex items-center gap-1 py-1.5">
        <span className="mr-1 rounded-sm bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {FORMAT_LABEL[format]}
        </span>

        {canPretty && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Toggle
                size="sm"
                pressed={prettyOn}
                onPressedChange={onTogglePretty}
                aria-label="Pretty print"
                className="h-7 px-2 text-[11px]"
              >
                Pretty
              </Toggle>
            </TooltipTrigger>
            <TooltipContent>Toggle pretty print</TooltipContent>
          </Tooltip>
        )}

        <Tooltip>
          <TooltipTrigger asChild>
            <Toggle
              size="sm"
              pressed={wrap}
              onPressedChange={onToggleWrap}
              aria-label="Wrap lines"
              className="h-7 w-7 p-0"
            >
              <WrapText className="h-3.5 w-3.5" />
            </Toggle>
          </TooltipTrigger>
          <TooltipContent>Toggle line wrap</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onCopy}>
              <Copy className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Copy body</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onDownload}>
              <Download className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Download raw body</TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
}

interface TruncationBannerProps {
  shownBytes: number;
  totalBytes: number;
  onShowFull: () => void;
  onDownload: () => void;
}

function TruncationBanner({ shownBytes, totalBytes, onShowFull, onDownload }: TruncationBannerProps) {
  return (
    <div className="flex items-center gap-2 border-b border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-[11px] text-amber-700 dark:text-amber-300">
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
      <span>
        Showing first {formatBytes(shownBytes)} of {formatBytes(totalBytes)}. Render truncated to keep the UI snappy.
      </span>
      <div className="ml-auto flex items-center gap-1">
        <Button variant="ghost" size="sm" className="h-6 px-2 text-[11px]" onClick={onShowFull}>
          <Eye className="mr-1 h-3 w-3" />
          Show full
        </Button>
        <Button variant="ghost" size="sm" className="h-6 px-2 text-[11px]" onClick={onDownload}>
          <Download className="mr-1 h-3 w-3" />
          Download
        </Button>
      </div>
    </div>
  );
}

function StatusBar({ response, format }: { response: ApiResponse; format: ResponseFormat }) {
  return (
    <div className="flex items-center gap-3 border-b border-border bg-muted/30 p-3">
      <span className={cn('font-mono text-lg font-bold', getStatusClass(response.status))}>
        {response.status}
      </span>
      <span className="truncate text-muted-foreground">{response.statusText}</span>
      <div className="ml-auto flex shrink-0 items-center gap-4 text-sm text-muted-foreground">
        <span className="hidden items-center gap-1.5 sm:flex">
          <Clock className="h-4 w-4" />
          {formatTime(response.time)}
        </span>
        <span className="hidden items-center gap-1.5 sm:flex">
          <Database className="h-4 w-4" />
          {formatBytes(response.size)}
        </span>
        <span className="rounded-sm bg-background px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {FORMAT_LABEL[format]}
        </span>
      </div>
    </div>
  );
}
