import { expect, test, type Page, type Route } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

// Invented records and sessions only. All non-static network traffic is intercepted.
const output = resolve('../../.task-notes/tv-browser');
const stamp = '2026-10-01T12:00:00Z';
const hash = 'a'.repeat(64);
const oldHash = 'b'.repeat(64);
const copy = '00000000-0000-4000-8000-000000000002';
function syntheticSession() {
  const id = '00000000-0000-4000-8000-000000000001';
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const encode = (x: unknown) => Buffer.from(JSON.stringify(x)).toString('base64url');
  return {
    access_token: `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: id, session_id: 'tv-fixture', exp })}.not-a-real-signature`,
    refresh_token: 'invented-refresh',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: exp,
    user: {
      id,
      aud: 'authenticated',
      role: 'authenticated',
      email: 'tv-fixture@example.invalid',
      email_confirmed_at: stamp,
      created_at: stamp,
      app_metadata: { provider: 'email', providers: ['email'] },
      user_metadata: {},
    },
  };
}
const json = (r: Route, body: unknown, status = 200) =>
  r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const fileRow = {
  key: 'fixture-file',
  name: 'Synthetic station invoice',
  label: 'Synthetic station invoice',
  station: 'KARE',
  year: '2026',
  category: 'State',
  kind: 'Invoice',
  uploaded_at: stamp,
};
const counts = {
  station_files_held: 27,
  unique_file_contents: 24,
  files_with_approved_copy: 18,
  text_read_failures: 2,
  download_failures: 3,
  checked_connection_files: 6,
};
async function fixture(page: Page, allowed = true) {
  const state = {
    allowed,
    withdrawn: false,
    media: [] as string[],
    writes: [] as { path: string; body: any }[],
    approved: false,
  };
  const session = syntheticSession();
  await page.addInitScript(
    ({ key, saved }) => {
      localStorage.clear();
      localStorage.setItem(key, JSON.stringify(saved));
    },
    { key: process.env.E2E_AUTH_STORAGE_KEY ?? 'sb-localhost-auth-token', saved: session },
  );
  const source = await page.context().newPage();
  await source.setViewportSize({ width: 600, height: 800 });
  await source.setContent(
    '<main style="padding:40px;font:20px Georgia"><h1>SYNTHETIC TEST RECORD</h1><p>Station invoice</p><hr><p>Example campaign</p><p>Gross amount: $12,345.67</p><p>Order 1234</p><p>Scheduled: October 1 through October 8</p><div style="background:#eee;border:1px solid #ccc;height:50px;margin:50px 0"></div><p>Private details withheld</p><hr><p>This invented record is for browser checks</p></main>',
  );
  const png = await source.screenshot();
  await source.close();
  const publication = () => ({
    id: copy,
    facility_id: '23079',
    file_id: 'fixture-file',
    content_hash: hash,
    status: state.approved ? 'approved' : 'prepared',
    safe_title: 'Synthetic safe invoice',
    safe_folder: 'Synthetic safe folder',
    category: 'State',
    safe_pages: [{ page: 1, text: 'Safe invoice text', text_status: 'readable' }],
    fingerprint: 'test-fingerprint',
    created_at: stamp,
    reviewed_at: null,
    pages: [{ page: 1, width: 600, height: 800 }],
  });
  await page.route('**/api/v1/**', async (r) => {
    const u = new URL(r.request().url()),
      path = u.pathname;
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204 });
    if (path === '/api/v1/me')
      return json(r, {
        data: {
          id: session.user.id,
          primary_email: session.user.email,
          display_name: 'Synthetic administrator',
          is_admin: allowed,
          sign_in_methods: { google: false, password: true },
        },
      });
    if (path === '/api/v1/admin/access') return json(r, { data: { is_admin: state.allowed } });
    if (path === '/api/v1/ads/access')
      return json(
        r,
        state.allowed ? { allowed: true } : { detail: 'Not found' },
        state.allowed ? 200 : 404,
      );
    if (path.includes('/pages/')) {
      state.media.push(r.request().headers().authorization || '');
      if (state.withdrawn && path.startsWith('/api/v1/ads/'))
        return json(r, { detail: 'Gone' }, 410);
      return r.fulfill({ status: 200, contentType: 'image/png', body: png });
    }
    if (path === '/api/v1/ads/counts') return json(r, counts);
    if (path === '/api/v1/ads/sources')
      return json(r, {
        stations: ['KSTP-TV', 'KARE', 'KMSP-TV'].map((call_sign) => ({
          call_sign,
          facility_id: 23079,
          fcc_url: 'https://publicfiles.fcc.gov/tv-profile/kare',
          newest_upload: stamp,
          last_list_check: stamp,
          last_file_copy: stamp,
        })),
        text_reader_version: 'fixture-1',
      });
    if (path === '/api/v1/ads/recent')
      return json(r, {
        stations: ['KSTP-TV', 'KARE', 'KMSP-TV'].map((call_sign) => ({
          call_sign,
          files: [{ ...fileRow, station: call_sign }],
        })),
      });
    if (path === '/api/v1/ads/browse')
      return json(r, {
        tab: u.searchParams.get('tab') || 'folders',
        q: u.searchParams.get('q') || '',
        station: u.searchParams.get('station') || '',
        year:
          u.searchParams.get('year') ||
          (u.searchParams.get('default_year') === 'true' ? '2026' : ''),
        category: u.searchParams.get('category') || '',
        page: Number(u.searchParams.get('page') || 1),
        page_size: 12,
        total: 12,
        capped: false,
        years: ['2026', '2024'],
        categories: ['State', 'Local', 'Non-candidate issue ads'],
        rows: Array.from({ length: 12 }, (_, i) => ({
          ...fileRow,
          key: `folder-${i}`,
          label: `Synthetic campaign folder ${i + 1}`,
          file_count: i + 1,
        })),
      });
    if (path === '/api/v1/ads/files/fixture-file') {
      if (state.withdrawn)
        return json(r, {
          key: 'fixture-file',
          copy_status: 'withdrawn',
          withdrawn_at: stamp,
          versions: [],
        });
      const version = u.searchParams.get('version') || hash;
      return json(r, {
        ...fileRow,
        copy_status: 'approved',
        copy_id: copy,
        version_id: version,
        fcc_url: 'https://publicfiles.fcc.gov/tv-profile/kare',
        newest_approved_version: hash,
        current_source_version: hash,
        source_changed: version !== hash,
        page_count: 2,
        versions: [
          { id: hash, first_saved_at: stamp, uploaded_at: stamp, status: 'approved' },
          {
            id: oldHash,
            first_saved_at: '2026-09-01T12:00:00Z',
            uploaded_at: stamp,
            status: 'approved',
          },
        ],
        folder: { key: 'folder-1', label: 'Synthetic campaign folder' },
        pages: [1, 2].map((number) => ({
          number,
          image_path: `/ads/files/fixture-file/pages/${number}?version=${version}&copy=${copy}`,
          text: `Synthetic machine text page ${number}`,
          text_status: 'ready',
        })),
        facts: [
          {
            id: 'gross',
            kind: 'Gross amount',
            value: '$12,345',
            quote: 'Gross amount: $12,345.67',
            page: 1,
            version_id: version,
            checked_at: stamp,
            status: 'checked',
            history: [{ value: '$12,300', corrected_at: stamp }],
          },
        ],
        dates: [],
        connections: [
          {
            id: 'expense-1',
            kind: 'expense',
            label: 'Synthetic saved expense',
            href: `/money/ads/files/fixture-file?expense=expense-1&version=${hash}&copy=${copy}`,
            quote: 'Order 1234',
            page: 1,
            version_id: version,
            status: 'checked',
            checked_at: stamp,
            evidence_label: 'Open retained expense row',
          },
        ],
        related: [
          {
            key: 'related-file',
            version_id: oldHash,
            copy_id: copy,
            name: 'Synthetic related order',
            kind: 'Order',
            reference: 'Order 1234',
            checked_at: stamp,
          },
        ],
        other_files: [{ ...fileRow, key: 'other-file', name: 'Synthetic second invoice' }],
      });
    }
    if (path === '/api/v1/ads/files/related-file')
      return json(r, {
        key: 'related-file',
        copy_status: 'withdrawn',
        withdrawn_at: stamp,
        versions: [],
      });
    if (path === '/api/v1/ads/expenses/expense-1')
      return json(r, {
        id: 'expense-1',
        label: 'Synthetic retained expense',
        dataset: 'Synthetic saved export',
        source_date: stamp,
        source_changed: true,
        fields: [{ label: 'Reported expense', value: '$12,345' }],
        evidence: { page: 1, quote: 'Order 1234', version_id: hash },
        file: { key: 'fixture-file', name: fileRow.name, copy_id: copy, version_id: hash },
      });
    if (path.startsWith('/api/v1/admin/political-ads')) {
      const suffix = path.replace('/api/v1/admin/political-ads', '');
      if (r.request().method() === 'POST') {
        state.writes.push({ path: suffix, body: r.request().postDataJSON() });
        if (suffix.endsWith('/approve')) state.approved = true;
      }
      const row = {
        facility_id: '23079',
        file_id: 'fixture-file',
        content_hash: hash,
        name: 'Synthetic private invoice',
        call_sign: 'KARE',
        folder_path: 'Synthetic folder',
        uploaded_at: stamp,
        first_saved_at: stamp,
        page_count: 1,
        status: 'unreviewed',
      };
      if (suffix === '/folders') return json(r, { rows: [], total: 0, page: 1, page_size: 12 });
      if (suffix.startsWith('/queue'))
        return json(r, { rows: [row], total: 1, page: 1, page_size: 12 });
      if (suffix.includes('/versions/'))
        return json(r, {
          document: { ...row, folder_id: 'folder-1' },
          pages: [{ page: 1, text: 'Private synthetic text', text_status: 'readable' }],
          draft_facts: [],
          copies: [],
          page_count: 1,
        });
      if (suffix === '/copies' || suffix.endsWith('/review'))
        return json(r, { publication: publication(), facts: [], connections: [], events: [] });
      if (suffix.endsWith('/approve')) return json(r, { ok: true });
    }
    if (path === '/api/v1/site-metrics/events') return r.fulfill({ status: 204 });
    if (path === '/api/v1/site-metrics/collection')
      return json(r, { collect: false, teamAccount: true, teamExclusionConfigured: true });
    return json(r, { detail: 'Unavailable in isolated fixture' }, 404);
  });
  return state;
}

