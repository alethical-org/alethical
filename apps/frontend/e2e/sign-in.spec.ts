import { expect, test } from '@playwright/test';

test('phone sign-in keeps focus visible while its panel opens and closes', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');

  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const close = dialog.getByRole('button', { name: 'Close' });
  await expect(close).toBeFocused();
  await expect(dialog.getByRole('button', { name: 'Continue with Google' })).toBeVisible();

  await close.click();
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeFocused();
});

test('signed-out sign-in shows Google and the account terms', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
  await expect(dialog.getByRole('link', { name: 'Terms of Use' })).toHaveAttribute(
    'href',
    '/terms',
  );
  await expect(dialog.getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute(
    'href',
    '/privacy',
  );
});

test('an expired confirmation link opens Create and focuses an invalid email', async ({ page }) => {
  await page.goto('/confirm');
  await page.getByRole('button', { name: 'Confirm email' }).click();
  await page.getByRole('button', { name: 'Go to Create account' }).click();
  const dialog = page.getByRole('dialog');
  await expect(
    dialog.getByRole('heading', { name: 'Create your Alethical account' }),
  ).toBeVisible();
  const email = dialog.getByRole('textbox', { name: 'EMAIL' });
  await email.fill('not-an-email');
  await dialog.getByRole('button', { name: 'Continue', exact: true }).click();

  await expect(
    page.getByText('Enter a complete email address, like name@example.com'),
  ).toBeVisible();
  await expect(email).toBeFocused();
});
