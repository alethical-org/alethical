/** Rendered regression: candidate results keep their place after a profile visit. */
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';

const base = process.argv[2] ?? 'http://localhost:8081';
assert(['localhost', '127.0.0.1'].includes(new URL(base).hostname), 'Use a local build');
const election = {
  id: 'test-election',
  label: 'General election',
  date: '2026-11-03',
  type: 'general',
};
const source = {
  authority: 'Minnesota Secretary of State',
  url: 'https://myballotmn.sos.mn.gov/',
  checkedDate: '2026-10-09',
};
const races = ['state', 'county', 'school'].flatMap((group, index) =>
  Array.from({ length: index === 0 ? 36 : 5 }, (_, i) => ({
    id: `${group}-${i}`,
    group,
    office: `Example office ${i + 1}`,
    votingArea: 'Example district',
    source,
    entries: [
      {
        kind: 'candidate',
        candidate: {
          id: (index * 40 + i + 1).toString(16).padStart(64, '0'),
          name: `Example candidate ${index * 40 + i + 1}`,
          sortName: `Candidate ${i}`,
        },
      },
    ],
  })),
);
const browser = await chromium.launch();
try {
  for (const width of [1280, 900, 390]) {
    const page = await browser.newPage({
      viewport: { width, height: 844 },
      isMobile: width === 390,
      hasTouch: width === 390,
    });
    await page.route('**/candidates/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      let body;
      if (path.endsWith('/elections')) body = [election];
      else if (path.endsWith('/suggest')) body = [];
      else if (path.endsWith('/lookup'))
        body = {
          kind: 'results',
          electionId: election.id,
          matchedAddress: '326 17TH AVE SE, MINNEAPOLIS, MN 55414',
          races,
          coverage: [],
        };
      else if (
        /\/candidates\/[a-f0-9]{64}$/.test(path) &&
        route.request().resourceType() !== 'document'
      ) {
        const id = path.split('/').pop();
        const race = races.find((r) => r.entries[0].candidate.id === id);
        body = {
          candidate: race.entries[0].candidate,
          election,
          office: race.office,
          votingArea: race.votingArea,
          source,
        };
      } else return route.continue();
      await route.fulfill({ json: body });
    });
    await page.goto(`${base}/candidates`);
    await page.getByRole('button', { name: 'Find', exact: true }).waitFor();
    await page
      .getByLabel('Full street address', { exact: true })
      .fill('326 17TH AVE SE, MINNEAPOLIS, MN 55414');
    await page.getByRole('button', { name: 'Find', exact: true }).click();
    await page.getByRole('button', { name: 'Change address', exact: true }).waitFor();
    await page.getByRole('button', { name: /^State offices/ }).click();
    const link = page.locator('a[href^="/candidates/"]:visible').first();
    await link.scrollIntoViewIfNeeded();
    // RN Web's scroll callback settles after 100ms; do not navigate mid-scroll.
    await page.waitForTimeout(250);
    const before = await link.boundingBox();
    const groups = await page
      .locator('button[aria-expanded]')
      .evaluateAll((nodes) => nodes.map((n) => [n.textContent, n.getAttribute('aria-expanded')]));
    const text = await page.locator('body').innerText();
    if (width === 390) await link.tap();
    else await link.click();
    await page.getByRole('heading', { name: /^Example candidate/ }).waitFor();
    await page.getByRole('link', { name: 'Go back', exact: true }).click();
    await link.waitFor();
    await page.waitForTimeout(250);
    const after = await link.boundingBox();
    assert(
      Math.abs(before.y - after.y) < 2,
      `${width}px: link moved from ${before.y} to ${after.y}`,
    );
    assert.equal(
      await page.locator('body').innerText(),
      text,
      'Address, election and results remain together',
    );
    assert.deepEqual(
      await page
        .locator('button[aria-expanded]')
        .evaluateAll((nodes) => nodes.map((n) => [n.textContent, n.getAttribute('aria-expanded')])),
      groups,
    );
    console.log(`${width}px candidate profile return keeps results and reading position`);
    await page.close();
  }
} finally {
  await browser.close();
}
