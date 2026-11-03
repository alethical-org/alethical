import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearReadCache } from '../api/read';
import { MediaBuys, browseRow } from '../pages/MediaBuys';
import { StationFile } from '../pages/StationFile';
import { PrintedAgency, StationFolder, TVStation } from '../pages/StationRecords';
import { copiedLines, day, savedAt } from '../pages/media/shared';
import { markQuote } from '../pages/media/evidence';
import * as routes from '../routes';
import { matchRoute } from '../routes';
import { navigate } from '../router';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock('../auth/session', () => ({
  useFinanceSession: () => ({ apiBaseUrl: 'https://api.example.test', accessToken: 'test-token' }),
}));

let container: HTMLDivElement;
let root: Root;
const VERSION = 'a'.repeat(64);
const OLD = 'b'.repeat(64);
const KEY = 'kare-1234';
const STATIONS = [
  {
    call_sign: 'KSTP-TV',
    facility_id: '1',
    fcc_url: 'https://publicfiles.fcc.gov/a',
    newest_upload: '2026-04-15',
    last_list_check: '2026-10-22',
    last_file_copy: '2026-10-22',
  },
  {
    call_sign: 'KARE',
    facility_id: '2',
    fcc_url: 'https://publicfiles.fcc.gov/b',
    newest_upload: '2026-03-11',
    last_list_check: '2026-10-22',
    last_file_copy: '2026-10-22',
  },
];
const FILE = {
  key: KEY,
  name: 'invoice.pdf',
  label: 'invoice.pdf',
  folder_label: 'Political File / 2026 / Local / Example Committee',
  station: 'KARE',
  year: 2026,
  category: 'Local',
  uploaded_at: null,
  version_id: VERSION,
  version_count: 2,
  source_changed: false,
};
const DETAIL = {
  ...FILE,
  agencies: [],
  folder: { key: 'kare-folder', label: 'Political File / 2026 / Local / Example Committee' },
  fcc_url: 'https://publicfiles.fcc.gov',
  fcc_available: true,
  versions: [
    { id: VERSION, first_saved_at: '2026-03-05T15:14:00Z', uploaded_at: null },
    { id: OLD, first_saved_at: '2026-03-04T22:40:00Z', uploaded_at: null },
  ],
  page_count: 2,
  pages: [
    { number: 1, text: 'BILL TO: EXAMPLE MEDIA', text_status: 'ready' },
    { number: 2, text: 'GROSS TOTAL $500.00', text_status: 'ready' },
  ],
  facts: [
    {
      id: 'fact-1',
      kind: 'Gross amount',
      status: 'checked',
      version_id: VERSION,
      value: '$500.00',
      quote: 'GROSS TOTAL $500.00',
      page: 2,
      checked_at: '2026-10-02',
      history: [],
    },
    {
      id: 'fact-2',
      kind: 'Bill to',
      status: 'checked',
      version_id: VERSION,
      value: 'EXAMPLE MEDIA BUYING',
      quote: 'BILL TO: EXAMPLE MEDIA BUYING',
      page: 1,
      checked_at: '2026-10-02',
      history: [],
    },
  ],
  dates: [],
  connections: [
    {
      id: 'conn-1',
      kind: 'committee',
      status: 'checked',
      version_id: VERSION,
      target: { kind: 'committee', id: '90001' },
      label: 'Example Committee',
      role: 'Advertiser',
      quote: 'BILL TO: EXAMPLE MEDIA',
      page: 1,
      checked_at: '2026-10-03',
    },
  ],
  current_source_version: VERSION,
};

