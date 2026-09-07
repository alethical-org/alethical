import { describe, expect, it } from 'vitest';
import { adminAccessFromPayload, currentAdminAccess } from '../adminAccess';
import { adminAccountDate, adminSignInMethods, adminUsersFromPayload } from '../adminUsers';

function payload() {
  return {
    data: [
      {
        id: 'example-user',
        email: null,
        created_at: '2026-09-07T04:00:00Z',
        confirmed_at: null,
        sign_in_methods: ['email'],
      },
    ],
    summary: {
      confirmed_accounts: 0,
      pending_accounts: 1,
      confirmed_today: 0,
      confirmed_7d: 0,
      confirmed_30d: 0,
    },
    page: { offset: 0, limit: 25, total: 1, has_more: false },
    as_of: '2026-09-07T12:00:00Z',
  };
}

describe('private account response', () => {
  it('preserves genuine zero counts, pending confirmation and an unavailable email', () => {
    expect(adminUsersFromPayload(payload())).toEqual(payload());
  });
  it('rejects partial replies instead of inventing zero counts', () => {
    expect(() => adminUsersFromPayload({ ...payload(), summary: {} })).toThrow();
    expect(() => adminUsersFromPayload({ ...payload(), data: undefined })).toThrow();
    expect(() => adminUsersFromPayload({ ...payload(), as_of: 'bad date' })).toThrow();
    expect(() =>
      adminUsersFromPayload({
        ...payload(),
        summary: { ...payload().summary, confirmed_accounts: -1 },
      }),
    ).toThrow();
  });
  it('requires an explicit boolean permission from the server', () => {
    expect(adminAccessFromPayload({ data: { is_admin: true } })).toBe(true);
    expect(adminAccessFromPayload({ data: { is_admin: false } })).toBe(false);
    expect(() => adminAccessFromPayload({ data: { is_admin: 'true' } })).toThrow();
    expect(() => adminAccessFromPayload({ data: {} })).toThrow();
  });
  it('shows only reported sign-in methods and Minnesota time', () => {
    expect(adminSignInMethods(['google', 'email'])).toBe('Google, Email');
    expect(adminSignInMethods([])).toBe('Not available');
    expect(adminAccountDate('2026-09-07T04:00:00Z')).toContain('Sep 6, 2026');
    expect(adminAccountDate('2026-09-07T04:00:00Z')).toContain('11:00 PM');
  });
});

describe('permission cannot move between accounts', () => {
  const result = {
    userId: 'administrator',
    accessToken: 'test-token-a',
    state: 'allowed' as const,
  };
  const auth = {
    isLoading: false,
    isSignedIn: true,
    userId: 'administrator',
    accessToken: 'test-token-a',
  };
  it('hides an old grant before account-change cleanup runs', () => {
    expect(currentAdminAccess(result, auth)).toBe('allowed');
    expect(currentAdminAccess(result, { ...auth, userId: 'reader' })).toBe('loading');
    expect(currentAdminAccess(result, { ...auth, accessToken: 'test-token-b' })).toBe('loading');
    expect(currentAdminAccess(result, { ...auth, isSignedIn: false })).toBe('signed-out');
    expect(currentAdminAccess(result, { ...auth, isLoading: true })).toBe('loading');
    expect(currentAdminAccess(null, auth)).toBe('loading');
  });
});
