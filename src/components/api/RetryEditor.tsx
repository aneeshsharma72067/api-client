import type { RetryConfig } from '@/types/api';
import { defaultRetryConfig } from '@/lib/http/retry';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

interface RetryEditorProps {
  value: RetryConfig | undefined;
  onChange: (next: RetryConfig) => void;
}

const PRESET_STATUSES = [408, 425, 429, 500, 502, 503, 504];

export function RetryEditor({ value, onChange }: RetryEditorProps) {
  const config = value ?? defaultRetryConfig();

  const toggleStatus = (status: number) => {
    const set = new Set(config.retryStatuses);
    if (set.has(status)) set.delete(status);
    else set.add(status);
    onChange({ ...config, retryStatuses: [...set].sort((a, b) => a - b) });
  };

  return (
    <div className="space-y-5 p-4">
      <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/20 p-3">
        <div>
          <p className="text-sm font-medium">Auto-retry</p>
          <p className="text-xs text-muted-foreground">
            Retry on network failures and configured status codes with exponential backoff.
          </p>
        </div>
        <Switch
          checked={config.enabled}
          onCheckedChange={(enabled) => onChange({ ...config, enabled })}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-xs font-medium text-muted-foreground">Max attempts</Label>
          <Input
            type="number"
            min={1}
            max={10}
            value={config.maxAttempts}
            onChange={(e) =>
              onChange({
                ...config,
                maxAttempts: Math.max(1, Math.min(10, Number(e.target.value) || 1)),
              })
            }
            disabled={!config.enabled}
            className="h-9"
          />
          <p className="text-[11px] text-muted-foreground">
            Includes the first attempt. Capped at 10.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs font-medium text-muted-foreground">Initial backoff (ms)</Label>
          <Input
            type="number"
            min={0}
            max={60_000}
            step={100}
            value={config.baseDelayMs}
            onChange={(e) =>
              onChange({
                ...config,
                baseDelayMs: Math.max(0, Math.min(60_000, Number(e.target.value) || 0)),
              })
            }
            disabled={!config.enabled}
            className="h-9"
          />
          <p className="text-[11px] text-muted-foreground">
            Doubled per retry with ±10% jitter.
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs font-medium text-muted-foreground">Retry on statuses</Label>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 text-[11px]"
            disabled={!config.enabled}
            onClick={() => onChange({ ...config, retryStatuses: [...PRESET_STATUSES] })}
          >
            Reset
          </Button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {PRESET_STATUSES.map((s) => {
            const active = config.retryStatuses.includes(s);
            return (
              <Badge
                key={s}
                variant={active ? 'default' : 'outline'}
                onClick={() => config.enabled && toggleStatus(s)}
                className={
                  config.enabled
                    ? 'cursor-pointer select-none'
                    : 'cursor-not-allowed select-none opacity-50'
                }
              >
                {s}
              </Badge>
            );
          })}
        </div>
        <p className="text-[11px] text-muted-foreground">
          Network errors always trigger a retry; status codes are only retried when listed here.
        </p>
      </div>
    </div>
  );
}
