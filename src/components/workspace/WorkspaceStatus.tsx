import { useWorkspace } from '@/hooks/useWorkspace';
import { cn } from '@/lib/utils';

export function WorkspaceStatus() {
  const ws = useWorkspace();
  if (!ws.isSupported) return null;
  if (ws.status === 'idle') return null;

  const color =
    ws.status === 'bound'
      ? 'bg-emerald-500'
      : ws.status === 'prompt'
        ? 'bg-sky-500'
        : 'bg-red-500';

  return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground" title={`Workspace: ${ws.status}`}>
      <span className={cn('inline-block h-2 w-2 rounded-full', color)} />
      <span className="truncate max-w-[140px]">{ws.rootName ?? ws.status}</span>
    </div>
  );
}