function json(data: unknown, status = 200) {
  return new Response(status === 200 ? JSON.stringify({ data }) : '{}', {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
function serve(answer: (url: URL) => Response) {
  const fetcher = vi.fn(async (input: string) => {
    const url = new URL(input);
    if (url.pathname.endsWith('/pages/1') || url.pathname.endsWith('/pages/2'))
      return new Response(new Blob(['x'], { type: 'image/png' }), {
        headers: { 'content-type': 'image/png' },
      });
    if (url.pathname.endsWith('/sources'))
      return json({ stations: STATIONS, text_reader_version: 'x' });
    return answer(url);
  });
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
}
async function flush() {
  for (let i = 0; i < 6; i += 1)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
}
async function render(path: string, node: () => React.ReactNode) {
  await act(async () => {
    navigate(path);
    root.render(node());
  });
  await flush();
}
const text = () => (container.textContent ?? '').replace(/\u00a0/g, ' ');
async function click(text: string) {
  const element = [...container.querySelectorAll<HTMLElement>('button, a')].find((e) =>
    e.textContent?.includes(text),
  );
  expect(element, text).toBeTruthy();
  await act(async () => element!.click());
  await flush();
}

beforeEach(() => {
  clearReadCache();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  window.scrollTo = vi.fn();
  URL.createObjectURL = vi.fn(() => 'blob:page');
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Media buys', () => {
  it('reads the private browse route and prints each tab’s rows as the drawing does', async () => {
    const fetcher = serve(() =>
      json({
        tab: 'agencies',
        q: '',
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
            stations: ['KARE', 'KSTP-TV'],
          },
        ],
      }),
    );
    await render('/media-buys?tab=agencies', () => <MediaBuys />);
    const text = container.textContent ?? '';
    expect(text).toContain('At least 500 agency names');
    expect(text).toContain('Names as printed, with each spelling listed separately');
    expect(text).toContain('KARE, KSTP-TV');
    expect(text).toContain('Not checked');
    expect(text).toContain('2 files');
    expect(text).toContain('Machine-read names are marked Not checked');
    expect(text).toContain('About these records');
    expect(text).toContain('TV station files copied Oct 22, 2026');
    expect(
      container.querySelector('a[href^="/media-buys/agencies/opaque-key?from="]'),
    ).toBeTruthy();
    const browse = fetcher.mock.calls
      .map(([url]) => String(url))
      .find((url) => url.includes('/browse'));
    expect(browse).toContain('tab=agencies');
    expect(browse).not.toContain('station=');
  });

  it('shows the checking entrance only once its page is built', async () => {
    serve(() =>
      json({
        tab: 'folders',
        q: '',
        page: 1,
        page_size: 12,
        total: 0,
        capped: false,
        years: [],
        categories: [],
        rows: [],
      }),
    );
    await render('/media-buys', () => <MediaBuys />);
    expect(container.textContent).not.toContain('Check TV station files');
    expect(container.textContent).toContain('No TV station files match this search');
    act(() => root.unmount());
    root = createRoot(container);
    vi.spyOn(routes, 'isBuilt').mockReturnValue(true);
    await render('/media-buys', () => <MediaBuys />);
    expect(
      container.querySelector('a[href^="/media-buys/check"]')?.textContent?.replace(/\u00a0/g, ' '),
    ).toContain('Check TV station files');
  });

  it('keeps earlier rows after a failed filter change and never calls them empty', async () => {
    serve((url) =>
      url.searchParams.get('station') === 'KARE'
        ? json(null, 503)
        : json({
            tab: 'folders',
            q: '',
            page: 1,
            page_size: 12,
            total: 1,
            capped: false,
            years: [2026],
            categories: [],
            rows: [
              {
                key: 'kare-f',
                label: 'Political File / 2026 / Held folder',
                file_count: 2,
                station: 'KARE',
                year: 2026,
                category: 'Local',
              },
            ],
          }),
    );
    await render('/media-buys', () => <MediaBuys />);
    expect(container.textContent).toContain('Held folder');
    expect(container.textContent).toContain('KARE · 2026 · Local');
    await click('Station:');
    await click('KARE');
    expect(container.textContent).toContain('Held folder');
    expect(container.textContent).toContain('Previous results are shown');
    expect(container.textContent).toContain('Try again');
    expect(container.textContent).not.toContain('No TV station files match');
  });

  it('opens a search result at its exact version', () => {
    expect(browseRow('folders', { ...FILE, match_label: 'Matched the file name' }).href).toBe(
      `/media-buys/files/${KEY}?version=${VERSION}`,
    );
    expect(
      browseRow('years', {
        key: '2024',
        label: '2024',
        year: 2024,
        file_count: 3,
        folder_count: 1,
      }),
    ).toMatchObject({
      note: '1 TV station folder',
      end: '3 files',
      href: '/media-buys?year=2024',
    });
    expect(
      browseRow('stations', { key: 'kare', label: 'KARE', file_count: 1, folder_count: 2 }),
    ).toMatchObject({
      mid: '2 folders',
      end: '1 file',
      href: '/media-buys/stations/kare',
    });
  });

  it('names each station’s copy date only when the dates differ', () => {
    expect(copiedLines(STATIONS)).toEqual(['TV station files copied Oct 22, 2026']);
    expect(copiedLines([STATIONS[0], { ...STATIONS[1], last_file_copy: '2026-10-20' }])).toEqual([
      'KSTP-TV: TV station files copied Oct 22, 2026',
      'KARE: TV station files copied Oct 20, 2026',
    ]);
  });
});

describe('TV station folder, station and printed agency name', () => {
  it('says a missing folder is no longer available, never a list of zero files', async () => {
    serve(() => json(null, 404));
    await render('/media-buys/folders/missing', () => (
      <StationFolder match={matchRoute('/media-buys/folders/missing')!} />
    ));
    expect(container.textContent).toContain('This folder is no longer available');
    expect(container.textContent).not.toContain('No files to show');
  });

  it('lists a folder’s files at their exact versions with its one checked connection', async () => {
    serve(() =>
      json({
        key: 'kare-folder',
        label: 'Political File / 2026 / Local / Example Committee',
        station: 'KARE',
        year: 2026,
        category: 'Local',
        fcc_url: 'https://publicfiles.fcc.gov',
        relationship: { ...DETAIL.connections[0], target: { kind: 'committee', id: '90001' } },
        files: [FILE],
      }),
    );
    await render('/media-buys/folders/kare-folder', () => (
      <StationFolder match={matchRoute('/media-buys/folders/kare-folder')!} />
    ));
    const text = container.textContent ?? '';
    expect(text).toContain('TV STATION FOLDER');
    expect(text).toContain('1 file held');
    expect(text).toContain('2 saved versions');
    expect(text).toContain('Unavailable');
    expect(text).toContain('Folder checked as relating to this committee · Checked on Oct 3, 2026');
    expect(text).toContain(
      'Folder listing read from the FCC public inspection file on Oct 22, 2026',
    );
    expect(
      container.querySelector(`a[href^="/media-buys/files/${KEY}?version=${VERSION}&from="]`),
    ).toBeTruthy();
    expect(container.querySelector('a[href^="/media-buys/stations/KARE"]')).toBeTruthy();
  });

  it('shows a failed folder with Try again, not a missing one', async () => {
    serve(() => json(null, 500));
    await render('/media-buys/folders/kare-folder', () => (
      <StationFolder match={matchRoute('/media-buys/folders/kare-folder')!} />
    ));
    expect(container.textContent).toContain(
      'We couldn’t load this folder. This is a problem on our side.',
    );
    expect(container.textContent).toContain('Try again');
    expect(container.textContent).not.toContain('no longer available');
  });

  it('prints a station’s years with a link to that year’s folders', async () => {
    serve(() =>
      json({
        ...STATIONS[1],
        counts: {
          station_files_held: 3,
          unique_file_contents: 3,
          text_read_failures: 0,
          download_failures: 0,
          checked_connection_files: 0,
        },
        folder_count: 2,
        folder_failures: 0,
        years: [
          { year: 2026, categories: [], file_count: 3 },
          { year: 2024, categories: [], file_count: 0 },
        ],
      }),
    );
    await render('/media-buys/stations/KARE', () => (
      <TVStation match={matchRoute('/media-buys/stations/KARE')!} />
    ));
    const text = container.textContent ?? '';
    expect(text).toContain('Records held, by year');
    expect(text).toContain('TV station files held3');
    expect(text).toContain('None held');
    expect(text).toContain('Other stations held');
    expect(text).toContain('Latest station upload held');
    expect(
      container.querySelector('a[href^="/media-buys?station=KARE&year=2026&from="]'),
    ).toBeTruthy();
    expect(container.querySelector('a[href^="/media-buys/stations/KSTP-TV?from="]')).toBeTruthy();
  });

  it('opens agency address evidence at its quoted page and version, with both payment searches', async () => {
    vi.spyOn(routes, 'isBuilt').mockImplementation((name) => name === 'payments-under-name');
    serve(() =>
      json({
        name: 'Exact Agency',
        key: 'agency',
        unchecked: true,
        groups: [{ station: 'KARE', year: 2026, files: [{ ...FILE, agency_unchecked: true }] }],
        addresses: [
          {
            address: '100 Main',
            evidence: [
              {
                file_key: KEY,
                file_name: 'invoice.pdf',
                version_id: OLD,
                page: 4,
                checked_at: '2026-10-01',
              },
            ],
          },
        ],
      }),
    );
    await render('/media-buys/agencies/agency', () => (
      <PrintedAgency match={matchRoute('/media-buys/agencies/agency')!} />
    ));
    const text = container.textContent ?? '';
    expect(text).toContain('1 file · KARE');
    expect(text).toContain('Machine-read · Not checked');
    expect(text).toContain('Checked on Oct 1, 2026');
    expect(text).toContain('A payment under this name does not prove the file was paid');
    const evidence = [...container.querySelectorAll('a')].find((a) =>
      a.textContent?.replace(/\u00a0/g, ' ').includes('View evidence'),
    );
    expect(evidence?.getAttribute('href')).toBe(`/media-buys/files/${KEY}?version=${OLD}&page=4`);
    expect(container.querySelector('a[href="/money/names/Exact%20Agency"]')).toBeTruthy();
    expect(
      container.querySelector('a[href="/money/names/Exact%20Agency#outside-payments"]'),
    ).toBeTruthy();
  });

  it('says so when no address is checked for a spelling', async () => {
    serve(() =>
      json({ name: 'Exact Agency', key: 'agency', unchecked: false, groups: [], addresses: [] }),
    );
    await render('/media-buys/agencies/agency', () => (
      <PrintedAgency match={matchRoute('/media-buys/agencies/agency')!} />
    ));
    expect(container.textContent).toContain('No address has been checked for this spelling');
    expect(container.textContent).toContain('Payment records');
  });
});

describe('TV station file', () => {
  it('shows the version’s checks, writes the page to the address and marks the quote in evidence', async () => {
    vi.spyOn(routes, 'isBuilt').mockReturnValue(true);
    const fetcher = serve((url) =>
      url.searchParams.get('version') === OLD
        ? json({ ...DETAIL, version_id: OLD, facts: [], connections: [] })
        : json(DETAIL),
    );
    await render(`/media-buys/files/${KEY}`, () => (
      <StationFile match={matchRoute(`/media-buys/files/${KEY}`)!} />
    ));
    const text = container.textContent ?? '';
    expect(text).toContain('TV STATION FILE');
    expect(text).toContain('2026 · Local · Example Committee');
    expect(text).toContain('Upload date unavailable');
    expect(text).toContain('Gross amount');
    expect(text).toContain('Checked on Oct 2, 2026 · Page 2');
    expect(text).toContain(
      'Checked as committee · Advertiser · this version · Checked on Oct 3, 2026',
    );
    expect(text).toContain(`For the version first saved ${savedAt('2026-03-05T15:14:00Z')}`);
    expect(container.querySelector('a#check-link')?.getAttribute('href')).toContain(
      `/media-buys/check?file=${KEY}&version=${VERSION}&from=`,
    );
    expect(
      fetcher.mock.calls.some(([url]) => String(url).includes(`/pages/1?version=${VERSION}`)),
    ).toBe(true);

    await act(async () => {
      const opener = container.querySelector('#vf-fact-1') as HTMLButtonElement;
      opener.focus();
      opener.click();
    });
    await flush();
    expect(window.location.search).toContain('page=2');
    const panel = document.querySelector('[role="dialog"]')!;
    expect(panel.textContent).toContain('Gross amount: $500.00');
    expect(panel.textContent).toContain('KARE public inspection file');
    expect(panel.querySelector('mark')?.textContent).toBe('GROSS TOTAL $500.00');
    expect(
      panel.querySelector(`a[href*="check=fact-1"][href*="action=correct"]`)?.textContent,
    ).toBe('Correct fact');
    expect(panel.querySelector(`a[href*="action=withdraw"]`)?.textContent).toBe('Withdraw check');
    await act(async () =>
      (panel.querySelector('[aria-label="Close source evidence"]') as HTMLButtonElement).click(),
    );
    await flush();
    expect(window.location.search).toContain('page=2');
    expect(document.activeElement?.id).toBe('vf-fact-1');

    await click('Saved versions:');
    await click('Earlier contents');
    expect(window.location.search).toContain(`version=${OLD}`);
    expect(container.textContent).toContain('No checked facts for this version');
    expect(container.querySelector('a#check-link')).toBeNull();
  });

  it('warns when a checked quote is not on its page and when the page has no text', async () => {
    serve(() =>
      json({
        ...DETAIL,
        pages: [
          { number: 1, text: 'BILL TO: EXAMPLE MEDIA', text_status: 'ready' },
          { number: 2, text: null, text_status: 'pending' },
        ],
      }),
    );
    await render(`/media-buys/files/${KEY}`, () => (
      <StationFile match={matchRoute(`/media-buys/files/${KEY}`)!} />
    ));
    await act(async () => (container.querySelector('#vf-fact-2') as HTMLButtonElement).click());
    await flush();
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      'The checked quote isn’t found exactly in this page’s machine-read text',
    );
    await act(async () =>
      (document.querySelector('[aria-label="Close source evidence"]') as HTMLButtonElement).click(),
    );
    await act(async () => (container.querySelector('#vf-fact-1') as HTMLButtonElement).click());
    await flush();
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      'Machine-read text is not available for this page',
    );
    // With Check TV station files on, the panel's actions open it at this check.
    for (const link of document.querySelectorAll('[role="dialog"] a')) {
      expect(link.getAttribute('href')).toMatch(/^\/media-buys\/check\?/);
    }
  });

  it('never opens another version for a link naming one that is not held', async () => {
    serve((url) => (url.searchParams.get('version') ? json(null, 404) : json(DETAIL)));
    const missing = 'c'.repeat(64);
    await render(`/media-buys/files/${KEY}?version=${missing}`, () => (
      <StationFile match={matchRoute(`/media-buys/files/${KEY}`)!} />
    ));
    const text = container.textContent ?? '';
    expect(text).toContain('This version is not held');
    expect(text).not.toContain('Checked facts');
    expect(text).not.toContain('Check this file');
    expect(
      [...container.querySelectorAll('a')]
        .find((a) => a.textContent?.replace(/\u00a0/g, ' ').includes('Open the current version'))
        ?.getAttribute('href'),
    ).toBe(`/media-buys/files/${KEY}?version=${VERSION}`);
  });

  it('says a missing file is no longer available', async () => {
    serve(() => json(null, 404));
    await render(`/media-buys/files/${KEY}`, () => (
      <StationFile match={matchRoute(`/media-buys/files/${KEY}`)!} />
    ));
    expect(container.textContent).toContain('This file is no longer available');
  });

  it('marks a quote only where it appears exactly', () => {
    expect(markQuote('A GROSS 1', 'GROSS')).toEqual({ before: 'A ', mark: 'GROSS', after: ' 1' });
    expect(markQuote('A GR0SS 1', 'GROSS')).toBeNull();
  });
});

