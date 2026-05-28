import type { ApiRequest, AuthConfig, HttpMethod, KeyValuePair, RequestBody } from '@/types/api';
import { generateId } from '@/lib/storage';
import { emptyResult, type ImportedFolder, type ImportResult } from './types';

type AnyObj = Record<string, unknown>;

const METHOD_KEYS = ['get', 'post', 'put', 'patch', 'delete'] as const;

function isObj(v: unknown): v is AnyObj {
  return typeof v === 'object' && v !== null;
}

function resolveBaseUrl(doc: AnyObj): { base: string; warnings: string[] } {
  const warnings: string[] = [];
  // OpenAPI 3.x
  const servers = doc.servers;
  if (Array.isArray(servers) && servers.length > 0) {
    const first = servers[0];
    if (isObj(first) && typeof first.url === 'string') {
      let url = first.url;
      const vars = isObj(first.variables) ? (first.variables as AnyObj) : undefined;
      if (vars) {
        url = url.replace(/\{(\w+)\}/g, (_, name) => {
          const v = vars[name];
          if (isObj(v) && typeof v.default === 'string') return v.default;
          return `{${name}}`;
        });
      }
      return { base: url.replace(/\/+$/, ''), warnings };
    }
  }
  // Swagger 2.0
  if (typeof doc.host === 'string') {
    const schemes = Array.isArray(doc.schemes) && doc.schemes.length > 0 ? doc.schemes[0] : 'https';
    const basePath = typeof doc.basePath === 'string' ? doc.basePath : '';
    return { base: `${schemes}://${doc.host}${basePath}`.replace(/\/+$/, ''), warnings };
  }
  warnings.push('No server URL found; requests will use relative paths.');
  return { base: '', warnings };
}

function authFromSecuritySchemes(doc: AnyObj): AuthConfig {
  // OpenAPI 3.x lives at components.securitySchemes; Swagger 2.0 at securityDefinitions.
  const components = isObj(doc.components) ? (doc.components as AnyObj) : undefined;
  const schemes =
    (isObj(components?.securitySchemes) ? (components!.securitySchemes as AnyObj) : undefined) ??
    (isObj(doc.securityDefinitions) ? (doc.securityDefinitions as AnyObj) : undefined);
  if (!schemes) return { type: 'none' };
  const first = Object.values(schemes).find(isObj) as AnyObj | undefined;
  if (!first) return { type: 'none' };
  const type = typeof first.type === 'string' ? first.type.toLowerCase() : '';
  if (type === 'http') {
    const scheme = typeof first.scheme === 'string' ? first.scheme.toLowerCase() : '';
    if (scheme === 'bearer') return { type: 'bearer', bearer: { token: '' } };
    if (scheme === 'basic') return { type: 'basic', basic: { username: '', password: '' } };
  }
  if (type === 'apikey' || type === 'apiKey') {
    const name = typeof first.name === 'string' ? first.name : 'X-API-Key';
    const place = typeof first.in === 'string' && first.in === 'query' ? 'query' : 'header';
    return { type: 'apiKey', apiKey: { key: name, value: '', addTo: place } };
  }
  // Swagger 2.0 basic
  if (type === 'basic') return { type: 'basic', basic: { username: '', password: '' } };
  return { type: 'none' };
}

interface SchemaContext {
  components: AnyObj | undefined;
  swaggerDefs: AnyObj | undefined;
  seen: Set<string>;
}

function resolveRef(ref: string, ctx: SchemaContext): AnyObj | undefined {
  // Support local refs only: #/components/schemas/Foo or #/definitions/Foo
  if (!ref.startsWith('#/')) return undefined;
  const parts = ref.slice(2).split('/');
  let cur: unknown = { components: ctx.components, definitions: ctx.swaggerDefs };
  for (const p of parts) {
    if (!isObj(cur)) return undefined;
    cur = (cur as AnyObj)[p];
  }
  return isObj(cur) ? cur : undefined;
}

function schemaToExample(schema: AnyObj | undefined, ctx: SchemaContext): unknown {
  if (!schema) return undefined;
  if (typeof schema.example !== 'undefined') return schema.example;
  if (typeof schema.default !== 'undefined') return schema.default;
  if (typeof schema.$ref === 'string') {
    if (ctx.seen.has(schema.$ref)) return null;
    ctx.seen.add(schema.$ref);
    const resolved = resolveRef(schema.$ref, ctx);
    const out = schemaToExample(resolved, ctx);
    ctx.seen.delete(schema.$ref);
    return out;
  }
  const type = typeof schema.type === 'string' ? schema.type : undefined;
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[0];
  if (type === 'object' || isObj(schema.properties)) {
    const props = isObj(schema.properties) ? (schema.properties as AnyObj) : {};
    const out: AnyObj = {};
    for (const [name, prop] of Object.entries(props)) {
      out[name] = schemaToExample(isObj(prop) ? prop : undefined, ctx);
    }
    return out;
  }
  if (type === 'array') {
    const item = isObj(schema.items) ? (schema.items as AnyObj) : undefined;
    return [schemaToExample(item, ctx)];
  }
  if (type === 'integer' || type === 'number') return 0;
  if (type === 'boolean') return false;
  return '';
}

