import { useMemo, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { tokenizeJson, type JsonToken } from '@/lib/response/format';
import { cn } from '@/lib/utils';

/**
 * Virtualized line-renderer for large response bodies. Only the visible
 * window is mounted in the DOM, keeping React responsive on 50MB+ payloads.
 *
 * The text is split into lines once; each row renders either plain text or
 * pre-tokenized JSON spans.
 */
interface VirtualBodyProps {
  text: string;
  format: 'json' | 'text';
  wrap: boolean;
}

const LINE_HEIGHT_PX = 18;

export function VirtualBody({ text, format, wrap }: VirtualBodyProps) {
  const parentRef = useRef<HTMLDivElement>(null);

  const lines = useMemo(() => text.split('\n'), [text]);
  const lineTokens = useMemo(
    () =>
      format === 'json'
        ? lines.map((line) => tokenizeJson(line))
        : null,
    [lines, format],
  );

  const virtualizer = useVirtualizer({
    count: lines.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => LINE_HEIGHT_PX,
    overscan: 24,
  });

  return (
    <div
      ref={parentRef}
      className="h-full w-full overflow-auto font-mono text-xs leading-[18px]"
    >
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          minWidth: wrap ? undefined : 'max-content',
          position: 'relative',
        }}
      >
        {virtualizer.getVirtualItems().map((row) => {
          const idx = row.index;
          const line = lines[idx];
          const tokens = lineTokens?.[idx];
          return (
            <div
              key={row.key}
              className={cn('flex pr-4', wrap ? 'whitespace-pre-wrap break-words' : 'whitespace-pre')}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${row.start}px)`,
                height: `${row.size}px`,
              }}
            >
              <span className="select-none px-3 text-right text-muted-foreground/60" style={{ minWidth: 48 }}>
                {idx + 1}
              </span>
              <span className="flex-1">
                {tokens ? tokens.map((t, i) => <JsonTokenSpan key={i} token={t} />) : line}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function JsonTokenSpan({ token }: { token: JsonToken }) {
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
      return <>{token.text}</>;
  }
}
