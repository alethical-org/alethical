import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearReadCache } from '../api/read';
import { MediaBuys, PENDING_LABEL, filingHref, mediaBuysAddress } from '../pages/MediaBuys';
import { StationFile } from '../pages/StationFile';
import {
  PrintedAgency,
  StationFolder,
  TVStation,
  agencySpellingGroups,
} from '../pages/StationRecords';
import { copiedLines, day, savedAt } from '../pages/media/shared';
import { markQuote } from '../pages/media/evidence';
import type { FilingRow } from '../pages/media/types';
import * as routes from '../routes';
import { matchRoute } from '../routes';
import { navigate, useLocation } from '../router';
import { withFrom } from '../returnContext';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const memberSession = vi.hoisted(() => ({ accessToken: 'test-token', retry: vi.fn() }));
vi.mock('../auth/session', () => ({
  useFinanceSession: () => ({
    apiBaseUrl: 'https://api.example.test',
    ...memberSession,
  }),
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
  first_saved_at: '2026-03-05T03:14:00Z',
  version_id: VERSION,
  version_count: 2,
  source_changed: false,
};
const DETAIL = {
  ...FILE,
  agencies: [],
  folder: {
    key: 'kare-folder',
    label: 'Political File / 2026 / Local / Example Committee',
  },
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
function serve(answer: (url: URL) => Response | Promise<Response>) {
  const fetcher = vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    if (url.pathname.endsWith('/pages/1') || url.pathname.endsWith('/pages/2'))
      return new Response(new Blob(['x'], { type: 'image/png' }), {
        headers: { 'content-type': 'image/png' },
      });
    if (url.pathname.endsWith('/sources'))
      return json({ stations: STATIONS, text_reader_version: 'x' });
    const response = answer(url);
    const signal = init?.signal;
    if (!(response instanceof Promise) || !signal) return response;
    // A browser abort frees the request slot even if a mocked old server reply
    // is deliberately held until after a newer query has already completed.
    return new Promise<Response>((resolve, reject) => {
      const abort = () => reject(new DOMException('Aborted', 'AbortError'));
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
      response.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    });
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
  memberSession.accessToken = 'test-token';
  memberSession.retry.mockClear();
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
  const ABOUT = {
    filings: 2704694,
    index_through: '2026-11-16',
    saved: 10797,
    saved_updated: '2026-11-17',
    complete: false,
  };
  const ROWS: FilingRow[] = [
    {
      key: 'TV|42|a',
      name: 'example-extv-order-2026-09-14.pdf',
      folder: 'Political Files / 2026 / Federal / Example Senate Campaign',
      station: 'EXTV-TV',
      service: 'TV',
      uploaded: '2026-09-14',
      file_id: 'fid-1',
      pdf: 'unavailable',
      minnesota_key: null,
    },
    {
      key: 'TV|43|b',
      name: 'example-kare-invoice.pdf',
      folder: 'Political File / 2026 / Local / Example Committee',
      station: 'KARE',
      service: 'TV',
      uploaded: null,
      file_id: 'fid-2',
      pdf: 'saved',
      minnesota_key: KEY,
    },
    {
      key: 'FM|7|c',
      name: 'example-exmp-order-2026-09-02.pdf',
      folder: 'Political Files / 2026 / State / Example for Governor',
      station: 'EXMP-FM',
      service: 'FM radio',
      uploaded: '2026-09-02',
      file_id: 'fid-3',
      pdf: 'saved',
      minnesota_key: null,
    },
    {
      key: 'AM|9|d',
      name: 'example-exam-contract-2026-07-21.pdf',
      folder: 'Political Files / 2026 / Non-Candidate Issue Ads / Example Issue Fund',
      station: 'EXAM',
      service: 'AM radio',
      uploaded: '2026-07-21',
      file_id: 'fid-4',
      pdf: 'unchecked',
      minnesota_key: null,
    },
  ];
  function list(url: URL, tab: string, rows: unknown[], extra: Record<string, unknown> = {}) {
    return json({
      tab,
      q: url.searchParams.get('q') ?? '',
      year: Number(url.searchParams.get('year') ?? 2026),
      years: [2026, 2024],
      page: Number(url.searchParams.get('page') ?? 1),
      page_size: 25,
      total: rows.length,
      rows,
      ...extra,
    });
  }
  const FOLDERS = [
    {
      key: 'folder-1',
      label: 'Example Committee',
      folder: 'Political File / 2026 / Local / Example Committee',
      station: 'KARE',
      service: 'TV',
      filings: 3,
      with_pdf: 3,
    },
    {
      key: 'folder-2',
      label: 'Example Issue Fund',
      folder: 'Political Files / 2026 / Non-Candidate Issue Ads / Example Issue Fund',
      station: 'EXAM',
      service: 'AM radio',
      filings: 1,
      with_pdf: 0,
    },
  ];
  const OUTLETS = [
    {
      key: 'outlet-1',
      name: 'KARE',
      service: 'TV',
      ident: 'KARE',
      place: 'Minneapolis, MN',
      years: [2026, 2024],
      filings: 12,
      with_pdf: 9,
      minnesota_station: 'kare',
    },
    {
      key: 'outlet-2',
      name: 'Example Satellite TV',
      service: 'Satellite TV',
      ident: 'Satellite provider',
      place: null,
      years: [2024],
      filings: 0,
      with_pdf: 0,
      minnesota_station: null,
    },
  ];
  function answer(url: URL) {
    if (url.pathname.endsWith('/filings')) return list(url, 'all-filings', ROWS, { about: ABOUT });
    if (url.pathname.endsWith('/filing-advertisers')) return list(url, 'advertisers', FOLDERS);
    if (url.pathname.endsWith('/filing-outlets'))
      return list(url, 'stations-and-providers', OUTLETS);
    const key = decodeURIComponent(url.pathname.split('/filings/')[1] ?? '');
    const row = ROWS.find((item) => item.key === key);
    if (!row) return json(null, 404);
    return json({
      ...row,
      year: 2026,
      ident: row.station,
      place: null,
      saved_on: row.pdf === 'saved' ? '2026-11-03' : null,
      pages: 1,
      content_hash: null,
      has_text: false,
      source_url: null,
    });
  }
  const reads = (fetcher: ReturnType<typeof serve>, route: string) =>
    fetcher.mock.calls.map(([input]) => new URL(input)).filter((u) => u.pathname.endsWith(route));
  const row = (name: string) =>
    [...container.querySelectorAll<HTMLTableRowElement>('tbody tr')].find((tr) =>
      tr.textContent?.includes(name),
    )!;
  const headers = () =>
    [...container.querySelectorAll('thead th')].map((th) => th.textContent?.trim());
  const address = () => new URLSearchParams(window.location.search);

  async function typeSearch(value: string) {
    const input = container.querySelector<HTMLInputElement>('#mbf-q')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }
  async function settleSearch() {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
    });
    await flush();
  }
  async function choose(menu: string, option: string) {
    await click(`${menu}:`);
    const choice = [
      ...container.querySelectorAll<HTMLButtonElement>('[role="option"] button'),
    ].find((button) => button.textContent?.includes(option));
    expect(choice, option).toBeTruthy();
    await act(async () => choice!.click());
    await flush();
  }

  it('opens on All filings: the national search, both filing PDF states and the About lines', async () => {
    const fetcher = serve(answer);
    await render('/media-buys', () => <MediaBuys />);
    expect(container.querySelector('h1')?.textContent).toBe('Media buys');
    expect(text()).toContain(
      'FCC political ad filings from TV and radio stations, cable systems and satellite providers across the U.S.',
    );
    expect(
      [...container.querySelectorAll('[role="tab"]')].map((tab) => [
        tab.textContent,
        tab.getAttribute('aria-selected'),
      ]),
    ).toEqual([
      ['All filings', 'true'],
      ['Advertisers', 'false'],
      ['Stations and providers', 'false'],
    ]);
    const [request] = reads(fetcher, '/finance/media-buys/filings');
    expect([...request.searchParams.keys()]).toEqual([]);
    expect(container.querySelector('label[for="mbf-q"]')?.textContent).toBe('Search filings');
    expect(container.querySelector('#mbf-q')?.getAttribute('aria-describedby')).toBe('mbf-q-hint');
    expect(container.querySelector('#mbf-q-hint')?.textContent).toBe(
      'Filename, folder, station, provider or FCC file ID',
    );
    expect(container.querySelector<HTMLInputElement>('.mbf-toggle input')?.checked).toBe(false);
    expect(text()).toContain('Sort by: Newest upload first');
    expect(text()).toContain('File year: 2026');
    expect(text()).toContain('4 results');
    expect(headers()).toEqual([
      'Filing',
      'Station or provider',
      'Uploaded',
      'FCC file ID',
      'Filing PDF',
      'Source',
    ]);
    expect(text().split('Filename or folder matches do not prove').length).toBe(2);
    expect(text()).toContain(
      'Filename or folder matches do not prove a purchase, buyer, order number, document type or price',
    );

    // Saved: Open, named for its file; Minnesota files open their TV station file.
    const minnesota = container.querySelector<HTMLAnchorElement>(
      'a[aria-label="Open filing PDF for example-kare-invoice.pdf"]',
    )!;
    expect(minnesota.textContent).toBe('Open');
    const mnHref = new URL(minnesota.href);
    expect(mnHref.pathname).toBe(`/media-buys/files/${KEY}`);
    expect(mnHref.searchParams.get('from')).toBe('/media-buys');
    const national = container.querySelector<HTMLAnchorElement>(
      'a[aria-label="Open filing PDF for example-exmp-order-2026-09-02.pdf"]',
    )!;
    expect(decodeURIComponent(new URL(national.href).pathname)).toBe(
      '/media-buys/files/national-FM|7|c',
    );
    // Not available is plain text; an unchecked filing never reads as Not available or blank.
    const unavailable = row('example-extv-order').querySelectorAll('td')[4];
    expect(unavailable.textContent).toBe('Not available');
    expect(unavailable.querySelector('a')).toBeNull();
    const pending = row('example-exam-contract').querySelectorAll('td')[4];
    expect(PENDING_LABEL).toBe('Check pending');
    expect(pending.textContent).toBe('Check pending');
    for (const tr of container.querySelectorAll('tbody tr')) {
      expect(tr.querySelectorAll('td')[4].textContent?.trim()).not.toBe('');
      expect(tr.querySelectorAll('td')[5].textContent).toBe('View source');
    }
    expect(row('example-kare-invoice').querySelectorAll('td')[2].textContent).toBe('Not given');
    expect(row('example-extv-order').querySelectorAll('td')[2].textContent).toBe('Sep 14, 2026');
    expect(row('example-extv-order').querySelectorAll('td')[0].textContent).toContain(
      'Political Files / 2026 / Federal / Example Senate Campaign',
    );
    expect(row('example-exmp-order').querySelectorAll('td')[1].textContent).toBe('EXMP-FMFM radio');

    const about = container.querySelector<HTMLElement>('section[aria-labelledby="about-h"]')!;
    const lines = [...about.querySelectorAll('li')].map((li) =>
      li.textContent?.replace(' (opens in a new tab)', ''),
    );
    expect(lines).toEqual([
      '2,704,694 searchable filings · FCC Public Inspection Files through Nov 16, 2026',
      '10,797 filings with a saved PDF of the original paperwork a station or provider filed with the FCC · Updated Nov 17, 2026',
    ]);
    const fcc = about.querySelector<HTMLAnchorElement>('a')!;
    expect(fcc.href).toBe('https://publicfiles.fcc.gov/');
    expect(fcc.target).toBe('_blank');
    expect(about.querySelectorAll('a')).toHaveLength(1);
    expect(text()).not.toContain('Sources and updates');
    expect(text()).not.toContain('Add to report');
    expect(text()).not.toContain('Create report');
  });

  it('keeps the reading guide closed until asked, with its 4 entries only when open', async () => {
    serve(answer);
    await render('/media-buys', () => <MediaBuys />);
    const button = container.querySelector<HTMLButtonElement>('#mbf-guide-button')!;
    expect(button.textContent).toBe('What can a filing show?');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('#mbf-guide')).toBeNull();
    expect(text()).not.toContain('Who requested the ad.');
    await act(async () => button.click());
    expect(button.getAttribute('aria-expanded')).toBe('true');
    const entries = [...container.querySelectorAll('#mbf-guide p')];
    expect(entries.map((p) => p.querySelector('strong')?.textContent)).toEqual([
      'Who requested the ad.',
      'What was booked and what aired.',
      'What was billed or paid.',
      'How filings fit together.',
    ]);
    expect(entries[2].textContent).toBe(
      'What was billed or paid. An invoice can show the price per ad, total charges, agency commission and balance due. Some also show payments received.',
    );
    await act(async () => button.click());
    expect(container.querySelector('#mbf-guide')).toBeNull();
    expect(document.activeElement === button || document.activeElement === document.body).toBe(
      true,
    );
  });

  it('searches as you type, applies Enter at once and restores the full list when cleared', async () => {
    const fetcher = serve(answer);
    await render('/media-buys?year=2024&from=%2Fhome', () => <MediaBuys />);
    const count = reads(fetcher, '/filings').length;
    await typeSearch('exam');
    expect(reads(fetcher, '/filings')).toHaveLength(count);
    await settleSearch();
    expect(address().get('q')).toBe('exam');
    expect(address().get('year')).toBe('2024');
    expect(address().get('from')).toBe('/home');
    expect(reads(fetcher, '/filings').at(-1)?.searchParams.get('q')).toBe('exam');
    await typeSearch('example contract');
    await act(async () => {
      container
        .querySelector('form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await flush();
    expect(address().get('q')).toBe('example contract');
    const afterEnter = reads(fetcher, '/filings').length;
    await settleSearch();
    expect(reads(fetcher, '/filings')).toHaveLength(afterEnter);
    await typeSearch('');
    await settleSearch();
    expect(address().has('q')).toBe(false);
    expect(container.querySelector<HTMLInputElement>('#mbf-q')?.value).toBe('');
    expect(text()).toContain('4 results');
  });

  it('puts year, document type, the filing PDF filter, sort and page in the address', async () => {
    const fetcher = serve(answer);
    await render('/media-buys', () => <MediaBuys />);
    const pushes = vi.spyOn(window.history, 'pushState');
    await choose('File year', '2024');
    expect(address().get('year')).toBe('2024');
    await choose('Document type', 'Orders and contracts');
    expect(address().get('doctype')).toBe('orders');
    // Orders and contracts adds Order number between FCC file ID and Filing PDF.
    expect(headers()).toEqual([
      'Filing',
      'Station or provider',
      'Uploaded',
      'FCC file ID',
      'Order number',
      'Filing PDF',
      'Source',
    ]);
    expect(row('example-extv-order').querySelectorAll('td')[4].textContent).toBe('Not checked');
    await act(async () => container.querySelector<HTMLInputElement>('.mbf-toggle input')!.click());
    await flush();
    expect(address().get('pdf')).toBe('yes');
    expect(pushes).toHaveBeenCalledTimes(3);
    await choose('Sort by', 'Name A–Z');
    expect(address().get('sort')).toBe('name');
    expect(pushes).toHaveBeenCalledTimes(3);
    const last = reads(fetcher, '/filings').at(-1)!;
    expect(Object.fromEntries(last.searchParams)).toEqual({
      year: '2024',
      doctype: 'orders',
      pdf: 'yes',
      sort: 'name',
    });
    // Each filter has a removable chip of its own name; the year has none.
    const chips = [...container.querySelectorAll('.mbf-chip')].map((chip) =>
      chip.getAttribute('aria-label'),
    );
    expect(chips).toEqual(['Remove Document type: Orders and contracts', 'Remove Has filing PDF']);
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="Remove Has filing PDF"]')!.click(),
    );
    await flush();
    expect(address().has('pdf')).toBe(false);
    expect(container.querySelector<HTMLInputElement>('.mbf-toggle input')?.checked).toBe(false);
    await click('Clear all');
    expect(address().has('doctype')).toBe(false);
    expect(address().get('year')).toBe('2024');
    expect(address().get('sort')).toBe('name');
    await choose('Sort by', 'Newest upload first');
    expect(address().has('sort')).toBe(false);
  });

  it('pages through results in the address and opens a later page from a copied link', async () => {
    const many = Array.from({ length: 25 }, (_, index) => ({
      ...ROWS[0],
      key: `TV|42|${index}`,
      name: `filing-${index}.pdf`,
    }));
    const fetcher = serve((url) =>
      url.pathname.endsWith('/filings')
        ? list(url, 'all-filings', many, { total: 60, about: ABOUT })
        : answer(url),
    );
    await render('/media-buys?page=2', () => <MediaBuys />);
    expect(reads(fetcher, '/filings')[0].searchParams.get('page')).toBe('2');
    expect(text()).toContain('Page 2 of 3');
    await click('Next');
    expect(address().get('page')).toBe('3');
    expect(reads(fetcher, '/filings').at(-1)?.searchParams.get('page')).toBe('3');
    await render('/media-buys?page=9', () => <MediaBuys />);
    expect(address().get('page')).toBe('3');
  });

  it.each([
    ['?tab=overview', '', 'filings'],
    ['?tab=source-documents&scope=member', '', 'filings'],
    ['?tab=national&page=43', '', 'filings'],
    ['?scope=index&q=example', '?q=example', 'filings'],
    ['?tab=orders-and-contracts', '?doctype=orders', 'filings'],
    ['?tab=stations', '?tab=stations-and-providers', 'filing-outlets'],
    ['?tab=folders&station=KARE', '?q=KARE', 'filings'],
    ['?station=KARE&year=2026', '?year=2026&q=KARE', 'filings'],
    ['?tab=agencies', '?tab=advertisers', 'filing-advertisers'],
    ['?tab=years&year=2024', '?year=2024', 'filings'],
    ['?tab=all-filings&year=2026&q=Example', '?year=2026&q=Example', 'filings'],
    ['?tab=stations&from=%2Fhome', '?tab=stations-and-providers&from=%2Fhome', 'filing-outlets'],
  ])('opens the older link %s as %s without a Back step', async (old, current, route) => {
    const fetcher = serve(answer);
    const pushes = vi.spyOn(window.history, 'pushState');
    await render('/media-buys' + old, () => <MediaBuys />);
    expect(window.location.search).toBe(current);
    expect(pushes).toHaveBeenCalledTimes(1);
    const routes = fetcher.mock.calls
      .map(([input]) => new URL(input).pathname.split('/media-buys/')[1])
      .filter(Boolean);
    expect(new Set(routes)).toEqual(new Set([route]));
  });

  it('opens a filing’s FCC details and returns focus to its View source button', async () => {
    const fetcher = serve(answer);
    await render('/media-buys?q=example', () => <MediaBuys />);
    const before = window.location.href;
    const button = row('example-extv-order').querySelector<HTMLButtonElement>('button')!;
    button.focus();
    await act(async () => button.click());
    await flush();
    const dialog = container.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog.querySelector('h2')?.textContent).toBe('example-extv-order-2026-09-14.pdf');
    expect(dialog.textContent).toContain('FCC Public Inspection Files');
    const pairs = [...dialog.querySelectorAll('.f-sources-row')].map((pair) => [
      pair.querySelector('dt')?.textContent,
      pair.querySelector('dd')?.textContent,
    ]);
    expect(pairs).toEqual([
      ['Station or provider', 'EXTV-TV · TV'],
      ['Folder', 'Political Files / 2026 / Federal / Example Senate Campaign'],
      ['FCC file ID', 'fid-1'],
      ['Uploaded', 'Sep 14, 2026'],
      ['Filing PDF', 'Not available'],
    ]);
    // The details claim no evidence check of their own.
    expect(dialog.textContent).not.toContain('Not checked');
    expect(dialog.textContent).not.toContain('Checked on');
    expect(reads(fetcher, '/filings/TV%7C42%7Ca')).toHaveLength(1);
    expect(window.location.href).toBe(before);
    await act(async () =>
      dialog.querySelector<HTMLButtonElement>('[aria-label="Close source evidence"]')!.click(),
    );
    await flush();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(button);
    expect(window.location.href).toBe(before);

    const saved = row('example-kare-invoice').querySelector<HTMLButtonElement>('button')!;
    await act(async () => saved.click());
    await flush();
    const savedPairs = [...container.querySelectorAll('[role="dialog"] .f-sources-row')].map(
      (pair) => [pair.querySelector('dt')?.textContent, pair.querySelector('dd')?.textContent],
    );
    expect(savedPairs).toContainEqual(['Uploaded', 'Not given']);
    expect(savedPairs).toContainEqual(['Filing PDF', 'Saved Nov 3, 2026']);
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    await flush();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(saved);
  });

  it('lists folder names on Advertisers as not checked, linking to their filings', async () => {
    const fetcher = serve(answer);
    await render('/media-buys?q=example', () => <MediaBuys />);
    const pushes = vi.spyOn(window.history, 'pushState');
    await click('Advertisers');
    expect(pushes).toHaveBeenCalledTimes(1);
    expect(address().get('tab')).toBe('advertisers');
    expect(address().get('q')).toBe('example');
    expect(reads(fetcher, '/filing-advertisers')[0].searchParams.get('q')).toBe('example');
    expect(container.querySelector('label[for="mbf-q"]')?.textContent).toBe(
      'Search by advertiser or folder name',
    );
    expect(container.querySelector('#mbf-q')?.getAttribute('placeholder')).toBe(
      'Advertiser or folder name',
    );
    expect(headers()).toEqual(['Name', 'Basis', 'Filings']);
    const cells = [...row('Example Committee').querySelectorAll('td')];
    expect(cells[1].textContent).toBe('Folder name as printed · Not checked');
    const link = cells[2].querySelector<HTMLAnchorElement>('a')!;
    expect(link.textContent).toBe('3 filings');
    expect(cells[2].textContent).toContain('KARE');
    const href = new URL(link.href);
    expect(href.pathname).toBe('/media-buys');
    expect(href.searchParams.get('year')).toBe('2026');
    expect(href.searchParams.get('q')).toBe('Example Committee');
    expect(href.searchParams.has('tab')).toBe(false);
    expect(row('Example Issue Fund').querySelectorAll('td')[2].textContent).toContain('1 filing');
    expect(text()).toContain(
      'Only checked facts establish an advertiser. Folder names are listed separately so they are not read as checked.',
    );
    expect(text()).not.toContain('About these records');
    expect(text()).not.toContain('Sort by');
  });

  it('lists stations and providers with Minnesota stations linked to their pages', async () => {
    serve(answer);
    await render('/media-buys?tab=stations-and-providers&year=2026', () => <MediaBuys />);
    expect(container.querySelector('label[for="mbf-q"]')?.textContent).toBe(
      'Search stations and providers',
    );
    expect(container.querySelector('#mbf-q')?.getAttribute('placeholder')).toBe(
      'Station, call sign or provider',
    );
    expect(headers()).toEqual([
      'Station or provider',
      'Service',
      'Call sign or ID',
      'Years',
      'Filings in 2026',
      'With filing PDF',
    ]);
    const kare = [...row('Minneapolis, MN').querySelectorAll('td')].map((td) => td.textContent);
    expect(kare).toEqual(['KAREMinneapolis, MN', 'TV', 'KARE', '2026, 2024', '12', '9']);
    const link = row('Minneapolis, MN').querySelector<HTMLAnchorElement>('a')!;
    expect(new URL(link.href).pathname).toBe('/media-buys/stations/kare');
    const satellite = [...row('Example Satellite TV').querySelectorAll('td')].map(
      (td) => td.textContent,
    );
    expect(satellite).toEqual([
      'Example Satellite TV',
      'Satellite TV',
      'Satellite provider',
      '2024',
      'None held',
      '',
    ]);
    expect(row('Example Satellite TV').querySelector('a')).toBeNull();
    expect(text()).not.toContain('About these records');
  });

  it('says results could not load, with Try again, while the search is starting', async () => {
    let ready = false;
    serve((url) =>
      url.pathname.endsWith('/filings') && !ready
        ? new Response(JSON.stringify({ detail: 'Filings are loading. Try again in a moment.' }), {
            status: 503,
            headers: { 'content-type': 'application/problem+json' },
          })
        : answer(url),
    );
    await render('/media-buys', () => <MediaBuys />);
    expect(text()).toContain('Couldn’t load results');
    expect(text()).not.toContain('No matching records');
    expect(text()).not.toContain('Not available');
    ready = true;
    await click('Try again');
    expect(text()).not.toContain('Couldn’t load results');
    expect(text()).toContain('4 results');
  });

  it('says nothing matched without calling any filing PDF unavailable', async () => {
    serve((url) =>
      url.pathname.endsWith('/filings')
        ? list(url, 'all-filings', [], { about: ABOUT })
        : answer(url),
    );
    await render('/media-buys?q=zzz', () => <MediaBuys />);
    expect(text()).toContain('0 results');
    expect(text()).toContain('No matching records');
    expect(text()).not.toContain('Not available');
    // About these records is national: it stays, whatever the search.
    expect(text()).toContain('2,704,694 searchable filings');
  });

  it('shows each filing as a card on phone, Filing PDF beside its value, then View source', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(max-width: 767px)',
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    serve(answer);
    await render('/media-buys', () => <MediaBuys />);
    expect(container.querySelector('table')).toBeNull();
    const card = [...container.querySelectorAll<HTMLElement>('.mbf-card')].find((item) =>
      item.textContent?.includes('example-extv-order'),
    )!;
    const terms = [...card.querySelectorAll('dt')].map((dt) => [
      dt.textContent,
      dt.nextElementSibling?.textContent,
    ]);
    expect(terms).toEqual([
      ['Station or provider', 'EXTV-TVTV'],
      ['Uploaded', 'Sep 14, 2026'],
      ['FCC file ID', 'fid-1'],
      ['Filing PDF', 'Not available'],
    ]);
    expect(card.lastElementChild?.textContent).toBe('View source');
  });

  it('names each station’s copy date only when the dates differ', () => {
    expect(copiedLines(STATIONS)).toEqual(['TV station files copied Oct 22, 2026']);
    expect(copiedLines([STATIONS[0], { ...STATIONS[1], last_file_copy: '2026-10-20' }])).toEqual([
      'KSTP-TV: TV station files copied Oct 22, 2026',
      'KARE: TV station files copied Oct 20, 2026',
    ]);
  });

  it('opens Minnesota files at the TV station file and national ones in the national reader', () => {
    expect(filingHref({ key: 'x', minnesota_key: KEY })).toBe(`/media-buys/files/${KEY}`);
    expect(decodeURIComponent(filingHref({ key: 'TV|1|2', minnesota_key: null }))).toBe(
      '/media-buys/files/national-TV|1|2',
    );
    expect(mediaBuysAddress('tab=national&nationalPage=4&browseSource=x&from=%2Fhome')).toBe(
      'from=%2Fhome',
    );
  });

  it('shows the checking entrance only once its page is built', async () => {
    serve(answer);
    await render('/media-buys', () => <MediaBuys />);
    expect(container.textContent).not.toContain('Check TV station files');
    act(() => root.unmount());
    root = createRoot(container);
    vi.spyOn(routes, 'isBuilt').mockReturnValue(true);
    await render('/media-buys', () => <MediaBuys />);
    expect(
      container.querySelector('a[href^="/media-buys/check"]')?.textContent?.replace(/ /g, ' '),
    ).toContain('Check TV station files');
  });
});