test.beforeEach(async ({ context, baseURL }) => {
  test.skip(
    !baseURL || !['localhost', '127.0.0.1'].includes(new URL(baseURL).hostname),
    'Local isolated browser checks only',
  );
  await mkdir(output, { recursive: true });
  await context.route('**/*', (r) => {
    const u = new URL(r.request().url());
    return u.origin === new URL(baseURL!).origin &&
      !u.pathname.startsWith('/api/') &&
      r.request().method() === 'GET'
      ? r.continue()
      : r.abort();
  });
});
for (const width of [390, 900, 1280]) {
  test(`landing ${width}px menu and layout`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await fixture(page);
    await page.goto('/money/ads');
    await expect(page.getByRole('heading', { name: 'TV ad records', exact: true })).toBeVisible();
    await expect(page.getByText('Synthetic campaign folder 12', { exact: true })).toBeVisible();
    const station = page.getByRole('combobox', { name: 'Station', exact: true });
    await station.click();
    const bottom = page.getByRole('option', { name: 'KMSP-TV', exact: true });
    const box = await station.boundingBox(),
      dest = await bottom.boundingBox();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.move(dest!.x + dest!.width / 2, dest!.y + dest!.height / 2, { steps: 12 });
    await expect(bottom).toBeVisible();
    await page.screenshot({ path: resolve(output, `menu-${width}.png`) });
    await bottom.click();
    await expect(station).toHaveText(/KMSP-TV/);
    await station.focus();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('listbox')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('listbox')).toHaveCount(0);
    await expect(station).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    await page.screenshot({ path: resolve(output, `landing-${width}.png`), fullPage: true });
    await page.getByRole('heading', { name: 'Recent station uploads' }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: resolve(output, `landing-lower-${width}.png`) });
    await page
      .getByRole('heading', { name: 'Sources and copy dates' })
      .evaluate((node) => node.scrollIntoView({ block: 'start' }));
    await page.screenshot({ path: resolve(output, `sources-${width}.png`) });
  });
}
test('nonadministrator cannot enter reader or private guide', async ({ page }) => {
  await fixture(page, false);
  for (const path of ['/money/ads', '/money/ads/guide']) {
    await page.goto(path);
    await expect(page.getByRole('heading', { name: 'We couldn’t find that page' })).toBeVisible();
    await expect(page.getByText('Administrators only', { exact: true })).toHaveCount(0);
  }
});
test('administrator private guide has no sharing or comments', async ({ page }) => {
  await fixture(page);
  await page.goto('/money/ads/guide');
  await expect(
    page.getByRole('heading', { name: 'How to read TV ad records', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: /share/i })).toHaveCount(0);
  await expect(page.getByText('Comments', { exact: true })).toHaveCount(0);
  await page.screenshot({ path: resolve(output, 'guide.png'), fullPage: true });
});
test('file image pages, text, history, versions and exact expense evidence', async ({ page }) => {
  const state = await fixture(page);
  await page.goto('/money/ads/files/fixture-file');
  await expect(page.locator('.tv-viewer img')).toBeVisible();
  await expect(page.locator('.tv-viewer img')).toHaveAttribute('src', /^blob:/);
  await page.screenshot({ path: resolve(output, 'file-top.png') });
  await page.getByRole('button', { name: 'Next page', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Page images' })).toBeVisible();
  await expect(page.getByText('Synthetic machine text page 2', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'History', exact: true }).click();
  await expect(page.getByText(/\$12,300 · Corrected/)).toBeVisible();
  const versions = page.getByRole('combobox', {
    name: 'Saved versions, newest first, Central Time',
  });
  for (const width of [1280, 900, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await versions.scrollIntoViewIfNeeded();
    await versions.click();
    const menu = page.getByRole('listbox');
    const bounds = await menu.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(19);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width - 19);
    await expect(menu.getByText('Shown', { exact: true })).toHaveCount(0);
    await page.screenshot({ path: resolve(output, `versions-${width}.png`) });
    await versions.press('Escape');
    await expect(menu).toHaveCount(0);
  }
  await page.setViewportSize({ width: 1280, height: 1000 });
  await versions.press('Enter');
  await versions.press('End');
  await page.screenshot({ path: resolve(output, 'versions-open.png') });
  await page.getByRole('option').last().click();
  await expect(page.getByText('An older approved copy', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: /Synthetic related order/ })).toHaveAttribute(
    'href',
    /related-file/,
  );
  await page.screenshot({ path: resolve(output, 'file-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 900, height: 1000 });
  await page.getByRole('region', { name: 'Page images' }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: resolve(output, 'file-tablet.png') });
  for (const width of [1280, 900, 390]) {
    await page.setViewportSize({ width, height: 1100 });
    await page
      .locator('.tv-file-lower')
      .evaluate((node) => node.scrollIntoView({ block: 'start' }));
    await page.screenshot({ path: resolve(output, `file-lower-${width}.png`) });
    await page
      .getByRole('heading', { name: 'Other files in this folder' })
      .scrollIntoViewIfNeeded();
    await page.screenshot({ path: resolve(output, `file-other-${width}.png`) });
  }
  await page.getByRole('link', { name: 'Open retained expense row' }).click();
  await expect(page.getByRole('heading', { name: 'Synthetic retained expense' })).toBeVisible();
  await expect(
    page.getByRole('link', { name: /Synthetic station invoice · page 1/ }),
  ).toHaveAttribute('href', new RegExp(`copy=${copy}`));
  expect(state.media.length).toBeGreaterThan(0);
  expect(state.media.every((x) => x.startsWith('Bearer '))).toBe(true);
});
test('withdrawn image removes previously shown copy metadata', async ({ page }) => {
  const state = await fixture(page);
  await page.goto('/money/ads/files/fixture-file');
  await expect(page.locator('.tv-viewer img')).toBeVisible();
  state.withdrawn = true;
  await page.getByRole('button', { name: 'Next page', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'This copy is no longer shown' })).toBeVisible();
  await expect(page.getByText('$12,345', { exact: true })).toHaveCount(0);
  await expect(page.locator('.tv-viewer img')).toHaveCount(0);
});
test('reviewer prepares and approves an exact synthetic copy', async ({ page }) => {
  const state = await fixture(page);
  await page.goto('/admin/political-ads');
  await page.getByRole('button', { name: 'Review Synthetic private invoice', exact: true }).click();
  await page.getByLabel('Safe file title', { exact: true }).fill('Synthetic safe invoice');
  await page.getByLabel('Safe folder label', { exact: true }).fill('Synthetic safe folder');
  await page.getByLabel('Category', { exact: true }).fill('State');
  await page.getByRole('button', { name: 'Text available', exact: true }).click();
  await page.getByLabel('Safe text for page 1', { exact: true }).fill('Safe invoice text');
  await page
    .getByLabel('Preparation notes and evidence', { exact: true })
    .fill('Synthetic privacy review');
  await page.getByRole('button', { name: 'Prepare safe copy', exact: true }).click();
  await expect(page.getByText('2. Inspect the prepared copy', { exact: true })).toBeVisible();
  await page
    .getByLabel('I inspected every prepared page and the private details have been removed', {
      exact: true,
    })
    .check();
  await page
    .getByLabel('I checked the title, folder label and category for private details', {
      exact: true,
    })
    .check();
  await page
    .getByLabel(
      'I inspected the text for every page and removed private details from searchable text',
      { exact: true },
    )
    .check();
  await page
    .getByLabel('Copy approval evidence', { exact: true })
    .fill('Synthetic exact copy approval');
  await page.screenshot({ path: resolve(output, 'admin-review.png'), fullPage: true });
  await page.getByRole('button', { name: 'Approve this exact copy', exact: true }).click();
  await expect(page.getByText('Review saved', { exact: true })).toBeVisible();
  expect(state.writes.map((x) => x.path)).toEqual(['/copies', `/copies/${copy}/approve`]);
  expect(state.writes[1].body).toMatchObject({
    expected_fingerprint: 'test-fingerprint',
    privacy_reviewed: true,
    metadata_reviewed: true,
    text_reviewed: true,
  });
});

test.describe('touch record controls', () => {
  test.use({ viewport: { width: 390, height: 900 }, hasTouch: true, isMobile: true });
  test('phone taps select a bottom menu row and open page text', async ({ page }) => {
    await fixture(page);
    await page.goto('/money/ads');
    await page.getByRole('combobox', { name: 'Category', exact: true }).tap();
    await page.getByRole('option', { name: 'Non-candidate issue ads', exact: true }).tap();
    await expect(page.getByRole('combobox', { name: 'Category', exact: true })).toHaveText(
      /Non-candidate issue ads/,
    );
    await page.goto('/money/ads/files/fixture-file');
    await expect(page.locator('.tv-viewer img')).toBeVisible();
    await page.getByRole('button', { name: 'Next page', exact: true }).tap();
    await page.getByRole('button', { name: 'Show text', exact: true }).tap();
    await expect(page.getByText('Synthetic machine text page 2', { exact: true })).toBeVisible();
    await page.getByRole('region', { name: 'Page images' }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: resolve(output, 'file-phone.png') });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
  });
});

test('related evidence opens the checked copy and a withdrawn copy stays unavailable', async ({
  page,
}) => {
  await fixture(page);
  await page.goto('/money/ads/files/fixture-file');
  const link = page.getByRole('link', { name: /Synthetic related order/ });
  await expect(link).toHaveAttribute(
    'href',
    `/money/ads/files/related-file?version=${oldHash}&copy=${copy}`,
  );
  await link.click();
  await expect(page.getByRole('heading', { name: 'This copy is no longer shown' })).toBeVisible();
  await expect(page.locator('.tv-viewer img')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Synthetic related order' })).toHaveCount(0);
});

for (const width of [390, 900, 1280]) {
  test(`approved printed-name copy ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await fixture(page);
    await page.route('**/api/v1/ads/agencies/printed-name', (r) =>
      json(r, {
        key: 'printed-name',
        name: 'SYNTHETIC & PRINTED NAME',
        payments_href: '/money/payments?name=SYNTHETIC%20%26%20PRINTED%20NAME&role=vendor',
        groups: [
          { station: 'KARE', year: '2026', files: [{ ...fileRow, agency_unchecked: true }] },
        ],
        addresses: [
          {
            address: '123 SYNTHETIC AVE',
            role: 'BILLING OFFICE',
            evidence: [
              {
                file_key: 'fixture-file',
                file_name: 'Synthetic invoice',
                page: 1,
                version_id: hash,
                copy_id: copy,
                uploaded_at: stamp,
                checked_at: stamp,
              },
            ],
          },
        ],
      }),
    );
    await page.goto('/money/ads/agencies/printed-name');
    await expect(
      page.getByText(
        'A name on a file is the spelling the station printed, and a matching name alone does not establish identity',
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Campaign payments with this exact printed name' }),
    ).toHaveAttribute('href', '/money/payments?name=SYNTHETIC%20%26%20PRINTED%20NAME&role=vendor');
    await expect(page.getByText('Role as printed: BILLING OFFICE')).toBeVisible();
    await page.screenshot({ path: resolve(output, `agency-copy-${width}.png`), fullPage: true });
    const addressLink = page
      .locator('.tv-address')
      .getByRole('link', { name: /Synthetic invoice/ });
    await addressLink.scrollIntoViewIfNeeded();
    await expect(addressLink).toHaveAttribute(
      'href',
      new RegExp(`version=${hash}.*copy=${copy}.*page=1`),
    );
    await page.screenshot({ path: resolve(output, `agency-address-${width}.png`) });
    await expect(addressLink).toHaveCSS('display', 'inline-flex');
    await expect(addressLink).toHaveCSS('min-height', '44px');
    await addressLink.focus();
    await page.screenshot({ path: resolve(output, `address-link-focus-${width}.png`) });
    await addressLink.blur();
    await addressLink.hover();
    await page.screenshot({ path: resolve(output, `address-link-hover-${width}.png`) });
    const agencyRow = page.locator('.tv-agency-file').first();
    await agencyRow.focus();
    await expect(agencyRow).toHaveCSS('outline-offset', '-2px');
    await expect(agencyRow).toHaveCSS('padding-left', '12px');
    await expect(agencyRow).toHaveCSS('padding-right', '12px');
    await page.screenshot({ path: resolve(output, `agency-row-focus-${width}.png`) });
    await agencyRow.blur();
    await agencyRow.hover();
    await page.screenshot({ path: resolve(output, `agency-row-hover-${width}.png`) });
    await expect(agencyRow.locator('.tv-small').first()).toHaveCSS('font-weight', '400');
    await page.route('**/api/v1/ads/files/printed-name', (r) =>
      json(r, {
        ...fileRow,
        key: 'printed-name',
        copy_status: 'approved',
        copy_id: copy,
        version_id: hash,
        page_count: 1,
        pages: [],
        versions: [
          { id: hash, status: 'approved', first_saved_at: stamp },
          { id: oldHash, status: 'approved', first_saved_at: stamp },
        ],
        facts: [
          {
            id: 'name',
            kind: 'Advertiser',
            status: 'checked',
            value: 'SYNTHETIC & PRINTED NAME',
            quote: 'Synthetic exact name',
            page: 1,
            checked_at: stamp,
          },
        ],
        dates: [],
        connections: [],
      }),
    );
    await page.goto('/money/ads/files/printed-name');
    await expect(
      page.getByRole('combobox', { name: 'Saved versions, newest first, Central Time' }),
    ).toHaveText(/1 other saved version/);
    const payments = page.getByRole('link', {
      name: 'Campaign payments with this exact printed name',
    });
    await payments.scrollIntoViewIfNeeded();
    await expect(payments).toHaveAttribute(
      'href',
      '/money/payments?name=SYNTHETIC+%26+PRINTED+NAME&role=vendor',
    );
    await expect(page.getByText('Advertiser, as printed', { exact: true })).toBeVisible();
    await expect(page.getByText('None to a Minnesota committee', { exact: true })).toBeVisible();
    await page.screenshot({ path: resolve(output, `file-copy-${width}.png`), fullPage: true });
  });
}

for (const width of [390, 900, 1280]) {
  test(`folder row targets and unnamed station category ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await fixture(page);
    await page.route('**/api/v1/ads/folders/fixture-folder', (r) =>
      json(r, {
        key: 'fixture-folder',
        station: 'KARE',
        year: '2026',
        category: 'State',
        label: 'Synthetic campaign folder',
        fcc_url: 'https://publicfiles.fcc.gov/tv-profile/kare',
        files: [
          { ...fileRow, version_id: hash, copy_id: copy, airing_periods: [], version_count: 2 },
        ],
      }),
    );
    await page.goto('/money/ads/folders/fixture-folder');
    await expect(page.getByText('1 file', { exact: true })).toBeVisible();
    const row = page.locator('.tv-folder-records tbody tr');
    await row.scrollIntoViewIfNeeded();
    await page.screenshot({ path: resolve(output, `folder-${width}.png`) });
    await row.getByRole('link').focus();
    await expect(row.getByRole('link')).toHaveCSS('outline-style', 'none');
    expect(
      await row.getByRole('link').evaluate((el) => getComputedStyle(el, '::after').outlineWidth),
    ).toBe('2px');
    await page.screenshot({ path: resolve(output, `folder-row-focus-${width}.png`) });
    await row.getByRole('link').blur();
    await row.hover();
    await page.screenshot({ path: resolve(output, `folder-row-hover-${width}.png`) });
    // The blank/right-hand part of a row opens the same record as its title.
    const box = (await row.boundingBox())!;
    await page.mouse.click(box.x + box.width - 8, box.y + box.height / 2);
    await expect(page.getByRole('heading', { name: fileRow.name, exact: true })).toBeVisible();
    await page.route('**/api/v1/ads/stations/kare', (r) =>
      json(r, {
        call_sign: 'KARE',
        facility_id: '23079',
        fcc_url: 'https://publicfiles.fcc.gov/tv-profile/kare',
        last_file_copy: stamp,
        folder_count: 4,
        folder_failures: 0,
        counts,
        years: [
          {
            year: '2026',
            file_count: 12,
            categories: [
              { name: '', count: 3 },
              { name: 'State', count: 1 },
            ],
          },
        ],
      }),
    );
    await page.goto('/money/ads/stations/kare');
    await expect(page.getByRole('heading', { name: 'KARE', exact: true })).toBeVisible();
    const unnamed = page.locator('[data-label="Not identified"]');
    await expect(unnamed).toHaveText(width < 768 ? 'Category not identified3 folders' : '3');
    await expect(unnamed.getByRole('link')).toHaveCount(0);
    await unnamed.scrollIntoViewIfNeeded();
    await page.screenshot({ path: resolve(output, `station-${width}.png`), fullPage: true });
    const yearLink = page.getByRole('link', { name: /2026/ });
    await expect(yearLink).toHaveAttribute('href', '/money/ads?tab=folders&station=KARE&year=2026');
    await yearLink.focus();
    if (width >= 768) {
      await expect(yearLink).toHaveCSS('outline-style', 'none');
      expect(await yearLink.evaluate((el) => getComputedStyle(el, '::after').outlineWidth)).toBe(
        '2px',
      );
    }
    await page.screenshot({ path: resolve(output, `station-row-focus-${width}.png`) });
    await yearLink.blur();
    await yearLink.hover();
    await page.screenshot({ path: resolve(output, `station-row-hover-${width}.png`) });
    await yearLink.click();
    await expect(page.getByRole('heading', { name: 'TV ad records', exact: true })).toBeVisible();
  });
}

for (const width of [390, 900, 1280]) {
  test(`folder failure retry and empty state ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await fixture(page);
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    let attempt = 0;
    await page.route('**/api/v1/ads/folders/state-folder', async (r) => {
      if (attempt++ === 0) {
        await pending;
        return json(r, { detail: 'Synthetic failure' }, 503);
      }
      return json(r, {
        key: 'state-folder',
        station: 'KARE',
        year: '2026',
        category: 'State',
        label: 'Synthetic empty folder',
        fcc_url: 'https://publicfiles.fcc.gov/tv-profile/kare',
        files: [],
      });
    });
    await page.goto('/money/ads/folders/state-folder');
    await expect(page.getByRole('status')).toHaveText('Loading this folder’s files');
    await page.screenshot({ path: resolve(output, `loading-${width}.png`) });
    release();
    await expect(page.getByRole('alert')).toContainText('We couldn’t load this folder right now');
    const retry = page.getByRole('button', { name: 'Try again', exact: true });
    await page.keyboard.press('Tab');
    await retry.focus();
    await expect(retry).toBeFocused();
    await page.screenshot({ path: resolve(output, `error-focus-${width}.png`) });
    await retry.hover();
    await page.screenshot({ path: resolve(output, `error-hover-${width}.png`) });
    await page.keyboard.press('Enter');
    await expect(page.getByText('No files to show in this folder', { exact: true })).toBeVisible();
    await expect(page.getByText('0 files', { exact: true })).toHaveCount(0);
    await page.screenshot({ path: resolve(output, `empty-${width}.png`) });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
  });
}

for (const [surface, data, expected] of [
  [
    'agencies',
    { name: 'Synthetic agency', groups: [], addresses: [] },
    'No address has been checked yet',
  ],
  [
    'stations',
    {
      call_sign: 'KARE',
      facility_id: '23079',
      fcc_url: 'https://publicfiles.fcc.gov/tv-profile/kare',
      counts: Object.fromEntries(Object.keys(counts).map((key) => [key, 0])),
      folder_count: 0,
      folder_failures: 0,
      years: [],
    },
    'Years and categories held',
  ],
  [
    'files',
    {
      ...fileRow,
      copy_status: 'not_ready',
      version_id: hash,
      copy_id: copy,
      versions: [],
      pages: [],
      facts: [],
      dates: [],
      connections: [],
      related: [],
      other_files: [],
    },
    'We hold this file; its approved copy is not ready',
  ],
] as const) {
  for (const width of [390, 900, 1280]) {
    test(`${surface} loading error recovery ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1100 });
      await fixture(page);
      let release!: () => void;
      const pending = new Promise<void>((resolve) => {
        release = resolve;
      });
      let attempt = 0;
      await page.route(`**/api/v1/ads/${surface}/state-record`, async (route) => {
        if (attempt++ === 0) {
          await pending;
          return json(route, { detail: 'Synthetic failure' }, 503);
        }
        return json(route, data);
      });
      await page.goto(`/money/ads/${surface}/state-record`);
      await expect(
        page.getByRole('heading', {
          name:
            surface === 'agencies'
              ? 'Printed agency name'
              : surface === 'stations'
                ? 'Station'
                : 'Station file',
          exact: true,
        }),
      ).toBeVisible();
      await expect(page.locator('.tv-loading')).toBeVisible();
      await page.screenshot({ path: resolve(output, `${surface}-loading-${width}.png`) });
      release();
      await expect(page.getByRole('alert')).toBeVisible();
      if (surface !== 'agencies') {
        await expect(page.getByRole('alert')).toContainText(
          `We couldn’t load this ${surface === 'stations' ? 'station' : 'file'} right now`,
        );
        await expect(page.getByRole('alert')).toContainText('This is a problem on our side');
      }
      await page.screenshot({ path: resolve(output, `${surface}-error-${width}.png`) });
      await page.getByRole('button', { name: 'Try again', exact: true }).click();
      await expect(page.getByText(expected, { exact: true })).toBeVisible();
      if (surface === 'stations')
        await expect(
          page.getByText('No folders held for this station', { exact: true }),
        ).toBeVisible();
      if (surface === 'agencies')
        await expect(
          page.getByText('No files to show for this name', { exact: true }),
        ).toBeVisible();
      await page.screenshot({ path: resolve(output, `${surface}-empty-${width}.png`) });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBe(true);
    });
  }
}

