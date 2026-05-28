import type { ApiResponse } from '@/types/api';

/**
 * Rule-based diagnostics for failed responses. The goal is to convert raw
 * status codes / error bodies into something a human can act on: likely
 * cause, what to check, how to retry. Rules fire on the first match so order
 * matters — most specific first.
 */

export type DiagnosticLevel = 'info' | 'warning' | 'error';

export interface Diagnostic {
  id: string;
  level: DiagnosticLevel;
  title: string;
  detail: string;
  suggestions: string[];
}

interface Rule {
  id: string;
  matches: (response: ApiResponse) => boolean;
  build: (response: ApiResponse) => Diagnostic;
}

function header(response: ApiResponse, name: string): string | undefined {
  const want = name.toLowerCase();
  for (const [k, v] of Object.entries(response.headers)) {
    if (k.toLowerCase() === want) return v;
  }
  return undefined;
}

function bodyIncludes(response: ApiResponse, fragments: string[]): boolean {
  const lower = response.body.toLowerCase();
  return fragments.some((f) => lower.includes(f.toLowerCase()));
}

const RULES: Rule[] = [
  // --- Transport-level (status 0, "Error" / "CORS blocked") -------------
  {
    id: 'cors-blocked',
    matches: (r) => r.status === 0 && (r.statusText === 'CORS blocked' || /cors/i.test(r.body)),
    build: () => ({
      id: 'cors-blocked',
      level: 'error',
      title: 'Browser blocked the request (CORS)',
      detail: 'The target server did not return an Access-Control-Allow-Origin header for this origin.',
      suggestions: [
        'Toggle "Send via dev proxy" in the URL bar to route through the local Vite middleware.',
        'Run the Tauri desktop build to bypass browser CORS entirely.',
        'If you control the API, add Access-Control-Allow-Origin for http://localhost:8080.',
      ],
    }),
  },
  {
    id: 'network-error',
    matches: (r) => r.status === 0,
    build: (r) => ({
      id: 'network-error',
      level: 'error',
      title: 'Request did not reach the server',
      detail: r.statusText === 'Error' ? 'Network or DNS failure before any HTTP response.' : r.statusText,
      suggestions: [
        'Check the URL spelling, protocol, and port.',
        'Confirm your network is online and the host is reachable.',
        'If the server is local, ensure it is listening on the expected interface.',
      ],
    }),
  },
  // --- Client errors ----------------------------------------------------
  {
    id: 'auth-missing',
    matches: (r) => r.status === 401,
    build: () => ({
      id: 'auth-missing',
      level: 'warning',
      title: 'Unauthorized (401)',
      detail: 'The server rejected the request because no valid credentials were presented.',
      suggestions: [
        'Open the Auth tab and supply a Bearer token, basic credentials, or API key.',
        'If the token is set, confirm it is not expired or scoped incorrectly.',
        'Check whether the request needs a different audience or tenant.',
      ],
    }),
  },
  {
    id: 'forbidden',
    matches: (r) => r.status === 403,
    build: () => ({
      id: 'forbidden',
      level: 'warning',
      title: 'Forbidden (403)',
      detail: 'Credentials were accepted but the principal lacks permission for this resource.',
      suggestions: [
        'Verify the token belongs to a user/role with access to the resource.',
        'Check IP allow-lists, mTLS requirements, or organization restrictions.',
      ],
    }),
  },
  {
    id: 'not-found',
    matches: (r) => r.status === 404,
    build: () => ({
      id: 'not-found',
      level: 'warning',
      title: 'Not Found (404)',
      detail: 'The path resolved to no resource on the server.',
      suggestions: [
        'Double-check the URL path; trailing slashes and casing matter on many APIs.',
        'Confirm the environment (prod/staging) is correct.',
      ],
    }),
  },
  {
    id: 'method-not-allowed',
    matches: (r) => r.status === 405,
    build: (r) => ({
      id: 'method-not-allowed',
      level: 'warning',
      title: 'Method Not Allowed (405)',
      detail: 'The endpoint exists but does not accept this HTTP method.',
      suggestions: [
        `Try the methods listed in the Allow header${header(r, 'Allow') ? `: ${header(r, 'Allow')}` : ''}.`,
        'Re-check the API documentation for the correct verb.',
      ],
    }),
  },
  {
    id: 'conflict',
    matches: (r) => r.status === 409,
    build: () => ({
      id: 'conflict',
      level: 'warning',
      title: 'Conflict (409)',
      detail: 'The server refused because the resource state conflicts with the request.',
      suggestions: [
        'Fetch the latest resource state and reconcile before retrying.',
        'If using optimistic concurrency, refresh the ETag/If-Match value.',
      ],
    }),
  },
  {
    id: 'gone',
    matches: (r) => r.status === 410,
    build: () => ({
      id: 'gone',
      level: 'info',
      title: 'Gone (410)',
      detail: 'The resource was permanently removed.',
      suggestions: ['Update collection links or migrate to the replacement endpoint.'],
    }),
  },
  {
    id: 'payload-too-large',
    matches: (r) => r.status === 413,
    build: () => ({
      id: 'payload-too-large',
      level: 'warning',
      title: 'Payload Too Large (413)',
      detail: 'The request body exceeded the server limit.',
      suggestions: ['Compress or chunk the payload.', 'Check if the endpoint supports multipart uploads.'],
    }),
  },
  {
    id: 'rate-limited',
    matches: (r) => r.status === 429,
    build: (r) => {
      const retry = header(r, 'Retry-After');
      return {
        id: 'rate-limited',
        level: 'warning',
        title: 'Rate limited (429)',
        detail: retry ? `The server asked you to wait ${retry} before retrying.` : 'The server is throttling this client.',
        suggestions: [
          'Enable Retry in the URL bar with exponential backoff.',
          'Inspect any X-RateLimit-* headers in the Headers tab for quota details.',
        ],
      };
    },
  },
  {
    id: 'bad-request',
    matches: (r) => r.status === 400,
    build: () => ({
      id: 'bad-request',
      level: 'warning',
      title: 'Bad Request (400)',
      detail: 'The server rejected the payload as malformed or invalid.',
      suggestions: [
        'Inspect the response body for the offending field.',
        'Verify Content-Type matches the body format (JSON vs form-data).',
      ],
    }),
  },
  // --- Server errors ----------------------------------------------------
  {
    id: 'cloudflare-down',
    matches: (r) => r.status >= 520 && r.status <= 526,
    build: (r) => ({
      id: 'cloudflare-down',
      level: 'error',
      title: `Cloudflare edge error (${r.status})`,
      detail: 'Cloudflare reached the origin but the response was invalid, timed out, or refused.',
      suggestions: [
        'Inspect the cf-ray and cf-cache-status headers in the Headers tab.',
        'Retry — many 52x errors are transient and resolve on a second attempt.',
      ],
    }),
  },
  {
    id: 'bad-gateway',
    matches: (r) => r.status === 502 || r.status === 504,
    build: (r) => ({
      id: 'bad-gateway',
      level: 'error',
      title: r.status === 504 ? 'Gateway Timeout (504)' : 'Bad Gateway (502)',
      detail: 'An upstream proxy could not deliver a valid response in time.',
      suggestions: [
        'Retry after a short backoff — these errors are often transient.',
        'If you control the upstream, check its logs for crashes or long-running handlers.',
      ],
    }),
  },
  {
    id: 'service-unavailable',
    matches: (r) => r.status === 503,
    build: (r) => {
      const retry = header(r, 'Retry-After');
      return {
        id: 'service-unavailable',
        level: 'error',
        title: 'Service Unavailable (503)',
        detail: retry ? `Retry-After suggests waiting ${retry}.` : 'The service is overloaded or in maintenance.',
        suggestions: ['Wait and retry.', 'Check the provider status page for ongoing incidents.'],
      };
    },
  },
  {
    id: 'internal-server-error',
    matches: (r) => r.status >= 500 && r.status < 600,
    build: (r) => ({
      id: 'internal-server-error',
      level: 'error',
      title: `Server error (${r.status})`,
      detail: 'The server crashed or returned an unhandled error.',
      suggestions: [
        'If you control the server, inspect logs for the correlated request ID.',
        'Look for an X-Request-Id header in the Headers tab to share with the server team.',
      ],
    }),
  },
  // --- Body-driven hints (fall through to here) -------------------------
  {
    id: 'aws-throttle',
    matches: (r) => bodyIncludes(r, ['Throttling', 'TooManyRequestsException']),
    build: () => ({
      id: 'aws-throttle',
      level: 'warning',
      title: 'AWS throttling detected',
      detail: 'The response body matches AWS throttling exceptions.',
      suggestions: ['Enable retry with jitter.', 'Request quota increase via Service Quotas.'],
    }),
  },
  {
    id: 'gcp-quota',
    matches: (r) => bodyIncludes(r, ['quotaExceeded', 'RESOURCE_EXHAUSTED']),
    build: () => ({
      id: 'gcp-quota',
      level: 'warning',
      title: 'Google Cloud quota exhausted',
      detail: 'The response references GCP quota errors.',
      suggestions: ['Check IAM quotas in the Cloud Console.', 'Use exponential backoff.'],
    }),
  },
];

/** Evaluate rules in order; return at most one diagnostic. */
export function diagnose(response: ApiResponse): Diagnostic | null {
  for (const rule of RULES) {
    if (rule.matches(response)) {
      return rule.build(response);
    }
  }
  return null;
}
