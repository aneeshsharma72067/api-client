import { useWorkspace } from '@/hooks/useWorkspace';
import { Button } from '@/components/ui/button';
import { AlertTriangle } from 'lucide-react';

export function WorkspaceBanner() {
  const ws = useWorkspace();

  if (!ws.isSupported) {
    return (
      <div className="flex items-center gap-2 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs text-amber-900 dark:text-amber-200">
        <AlertTriangle className="h-3.5 w-3.5" />
        Workspace requires Chrome or Edge. Your data is saved locally.
      </div>
    );
  }

  if (ws.status === 'permission-lost' || ws.status === 'denied') {
    return (
      <div className="flex items-center gap-2 border-b border-red-500/30 bg-red-500/10 px-4 py-2 text-xs text-red-900 dark:text-red-200">
        <AlertTriangle className="h-3.5 w-3.5" />
        Workspace permission lost.
        <Button size="sm" variant="outline" className="ml-auto h-6" onClick={() => void ws.reconnect()}>
          Reconnect
        </Button>
      </div>
    );
  }

  if (ws.status === 'prompt') {
    return (
      <div className="flex items-center gap-2 border-b border-sky-500/30 bg-sky-500/10 px-4 py-2 text-xs text-sky-900 dark:text-sky-200">
        Previously opened workspace requires permission.
        <Button size="sm" variant="outline" className="ml-auto h-6" onClick={() => void ws.reconnect()}>
          Reconnect
        </Button>
      </div>
    );
  }

  return null;
}
