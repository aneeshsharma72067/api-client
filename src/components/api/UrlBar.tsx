import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { MethodSelector } from './MethodSelector';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Send, Loader2, Network } from 'lucide-react';
import { HttpMethod } from '@/types/api';
import {
  getUseDevProxy,
  setUseDevProxy,
  isDevProxyAvailable,
  isTauri,
} from '@/lib/http/runtime';
import { cn } from '@/lib/utils';

interface UrlBarProps {
  method: HttpMethod;
  url: string;
  isLoading: boolean;
  onMethodChange: (method: HttpMethod) => void;
  onUrlChange: (url: string) => void;
  onSend: () => void;
}

export function UrlBar({
  method,
  url,
  isLoading,
  onMethodChange,
  onUrlChange,
  onSend,
}: UrlBarProps) {
  const proxyAvailable = isDevProxyAvailable();
  const tauri = isTauri();
  const [useProxy, setUseProxy] = useState<boolean>(() => getUseDevProxy());

  // Keep the toggle reactive across hot reloads / multi-tab edits.
  useEffect(() => {
    setUseDevProxy(useProxy);
  }, [useProxy]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      onSend();
    }
  };

  return (
    <div className="flex items-center gap-2 p-3 bg-card border-b border-border">
      <MethodSelector value={method} onChange={onMethodChange} />
      <Input
        type="text"
        placeholder="Enter request URL or paste cURL"
        value={url}
        onChange={(e) => onUrlChange(e.target.value)}
        onKeyDown={handleKeyDown}
        className="flex-1 font-mono text-sm bg-background"
      />
      <TransportIndicator
        tauri={tauri}
        proxyAvailable={proxyAvailable}
        useProxy={useProxy}
        onToggleProxy={setUseProxy}
      />
      <Button
        onClick={onSend}
        disabled={isLoading || !url.trim()}
        className="gap-2 px-6"
      >
        {isLoading ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Sending
          </>
        ) : (
          <>
            <Send className="h-4 w-4" />
            Send
          </>
        )}
      </Button>
    </div>
  );
}

interface TransportIndicatorProps {
  tauri: boolean;
  proxyAvailable: boolean;
  useProxy: boolean;
  onToggleProxy: (value: boolean) => void;
}

function TransportIndicator({
  tauri,
  proxyAvailable,
  useProxy,
  onToggleProxy,
}: TransportIndicatorProps) {
  // Tauri overrides everything: native HTTP, no CORS, no toggle needed.
  if (tauri) {
    return (
      <TooltipProvider delayDuration={150}>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="hidden items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-emerald-500 sm:inline-flex">
              <Network className="h-3 w-3" />
              native
            </span>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">
            Requests run through the Tauri Rust client. No CORS limits.
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  // Pure-browser production build: nothing to toggle, just inform.
  if (!proxyAvailable) {
    return (
      <TooltipProvider delayDuration={150}>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="hidden items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground sm:inline-flex">
              <Network className="h-3 w-3" />
              browser
            </span>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-xs text-xs">
            Direct browser fetch. Cross-origin requests without CORS headers will be blocked —
            run <code className="font-mono">npm run dev</code> or the Tauri build to enable the proxy.
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn(
            'h-9 gap-1.5 px-2 text-[11px] font-medium uppercase tracking-wide',
            useProxy ? 'text-primary' : 'text-muted-foreground',
          )}
          title="Transport settings"
        >
          <Network className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">{useProxy ? 'proxy' : 'direct'}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-3">
        <div className="space-y-3">
          <div>
            <p className="text-sm font-medium">Send via dev proxy</p>
            <p className="text-xs text-muted-foreground">
              Routes requests through the Vite middleware so browser CORS doesn't block them.
              Dev only — production builds need the Tauri shell.
            </p>
          </div>
          <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-muted/30 px-2.5 py-2">
            <label htmlFor="dev-proxy-toggle" className="text-xs font-medium">
              Use dev proxy
            </label>
            <Switch
              id="dev-proxy-toggle"
              checked={useProxy}
              onCheckedChange={onToggleProxy}
            />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
