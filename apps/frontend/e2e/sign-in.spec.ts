import { expect, test } from '@playwright/test';

test('phone sign-in keeps focus on a visible control while its screen changes', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');

  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const close = dialog.getByRole('button', { name: 'Close' });
  await expect(close).toBeFocused();

  await dialog.getByRole('button', { name: 'Create an account' }).click();
  await expect(close).toBeFocused();

  await dialog.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(close).toBeFocused();

  await dialog.getByRole('button', { name: 'Forgot password?' }).click();
  await expect(close).toBeFocused();

  await close.click();
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeFocused();
});

test('a rejected password sign-in focuses the cleared password field', async ({ page }) => {
  let passwordRequestSeen = false;
  await page.route(/\/auth\/v1\/token\?grant_type=password/, async (route) => {
    passwordRequestSeen = true;
    await route.fulfill({
      status: 400,
      contentType: 'application/json',
      headers: { 'x-supabase-api-version': '2024-01-01' },
      body: JSON.stringify({
        code: 'invalid_credentials',
        msg: 'Invalid login credentials',
      }),
    });
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: 'EMAIL' }).fill('reader@example.invalid');
  const password = dialog.getByRole('textbox', { name: 'PASSWORD' });
  await password.fill('not-a-real-password');
  await dialog.getByRole('button', { name: 'Sign in', exact: true }).click();

  await expect.poll(() => passwordRequestSeen).toBe(true);
  await expect(dialog.getByText('Email or password is incorrect.')).toBeVisible();
  await expect(password).toHaveValue('');
  await expect(password).toBeFocused();
});

test('an expired confirmation link focuses an invalid replacement email', async ({ page }) => {
  await page.goto('/confirm');
  await page.getByRole('button', { name: 'Confirm email' }).click();
  const email = page.getByRole('textbox', { name: 'EMAIL' });
  await email.fill('not-an-email');
  await page.getByRole('button', { name: 'Send a new confirmation email' }).click();

  await expect(
    page.getByText('Enter a complete email address, like name@example.com.'),
  ).toBeVisible();
  await expect(email).toBeFocused();
});
