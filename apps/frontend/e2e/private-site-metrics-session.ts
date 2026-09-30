import type { Page } from '@playwright/test';

/** An invented administrator session; every answer stays inside the local browser. */
export async function installPrivateSiteMetricsSession(page: Page) {
  const id = '00000000-0000-4000-8000-000000000001';
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const session = {
    access_token: `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: id, exp: expiresAt })}.not-a-real-signature`,
    refresh_token: 'not-a-real-refresh-token',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: expiresAt,
    user: {
      id,
      aud: 'authenticated',
      role: 'authenticated',
      email: 'admin-fixture@example.invalid',
      email_confirmed_at: '2026-01-01T00:00:00Z',
      created_at: '2026-01-01T00:00:00Z',
      app_metadata: { provider: 'email', providers: ['email'] },
      user_metadata: {},
    },
  };
  await page.addInitScript(({ key, saved }) => localStorage.setItem(key, JSON.stringify(saved)), {
    key: process.env.E2E_AUTH_STORAGE_KEY ?? 'sb-localhost-auth-token',
    saved: session,
  });
  await page.route('**/api/v1/me', (route) =>
    route.request().method() === 'OPTIONS'
      ? route.fulfill({ status: 204 })
      : route.fulfill({ json: { data: { id, primary_email: session.user.email } } }),
  );
  await page.route('**/api/v1/admin/access', (route) =>
    route.request().method() === 'OPTIONS'
      ? route.fulfill({ status: 204 })
      : route.fulfill({ json: { data: { is_admin: true } } }),
  );
}
