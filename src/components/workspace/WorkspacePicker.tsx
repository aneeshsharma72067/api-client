import { Button } from '@/components/ui/button';
import { useWorkspace } from '@/hooks/useWorkspace';
import { FolderOpen, FolderSync, Link2Off } from 'lucide-react';

export function WorkspacePicker() {
  const ws = useWorkspace();
  if (!ws.isSupported) return null;

  if (ws.status === 'prompt' || ws.status === 'permission-lost' || ws.status === 'denied') {
    return (
      <Button variant="outline" size="sm" onClick={() => void ws.reconnect()} title="Reconnect workspace">
        <Link2Off className="h-4 w-4 mr-2" />
        Reconnect
      </Button>
    );
  }

  if (ws.status === 'bound') {
    return (
      <Button variant="ghost" size="sm" onClick={() => void ws.close()} title="Close workspace">
        <FolderSync className="h-4 w-4 mr-2" />
        {ws.rootName}
      </Button>
    );
  }

  return (
    <Button variant="outline" size="sm" onClick={() => void ws.open()} title="Open a workspace folder">
      <FolderOpen className="h-4 w-4 mr-2" />
      Open Folder
    </Button>
  );
}
