/** Focused browser regression for the 2 approved candidate address submit buttons. */
import assert from 'node:assert/strict';
import { chromium, webkit } from '@playwright/test';

const base = process.argv[2] ?? 'http://localhost:19067';
assert(['localhost', '127.0.0.1'].includes(new URL(base).hostname), 'Use the local preview');
const geometry = (locator) =>
  locator.evaluate((node) => {
    const { width, height, x, y } = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    return { width, height, x, y, fill: style.backgroundColor, border: style.borderColor };
  });
for (const engine of [chromium, webkit]) {
  const browser = await engine.launch({ headless: true });
  try {
    for (const width of [1280, 900, 390]) {
      const page = await browser.newPage({
        viewport: { width, height: 1000 },
        hasTouch: width === 390,
      });
      await page.goto(`${base}/candidates`);
      await page.getByLabel('Review state', { exact: true }).waitFor();
      await page.evaluate(() => document.fonts.ready);
      await page.getByLabel('Slow request', { exact: true }).check();
      const field = page.getByLabel('Full street address', { exact: true });
      const ready = page.getByRole('button', { name: 'Find my candidates', exact: true });
      const busy = page.getByRole('button', { name: 'Finding candidates…', exact: true });
      const verifyBusy = async (before, compact = false) => {
        await busy.waitFor();
        await page.screenshot({
          path: `/tmp/candidate-busy-active-${engine.name()}-${width}-${compact ? 'edit' : 'entry'}.png`,
        });
        assert.deepEqual(
          await geometry(busy),
          before,
          'Busy button box/fill/border must stay fixed',
        );
        assert.equal(before.height, compact ? 52 : 60);
        if (!compact) assert.equal(before.width, width === 1280 ? 248 : width === 900 ? 220 : 350);
        assert.equal(await busy.getAttribute('aria-disabled'), 'true');
        assert.equal(await busy.evaluate((node) => node === document.activeElement), true);
        assert.equal(await busy.evaluate((node) => getComputedStyle(node).cursor), 'progress');
        const spinner = busy.locator('[data-candidate-spinner="true"]');
        assert.equal(
          await spinner.evaluate((node) => getComputedStyle(node).animationDuration),
          '0.8s',
        );
        assert.equal(await spinner.locator('circle').getAttribute('stroke'), 'rgba(6,35,26,0.25)');
        assert.equal(
          await spinner.evaluate((node) => Number.parseFloat(getComputedStyle(node).width)),
          17,
        );
        const announcements = page
          .locator('[aria-live="polite"]')
          .filter({ hasText: /^Finding candidates…$/ });
        assert.equal(await announcements.count(), 1);
        assert.equal(await announcements.evaluate((node) => getComputedStyle(node).width), '1px');
        assert.equal(await page.getByText('Finding candidates…', { exact: true }).count(), 2);
        assert.equal(
          await busy.evaluate(
            (node) => node.parentElement.nextElementSibling.nextElementSibling.textContent,
          ),
          '',
        );
        await page.emulateMedia({ reducedMotion: 'reduce' });
        assert.equal(
          await spinner.evaluate((node) => getComputedStyle(node).animationName),
          'none',
        );
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        await busy.dispatchEvent('click');
        await busy.press('Enter');
        await field.press('Enter');
        await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
        assert.deepEqual(
          await geometry(busy),
          before,
          'Busy hover/press must not change its box or fill',
        );
      };
      await field.fill('100 Example Street');
      await ready.focus();
      const before = await geometry(ready);
      const help = page.getByText('A city or ZIP code alone cannot identify your local races', {
        exact: true,
      });
      const helpBefore = await help.boundingBox();
      await ready.press('Enter');
      await verifyBusy(before);
      assert.deepEqual(
        await help.boundingBox(),
        helpBefore,
        'Reserved message space keeps the next line steady',
      );
      await page.getByRole('button', { name: 'Change address', exact: true }).waitFor();
      await page.getByRole('button', { name: 'Change address', exact: true }).click();
      await field.fill('200 Example Street');
      await page.getByLabel('Review state', { exact: true }).selectOption('no-match');
      await ready.focus();
      const compactBefore = await geometry(ready);
      const racesBefore = await page.locator('.candidate-group-toggle').first().boundingBox();
      await ready.press('Enter');
      await verifyBusy(compactBefore, true);
      assert.deepEqual(
        await page.locator('.candidate-group-toggle').first().boundingBox(),
        racesBefore,
        'Retained race rows stay steady during an address search',
      );
      await page
        .getByText('We couldn’t match that address: check the street address, city, and ZIP code', {
          exact: true,
        })
        .waitFor();
      assert.equal(await ready.getAttribute('aria-disabled'), null);
      await page.mouse.move(1, 1);
      assert.deepEqual(await geometry(ready), compactBefore);
      assert.equal(await field.inputValue(), '200 Example Street');
      await page.getByLabel('Review state', { exact: true }).selectOption('full');
      await ready.click();
      await page.getByRole('button', { name: 'Change address', exact: true }).waitFor();
      await page.getByRole('button', { name: 'Change address', exact: true }).click();
      await field.fill('300 Example Street');
      await page.getByLabel('Review state', { exact: true }).selectOption('failure');
      const failedRacesBefore = await page.locator('.candidate-group-toggle').first().boundingBox();
      await ready.click();
      await busy.waitFor();
      await page.getByText('We couldn’t update the results', { exact: true }).waitFor();
      assert.equal(await ready.count(), 1);
      if (width === 1280)
        assert.deepEqual(
          await page.locator('.candidate-group-toggle').first().boundingBox(),
          failedRacesBefore,
          'Failed address searches keep desktop retained races steady',
        );
      await page.getByLabel('Review state', { exact: true }).selectOption('full');
      await page.getByRole('button', { name: 'Try again', exact: true }).click();
      await busy.waitFor();
      if (width === 1280)
        assert.deepEqual(
          await page.locator('.candidate-group-toggle').first().boundingBox(),
          failedRacesBefore,
          'Address retries keep desktop retained races steady',
        );
      await page.getByRole('button', { name: 'Change address', exact: true }).waitFor();
      await page.getByRole('combobox', { name: /^Election/ }).click();
      await page.getByRole('option', { name: /State primary/ }).click();
      await page.getByText('Updating candidates…', { exact: true }).waitFor();
      assert.equal(await busy.count(), 0, 'Election update keeps its existing status');
      await page.getByText('Not every office has a primary', { exact: true }).waitFor();
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
      );
      await page.screenshot({
        path: `/tmp/candidate-busy-${engine.name()}-${width}.png`,
        fullPage: true,
      });
      console.log(
        `${engine.name()} ${width}px: entry/edit busy, focus, size, retry, repeat, reduced motion and election status pass`,
      );
      await page.close();
    }
  } finally {
    await browser.close();
  }
}