test('TV navigation reuses the loaded app and restores all-years browsing', async ({ page }) => {
  await fixture(page);
  const documents: string[] = [];
  const browseReads: string[] = [];
  let accessReads = 0;
  page.on('request', (r) => {
    if (r.resourceType() === 'document') documents.push(r.url());
    if (new URL(r.url()).pathname === '/api/v1/ads/browse') browseReads.push(r.url());
    if (new URL(r.url()).pathname === '/api/v1/ads/access') accessReads += 1;
  });
  await page.goto('/money/ads');
  await expect(page.getByText('Synthetic campaign folder 1', { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/year=2026/);
  expect(browseReads).toHaveLength(1);
  expect(new URL(browseReads[0]).searchParams.get('default_year')).toBe('true');
  await page.getByRole('combobox', { name: 'Folder year', exact: true }).click();
  await page.getByRole('option', { name: 'All years', exact: true }).click();
  await expect(page).toHaveURL(/year=all/);
  const before = accessReads;
  await page
    .getByRole('link', { name: /Synthetic station invoice/ })
    .first()
    .click();
  await expect(page.getByRole('heading', { name: fileRow.name, exact: true })).toBeVisible();
  await expect.poll(() => accessReads).toBeGreaterThan(before);
  expect(documents).toHaveLength(1);
  await page.getByRole('link', { name: 'Back to TV ad records', exact: true }).click();
  await expect(page.getByText('Synthetic campaign folder 1', { exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Folder year', exact: true })).toHaveText(
    'All years',
  );
  expect(new URL(browseReads.at(-1)!).searchParams.has('default_year')).toBe(false);
  expect(documents).toHaveLength(1);
  await page.goBack();
  await expect(page.getByRole('heading', { name: fileRow.name, exact: true })).toBeVisible();
  expect(documents).toHaveLength(1);
});

test('a revoked administrator cannot enter another TV record through app navigation', async ({
  page,
}) => {
  const state = await fixture(page);
  await page.goto('/money/ads?year=all');
  await expect(page.getByText('Synthetic campaign folder 1', { exact: true })).toBeVisible();
  state.allowed = false;
  await page
    .getByRole('link', { name: /Synthetic station invoice/ })
    .first()
    .click();
  await expect(page.getByRole('heading', { name: 'We couldn’t find that page' })).toBeVisible();
  await expect(page.getByRole('heading', { name: fileRow.name, exact: true })).toHaveCount(0);
});
