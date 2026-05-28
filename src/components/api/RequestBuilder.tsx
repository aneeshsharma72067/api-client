import { ApiRequest } from '@/types/api';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { UrlBar } from './UrlBar';
import { KeyValueEditor } from './KeyValueEditor';
import { AuthEditor } from './AuthEditor';
import { BodyEditor } from './BodyEditor';
import { ScriptEditor } from './ScriptEditor';
import { RetryEditor } from './RetryEditor';

interface RequestBuilderProps {
  request: ApiRequest;
  isLoading: boolean;
  onUpdate: (request: ApiRequest) => void;
  onSend: () => void;
}

export function RequestBuilder({ request, isLoading, onUpdate, onSend }: RequestBuilderProps) {
  return (
    <div className="flex flex-col h-full bg-card">
      <UrlBar
        method={request.method}
        url={request.url}
        isLoading={isLoading}
        onMethodChange={(method) => onUpdate({ ...request, method })}
        onUrlChange={(url) => onUpdate({ ...request, url })}
        onSend={onSend}
      />

      <Tabs defaultValue="params" className="flex-1 flex flex-col">
        <TabsList className="w-full justify-start rounded-none border-b border-border bg-transparent px-3 h-10">
          <TabsTrigger value="params" className="data-[state=active]:bg-muted rounded-b-none">
            Params {request.params.filter(p => p.enabled && p.key).length > 0 && 
              <span className="ml-1.5 text-xs bg-primary/20 text-primary px-1.5 rounded">{request.params.filter(p => p.enabled && p.key).length}</span>}
          </TabsTrigger>
          <TabsTrigger value="headers" className="data-[state=active]:bg-muted rounded-b-none">
            Headers {request.headers.filter(h => h.enabled && h.key).length > 0 && 
              <span className="ml-1.5 text-xs bg-primary/20 text-primary px-1.5 rounded">{request.headers.filter(h => h.enabled && h.key).length}</span>}
          </TabsTrigger>
          <TabsTrigger value="body" className="data-[state=active]:bg-muted rounded-b-none">
            Body
          </TabsTrigger>
          <TabsTrigger value="auth" className="data-[state=active]:bg-muted rounded-b-none">
            Auth
          </TabsTrigger>
          <TabsTrigger value="pre-request" className="data-[state=active]:bg-muted rounded-b-none">
            Pre-request
          </TabsTrigger>
          <TabsTrigger value="tests" className="data-[state=active]:bg-muted rounded-b-none">
            Tests
          </TabsTrigger>
          <TabsTrigger value="retry" className="data-[state=active]:bg-muted rounded-b-none">
            Retry
            {request.retry?.enabled && (
              <span className="ml-1.5 text-xs bg-primary/20 text-primary px-1.5 rounded">on</span>
            )}
          </TabsTrigger>
        </TabsList>

        <div className="flex-1 overflow-auto scrollbar-thin">
          <TabsContent value="params" className="m-0 p-4">
            <KeyValueEditor
              items={request.params}
              onChange={(params) => onUpdate({ ...request, params })}
              keyPlaceholder="Parameter"
              valuePlaceholder="Value"
              showDescription
            />
          </TabsContent>
          <TabsContent value="headers" className="m-0 p-4">
            <KeyValueEditor
              items={request.headers}
              onChange={(headers) => onUpdate({ ...request, headers })}
              keyPlaceholder="Header"
              valuePlaceholder="Value"
            />
          </TabsContent>
          <TabsContent value="body" className="m-0">
            <BodyEditor body={request.body} onChange={(body) => onUpdate({ ...request, body })} />
          </TabsContent>
          <TabsContent value="auth" className="m-0">
            <AuthEditor auth={request.auth} onChange={(auth) => onUpdate({ ...request, auth })} />
          </TabsContent>
          <TabsContent value="pre-request" className="m-0">
            <ScriptEditor
              script={request.preRequestScript || ''}
              onChange={(preRequestScript) => onUpdate({ ...request, preRequestScript })}
              type="pre-request"
            />
          </TabsContent>
          <TabsContent value="tests" className="m-0">
            <ScriptEditor
              script={request.testScript || ''}
              onChange={(testScript) => onUpdate({ ...request, testScript })}
              type="test"
            />
          </TabsContent>
          <TabsContent value="retry" className="m-0">
            <RetryEditor
              value={request.retry}
              onChange={(retry) => onUpdate({ ...request, retry })}
            />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
