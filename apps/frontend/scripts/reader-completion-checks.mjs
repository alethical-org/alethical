#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { readerBaseUrl, commitSha, readerRequestPolicy } from './reader-completion-policy.mjs';
import { safeAuthCallbackReport } from './safe-auth-callback-report.mjs';
import { readerReleaseRelation } from './reader-release-relation.mjs';
import {
  officialBillIdentity,
  sameOfficialBill,
  selectedBillMatchesOfficialLink,
} from './reader-official-bill.mjs';
import { readerFixtures } from './reader-completion-fixtures.mjs';

export async function runReaderChecks(options) {
  const report = {
    schema_version: 1,
    phase: options.fixtures ? 'premerge-fixtures' : 'live-public-read',
    started_at: new Date().toISOString(),
    target_origin: null,
    checked_commit: null,
    expected_commit: null,
    served_commit: null,
    release_match: 'not-checked',
    checks: [],
    blocked_requests: 0,
    suppressed_metrics: 0,
    blocked_external_reads: 0,
    passed: false,
    scope:
      'Chromium desktop public navigation and bill source link; no sign-in, writes, AI answers, numeric accuracy, full accessibility or visual review',
  };
  let browser;
  let activeCheck = 'input-safety';
  try {
    const base = readerBaseUrl(options.baseUrl);
    report.target_origin = base;
    if (options.checkedCommit) report.checked_commit = commitSha(options.checkedCommit);
    if (options.expectedCommit) report.expected_commit = commitSha(options.expectedCommit);
    if (options.fixtures && base === 'https://www.alethical.com')
      throw new Error('Fixtures cannot target production');
    const wait = Number(options.releaseWaitSeconds ?? 0);
    if (!Number.isInteger(wait) || wait < 0 || wait > 900) throw new Error('Invalid bounded wait');
    const { chromium, expect } = await import('@playwright/test');
    browser = await chromium.launch();
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      serviceWorkers: 'block',
    });
    const fixture = options.fixtures ? await readerFixtures() : null;
    await context.route('**/*', async (route) => {
      const request = route.request();
      const policy = readerRequestPolicy(request.url(), request.method(), base);
      if (policy === 'metrics') {
        report.suppressed_metrics++;
        return route.fulfill({ status: 204 });
      }
      if (policy === 'deny') {
        const url = new URL(request.url());
        const safe = safeAuthCallbackReport(request.url());
        const privatePath =
          /\/(?:auth|sign-in|sign-up|login|oauth|callback|me|ask|chat)(?:\/|$)/i.test(url.pathname);
        if (
          !['GET', 'HEAD'].includes(request.method()) ||
          privatePath ||
          safe.privateQueryFieldsPresent ||
          safe.privateFragmentFieldsPresent
        )
          report.blocked_requests++;
        else report.blocked_external_reads++;
        return route.abort();
      }
      if (fixture && new URL(request.url()).origin !== base) {
        const url = new URL(request.url());
        const body = fixture(url.pathname);
        if (url.origin === 'https://api.alethical.com' && body !== undefined) {
          return route.fulfill({ json: body, headers: { 'access-control-allow-origin': '*' } });
        }
        if (policy === 'official-source')
          return route.fulfill({
            contentType: 'text/html',
            body: `<title>Fixture official bill</title><p>Fixture source destination: ${officialBillIdentity(request.url())?.chamber ?? ''} ${officialBillIdentity(request.url())?.number ?? ''}</p>`,
          });
        // Decorative external assets and unrelated eager reads cannot reach a
        // real service during fixture CI. A 503 is explicit missing coverage,
        // never invented campaign records or a placeholder success response.
        return route.fulfill({ status: 503, body: '' });
      }
      return route.continue();
    });
    // WebSocket traffic cannot bypass the read-only HTTP guard.
    await context.routeWebSocket('**/*', (socket) => {
      report.blocked_requests++;
      socket.close();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(20_000);
    const check = async (name, action) => {
      activeCheck = name;
      const started = Date.now();
      await action();
      report.checks.push({ name, passed: true, duration_ms: Date.now() - started });
    };
    await check('home-and-release-stamp', async () => {
      const deadline = Date.now() + wait * 1000;
      do {
        const response = await page.goto(base, { waitUntil: 'domcontentloaded' });
        if (!response?.ok()) throw new Error('Home unavailable');
        const stamp = await page.evaluate(
          () =>
            document
              .querySelector('meta[name="alethical-release-commit"]')
              ?.getAttribute('content') ?? null,
        );
        report.served_commit = /^[0-9a-f]{40}$/.test(stamp ?? '') ? stamp : null;
        if (!report.expected_commit) {
          report.release_match = 'not-requested';
          break;
        }
        report.release_match = report.served_commit
          ? readerReleaseRelation({
              expected: report.expected_commit,
              served: report.served_commit,
              allowNewer: options.allowNewer,
              allowEquivalent: options.allowEquivalent,
            })
          : 'missing';
        if (
          ['exact', 'newer-descendant', 'older-equivalent-website'].includes(report.release_match)
        )
          break;
        if (Date.now() >= deadline) throw new Error('Expected release unavailable');
        await new Promise((resolve) =>
          setTimeout(resolve, Math.min(15_000, deadline - Date.now())),
        );
      } while (true);
      await expect(page).toHaveTitle(/Alethical/);
      await expect(page.getByRole('link', { name: /Bills and votes/ })).toBeVisible();
    });
    await check('home-link-opens-bills', async () => {
      await page.getByRole('link', { name: /Bills and votes/ }).click();
      await expect(page).toHaveURL(
        new RegExp(`${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/bills$`),
      );
      await expect(page.getByRole('heading', { name: 'Search bills', exact: true })).toBeVisible();
    });
    await check('search-opens-bill-with-official-link', async () => {
      const search = page.getByPlaceholder('Search by keyword or bill number', { exact: true });
      await search.fill('school');
      await search.press('Enter');
      activeCheck = 'search-submission-reaches-query';
      await expect(page).toHaveURL(/\/bills\?[^#]*q=school/);
      const result = page.locator('a[href^="/bills/"]').filter({ visible: true }).first();
      activeCheck = 'search-visible-bill-result';
      await expect(result).toBeVisible();
      activeCheck = 'search-result-opens-bill';
      await result.click();
      await expect(page).toHaveURL(/\/bills\/[^/?]+$/);
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
      const source = page.getByRole('link', { name: 'Bill overview', exact: true }).first();
      activeCheck = 'bill-has-official-overview-link';
      await expect(source).toBeVisible();
      const destination = await source.getAttribute('href');
      if (readerRequestPolicy(destination, 'GET', base) !== 'official-source')
        throw new Error('Unapproved source');
      const expectedBill = officialBillIdentity(destination);
      if (
        !expectedBill ||
        !selectedBillMatchesOfficialLink(new URL(page.url()).pathname, expectedBill)
      )
        throw new Error('Official link identifies a different bill');
      let officialStatus = null;
      const onResponse = (response) => {
        if (
          response.request().isNavigationRequest() &&
          readerRequestPolicy(response.url(), 'GET', base) === 'official-source'
        )
          officialStatus = response.status();
      };
      context.on('response', onResponse);
      activeCheck = 'official-overview-click-reaches-source';
      const popupPromise = context.waitForEvent('page');
      await source.click();
      const popup = await popupPromise;
      await popup.waitForLoadState('domcontentloaded');
      if (readerRequestPolicy(popup.url(), 'GET', base) !== 'official-source')
        throw new Error('Unexpected source redirect');
      if (!sameOfficialBill(expectedBill, officialBillIdentity(popup.url())))
        throw new Error('Official source identifies a different bill');
      if (officialStatus === null || officialStatus < 200 || officialStatus >= 400)
        throw new Error('Official source unavailable');
      context.off('response', onResponse);
      await expect(popup.locator('body')).toContainText(
        new RegExp(`\\b${expectedBill.chamber}\\s*0*${expectedBill.number}\\b`),
      );
      await popup.close();
    });
    await check('legislator-directory-opens-overview', async () => {
      await page.goto(`${base}/legislators`);
      await expect(
        page.getByRole('heading', { name: 'Search legislators', exact: true }),
      ).toBeVisible();
      const profile = page
        .locator('a[href^="/legislators/"]:not([href*="?"])')
        .filter({ visible: true })
        .first();
      await expect(profile).toBeVisible();
      await profile.click();
      await expect(page).toHaveURL(/\/legislators\/[^/?]+$/);
      await expect(page.getByRole('link', { name: 'Overview', exact: true })).toHaveAttribute(
        'aria-current',
        'page',
      );
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    });
    await check('blog-collection-opens-article', async () => {
      await page.goto(`${base}/blog`);
      activeCheck = 'blog-has-research-collection-link';
      await page.getByRole('link', { name: 'All research reports', exact: true }).click();
      activeCheck = 'blog-link-opens-research-collection';
      await expect(page).toHaveURL(/\/blog\/research$/);
      const article = page.locator('a[href^="/blog/research/"]').filter({ visible: true }).first();
      activeCheck = 'research-collection-has-visible-article-link';
      await expect(article).toBeVisible();
      activeCheck = 'research-link-opens-article';
      await article.click();
      await expect(page).toHaveURL(/\/blog\/research\/[^/?]+(?:\?[^#]*)?$/);
      activeCheck = 'research-article-has-title-and-return-link';
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
      const returnLink = page
        .getByRole('link', { name: /^(Back to Blog|All research reports)$/ })
        .first();
      await expect(returnLink).toBeVisible();
      await returnLink.click();
      await expect(page).toHaveURL(/\/blog(?:\/research)?(?:\?[^#]*)?$/);
    });
    await check('money-lane-opens-legislator-money-tab', async () => {
      await page.goto(`${base}/money`);
      await expect(
        page.getByRole('heading', { name: 'Money in politics', exact: true }),
      ).toBeVisible();
      await page
        .locator('[data-testid="money-lanes"] a')
        .filter({ hasText: 'Legislators' })
        .click();
      await expect(page).toHaveURL(/\/legislators\?tab=money$/);
      const profile = page
        .locator('a[href^="/legislators/"][href$="?tab=money"]')
        .filter({ visible: true })
        .first();
      await expect(profile).toBeVisible();
      await profile.click();
      await expect(page.getByRole('link', { name: 'Campaign money', exact: true })).toHaveAttribute(
        'aria-current',
        'page',
      );
    });
    await check('no-unexpected-network-action', async () => {
      if (report.blocked_requests !== 0) throw new Error('Unexpected network action prevented');
    });
    report.passed = true;
  } catch (error) {
    // Playwright exceptions can contain full addresses and page text. Neither
    // their messages nor traces/screenshots/console events enter saved evidence.
    const knownFailures = new Map([
      ['Home unavailable', 'home-http-failure'],
      ['Expected release unavailable', 'expected-release-not-served'],
      ['Official source unavailable', 'official-source-http-failure'],
      ['Unapproved source', 'official-link-target-rejected'],
      ['Unexpected source redirect', 'official-source-redirect-rejected'],
      ['Official link identifies a different bill', 'official-link-bill-mismatch'],
      ['Official source identifies a different bill', 'official-destination-bill-mismatch'],
      ['Unexpected network action prevented', 'unexpected-action-prevented'],
      ['Fixtures cannot target production', 'production-fixture-target-rejected'],
      ['Invalid bounded wait', 'release-wait-outside-limit'],
      ['Expected a full commit hash', 'invalid-commit-input'],
      ['Reader checks require a bare approved origin', 'target-not-bare-origin'],
      ['Reader checks require official production or HTTP loopback', 'target-origin-rejected'],
    ]);
    report.checks.push({
      name: activeCheck,
      passed: false,
      failure:
        knownFailures.get(error?.message) ??
        (error?.name === 'TimeoutError' ? 'reader-action-timed-out' : 'reader-expectation-not-met'),
    });
  } finally {
    await browser?.close().catch(() => {});
    if (report.blocked_requests > 0 && report.passed) {
      report.passed = false;
      report.checks.push({
        name: 'no-unexpected-network-action-during-close',
        passed: false,
        failure: 'unexpected-action-prevented',
      });
    }
    report.finished_at = new Date().toISOString();
    await mkdir(dirname(options.output), { recursive: true });
    await writeFile(options.output, `${JSON.stringify(report, null, 2)}\n`);
  }
  return report;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const { values } = parseArgs({
    options: {
      'base-url': { type: 'string', default: 'https://www.alethical.com' },
      output: { type: 'string', default: 'reader-completion-results.json' },
      'checked-commit': { type: 'string' },
      'expected-commit': { type: 'string' },
      'release-wait-seconds': { type: 'string', default: '0' },
      fixtures: { type: 'boolean' },
      'allow-newer': { type: 'boolean' },
      'allow-equivalent': { type: 'boolean' },
    },
  });
  const result = await runReaderChecks({
    baseUrl: values['base-url'],
    output: values.output,
    checkedCommit: values['checked-commit'],
    expectedCommit: values['expected-commit'],
    releaseWaitSeconds: values['release-wait-seconds'],
    fixtures: values.fixtures,
    allowNewer: values['allow-newer'],
    allowEquivalent: values['allow-equivalent'],
  });
  console.log(
    `Reader checks: ${result.passed ? 'passed' : 'failed'} (${result.phase}); saved named-check evidence`,
  );
  process.exitCode = result.passed ? 0 : 1;
}