function buildRequestBody(op: AnyObj, ctx: SchemaContext): { body: RequestBody; contentType?: string } {
  // OpenAPI 3 requestBody
  const rb = isObj(op.requestBody) ? (op.requestBody as AnyObj) : undefined;
  if (rb && isObj(rb.content)) {
    const content = rb.content as AnyObj;
    const jsonEntry = Object.entries(content).find(([ct]) => ct.includes('json'));
    if (jsonEntry) {
      const media = isObj(jsonEntry[1]) ? (jsonEntry[1] as AnyObj) : undefined;
      const schema = isObj(media?.schema) ? (media!.schema as AnyObj) : undefined;
      const example = schemaToExample(schema, ctx);
      return {
        body: { type: 'json', raw: example === undefined ? '' : JSON.stringify(example, null, 2) },
        contentType: jsonEntry[0],
      };
    }
    const formEntry = Object.entries(content).find(([ct]) => ct.includes('x-www-form-urlencoded'));
    if (formEntry) {
      return { body: { type: 'x-www-form-urlencoded', urlencoded: [] }, contentType: formEntry[0] };
    }
    const multipart = Object.entries(content).find(([ct]) => ct.includes('multipart/form-data'));
    if (multipart) {
      return { body: { type: 'form-data', formData: [] }, contentType: multipart[0] };
    }
  }
  // Swagger 2.0 body parameter
  const params = Array.isArray(op.parameters) ? (op.parameters as unknown[]) : [];
  const bodyParam = params.find((p) => isObj(p) && (p as AnyObj).in === 'body');
  if (isObj(bodyParam)) {
    const schema = isObj((bodyParam as AnyObj).schema) ? ((bodyParam as AnyObj).schema as AnyObj) : undefined;
    const example = schemaToExample(schema, ctx);
    return {
      body: { type: 'json', raw: example === undefined ? '' : JSON.stringify(example, null, 2) },
      contentType: 'application/json',
    };
  }
  return { body: { type: 'none' } };
}

function buildParamsAndHeaders(
  op: AnyObj,
  pathLevelParams: unknown[],
): { params: KeyValuePair[]; headers: KeyValuePair[]; pathParams: KeyValuePair[] } {
  const params: KeyValuePair[] = [];
  const headers: KeyValuePair[] = [];
  const pathParams: KeyValuePair[] = [];
  const all = [...pathLevelParams, ...(Array.isArray(op.parameters) ? (op.parameters as unknown[]) : [])];
  for (const p of all) {
    if (!isObj(p)) continue;
    const inPlace = typeof p.in === 'string' ? p.in : '';
    const name = typeof p.name === 'string' ? p.name : '';
    if (!name) continue;
    const example =
      (typeof p.example !== 'undefined' ? String(p.example) : undefined) ??
      (isObj(p.schema) && typeof (p.schema as AnyObj).example !== 'undefined'
        ? String((p.schema as AnyObj).example)
        : '');
    const pair: KeyValuePair = { id: generateId(), key: name, value: example, enabled: true };
    if (typeof p.description === 'string') pair.description = p.description;
    if (inPlace === 'query') params.push(pair);
    else if (inPlace === 'header') headers.push(pair);
    else if (inPlace === 'path') pathParams.push(pair);
  }
  return { params, headers, pathParams };
}

function substitutePath(template: string, pathParams: KeyValuePair[]): string {
  return template.replace(/\{(\w+)\}/g, (_, name) => {
    const found = pathParams.find((p) => p.key === name);
    return found && found.value ? found.value : `{${name}}`;
  });
}

export function parseOpenApi(doc: unknown): ImportResult {
  const result = emptyResult('openapi');
  if (!isObj(doc)) {
    result.warnings.push('Document is not an OpenAPI/Swagger object.');
    return result;
  }
  const { base, warnings: baseWarnings } = resolveBaseUrl(doc);
  result.warnings.push(...baseWarnings);

  const info = isObj(doc.info) ? (doc.info as AnyObj) : undefined;
  if (info && typeof info.title === 'string') result.suggestedCollection = info.title;

  const paths = isObj(doc.paths) ? (doc.paths as AnyObj) : {};
  const defaultAuth = authFromSecuritySchemes(doc);
  const ctx: SchemaContext = {
    components: isObj(doc.components) ? (doc.components as AnyObj) : undefined,
    swaggerDefs: isObj(doc.definitions) ? (doc.definitions as AnyObj) : undefined,
    seen: new Set(),
  };

  const folderMap = new Map<string, ApiRequest[]>();

  for (const [pathTemplate, item] of Object.entries(paths)) {
    if (!isObj(item)) continue;
    const pathLevelParams = Array.isArray((item as AnyObj).parameters) ? ((item as AnyObj).parameters as unknown[]) : [];
    for (const methodKey of METHOD_KEYS) {
      const op = (item as AnyObj)[methodKey];
      if (!isObj(op)) continue;
      const method = methodKey.toUpperCase() as HttpMethod;
      const { params, headers, pathParams } = buildParamsAndHeaders(op, pathLevelParams);
      const { body, contentType } = buildRequestBody(op, ctx);
      const finalHeaders =
        contentType && !headers.some((h) => h.key.toLowerCase() === 'content-type')
          ? [...headers, { id: generateId(), key: 'Content-Type', value: contentType, enabled: true }]
          : headers;

      const url = `${base}${substitutePath(pathTemplate, pathParams)}`;
      const name =
        (typeof op.operationId === 'string' && op.operationId) ||
        (typeof op.summary === 'string' && op.summary) ||
        `${method} ${pathTemplate}`;

      const req: ApiRequest = {
        id: generateId(),
        name,
        method,
        url,
        headers: finalHeaders,
        params,
        body,
        auth: defaultAuth,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const tags = Array.isArray(op.tags) ? (op.tags as unknown[]).filter((t): t is string => typeof t === 'string') : [];
      if (tags.length === 0) {
        result.requests.push(req);
      } else {
        const tag = tags[0];
        const list = folderMap.get(tag) ?? [];
        list.push(req);
        folderMap.set(tag, list);
      }
    }
  }

  const folders: ImportedFolder[] = [];
  for (const [name, requests] of folderMap) folders.push({ name, requests });
  result.folders = folders.sort((a, b) => a.name.localeCompare(b.name));

  return result;
}
