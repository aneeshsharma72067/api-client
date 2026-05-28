import YAML from 'yaml';
import { z } from 'zod';
import type {
  ApiRequest,
  AuthConfig,
  HttpMethod,
  KeyValuePair,
  RequestBody,
} from '@/types/api';
import { generateId } from '@/lib/storage';
import { WorkspaceError } from './types';

const methodEnum = z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
const flatMap = z.record(z.string(), z.union([z.string(), z.number(), z.boolean()]).transform(String)).optional();

const authSchema = z
  .object({
    type: z.enum(['none', 'bearer', 'basic', 'apiKey']).default('none'),
    token: z.string().optional(),
    username: z.string().optional(),
    password: z.string().optional(),
    apiKey: z
      .object({
        key: z.string(),
        value: z.string(),
        in: z.enum(['header', 'query']).default('header'),
      })
      .optional(),
  })
  .optional();

const bodySchema = z
  .object({
    type: z.enum(['none', 'json', 'form-data', 'x-www-form-urlencoded', 'raw']).default('none'),
    raw: z.string().optional(),
    formData: flatMap,
    urlencoded: flatMap,
  })
  .optional();

const RequestYamlSchema = z.object({
  name: z.string(),
  method: methodEnum,
  url: z.string(),
  headers: flatMap,
  params: flatMap,
  auth: authSchema,
  body: bodySchema,
  preRequestScript: z.string().optional(),
  testScript: z.string().optional(),
});

type RawRequestYaml = z.infer<typeof RequestYamlSchema>;

function mapToPairs(map: Record<string, string> | undefined): KeyValuePair[] {
  if (!map) return [];
  return Object.entries(map).map(([key, value]) => ({
    id: generateId(),
    key,
    value: String(value),
    enabled: true,
  }));
}

function pairsToMap(pairs: KeyValuePair[]): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const p of pairs) {
    if (!p.enabled || !p.key) continue;
    out[p.key] = p.value;
  }
  return Object.keys(out).length ? out : undefined;
}

function deserializeAuth(raw: RawRequestYaml['auth']): AuthConfig {
  if (!raw || raw.type === 'none') return { type: 'none' };
  switch (raw.type) {
    case 'bearer':
      return { type: 'bearer', bearer: { token: raw.token ?? '' } };
    case 'basic':
      return { type: 'basic', basic: { username: raw.username ?? '', password: raw.password ?? '' } };
    case 'apiKey':
      return {
        type: 'apiKey',
        apiKey: {
          key: raw.apiKey?.key ?? '',
          value: raw.apiKey?.value ?? '',
          addTo: raw.apiKey?.in ?? 'header',
        },
      };
    default:
      return { type: 'none' };
  }
}

function serializeAuth(auth: AuthConfig): RawRequestYaml['auth'] | undefined {
  if (auth.type === 'none') return undefined;
  if (auth.type === 'bearer') return { type: 'bearer', token: auth.bearer?.token ?? '' };
  if (auth.type === 'basic') {
    return { type: 'basic', username: auth.basic?.username ?? '', password: auth.basic?.password ?? '' };
  }
  return {
    type: 'apiKey',
    apiKey: {
      key: auth.apiKey?.key ?? '',
      value: auth.apiKey?.value ?? '',
      in: auth.apiKey?.addTo ?? 'header',
    },
  };
}

function deserializeBody(raw: RawRequestYaml['body']): RequestBody {
  if (!raw || raw.type === 'none') return { type: 'none' };
  const body: RequestBody = { type: raw.type };
  if (raw.raw !== undefined) body.raw = raw.raw;
  if (raw.formData) body.formData = mapToPairs(raw.formData);
  if (raw.urlencoded) body.urlencoded = mapToPairs(raw.urlencoded);
  return body;
}

function serializeBody(body: RequestBody): RawRequestYaml['body'] | undefined {
  if (body.type === 'none') return undefined;
  const out: NonNullable<RawRequestYaml['body']> = { type: body.type };
  if (body.raw !== undefined && body.raw !== '') out.raw = body.raw;
  const fd = body.formData ? pairsToMap(body.formData) : undefined;
  if (fd) out.formData = fd;
  const ue = body.urlencoded ? pairsToMap(body.urlencoded) : undefined;
  if (ue) out.urlencoded = ue;
  return out;
}

export function parseRequest(text: string, path: string, idHint?: string, mtime?: number): ApiRequest {
  let raw: unknown;
  try {
    raw = YAML.parse(text);
  } catch (err) {
    throw new WorkspaceError('ParseError', `YAML syntax error in ${path}`, { path, cause: err });
  }
  const parsed = RequestYamlSchema.safeParse(raw);
  if (!parsed.success) {
    throw new WorkspaceError('ParseError', `Schema error in ${path}: ${parsed.error.message}`, { path });
  }
  const data = parsed.data;
  const now = mtime ?? Date.now();
  return {
    id: idHint ?? generateId(),
    name: data.name,
    method: data.method as HttpMethod,
    url: data.url,
    headers: mapToPairs(data.headers),
    params: mapToPairs(data.params),
    body: deserializeBody(data.body),
    auth: deserializeAuth(data.auth),
    preRequestScript: data.preRequestScript,
    testScript: data.testScript,
    createdAt: now,
    updatedAt: now,
  };
}

export function serializeRequest(req: ApiRequest): string {
  const doc: Record<string, unknown> = {
    name: req.name,
    method: req.method,
    url: req.url,
  };
  const headers = pairsToMap(req.headers);
  if (headers) doc.headers = headers;
  const params = pairsToMap(req.params);
  if (params) doc.params = params;
  const auth = serializeAuth(req.auth);
  if (auth) doc.auth = auth;
  const body = serializeBody(req.body);
  if (body) doc.body = body;
  if (req.preRequestScript) doc.preRequestScript = req.preRequestScript;
  if (req.testScript) doc.testScript = req.testScript;
  return YAML.stringify(doc, { lineWidth: 0 });
}