describe('Media buys card', () => {
  /** The connections answer as the server builds it (`connected` in
   * alethical/api/services/tv_ads.py): every row once in `files` without a role,
   * and again in its group with the role line. */
  function connected(groups: { label: string; files: Record<string, unknown>[] }[]) {
    const files = groups.flatMap((group) => group.files.map(({ role: _role, ...row }) => row));
    return { agency_key: null, exact_name_count: 0, files, total: files.length, groups };
  }
  const INVOICE = {
    ...FILE,
    kind: 'Invoice',
    uploaded_at: '2026-03-04',
    role: 'Advertiser, as printed',
  };

  it('lists each connected file once, at its exact version, with a way back', async () => {
    const { MediaBuysCard } = await import('../pages/media/MediaBuysCard');
    vi.spyOn(routes, 'isBuilt').mockReturnValue(true);
    const fetcher = serve(() => json(connected([{ label: '', files: [INVOICE] }])));
    await render('/money/committees/90001?year=2026', () => (
      <MediaBuysCard kind="committee" target="90001" name="Example Committee" />
    ));
    expect(text()).toContain('KSTP-TV, KARE and KMSP-TV station files, not in money totals');
    expect(text()).toContain('KARE invoice ·Mar 4, 2026');
    expect(text()).toContain('Advertiser, as printed');
    const links = container.querySelectorAll('.mb-buys-card a');
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute('href')).toBe(
      `/media-buys/files/${KEY}?version=${VERSION}&from=%2Fmoney%2Fcommittees%2F90001%3Fyear%3D2026`,
    );
    expect(container.querySelector('.mb-buys-card h3')).toBeNull();
    const asked = fetcher.mock.calls.map(([url]) => new URL(String(url)));
    const read = asked.find((url) => url.pathname.endsWith('/finance/media-buys/connections'));
    expect(read?.searchParams.get('kind')).toBe('committee');
    expect(read?.searchParams.get('target')).toBe('90001');
  });

  it('says no file is connected, by the record’s name', async () => {
    const { MediaBuysCard } = await import('../pages/media/MediaBuysCard');
    vi.spyOn(routes, 'isBuilt').mockReturnValue(true);
    serve(() => json(connected([])));
    await render('/money/committees/1', () => (
      <MediaBuysCard kind="committee" target="1" name="Example Committee" />
    ));
    expect(text()).toContain('No TV station files have a checked connection to Example Committee');
    expect(container.querySelector('.mb-buys-card ul')).toBeNull();
  });

  it('says the files could not be loaded, with Try again, never an empty card', async () => {
    const { MediaBuysCard } = await import('../pages/media/MediaBuysCard');
    vi.spyOn(routes, 'isBuilt').mockReturnValue(true);
    let fail = true;
    const fetcher = serve(() =>
      fail ? json(null, 500) : json(connected([{ label: '', files: [INVOICE] }])),
    );
    await render('/money/committees/90001', () => (
      <MediaBuysCard kind="committee" target="90001" name="X" />
    ));
    expect(text()).toContain('We couldn’t load these TV station files');
    expect(text()).not.toContain('problem on our side');
    expect(text()).not.toContain('No TV station files have a checked connection');
    fail = false;
    const before = fetcher.mock.calls.length;
    await click('Try again');
    expect(fetcher.mock.calls.length).toBeGreaterThan(before);
    expect(text()).toContain('KARE invoice');
    expect(text()).not.toContain('We couldn’t load these TV station files');
  });

  it('treats an answer without its lists as a failed read', async () => {
    const { MediaBuysCard } = await import('../pages/media/MediaBuysCard');
    vi.spyOn(routes, 'isBuilt').mockReturnValue(true);
    serve(() => json({}));
    await render('/money/committees/90001', () => (
      <MediaBuysCard kind="committee" target="90001" name="X" />
    ));
    expect(text()).toContain('We couldn’t load these TV station files');
    expect(text()).not.toContain('No TV station files have a checked connection');
  });

  it('lists a candidacy’s committee files first, then the files that name the candidate', async () => {
    const { MediaBuysCard, NAMED_TITLE } = await import('../pages/media/MediaBuysCard');
    vi.spyOn(routes, 'isBuilt').mockReturnValue(true);
    const ORDER = { ...FILE, key: 'kstp-9', kind: 'Order', uploaded_at: '2026-04-09' };
    // Served in the other order, to show the card keeps the committee group first.
    serve(() =>
      json(
        connected([
          {
            label: 'Station files that name this candidate',
            files: [{ ...ORDER, role: 'Named on page 1' }],
          },
          {
            label: 'Files with a checked connection to Example Candidate Committee',
            files: [INVOICE],
          },
        ]),
      ),
    );
    await render('/candidates/abc', () => (
      <MediaBuysCard kind="candidate" target="abc" name="Morgan Example" />
    ));
    const titles = [...container.querySelectorAll('.mb-buys-card h3')].map((h) => h.textContent);
    expect(titles).toEqual([
      'Files with a checked connection to Example Candidate Committee',
      NAMED_TITLE,
    ]);
    expect(NAMED_TITLE).toBe('TV station files that name this candidate');
    const groups = [...container.querySelectorAll('.mb-buys-group')].map((g) => g.textContent);
    expect(groups[0]).toContain('KARE invoice');
    expect(groups[0]).not.toContain('Named on page 1');
    expect(groups[1]).toContain('Named on page 1');
    expect(groups[1]).not.toContain('KARE invoice');
  });

  it('asks for a race by its exact campaign-money contest and prints no stage titles', async () => {
    const { MediaBuysCard, raceTarget } = await import('../pages/media/MediaBuysCard');
    vi.spyOn(routes, 'isBuilt').mockReturnValue(true);
    const fetcher = serve(() =>
      json(
        connected([
          { label: 'General election', files: [{ ...INVOICE, role: 'General election' }] },
        ]),
      ),
    );
    const target = raceTarget('House', '99A', 2026);
    expect(JSON.parse(target)).toEqual({ office: 'House', district: '99A', year: 2026 });
    await render('/money/races/house-99a?year=2026', () => (
      <MediaBuysCard
        kind="race"
        target={target}
        name="State Representative · District 99A · 2026"
      />
    ));
    const read = fetcher.mock.calls
      .map(([url]) => new URL(String(url)))
      .find((url) => url.pathname.endsWith('/connections'));
    expect(read?.searchParams.get('kind')).toBe('race');
    expect(read?.searchParams.get('target')).toBe(
      '{"office":"House","district":"99A","year":2026}',
    );
    expect(container.querySelector('.mb-buys-card h3')).toBeNull();
    expect(text()).toContain('General election');
  });

  it('is left off, with nothing read, while the TV station file page is off', async () => {
    const { MediaBuysCard } = await import('../pages/media/MediaBuysCard');
    vi.spyOn(routes, 'isBuilt').mockImplementation((name) => name !== 'station-file');
    const fetcher = serve(() => json(connected([])));
    await render('/money/committees/90001', () => (
      <MediaBuysCard kind="committee" target="90001" name="X" />
    ));
    expect(container.querySelector('.mb-buys-card')).toBeNull();
    expect(fetcher.mock.calls.some(([url]) => String(url).includes('/connections'))).toBe(false);
  });
});

describe('Upload dates', () => {
  it('reads the FCC form production sends, and an ISO date', () => {
    // Production: `uploaded_at: "09/02/2026 11:46 AM"`.
    expect(day('09/02/2026 11:46 AM')).toBe('Sep 2, 2026');
    expect(day('2026-09-02')).toBe('Sep 2, 2026');
    expect(day(null)).toBe('Unavailable');
    expect(day('not a date')).toBe('Unavailable');
  });
});
