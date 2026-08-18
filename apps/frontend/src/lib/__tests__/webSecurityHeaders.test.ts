import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

type Header = { key: string; value: string };
type HeaderRule = { source: string; headers: Header[] };

const root = resolve(__dirname, '../../../../..');
const config = JSON.parse(readFileSync(resolve(root, 'vercel.json'), 'utf8')) as {
  headers: HeaderRule[];
};
const globalRule = config.headers.find((rule) => rule.source === '/(.*)');
const globalHeaders = new Map(globalRule?.headers.map(({ key, value }) => [key, value]));
const policy = globalHeaders.get('Content-Security-Policy') ?? '';
const directives = new Map(
  policy.split('; ').map((directive) => {
    const [name, ...sources] = directive.split(' ');
    return [name, sources];
  }),
);
const pageShell = readFileSync(resolve(root, 'apps/frontend/public/index.html'), 'utf8');

function inlineProgram(file: string, id: string): string {
  const source = readFileSync(resolve(root, file), 'utf8');
  const match = source.match(new RegExp(`<script id=["']${id}["']>([\\s\\S]*?)<\\/script>`));
  if (!match) throw new Error(`${id} was not found in ${file}`);
  return match[1];
}

function policyHash(program: string): string {
  return `'sha256-${createHash('sha256').update(program).digest('base64')}'`;
}

describe('web security response headers', () => {
  it('protects every website response with the required browser boundaries', () => {
    expect(globalRule).toBeDefined();
    expect(Object.fromEntries(globalHeaders)).toMatchObject({
      'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=(self), payment=(), usb=()',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'X-Permitted-Cross-Domain-Policies': 'none',
      'X-XSS-Protection': '0',
    });
  });

  it('allows only the outside connections the shipped website needs', () => {
    expect(directives.get('default-src')).toEqual(["'none'"]);
    expect(directives.get('connect-src')).toEqual([
      "'self'",
      'https://api.alethical.com',
      'https://naakzorbkqqgbsreulqi.supabase.co',
      'https://cloudflareinsights.com',
    ]);
    expect(directives.get('font-src')).toEqual(["'self'", 'data:', 'https://fonts.gstatic.com']);
    expect(directives.get('frame-src')).toEqual(["'none'"]);
    expect(directives.get('img-src')).toEqual(["'self'", 'data:', 'blob:', 'https:']);
    expect(directives.get('object-src')).toEqual(["'none'"]);
    expect(directives.get('style-src')).toEqual([
      "'self'",
      "'unsafe-inline'",
      'https://fonts.googleapis.com',
    ]);
    expect(directives.get('base-uri')).toEqual(["'none'"]);
    expect(directives.get('form-action')).toEqual(["'self'"]);
    expect(directives.get('frame-ancestors')).toEqual(["'none'"]);
    expect(directives.get('upgrade-insecure-requests')).toEqual([]);
  });

  it('trusts only reviewed inline programs by their exact contents', () => {
    const programs = [
      inlineProgram('apps/frontend/public/index.html', 'alethical-release-recovery'),
      inlineProgram('api/page.ts', 'alethical-email-link-bootstrap'),
      inlineProgram('api/page.ts', 'alethical-forgot-password-bootstrap'),
    ];

    expect(directives.get('script-src')).toEqual([
      "'self'",
      'https://static.cloudflareinsights.com',
      ...programs.map(policyHash),
    ]);
    expect(directives.get('script-src-attr')).toEqual(["'none'"]);
  });

  it('loads only the public Cloudflare speed beacon configured for Alethical', () => {
    expect(pageShell).toContain('src="https://static.cloudflareinsights.com/beacon.min.js"');
    expect(pageShell).toContain(`data-cf-beacon='{"token": "2054b504329c4586a515de9083e6164e"}'`);
  });
});
