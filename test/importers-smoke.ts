import {
  parseCurl,
  importOpenApi,
  parseOpenApi,
  parsePostman,
  parseHar,
  parseImport,
  detectFormat,
  totalRequestCount,
} from '../src/lib/imports/importers';

export const sampleCurl = `curl -X POST https://api.example.com/users?team=1 \\
  -H 'Authorization: Bearer test-token' \\
  -H 'Content-Type: application/json' \\
  --data '{"name":"Ada"}'`;

export const sampleCurlMulti = `curl https://api.example.com/health
curl -u user:pass https://api.example.com/me
curl -X PUT 'https://api.example.com/users/1' -H "Content-Type: application/json" --data-raw '{"name":"Bea"}'`;

export const sampleOpenApi = {
  openapi: '3.0.0',
  info: { title: 'Demo API' },
  servers: [{ url: 'https://api.example.com' }],
  components: {
    securitySchemes: {
      bearer: { type: 'http', scheme: 'bearer' },
    },
  },
  paths: {
    '/users': {
      get: {
        operationId: 'listUsers',
        summary: 'List users',
        tags: ['users'],
        parameters: [
          { name: 'limit', in: 'query', schema: { type: 'integer', example: 25 } },
          { name: 'X-Trace', in: 'header', schema: { type: 'string' } },
        ],
      },
      post: {
        summary: 'Create user',
        tags: ['users'],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: { name: { type: 'string', example: 'Ada' } },
              },
            },
          },
        },
      },
    },
    '/users/{id}': {
      get: {
        operationId: 'getUser',
        tags: ['users'],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', example: '42' } }],
      },
    },
  },
};

