import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearReadCache } from '../api/read';
import { MediaBuys } from '../pages/MediaBuys';
import { StationFile } from '../pages/StationFile';
import { PrintedAgency, StationFolder } from '../pages/StationRecords';
import { matchRoute } from '../routes';
import { navigate } from '../router';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock('../auth/session', () => ({
  useFinanceSession: () => ({ apiBaseUrl: 'https://api.example.test', accessToken: 'test-token' }),
}));
let container: HTMLDivElement;
let root: Root;
const VERSION = 'a'.repeat(64),
  OLD = 'b'.repeat(64);
const FILE = {
  key: 'held-file',
  name: 'invoice.pdf',
  label: 'invoice.pdf',
  station: 'KARE',
  year: 2026,
  category: 'State',
  uploaded_at: null,
  version_id: VERSION,
  version_count: 2,
  source_changed: false,
};
const DETAIL = {
  ...FILE,
  agencies: [],
  folder: { key: 'folder', label: 'Campaign folder' },
  fcc_url: 'https://publicfiles.fcc.gov',
  fcc_available: true,
  versions: [
    { id: VERSION, first_saved_at: '2026-10-01', uploaded_at: null },
    { id: OLD, first_saved_at: '2026-09-01', uploaded_at: null },
  ],
  page_count: 1,
  pages: [{ number: 1, text: 'Invoice for $500', text_status: 'read', image: '' }],
  facts: [
    {
      id: 'fact',
      kind: 'gross_amount',
      status: 'checked',
      version_id: VERSION,
      value: '500',
      qualifier: 'Gross',
      quote: 'Invoice for $500',
      page: 1,
      checked_at: '2026-10-02',
      history: [],
    },
  ],
  dates: [],
  connections: [],
  current_source_version: VERSION,
};
function json(data: unknown, status = 200) {
  return new Response(JSON.stringify({ data }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
beforeEach(() => {
  clearReadCache();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  window.scrollTo = vi.fn();
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
async function render(path: string, node: () => React.ReactNode) {
  await act(async () => {
    navigate(path);
    root.render(node());
  });
}
async function click(text: string) {
  const el = [...container.querySelectorAll('button')].find((e) => e.textContent?.includes(text));
  expect(el).toBeTruthy();
  await act(async () => el!.click());
}
describe('Media buys reads', () => {
  it('uses the private browse route, keeps exact agency spellings and names the count as a floor', async () => {
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      expect(init?.headers).toEqual({ Authorization: 'Bearer test-token' });
      return url.includes('/sources')
        ? json({ stations: [] })
        : json({
            tab: 'agencies',
            page: 1,
            page_size: 12,
            total: 500,
            capped: true,
            years: [2026],
            categories: [],
            rows: [
              {
                key: 'opaque-key',
                label: 'EXAMPLE AGENCY LLC',
                file_count: 2,
                unchecked: true,
                stations: ['KARE'],
              },
            ],
          });
    });
    vi.stubGlobal('fetch', fetcher);
    await render('/media-buys?tab=agencies', () => <MediaBuys />);
    expect(container.textContent).toContain('At least 500 agency names');
    expect(container.textContent).toContain('Not checked');
    expect(container.querySelector('a[href*="/agencies/"]')?.getAttribute('href')).toContain(
      '/media-buys/agencies/opaque-key',
    );
    expect(fetcher.mock.calls.some(([url]) => url.includes('tab=agencies'))).toBe(true);
  });
  it('retains earlier rows after a failed filter change without calling them empty', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.includes('/sources')
          ? json({ stations: [{ call_sign: 'KARE' }] })
          : url.includes('station=KARE')
            ? json(null, 503)
            : json({
                tab: 'folders',
                page: 1,
                page_size: 12,
                total: 1,
                capped: false,
                years: [2026],
                categories: [],
                rows: [{ key: 'folder', label: 'Held folder', file_count: 2 }],
              }),
      ),
    );
    await render('/media-buys', () => <MediaBuys />);
    await click('Station:');
    await click('KARE');
    expect(container.textContent).toContain('Held folder');
    expect(container.textContent).toContain('Previous results are shown');
    expect(container.textContent).not.toContain('No station files match');
  });
  it('makes an unavailable folder a missing record, never a list of zero files', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.includes('/sources') ? json({ stations: [] }) : json(null, 404),
      ),
    );
    await render('/media-buys/folders/missing', () => (
      <StationFolder match={matchRoute('/media-buys/folders/missing')!} />
    ));
    expect(container.textContent).toContain('This record is no longer available');
    expect(container.textContent).not.toContain('No files to show');
  });
  it('keeps the exact source version on a private image and clears facts when versions change', async () => {
    const fetcher = vi.fn(async (url: string) =>
      url.includes('/sources')
        ? json({ stations: [] })
        : url.includes('/pages/')
          ? json(null, 503)
          : url.includes(`version=${OLD}`)
            ? json({ ...DETAIL, version_id: OLD, facts: [] })
            : json(DETAIL),
    );
    vi.stubGlobal('fetch', fetcher);
    await render('/media-buys/files/held-file', () => (
      <StationFile match={matchRoute('/media-buys/files/held-file')!} />
    ));
    expect(container.textContent).toContain('Gross');
    expect(container.textContent).toContain('We couldn’t load this page image');
    expect(fetcher.mock.calls.some(([url]) => url.includes(`/pages/1?version=${VERSION}`))).toBe(
      true,
    );
    await click('Saved versions:');
    await click('Sep 1');
    expect(container.textContent).toContain('No checked facts for this version');
    expect(container.textContent).not.toContain('Gross');
    expect(fetcher.mock.calls.some(([url]) => url.includes(`/pages/1?version=${OLD}`))).toBe(true);
  });
  it('opens agency evidence at the quoted page and version, with payments kept in separate searches', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.includes('/sources')
          ? json({ stations: [] })
          : json({
              name: 'Exact Agency',
              key: 'agency',
              groups: [],
              addresses: [
                {
                  address: '100 Main',
                  evidence: [
                    {
                      file_key: 'held-file',
                      file_name: 'invoice.pdf',
                      version_id: OLD,
                      page: 4,
                      checked_at: '2026-10-01',
                    },
                  ],
                },
              ],
            }),
      ),
    );
    await render('/media-buys/agencies/agency', () => (
      <PrintedAgency match={matchRoute('/media-buys/agencies/agency')!} />
    ));
    const link = container.querySelector('a[href*="/files/"]')?.getAttribute('href');
    expect(link).toContain(`version=${OLD}`);
    expect(link).toContain('page=4');
    expect(container.querySelector('a[href*="section=campaign-payments"]')).toBeTruthy();
    expect(container.querySelector('a[href*="section=outside-payments"]')).toBeTruthy();
  });
});
