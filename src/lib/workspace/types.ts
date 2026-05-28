export type WorkspaceStatus =
  | 'idle'
  | 'unsupported'
  | 'prompt'
  | 'denied'
  | 'permission-lost'
  | 'bound';

export type IdIndex = Record<string, string>;

export interface WorkspaceFileMeta {
  path: string;
  mtime: number;
  size: number;
}

export type WorkspaceErrorKind =
  | 'PermissionDenied'
  | 'NotFound'
  | 'ParseError'
  | 'WriteFailed'
  | 'BrowserUnsupported';

export class WorkspaceError extends Error {
  kind: WorkspaceErrorKind;
  path?: string;
  cause?: unknown;
  constructor(kind: WorkspaceErrorKind, message: string, opts?: { path?: string; cause?: unknown }) {
    super(message);
    this.kind = kind;
    this.path = opts?.path;
    this.cause = opts?.cause;
  }
}
