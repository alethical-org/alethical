import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';
import { build, preview } from 'vite';

// Runs entirely on loopback with the shipped Finance app and security headers.
// Install the Playwright Chromium browser, or use PLAYWRIGHT_CHANNEL=chrome.
test('Chrome saves the displayed original after the former 60-second expiry', async (t) => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const scratch = await mkdtemp(path.join(tmpdir(), 'finance-pdf-'));
  let server;
  let browser;
  t.after(async () => {
    await browser?.close();
    await server?.close();
    await rm(scratch, { recursive: true, force: true });
  });
  const outDir = path.join(scratch, 'dist');
  Object.assign(process.env, {
    VITE_API_BASE_URL: '/.',
    VITE_FINANCE_SCREENS: 'on',
    VITE_SUPABASE_URL: 'http://127.0.0.1:1',
    VITE_SUPABASE_PUBLISHABLE_KEY: 'local-browser-fixture',
  });
  const config = JSON.parse(await readFile(path.join(root, 'vercel.json'), 'utf8'));
  const headers = Object.fromEntries(
    config.headers[0].headers.map(({ key, value }) => [key, value]),
  );
  await build({ root, logLevel: 'warn', build: { outDir, emptyOutDir: true } });
  server = await preview({
    root,
    build: { outDir },
    preview: { port: 0, host: '127.0.0.1', headers },
  });
  const origin = 'http://127.0.0.1:' + server.httpServer.address().port;
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chromium' });
  const page = await browser.newPage();
  const token = 'finance_research_' + 't'.repeat(40);
  await page.addInitScript((access_token) => {
    if (window !== window.top || location.protocol !== 'http:') return;
    localStorage.setItem(
      'alethical-finance-research-session',
      JSON.stringify({
        access_token,
        email: 'reader@example.test',
        expires_at: new Date(Date.now() + 3600_000).toISOString(),
      }),
    );
  }, token);

  const pdf = await readFile(
    new URL(
      '../../../alethical/tests/fixtures/campaign_finance_calendars/2015_general_disclosure_calendar.pdf',
      import.meta.url,
    ),
  );
  const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
  const version = sha256(pdf);
  const key = encodeURIComponent('TV|42|00000000-0000-4000-8000-000000000001');
  const listPath = '/api/v1/finance/media-buys/filings';
  const apiPath = '/api/v1/finance/media-buys/national-files/' + key;
  let originalGets = 0;
  await page.route('**/api/v1/**', async (route) => {
    if (route.request().headers().authorization !== 'Bearer ' + token)
      return route.fulfill({ status: 401, body: '' });
    const url = new URL(route.request().url());
    if (url.pathname === '/api/v1/finance/access') return route.fulfill({ json: {} });
    if (url.pathname === listPath)
      return route.fulfill({
        json: {
          data: {
            tab: 'all-filings',
            q: '',
            year: 2015,
            years: [2015],
            page: 1,
            page_size: 25,
            total: 1,
            rows: [
              {
                key: decodeURIComponent(key),
                name: 'Disclosure Schedule.pdf',
                folder: 'Political Files',
                station: 'Example TV',
                service: 'TV',
                uploaded: null,
                file_id: '00000000-0000-4000-8000-000000000001',
                pdf: 'saved',
                minnesota_key: null,
              },
            ],
            about: {
              filings: 1,
              index_through: '2026-11-16',
              saved: 1,
              saved_updated: '2026-11-17',
              complete: true,
            },
          },
        },
      });
    if (url.pathname === apiPath + '/original') {
      assert.equal(url.searchParams.get('version'), version);
      originalGets++;
      return route.fulfill({ contentType: 'application/pdf', body: pdf });
    }
    if (url.pathname !== apiPath) return route.fulfill({ status: 404 });
    return route.fulfill({
      json: {
        data: {
          title: 'Disclosure Schedule.pdf',
          service: 'TV',
          station_name: 'Example TV',
          folder_path: 'Political Files',
          content_hash: version,
          has_text: false,
        },
      },
    });
  });
  const document = await page.goto(origin + '/media-buys?tab=national');
  assert.equal(
    await document.headerValue('content-security-policy'),
    headers['Content-Security-Policy'],
  );
  const result = page.getByRole('link', { name: 'Open filing PDF for Disclosure Schedule.pdf' });
  await result.waitFor();
  const directory = page.url();
  await result.click();
  const detail = page.url();
  const open = page.getByRole('button', { name: 'Open original PDF' });
  await open.waitFor();
  assert.equal(originalGets, 0);
  await page.clock.install();
  await open.click();
  const save = page.getByRole('link', { name: 'Save PDF' });
  await save.waitFor();
  const frame = page.locator('iframe[title="Original PDF: Disclosure Schedule.pdf"]');
  assert.equal(await frame.getAttribute('src'), await save.getAttribute('href'));
  // Chrome inserts its PDF viewer extension after the document opens.
  await expect
    .poll(() =>
      page
        .frames()
        .some(
          (child) =>
            child.url().startsWith('chrome-extension://') &&
            child.parentFrame()?.url().startsWith('blob:'),
        ),
    )
    .toBe(true);
  await page.clock.fastForward(65_000);
  // Check the browser's toolbar too: this is where the original save failed.
  const nativeViewer = page.frames().find((child) => child.url().startsWith('chrome-extension://'));
  const nativeStarted = page.waitForEvent('download', { timeout: 8_000 });
  await nativeViewer.getByRole('button', { name: 'Download', exact: true }).click();
  const nativeFile = path.join(scratch, 'native.pdf');
  await (await nativeStarted).saveAs(nativeFile);
  assert.equal(sha256(await readFile(nativeFile)), version);

  const started = page.waitForEvent('download');
  await save.click();
  const download = await started;
  assert.equal(download.suggestedFilename(), 'Disclosure Schedule.pdf');
  const saved = path.join(scratch, download.suggestedFilename());
  await download.saveAs(saved);
  assert.equal(sha256(await readFile(saved)), version);
  assert.equal(originalGets, 1);
  await page.goBack();
  await open.waitFor();
  assert.equal(page.url(), detail);
  assert.equal(await frame.count(), 0);
  await open.click();
  await save.waitFor();
  await page.reload();
  await save.waitFor();
  await page.getByRole('button', { name: 'Close PDF' }).click();
  await open.waitFor();
  assert.equal(page.url(), detail);
  await page.goBack();
  assert.equal(page.url(), directory);
});
