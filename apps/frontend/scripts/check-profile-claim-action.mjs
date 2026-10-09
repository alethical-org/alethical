/** Rendered regression for the public profile's approved account-action treatment. */
import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';

const base = process.argv[2] ?? 'http://localhost:19077';
assert(['localhost', '127.0.0.1'].includes(new URL(base).hostname), 'Use the local preview');
const browser = await chromium.launch({ headless: true });
const geometry = (control) =>
  control.evaluate((node) => {
    const box = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    const text = getComputedStyle(node.firstElementChild);
    const description = document.getElementById(node.getAttribute('aria-describedby'));
    return {
      x: box.x,
      width: box.width,
      height: box.height,
      fill: style.backgroundColor,
      border: style.borderColor,
      radius: style.borderRadius,
      text: text.color,
      fontSize: text.fontSize,
      weight: text.fontWeight,
      descriptionX: description?.getBoundingClientRect().x,
      description: description?.textContent,
      gap: description?.getBoundingClientRect().top - box.bottom,
    };
  });
try {
  for (const width of [1280, 900, 390, 320]) {
    const page = await browser.newPage({
      viewport: { width, height: 1000 },
      hasTouch: width < 768,
    });
    await page.goto(`${base}/candidates/preview-general-alex`);
    await page.getByLabel('Campaign', { exact: true }).selectOption('absent');
    await page.evaluate(() => document.fonts.ready);
    const account = page.getByLabel('Account', { exact: true });
    for (const [state, label, green, destination] of [
      ['public', 'Claim this profile', true, 'claim'],
      ['approved', 'Manage this profile', true, 'manage'],
      ['pending', 'View profile claim status', false, 'claim'],
    ]) {
      await account.selectOption(state);
      const control = page.getByRole('link', { name: label, exact: true });
      await control.waitFor();
      await page.mouse.move(1, 1);
      const shown = await geometry(control);
      assert.equal(shown.fill, green ? 'rgb(46, 212, 126)' : 'rgb(255, 255, 255)');
      assert.equal(shown.text, green ? 'rgb(6, 35, 26)' : 'rgb(17, 21, 15)');
      assert.equal(shown.height, 48);
      assert.equal(shown.radius, '12px');
      assert.equal(shown.fontSize, '16px');
      assert.equal(shown.weight, '700');
      assert.equal(shown.x, shown.descriptionX, 'Button and explanation share their left edge');
      assert.equal(shown.gap, 8);
      assert(shown.description.length > 40, 'The button keeps its screen-reader explanation');
      assert.equal(
        await control.getAttribute('href'),
        `/candidates/preview-general-alex/${destination}`,
      );
      if (width < 768) assert.equal(shown.width, width - 40, 'Phone action fills the column');
      else assert(shown.width < 300, 'Desktop/tablet button stays sized to its words');
      await control.focus();
      assert.equal(
        await control.evaluate((node) => getComputedStyle(node).outlineColor),
        'rgb(124, 92, 255)',
      );
      assert.equal(await control.evaluate((node) => getComputedStyle(node).outlineWidth), '2px');
      if (width >= 768) {
        await control.hover();
        assert.equal(
          (await geometry(control)).fill,
          green ? 'rgb(40, 191, 113)' : 'rgb(247, 248, 250)',
        );
        await page.mouse.down();
        await expect(control).toHaveCSS(
          'background-color',
          green ? 'rgb(35, 173, 102)' : 'rgb(236, 239, 241)',
        );
        await page.mouse.move(1, 1);
        await page.mouse.up();
      }
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
      );
    }
    await account.selectOption('loading');
    await page.getByText('Loading profile claim status…', { exact: true }).waitFor();
    assert.equal(
      await page.getByRole('link', { name: 'Claim this profile', exact: true }).count(),
      0,
    );
    await account.selectOption('error');
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await page.getByRole('link', { name: 'Claim this profile', exact: true }).waitFor();
    await page.close();
    console.log(`Profile account action passed at ${width}px`);
  }
} finally {
  await browser.close();
}