export const samplePostman = {
  info: { name: 'Demo Collection', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
  item: [
    {
      name: 'Health',
      request: { method: 'GET', url: { raw: 'https://api.example.com/health' } },
    },
    {
      name: 'Users',
      item: [
        {
          name: 'List users',
          request: {
            method: 'GET',
            url: { raw: 'https://api.example.com/users?team=1', query: [{ key: 'team', value: '1' }] },
            header: [{ key: 'Accept', value: 'application/json' }],
          },
        },
        {
          name: 'Create user',
          request: {
            method: 'POST',
            url: { raw: 'https://api.example.com/users' },
            body: { mode: 'raw', raw: '{"name":"Ada"}', options: { raw: { language: 'json' } } },
            auth: { type: 'bearer', bearer: [{ key: 'token', value: 'secret' }] },
          },
        },
      ],
    },
  ],
};

export const sampleHar = {
  log: {
    entries: [
      { request: { method: 'GET', url: 'https://api.example.com/health', headers: [], queryString: [] } },
      {
        request: {
          method: 'POST',
          url: 'https://api.example.com/users?team=1',
          headers: [{ name: 'Content-Type', value: 'application/json' }],
          queryString: [{ name: 'team', value: '1' }],
          postData: { mimeType: 'application/json', text: '{"name":"Ada"}' },
        },
      },
      // duplicate of the first — should be deduped
      { request: { method: 'GET', url: 'https://api.example.com/health', headers: [], queryString: [] } },
    ],
  },
};

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

export function runImportSmokeTest() {
  // --- curl, single ---
  const curlRequests = parseCurl(sampleCurl);
  assert(curlRequests.length === 1, `Expected 1 curl request, got ${curlRequests.length}`);
  const curl = curlRequests[0];
  assert(curl.method === 'POST', `Expected POST, got ${curl.method}`);
  assert(curl.url === 'https://api.example.com/users', `Unexpected curl URL: ${curl.url}`);
  assert(curl.params.length === 1 && curl.params[0].key === 'team', 'Expected team query param extracted');
  assert(curl.auth.type === 'bearer' && curl.auth.bearer?.token === 'test-token', 'Expected bearer auth from header');
  // Authorization header stripped, Content-Type kept
  assert(
    !curl.headers.some((h) => h.key.toLowerCase() === 'authorization'),
    'Authorization header should be promoted to auth and removed',
  );
  assert(curl.body.type === 'json' && curl.body.raw === '{"name":"Ada"}', `Unexpected curl body: ${JSON.stringify(curl.body)}`);

  // --- curl, multi-command + basic auth ---
  const multi = parseCurl(sampleCurlMulti);
  assert(multi.length === 3, `Expected 3 curl requests, got ${multi.length}`);
  assert(multi[1].auth.type === 'basic' && multi[1].auth.basic?.username === 'user', 'Expected basic auth from -u');
  assert(multi[2].method === 'PUT', `Expected PUT, got ${multi[2].method}`);

  // --- OpenAPI ---
  const openApiResult = parseOpenApi(sampleOpenApi);
  assert(openApiResult.suggestedCollection === 'Demo API', 'OpenAPI title should be suggested collection');
  // 3 ops total, all under "users" tag → all in folders
  assert(openApiResult.folders.length === 1, `Expected 1 folder, got ${openApiResult.folders.length}`);
  assert(openApiResult.folders[0].requests.length === 3, 'Expected 3 ops in users folder');
  const list = openApiResult.folders[0].requests.find((r) => r.name === 'listUsers');
  assert(list && list.params.length >= 1 && list.params[0].key === 'limit', 'Expected limit query param');
  const create = openApiResult.folders[0].requests.find((r) => r.method === 'POST');
  assert(create && create.body.type === 'json' && create.body.raw?.includes('Ada'), 'Expected JSON body example');
  assert(create && create.auth.type === 'bearer', 'Expected bearer auth from securitySchemes');
  const getOne = openApiResult.folders[0].requests.find((r) => r.name === 'getUser');
  assert(getOne && getOne.url === 'https://api.example.com/users/42', `Path param substitution failed: ${getOne?.url}`);

  // Back-compat shim still works
  const flat = importOpenApi(sampleOpenApi);
  assert(flat.length === 3, `Back-compat importOpenApi returned ${flat.length}`);

  // --- Postman ---
  const postman = parsePostman(samplePostman);
  assert(postman.suggestedCollection === 'Demo Collection', 'Postman collection name should be suggested');
  assert(postman.requests.length === 1 && postman.requests[0].name === 'Health', 'Expected one top-level request');
  assert(postman.folders.length === 1 && postman.folders[0].name === 'Users', 'Expected Users folder');
  const createUser = postman.folders[0].requests.find((r) => r.method === 'POST');
  assert(createUser && createUser.body.type === 'json', 'Expected JSON body from Postman');
  assert(createUser && createUser.auth.type === 'bearer' && createUser.auth.bearer?.token === 'secret', 'Expected bearer auth');

  // --- HAR ---
  const har = parseHar(sampleHar);
  assert(har.requests.length === 2, `Expected 2 dedup'd HAR requests, got ${har.requests.length}`);
  const post = har.requests.find((r) => r.method === 'POST');
  assert(post && post.params.length === 1 && post.params[0].key === 'team', 'Expected query param from HAR');
  assert(post && post.body.type === 'json', 'Expected JSON body from HAR');

  // --- detect + parseImport ---
  assert(detectFormat(sampleCurl) === 'curl', 'detectFormat: curl');
  assert(detectFormat(JSON.stringify(sampleOpenApi)) === 'openapi', 'detectFormat: openapi');
  assert(detectFormat(JSON.stringify(samplePostman)) === 'postman', 'detectFormat: postman');
  assert(detectFormat(JSON.stringify(sampleHar)) === 'har', 'detectFormat: har');

  const autoCurl = parseImport(sampleCurl);
  assert(autoCurl.format === 'curl' && totalRequestCount(autoCurl) === 1, 'auto-parse curl');

  return {
    curlRequests,
    multi,
    openApiResult,
    postmanResult: postman,
    harResult: har,
  };
}

export default runImportSmokeTest;