describe('TV station folder, station and printed agency name', () => {
  it('deduplicates only the same file/version and keeps the other original spelling', () => {
    const agency = (key: string, name: string, files: (typeof FILE)[]) => ({
      key,
      name,
      unchecked: false,
      addresses: [],
      groups: [{ station: 'KARE', year: 2026, files }],
    });
    const groups = agencySpellingGroups([
      agency('exact', 'Example Media', [FILE]),
      agency('variant', 'Exmaple Media', [
        FILE,
        { ...FILE, version_id: OLD },
        { ...FILE, key: 'kare-other' },
      ]),
    ]);
    expect(groups.map((group) => group.files.length)).toEqual([1, 2]);
    expect(groups[0].files[0].alsoPrintedAs).toEqual(['Exmaple Media']);
    expect(groups[1].files.map((file) => [file.key, file.version_id])).toEqual([
      [KEY, OLD],
      ['kare-other', VERSION],
    ]);
    expect(FILE).not.toHaveProperty('alsoPrintedAs');
  });

  it('loads strong agency spellings pinned to exact source state and keeps their checks separate', async () => {
    const fetcher = serve((url) => {
      if (url.pathname.endsWith('/spellings')) {
        expect(url.searchParams.get('version')).toBe('c'.repeat(16));
        return json({
          key: 'agency',
          version: 'c'.repeat(16),
          spellings: [
            {
              key: 'variant',
              name: 'Exmaple Media',
              unchecked: true,
              addresses: [],
              groups: [
                {
                  station: 'KARE',
                  year: 2026,
                  files: [{ ...FILE, agency_unchecked: true }],
                },
              ],
            },
          ],
        });
      }
      if (url.pathname.endsWith('/similar-names'))
        return json({ rows: [], has_more: false, key: 'agency' });
      return json({
        key: 'agency',
        name: 'Example Media',
        version: 'c'.repeat(16),
        unchecked: false,
        addresses: [],
        groups: [
          {
            station: 'KARE',
            year: 2026,
            files: [
              {
                ...FILE,
                agency_unchecked: false,
                agency_checked_at: '2026-11-01',
              },
            ],
          },
        ],
      });
    });
    await render('/media-buys/agencies/agency', () => (
      <PrintedAgency match={matchRoute('/media-buys/agencies/agency')!} />
    ));
    expect(fetcher).toHaveBeenCalled();
    expect(container.textContent).toContain('Also printed as: Exmaple Media');
    expect(container.querySelectorAll('a[href*="/media-buys/files/"]')).toHaveLength(1);
    expect(container.textContent).toContain('Checked on Nov 1, 2026');
    expect(container.textContent).not.toContain('Each spelling is kept separate');
  });
  it('keeps searched-list context through folder, file and related station returns', async () => {
    function Flow() {
      const location = useLocation();
      const match = matchRoute(location.pathname)!;
      if (match.route.name === 'station-folder') return <StationFolder match={match} />;
      if (match.route.name === 'station-file') return <StationFile match={match} />;
      if (match.route.name === 'station') return <TVStation match={match} />;
      return <MediaBuys />;
    }
    serve((url) => {
      if (url.pathname.includes('/files/')) return json(DETAIL);
      if (url.pathname.includes('/folders/'))
        return json({
          key: 'kare-folder',
          label: 'Political File / 2025 / Local / Example Committee',
          station: 'KARE',
          year: 2025,
          category: 'Local',
          fcc_url: 'https://publicfiles.fcc.gov',
          relationship: null,
          files: [FILE],
        });
      return json({
        tab: 'all-filings',
        q: url.searchParams.get('q') ?? '',
        year: 2025,
        years: [2025],
        page: 1,
        page_size: 25,
        total: 0,
        rows: [],
        about: {
          filings: 1,
          index_through: '2026-11-16',
          saved: 1,
          saved_updated: '2026-11-17',
          complete: true,
        },
      });
    });
    const station = withFrom('/media-buys/stations/kare', '/media-buys?tab=stations-and-providers');
    const searched = withFrom('/media-buys?q=KARE&year=2025', station);
    await render(withFrom('/media-buys/folders/kare-folder', searched), () => <Flow />);
    const originalFolder = window.location.pathname + window.location.search;
    const related = container.querySelector<HTMLAnchorElement>(
      'a[href^="/media-buys/stations/KARE"]',
    )!;
    const relatedFrom = new URL(related.href).searchParams.get('from')!;
    expect(new URL(relatedFrom, 'https://finance.test').searchParams.get('from')).toContain(
      'q=KARE&year=2025',
    );
    await click('invoice.pdf');
    expect(new URLSearchParams(window.location.search).get('version')).toBe(VERSION);
    await click('Back to TV station folder');
    expect(window.location.pathname).toBe('/media-buys/folders/kare-folder');
    expect(window.location.search).not.toBe('');
    await click('Back to Media buys');
    expect(window.location.pathname).toBe('/media-buys');
    expect(new URLSearchParams(window.location.search).get('q')).toBe('KARE');
    expect(new URLSearchParams(window.location.search).get('year')).toBe('2025');
    expect(container.querySelector('a.f-back')?.textContent).toBe('Back to TV station');
    expect(originalFolder).toContain('from=');
  });

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
        relationship: {
          ...DETAIL.connections[0],
          target: { kind: 'committee', id: '90001' },
        },
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
    expect(text).toContain('FIRST SAVED');
    expect(text).toContain('Mar 4, 2026');
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
    expect(container.textContent).toContain('Couldn’t load folder. This is a problem on our side.');
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
        latest_check_at: '2026-10-03T01:00:00Z',
        years: [
          {
            year: 2026,
            categories: [],
            file_count: 3,
            counts: {
              station_files_held: 3,
              unique_file_contents: 2,
              text_read_failures: 1,
              download_failures: 0,
              folder_failures: 2,
            },
          },
          {
            year: null,
            categories: [],
            file_count: 0,
            counts: {
              station_files_held: 0,
              unique_file_contents: 0,
              text_read_failures: 0,
              download_failures: 1,
              folder_failures: 1,
            },
          },
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
    expect(text).toContain('Latest review checkOct 2, 2026');
    expect(container.querySelector('[aria-label="2026"]')?.textContent).toContain(
      'Unique file contents2',
    );
    expect(container.querySelector('[aria-label="2026"]')?.textContent).toContain(
      'Folders we couldn’t list2',
    );
    expect(container.querySelector('[aria-label="Year unavailable"]')?.textContent).toContain(
      'Files we couldn’t download1',
    );
    // The station-wide counts, once, for all years, with the drawn notes: gaps in
    // the collection are never hidden.
    const all = container.querySelector('[aria-label="All years"]')!;
    const metrics = [...all.querySelectorAll('.mb-metrics > div')].map((d) => d.textContent);
    expect(metrics).toEqual([
      'TV station files held3',
      'Unique file contents3',
      'Files whose text could not be fully read0',
      'Files we couldn’t download0',
      'Folders we couldn’t list0',
    ]);
    expect(text).toContain(
      'Files we couldn’t download and folders we couldn’t list are collection gaps on our side, not statements about the station',
    );
    expect(
      container.querySelector('a[href^="/media-buys?station=KARE&year=2026&from="]'),
    ).toBeTruthy();
    expect(container.querySelector('a[href^="/media-buys/stations/KSTP-TV?from="]')).toBeTruthy();
  });

  it('prints each agency name check on its own Minnesota day, never a file or address date', async () => {
    serve(() =>
      json({
        name: 'Exact Agency',
        key: 'agency',
        unchecked: false,
        addresses: [],
        groups: [
          {
            station: 'KARE',
            year: 2026,
            files: [
              {
                ...FILE,
                key: 'checked',
                agency_unchecked: false,
                agency_checked_at: '2026-11-04T02:00:00Z',
              },
              {
                ...FILE,
                key: 'mixed',
                agency_unchecked: false,
                agency_checked_at: null,
              },
              {
                ...FILE,
                key: 'unchecked',
                agency_unchecked: true,
                agency_checked_at: '2026-11-04T02:00:00Z',
              },
            ],
          },
        ],
      }),
    );
    await render('/media-buys/agencies/agency', () => (
      <PrintedAgency match={matchRoute('/media-buys/agencies/agency')!} />
    ));
    expect(container.textContent).toContain('Checked on Nov 3, 2026');
    expect(container.textContent?.match(/Checked on/g)).toHaveLength(1);
    expect(container.textContent).toContain('Machine-read · Not checked');
  });

  it('opens agency address evidence at its quoted page and version, with both payment searches', async () => {
    vi.spyOn(routes, 'isBuilt').mockImplementation((name) => name === 'payments-under-name');
    serve(() =>
      json({
        name: 'Exact Agency',
        key: 'agency',
        unchecked: true,
        groups: [
          {
            station: 'KARE',
            year: 2026,
            files: [{ ...FILE, agency_unchecked: true }],
          },
        ],
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
                quote: 'BILL TO EXACT AGENCY AT 100 MAIN',
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
    expect(container.querySelector('blockquote')?.textContent).toBe(
      'BILL TO EXACT AGENCY AT 100 MAIN',
    );
    expect(text).toContain('A payment under this name does not prove the file was paid');
    const evidence = [...container.querySelectorAll('a')].find((a) =>
      a.textContent?.replace(/\u00a0/g, ' ').includes('View evidence'),
    );
    expect(evidence?.getAttribute('href')).toBe(`/media-buys/files/${KEY}?version=${OLD}&page=4`);
    expect(
      container.querySelector(
        'a[href="/money/names/Exact%20Agency?role=payee&dataset=expenditures"]',
      ),
    ).toBeTruthy();
    expect(
      container.querySelector(
        'a[href="/money/names/Exact%20Agency?role=payee&dataset=independent#outside-payments"]',
      ),
    ).toBeTruthy();
  });

  it('says so when no address is checked for a spelling', async () => {
    serve(() =>
      json({
        name: 'Exact Agency',
        key: 'agency',
        unchecked: false,
        groups: [],
        addresses: [],
      }),
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
    expect(markQuote('A GROSS 1', 'GROSS')).toEqual({
      before: 'A ',
      mark: 'GROSS',
      after: ' 1',
    });
    expect(markQuote('A GR0SS 1', 'GROSS')).toBeNull();
  });
});

describe('Media buys card', () => {
  /** The connections answer as the server builds it (`connected` in
   * alethical/api/services/tv_ads.py): every row once in `files` without a role,
   * and again in its group with the role line. */
  function connected(groups: { label: string; files: Record<string, unknown>[] }[]) {
    const files = groups.flatMap((group) => group.files.map(({ role: _role, ...row }) => row));
    return {
      agency_key: null,
      exact_name_count: 0,
      files,
      total: files.length,
      groups,
    };
  }
  const INVOICE = {
    ...FILE,
    kind: 'Invoice',
    uploaded_at: '2026-03-04',
    role: 'Advertiser, as printed',
  };

  it('uses the served connection kind and cited page without guessing from its label', async () => {
    const { MediaBuysCard } = await import('../pages/media/MediaBuysCard');
    vi.spyOn(routes, 'isBuilt').mockReturnValue(true);
    serve(() =>
      json({
        agency_key: null,
        exact_name_count: 0,
        files: [INVOICE],
        total: 1,
        groups: [
          {
            label: 'Unrelated title',
            kind: 'named',
            files: [{ ...INVOICE, page: 4 }],
          },
        ],
      }),
    );
    await render('/candidates/example', () => (
      <MediaBuysCard kind="candidate" target="example" name="Example" />
    ));
    expect(container.querySelector('.mb-buys-card h3')?.textContent).toBe(
      'TV station files that name this candidate',
    );
    expect(container.querySelector('.mb-buys-card a')?.getAttribute('href')).toContain(
      `version=${VERSION}&page=4`,
    );
  });

  it.each(['person', 'legislator', 'organization'] as const)(
    'keeps %s profile file versions, page links and failure states',
    async (kind) => {
      const { MediaBuysCard } = await import('../pages/media/MediaBuysCard');
      vi.spyOn(routes, 'isBuilt').mockReturnValue(true);
      let response = json({
        files: [INVOICE],
        total: 1,
        groups: [
          {
            kind: 'committee',
            label: 'Files with a checked connection to Example Committee',
            files: [{ ...INVOICE, page: 2 }],
          },
          {
            kind: 'named',
            label: 'Untrusted candidate description',
            files: [{ ...INVOICE, page: 4 }],
          },
        ],
      });
      serve(() => response.clone());
      await render('/people/example', () => (
        <MediaBuysCard kind={kind} target="example" name="Example" personIsCandidate={true} />
      ));
      const links = [...container.querySelectorAll('.mb-buys-card a')];
      expect(links).toHaveLength(2);
      expect(links[0].getAttribute('href')).toContain(
        `version=${VERSION}&page=2&from=%2Fpeople%2Fexample`,
      );
      expect(links[1].getAttribute('href')).toContain(
        `version=${VERSION}&page=4&from=%2Fpeople%2Fexample`,
      );
      expect([...container.querySelectorAll('.mb-buys-card h3')].map((x) => x.textContent)).toEqual(
        kind === 'organization'
          ? []
          : [
              'Files with a checked connection to Example Committee',
              kind === 'legislator'
                ? 'TV station files that name this legislator'
                : 'TV station files that name this candidate',
            ],
      );
      // A new profile with an unavailable read never gets the previous profile's files or an empty claim.
      response = new Response(null, { status: 503 });
      await render('/people/other', () => (
        <MediaBuysCard kind={kind} target="other" name="Other" />
      ));
      expect(container.querySelectorAll('.mb-buys-card a')).toHaveLength(0);
      expect(text()).toContain('Couldn’t load TV station files');
      expect(text()).not.toContain('No TV station files have a checked connection');
      response = json({ files: [], groups: [], total: 0 });
      await click('Try again');
      expect(text()).toContain('No TV station files have a checked connection to Other');
    },
  );

  it('does not call an identity-only person a candidate from a server group label', async () => {
    const { MediaBuysCard } = await import('../pages/media/MediaBuysCard');
    vi.spyOn(routes, 'isBuilt').mockReturnValue(true);
    serve(() =>
      json({
        files: [INVOICE],
        groups: [
          {
            kind: 'named',
            label: 'Files naming this candidate',
            files: [INVOICE],
          },
        ],
        total: 1,
      }),
    );
    await render('/people/example', () => (
      <MediaBuysCard kind="person" target="example" name="Example" />
    ));
    expect(container.querySelector('.mb-buys-card h3')).toBeNull();
    expect(container.querySelectorAll('.mb-buys-card a')).toHaveLength(1);
    expect(text()).not.toContain('candidate');
  });

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
    expect(text()).toContain('Couldn’t load TV station files');
    expect(text()).not.toContain('problem on our side');
    expect(text()).not.toContain('No TV station files have a checked connection');
    fail = false;
    const before = fetcher.mock.calls.length;
    await click('Try again');
    expect(fetcher.mock.calls.length).toBeGreaterThan(before);
    expect(text()).toContain('KARE invoice');
    expect(text()).not.toContain('Couldn’t load TV station files');
  });

  it('treats an answer without its lists as a failed read', async () => {
    const { MediaBuysCard } = await import('../pages/media/MediaBuysCard');
    vi.spyOn(routes, 'isBuilt').mockReturnValue(true);
    serve(() => json({}));
    await render('/money/committees/90001', () => (
      <MediaBuysCard kind="committee" target="90001" name="X" />
    ));
    expect(text()).toContain('Couldn’t load TV station files');
    expect(text()).not.toContain('No TV station files have a checked connection');
  });

  it('lists a candidacy’s committee files first, then the files that name the candidate', async () => {
    const { MediaBuysCard, NAMED_TITLE } = await import('../pages/media/MediaBuysCard');
    vi.spyOn(routes, 'isBuilt').mockReturnValue(true);
    const ORDER = {
      ...FILE,
      key: 'kstp-9',
      kind: 'Order',
      uploaded_at: '2026-04-09',
    };
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
          {
            label: 'General election',
            files: [{ ...INVOICE, role: 'General election' }],
          },
        ]),
      ),
    );
    const target = raceTarget('House', '99A', 2026);
    expect(JSON.parse(target)).toEqual({
      office: 'House',
      district: '99A',
      year: 2026,
    });
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

describe('National FCC originals in Media buys', () => {
  const key = 'CABLE|000123|test';
  const version = 'b'.repeat(64);

  it('opens a national original from a later results page and returns to the same address', async () => {
    function Flow() {
      const location = useLocation();
      const match = matchRoute(location.pathname)!;
      if (match.route.name === 'station-file') return <StationFile match={match} />;
      return <MediaBuys />;
    }
    const fetcher = serve((url) => {
      if (url.pathname.endsWith('/filings'))
        return json({
          tab: 'all-filings',
          q: url.searchParams.get('q') ?? '',
          year: 2026,
          years: [2026],
          page: Number(url.searchParams.get('page') ?? 1),
          page_size: 25,
          total: 60,
          rows: [
            {
              key,
              name: 'Original.pdf',
              folder: 'Political Files/2026/State',
              station: 'Held Cable',
              service: 'Cable',
              uploaded: '2026-09-02',
              file_id: 'test',
              pdf: 'saved',
              minnesota_key: null,
            },
          ],
          about: {
            filings: 60,
            index_through: '2026-11-16',
            saved: 1,
            saved_updated: '2026-11-17',
            complete: true,
          },
        });
      return json({ title: 'Original.pdf', content_hash: version, folder_path: 'x' });
    });
    await render('/media-buys?q=held&page=2', () => <Flow />);
    const directory = window.location.pathname + window.location.search;
    const link = container.querySelector<HTMLAnchorElement>(
      'a[aria-label="Open filing PDF for Original.pdf"]',
    )!;
    const href = new URL(link.href);
    expect(decodeURIComponent(href.pathname)).toBe('/media-buys/files/national-' + key);
    expect(href.searchParams.has('version')).toBe(false);
    expect(href.searchParams.get('from')).toBe(directory);
    await act(async () => link.click());
    await flush();
    const detail = fetcher.mock.calls
      .map(([input]) => new URL(input))
      .find((u) => u.pathname.includes('/national-files/'))!;
    expect(decodeURIComponent(detail.pathname)).toContain('/national-files/' + key);
    expect(detail.searchParams.has('version')).toBe(false);
    expect(text()).toContain('Original.pdf');
    await click('Back to Media buys');
    expect(window.location.pathname + window.location.search).toBe(directory);
  });

  it('names Media buys as the national file’s return without earlier context', async () => {
    const path = '/media-buys/files/national-' + encodeURIComponent(key);
    serve(() => json({ title: 'Order', content_hash: version }));
    await render(path, () => <StationFile match={matchRoute(path)!} />);
    const back = container.querySelector<HTMLAnchorElement>('a.f-back')!;
    expect(back.textContent).toBe('Back to Media buys');
    expect(new URL(back.href).pathname + new URL(back.href).search).toBe('/media-buys');
  });

  it('holds one private PDF for preview and saving until the member closes it', async () => {
    const path = '/media-buys/files/national-' + encodeURIComponent(key);
    const fetcher = serve((url) =>
      url.pathname.endsWith('/original')
        ? new Response('%PDF-1.7', { headers: { 'content-type': 'application/pdf' } })
        : json({ title: 'Order/73.pdf', content_hash: version }),
    );
    await render(path + '?version=' + version, () => <StationFile match={matchRoute(path)!} />);
    const originalRequests = () => fetcher.mock.calls.filter(([url]) => url.includes('/original?'));
    expect(originalRequests()).toHaveLength(0);
    await click('Open original PDF');
    const preview = container.querySelector<HTMLIFrameElement>('iframe[title]');
    const save = container.querySelector<HTMLAnchorElement>('a[download]');
    expect(save?.download).toBe('Order-73.pdf');
    expect(save?.getAttribute('href')).toBe('blob:page');
    expect(preview?.getAttribute('src')).toBe(save?.getAttribute('href'));
    expect(originalRequests()).toHaveLength(1);
    expect(originalRequests()[0][1]?.headers).toEqual({ Authorization: 'Bearer test-token' });
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    await click('Close PDF');
    expect(container.querySelector('iframe, a[download]')).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:page');
    expect(window.location.search).toBe('?version=' + version);
  });

  it('clears the saved PDF on account change and checks access when the new account is refused', async () => {
    const path = '/media-buys/files/national-' + encodeURIComponent(key);
    const viewer = path + '?version=' + version + '&original=1';
    const fetcher = serve((url) => {
      if (!url.pathname.endsWith('/original'))
        return json({ title: 'Order', content_hash: version });
      return memberSession.accessToken === 'test-token'
        ? new Response('%PDF-1.7', { headers: { 'content-type': 'application/pdf' } })
        : json({}, 403);
    });
    const file = () => <StationFile match={matchRoute(path)!} />;
    await render(viewer, file);
    expect(container.querySelector('a[download]')).toBeTruthy();
    memberSession.accessToken = 'changed-token';
    await act(async () => root.render(file()));
    await flush();
    expect(container.querySelector('iframe, a[download]')).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:page');
    expect(memberSession.retry).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls.filter(([url]) => url.includes('/original?'))).toHaveLength(2);
    await click('Close PDF');
    expect(window.location.search).toBe('?version=' + version);
  });

  it('reads text only on request, uses the exact file version and offers retry when the PDF cannot open', async () => {
    const path = '/media-buys/files/national-' + encodeURIComponent(key);
    let originalReady = false;
    const fetcher = serve((url) => {
      expect(url.searchParams.get('version')).toBe(version);
      if (url.pathname.endsWith('/text'))
        return json({ pages: [{ page: 1, text: 'Order from the FCC record', method: 'ocr' }] });
      if (url.pathname.endsWith('/original'))
        return originalReady
          ? new Response('%PDF-1.7', { headers: { 'content-type': 'application/pdf' } })
          : json({}, 503);
      return json({
        title: 'National invoice',
        service: 'CABLE',
        station_name: 'Held Cable',
        file_id: 'test',
        folder_path: 'Political Files/2026/State',
        content_hash: version,
        page_count: 1,
        has_text: true,
        source_url: 'https://files.fcc.gov/download/test.pdf',
      });
    });
    await render(path + '?version=' + version, () => <StationFile match={matchRoute(path)!} />);
    expect(text()).toContain('National invoice');
    expect(fetcher.mock.calls.some(([url]) => new URL(url).pathname.endsWith('/text'))).toBe(false);
    await click('Show text');
    expect(text()).toContain('Order from the FCC record');
    await click('Open original PDF');
    expect(text()).toContain('Try opening PDF again');
    originalReady = true;
    await click('Try opening PDF again');
    expect(container.querySelector('a[download]')).toBeTruthy();
  });
});
