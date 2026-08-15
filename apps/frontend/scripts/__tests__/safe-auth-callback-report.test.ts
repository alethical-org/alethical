import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { safeAuthCallbackReport } from '../safe-auth-callback-report.mjs';

const privateFields = [
  'access_token',
  'refresh_token',
  'provider_token',
  'provider_refresh_token',
  'id_token',
  'token_hash',
  'token',
  'code',
  'code_verifier',
  'state',
  'nonce',
  'otp',
  'device_code',
  'user_code',
  'session_state',
  'authorization_code',
  'oauth_state',
  'client_secret',
  'pkce_verifier',
  'sso_nonce',
] as const;

const script = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../safe-auth-callback-report.mjs',
);

describe('safe auth callback reports', () => {
  it.each(privateFields)('detects %s in the query without returning its fake value', (field) => {
    const fakeValue = `fake-${field}-value`;
    const report = safeAuthCallbackReport(
      `https://www.alethical.com/auth/callback?kept=1&${field}=${fakeValue}`,
    );
    const output = JSON.stringify(report);

    expect(report).toEqual({
      origin: 'https://www.alethical.com',
      path: '/auth/callback',
      privateQueryFieldsPresent: true,
      privateFragmentFieldsPresent: false,
    });
    expect(output).not.toContain(field);
    expect(output).not.toContain(fakeValue);
    expect(output).not.toContain('?');
    expect(output).not.toContain('#');
  });

  it.each(privateFields)('detects %s in the fragment without returning its fake value', (field) => {
    const fakeValue = `fake-${field}-value`;
    const report = safeAuthCallbackReport(
      `https://www.alethical.com/auth/callback#kept=1&${field}=${fakeValue}`,
    );
    const output = JSON.stringify(report);

    expect(report).toEqual({
      origin: 'https://www.alethical.com',
      path: '/auth/callback',
      privateQueryFieldsPresent: false,
      privateFragmentFieldsPresent: true,
    });
    expect(output).not.toContain(field);
    expect(output).not.toContain(fakeValue);
    expect(output).not.toContain('?');
    expect(output).not.toContain('#');
  });

  it('finds a private field in a fragment that starts with an ordinary anchor', () => {
    expect(
      safeAuthCallbackReport(
        'https://www.alethical.com/confirm#section?token_hash=fake-confirmation-value&type=email',
      ),
    ).toEqual({
      origin: 'https://www.alethical.com',
      path: '/confirm',
      privateQueryFieldsPresent: false,
      privateFragmentFieldsPresent: true,
    });
  });

  it('finds a percent-encoded private field name', () => {
    expect(
      safeAuthCallbackReport(
        'https://www.alethical.com/auth/callback?%61ccess%5Ftoken=fake-encoded-value',
      ).privateQueryFieldsPresent,
    ).toBe(true);
  });

  it('reports false when the address has only ordinary navigation fields', () => {
    expect(
      safeAuthCallbackReport('https://www.alethical.com/bills/HF123?tab=votes#roll-call'),
    ).toEqual({
      origin: 'https://www.alethical.com',
      path: '/bills/HF123',
      privateQueryFieldsPresent: false,
      privateFragmentFieldsPresent: false,
    });
  });

  it('reports the scheme and host as the origin for the saved phone callback', () => {
    expect(
      safeAuthCallbackReport('alethical://auth/callback#provider_token=fake-phone-value'),
    ).toEqual({
      origin: 'alethical://auth',
      path: '/callback',
      privateQueryFieldsPresent: false,
      privateFragmentFieldsPresent: true,
    });
  });

  it('fails with a generic message for an unsupported address scheme', () => {
    expect(() => safeAuthCallbackReport('javascript:access_token=fake-path-value')).toThrow(
      'Could not report the sign-in return address safely.',
    );
  });

  it('reads the callback from standard input and prints only the safe report', () => {
    const fakeValue = 'fake-cli-access-value';
    const output = execFileSync(process.execPath, [script], {
      input: `https://www.alethical.com/auth/callback#access_token=${fakeValue}`,
      encoding: 'utf8',
    });

    expect(JSON.parse(output)).toEqual({
      origin: 'https://www.alethical.com',
      path: '/auth/callback',
      privateQueryFieldsPresent: false,
      privateFragmentFieldsPresent: true,
    });
    expect(output).not.toContain(fakeValue);
    expect(output).not.toContain('access_token');
  });

  it('does not echo a malformed callback when command-line reporting fails', () => {
    const fakeValue = 'fake-malformed-access-value';
    const result = spawnSync(process.execPath, [script], {
      input: `not an address?access_token=${fakeValue}`,
      encoding: 'utf8',
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('Could not report the sign-in return address safely.\n');
    expect(result.stderr).not.toContain(fakeValue);
  });
});
