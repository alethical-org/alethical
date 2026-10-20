import { expect, test } from '@playwright/test';

const path = '/blog/events/forward-debate-2026';
const canonical = `https://www.alethical.com${path}`;

test.beforeEach(async ({ context, baseURL }) => {
  const base = new URL(baseURL!);
  if (!['localhost', '127.0.0.1'].includes(base.hostname))
    throw new Error('Share checks require a loopback build');
  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (!['GET', 'HEAD'].includes(request.method())) return route.abort();
    if (url.origin === base.origin && !/^\/(?:api|auth|_vercel)\//.test(url.pathname))
      return route.continue();
    // Keep media and account activity out of this control test.
    return route.abort();
  });
});

for (const [width, height] of [
  [1440, 960],
  [1280, 800],
  [1100, 400],
  [834, 1112],
  [390, 844],
  [320, 640],
]) {
  test(`${width}: canonical sharing preserves the player and usable focus`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto(`${path}?t=1260.54#watch`);
    const trigger = page.getByRole('button', { name: 'Share this post', exact: true });
    await expect(trigger).toHaveCount(1);
    const iframe = await page.locator('#replay-player').elementHandle();
    const src = await iframe!.getAttribute('src');
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: 'Share this post', exact: true });
    const heading = dialog.getByRole('heading', { name: 'Share this post' });
    await expect(heading).toBeFocused();
    await expect(heading).toHaveCSS('outline-style', 'none');
    await expect(dialog.getByRole('textbox', { name: 'Post link' })).toHaveValue(canonical);
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab');
      expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
    }
    for (const destination of ['Email', 'WhatsApp', 'Facebook', 'LinkedIn', 'X', 'Bluesky']) {
      const control = dialog.getByRole('button', {
        name: destination === 'Email' ? 'Share by email' : `Share on ${destination}`,
        exact: true,
      });
      await control.scrollIntoViewIfNeeded();
      expect(
        await control.evaluate((node) => {
          const box = node.getBoundingClientRect();
          return node.contains(
            document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2),
          );
        }),
      ).toBe(true);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    expect(
      await iframe!.evaluate((node) => node === document.querySelector('#replay-player')),
    ).toBe(true);
    expect(await iframe!.getAttribute('src')).toBe(src);
    await expect(page.getByRole('link', { name: 'On YouTube', exact: true })).toBeVisible();
    // A scrim click closes the panel without hitting the player or invitation.
    await trigger.click();
    await page.mouse.click(5, 5);
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(page).toHaveURL(new RegExp(`${path}\\?t=1260\\.54#watch$`));
  });
}

test('copy failure selects the full address and popup failure remains recoverable', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async () => {
          throw new Error('Blocked');
        },
      },
    });
    document.execCommand = () => false;
    window.open = () => null;
  });
  await page.goto(path);
  await page.getByRole('button', { name: 'Share this post', exact: true }).click();
  await page.getByRole('button', { name: 'Copy', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toHaveText(
    'Couldn’t copy the link. Select and copy it from the link field.',
  );
  const field = page.getByRole('textbox', { name: 'Post link' });
  await expect(field).toBeFocused();
  await expect(field).toHaveCSS('outline-style', 'none');
  await expect(field.locator('..')).toHaveCSS('border-color', 'rgb(91, 48, 214)');
  await expect(field.locator('..')).toHaveCSS(
    'box-shadow',
    'rgba(91, 48, 214, 0.22) 0px 0px 0px 3px',
  );
  expect(
    await field.evaluate((node: HTMLInputElement) =>
      node.value.slice(node.selectionStart!, node.selectionEnd!),
    ),
  ).toBe(canonical);
  await page.getByRole('button', { name: 'Share on Bluesky' }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toHaveText(
    'Couldn’t open the sharing app. Copy the link instead.',
  );
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('native cancellation is silent and actual failure has a recovery message', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    let calls = 0;
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true });
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async () => {
        if (++calls === 1) throw new DOMException('Cancelled', 'AbortError');
        throw new Error('Unavailable');
      },
    });
  });
  await page.goto(path);
  await page.getByRole('button', { name: 'Share this post', exact: true }).click();
  await page.getByRole('button', { name: 'Share using another app' }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Share using another app' }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toHaveText(
    'Couldn’t open the sharing menu. Copy the link instead.',
  );
});

test('320px enlarged date and Share wrap without overflow', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto(path);
  const trigger = page.getByRole('button', { name: 'Share this post', exact: true });
  await expect(trigger).toBeVisible();
  await page.locator('.event-meta').evaluate((row) => {
    row.querySelectorAll('p,span,button,div').forEach((node) => {
      (node as HTMLElement).style.fontSize = '30px';
    });
  });
  expect((await trigger.boundingBox())!.y).toBeGreaterThan(
    (await page.locator('.event-published').boundingBox())!.y,
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

for (const [width, columns] of [
  [320, 1],
  [390, 2],
]) {
  test(`${width}px doubled text adapts to ${columns} columns without splitting names`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 640 });
    await page.goto(path);
    await page.getByRole('button', { name: 'Share this post', exact: true }).click();
    const dialog = page.getByRole('dialog');
    const grid = dialog.locator('[data-share-destination-label]').first().locator('../..');
    await expect
      .poll(() =>
        grid.evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(' ').length),
      )
      .toBe(3);
    await dialog.evaluate((panel) => {
      const textElements = Array.from(panel.querySelectorAll<HTMLElement>('*')).filter((node) =>
        Array.from(node.childNodes).some(
          (child) => child.nodeType === Node.TEXT_NODE && child.textContent?.trim(),
        ),
      );
      const sizes = textElements.map((node) => parseFloat(getComputedStyle(node).fontSize));
      textElements.forEach((node, index) => {
        node.style.fontSize = `${sizes[index] * 2}px`;
      });
    });
    await expect
      .poll(() =>
        grid.evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(' ').length),
      )
      .toBe(columns);
    for (const name of [
      'Share by email',
      'Share on WhatsApp',
      'Share on Facebook',
      'Share on LinkedIn',
      'Share on X',
      'Share on Bluesky',
    ]) {
      const button = dialog.getByRole('button', { name, exact: true });
      await button.scrollIntoViewIfNeeded();
      await expect(button.locator('[data-share-destination-label]')).toHaveCSS('font-size', '26px');
      const fits = await button.evaluate((node) => {
        const box = node.getBoundingClientRect();
        const label = node.lastElementChild!;
        const text = label.getBoundingClientRect();
        const range = document.createRange();
        range.selectNodeContents(label);
        return (
          range.getClientRects().length === 1 &&
          text.left >= box.left &&
          text.right <= box.right &&
          label.scrollWidth <= label.clientWidth
        );
      });
      expect(fits, name).toBe(true);
    }
    await expect(dialog).toBeVisible();
  });
}
