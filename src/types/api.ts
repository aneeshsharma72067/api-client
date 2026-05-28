export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export type AuthType = 'none' | 'bearer' | 'basic' | 'apiKey';

export type BodyType = 'none' | 'json' | 'form-data' | 'x-www-form-urlencoded' | 'raw';

export interface KeyValuePair {
  id: string;
  key: string;
  value: string;
  enabled: boolean;
  description?: string;
}

export interface AuthConfig {
  type: AuthType;
  bearer?: {
    token: string;
  };
  basic?: {
    username: string;
    password: string;
  };
  apiKey?: {
    key: string;
    value: string;
    addTo: 'header' | 'query';
  };
}

export interface RequestBody {
  type: BodyType;
  raw?: string;
  formData?: KeyValuePair[];
  urlencoded?: KeyValuePair[];
}

export interface ApiRequest {
  id: string;
  name: string;
  method: HttpMethod;
  url: string;
  headers: KeyValuePair[];
  params: KeyValuePair[];
  body: RequestBody;
  auth: AuthConfig;
  preRequestScript?: string;
  testScript?: string;
  retry?: RetryConfig;
  createdAt: number;
  updatedAt: number;
}

export interface ApiResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  time: number;
  size: number;
  cookies?: Record<string, string>;
  /** Per-attempt timing/status when the request was retried. */
  attempts?: ResponseAttempt[];
  /** Which transport serviced the call (tauri | vite-proxy | fetch). */
  transport?: 'tauri' | 'vite-proxy' | 'fetch';
}

export interface ResponseAttempt {
  index: number;
  status: number;
  time: number;
  /** Backoff delay before this attempt was made, in ms. */
  delay: number;
  ok: boolean;
  error?: string;
}

export interface RetryConfig {
  enabled: boolean;
  /** Max number of attempts including the first. */
  maxAttempts: number;
  /** Initial backoff in ms; doubled per retry. */
  baseDelayMs: number;
  /** Retry on these statuses (besides network errors). */
  retryStatuses: number[];
}

export interface Collection {
  id: string;
  name: string;
  requests: string[];
  folders: string[];
  createdAt: number;
  updatedAt: number;
}

export interface Folder {
  id: string;
  name: string;
  parentId: string | null;
  collectionId: string;
  requests: string[];
  folders: string[];
}

export interface HistoryItem {
  id: string;
  request: ApiRequest;
  response: ApiResponse | null;
  timestamp: number;
}

export interface Environment {
  id: string;
  name: string;
  variables: KeyValuePair[];
  isActive: boolean;
}

export interface GlobalVariables {
  variables: KeyValuePair[];
}

export interface WebSocketMessage {
  id: string;
  type: 'sent' | 'received';
  data: string;
  timestamp: number;
}

export interface WebSocketConnection {
  id: string;
  url: string;
  status: 'connecting' | 'connected' | 'disconnected' | 'error';
  messages: WebSocketMessage[];
  createdAt: number;
}

export interface ScriptResult {
  logs: string[];
  errors: string[];
  testResults?: TestResult[];
}

export interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}
