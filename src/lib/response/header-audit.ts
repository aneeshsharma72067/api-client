/**
 * Security header audit. Pure rule evaluation — no network, no DOM. Each
 * rule produces a finding the UI can render verbatim. Headers are matched
 * case-insensitively because servers are inconsistent.
 */

export type AuditSeverity = 'good' | 'warning' | 'critical' | 'info';

export interface AuditFinding {
  id: string;
  header: string;
  severity: AuditSeverity;
  title: string;
  detail: string;
  /** Concrete value seen, if any. */
  value?: string;
}

export interface AuditReport {
  findings: AuditFinding[];
  score: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
}

function get(headers: Record<string, string>, name: string): string | undefined {
  const want = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === want) return value;
  }
  return undefined;
}

interface Rule {
  id: string;
  header: string;
  evaluate: (value: string | undefined, all: Record<string, string>) => AuditFinding | null;
}

const RULES: Rule[] = [
  {
    id: 'strict-transport-security',
    header: 'Strict-Transport-Security',
    evaluate: (value) => {
      if (!value) {
        return {
          id: 'hsts-missing',
          header: 'Strict-Transport-Security',
          severity: 'warning',
          title: 'HSTS not enforced',
          detail: 'Browsers may downgrade to HTTP. Add Strict-Transport-Security with a max-age of at least 15552000.',
        };
      }
      const maxAgeMatch = /max-age=(\d+)/i.exec(value);
      const maxAge = maxAgeMatch ? Number(maxAgeMatch[1]) : 0;
      if (maxAge < 15_552_000) {
        return {
          id: 'hsts-short',
          header: 'Strict-Transport-Security',
          severity: 'warning',
          title: 'HSTS max-age below 180 days',
          detail: `Reported max-age=${maxAge}. Recommended ≥ 15552000 (180 days).`,
          value,
        };
      }
      return {
        id: 'hsts-ok',
        header: 'Strict-Transport-Security',
        severity: 'good',
        title: 'HSTS configured',
        detail: 'max-age satisfies the 180-day recommendation.',
        value,
      };
    },
  },
  {
    id: 'content-security-policy',
    header: 'Content-Security-Policy',
    evaluate: (value) => {
      if (!value) {
        return {
          id: 'csp-missing',
          header: 'Content-Security-Policy',
          severity: 'warning',
          title: 'No CSP set',
          detail: 'Without CSP the response cannot constrain script sources. Define a Content-Security-Policy header.',
        };
      }
      if (/unsafe-inline|unsafe-eval/i.test(value)) {
        return {
          id: 'csp-unsafe',
          header: 'Content-Security-Policy',
          severity: 'warning',
          title: 'CSP allows unsafe-inline or unsafe-eval',
          detail: 'These directives undermine CSP. Prefer nonces or hashes for inline code.',
          value,
        };
      }
      return {
        id: 'csp-ok',
        header: 'Content-Security-Policy',
        severity: 'good',
        title: 'CSP present',
        detail: 'No obviously unsafe directives detected.',
        value,
      };
    },
  },
  {
    id: 'x-frame-options',
    header: 'X-Frame-Options',
    evaluate: (value, all) => {
      const csp = get(all, 'Content-Security-Policy') ?? '';
      const fa = /frame-ancestors\s+[^;]+/i.test(csp);
      if (!value && !fa) {
        return {
          id: 'xfo-missing',
          header: 'X-Frame-Options',
          severity: 'warning',
          title: 'Clickjacking protection missing',
          detail: 'Neither X-Frame-Options nor CSP frame-ancestors is set.',
        };
      }
      if (value && /allowall/i.test(value)) {
        return {
          id: 'xfo-allowall',
          header: 'X-Frame-Options',
          severity: 'warning',
          title: 'Frame embedding permitted',
          detail: 'X-Frame-Options: ALLOWALL allows arbitrary embedding.',
          value,
        };
      }
      return {
        id: 'xfo-ok',
        header: 'X-Frame-Options',
        severity: 'good',
        title: 'Clickjacking protection in place',
        detail: value ? `X-Frame-Options=${value}` : 'CSP frame-ancestors restricts embedding.',
        value,
      };
    },
  },
  {
    id: 'x-content-type-options',
    header: 'X-Content-Type-Options',
    evaluate: (value) => {
      if (!value) {
        return {
          id: 'xcto-missing',
          header: 'X-Content-Type-Options',
          severity: 'warning',
          title: 'MIME sniffing not blocked',
          detail: 'Set X-Content-Type-Options: nosniff to prevent MIME confusion attacks.',
        };
      }
      if (!/nosniff/i.test(value)) {
        return {
          id: 'xcto-bad',
          header: 'X-Content-Type-Options',
          severity: 'warning',
          title: 'X-Content-Type-Options is not "nosniff"',
          detail: `Got ${value}. Set to nosniff.`,
          value,
        };
      }
      return {
        id: 'xcto-ok',
        header: 'X-Content-Type-Options',
        severity: 'good',
        title: 'MIME sniffing blocked',
        detail: 'nosniff enforced.',
        value,
      };
    },
  },
  {
    id: 'referrer-policy',
    header: 'Referrer-Policy',
    evaluate: (value) => {
      if (!value) {
        return {
          id: 'referrer-missing',
          header: 'Referrer-Policy',
          severity: 'info',
          title: 'No referrer policy declared',
          detail: 'Consider strict-origin-when-cross-origin to limit referrer leakage.',
        };
      }
      if (/unsafe-url|no-referrer-when-downgrade/i.test(value)) {
        return {
          id: 'referrer-leaky',
          header: 'Referrer-Policy',
          severity: 'warning',
          title: 'Permissive referrer policy',
          detail: `${value} leaks the full URL on cross-origin navigation.`,
          value,
        };
      }
      return {
        id: 'referrer-ok',
        header: 'Referrer-Policy',
        severity: 'good',
        title: 'Referrer-Policy declared',
        detail: value,
        value,
      };
    },
  },
  {
    id: 'permissions-policy',
    header: 'Permissions-Policy',
    evaluate: (value) => {
      if (!value) {
        return {
          id: 'permissions-missing',
          header: 'Permissions-Policy',
          severity: 'info',
          title: 'No Permissions-Policy',
          detail: 'Consider restricting features like camera/geolocation explicitly.',
        };
      }
      return {
        id: 'permissions-ok',
        header: 'Permissions-Policy',
        severity: 'good',
        title: 'Permissions-Policy set',
        detail: value,
        value,
      };
    },
  },
  {
    id: 'access-control-allow-origin',
    header: 'Access-Control-Allow-Origin',
    evaluate: (value, all) => {
      if (!value) {
        return {
          id: 'cors-none',
          header: 'Access-Control-Allow-Origin',
          severity: 'info',
          title: 'CORS not advertised',
          detail: 'Endpoint does not declare an Access-Control-Allow-Origin header.',
        };
      }
      if (value.trim() === '*') {
        const creds = get(all, 'Access-Control-Allow-Credentials');
        if (creds && /true/i.test(creds)) {
          return {
            id: 'cors-bad',
            header: 'Access-Control-Allow-Origin',
            severity: 'critical',
            title: 'CORS wildcard with credentials',
            detail: 'Browsers ignore this combination; it also signals misconfigured ACL.',
            value,
          };
        }
        return {
          id: 'cors-wildcard',
          header: 'Access-Control-Allow-Origin',
          severity: 'warning',
          title: 'CORS open to any origin',
          detail: 'Wildcard ACAO lets any site read the response. Scope this to trusted origins.',
          value,
        };
      }
      return {
        id: 'cors-ok',
        header: 'Access-Control-Allow-Origin',
        severity: 'good',
        title: 'CORS restricted',
        detail: value,
        value,
      };
    },
  },
];

function scoreOf(severity: AuditSeverity): number {
  switch (severity) {
    case 'good':
      return 100;
    case 'info':
      return 70;
    case 'warning':
      return 40;
    case 'critical':
      return 0;
  }
}

function gradeOf(score: number): AuditReport['grade'] {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 65) return 'C';
  if (score >= 45) return 'D';
  return 'F';
}

export function auditHeaders(headers: Record<string, string>): AuditReport {
  const findings: AuditFinding[] = [];
  for (const rule of RULES) {
    const value = get(headers, rule.header);
    const f = rule.evaluate(value, headers);
    if (f) findings.push(f);
  }
  const total = findings.reduce((sum, f) => sum + scoreOf(f.severity), 0);
  const score = findings.length === 0 ? 0 : Math.round(total / findings.length);
  return { findings, score, grade: gradeOf(score) };
}
