import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearReadCache } from '../api/read';
import { CheckStationFiles, queueNote } from '../pages/CheckStationFiles';
import {
  blankDraft,
  draftKey,
  findDuplicate,
  historyRows,
  refusalField,
  validate,
} from '../pages/checkStation/model';
import type { FileDetail } from '../pages/media/types';
import { navigate } from '../router';
import * as routes from '../routes';
import { clearDrafts } from '../ui/drafts';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock('../auth/session', () => ({
  useFinanceSession: () => ({
    apiBaseUrl: 'https://api.example.test',
    accessToken,
  }),
}));

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() {
    return this.values.size;
  }
  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, String(value));
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
  clear() {
    this.values.clear();
  }
}

const VERSION = 'a'.repeat(64);
const OLD = 'b'.repeat(64);
const KEY = 'kstp-tv-file-1';
const OTHER = 'kare-file-2';
const ROW = {
  key: KEY,
  name: 'invoice.pdf',
  label: 'invoice.pdf',
  folder_label: 'Political File / 2026 / Local / Example Committee',
  station: 'KSTP-TV',
  year: 2026,
  category: 'Local',
  uploaded_at: '2026-03-04',
  version_id: VERSION,
  version_count: 2,
  source_changed: false,
  saved_at: '2026-03-05T15:14:00Z',
  suggestion_count: 1,
  reasons: [{ kind: 'folder_committee_checked' as const, label: 'Example Committee' }],
};
const DETAIL: FileDetail = {
  ...ROW,
  agencies: [],
  folder: { key: 'kstp-tv-folder', label: ROW.folder_label },
  fcc_url: 'https://publicfiles.fcc.gov',
  fcc_available: true,
  versions: [
    { id: VERSION, first_saved_at: '2026-03-05T15:14:00Z', uploaded_at: null },
    { id: OLD, first_saved_at: '2026-03-04T22:40:00Z', uploaded_at: null },
  ],
  page_count: 3,
  pages: [
    { number: 1, text: 'BILL TO: EXAMPLE MEDIA BUYING', text_status: 'ready' },
    { number: 2, text: 'NET $10,625.00\nGROSS TOTAL $12,500.00', text_status: 'ready' },
    { number: 3, text: null, text_status: 'pending' },
  ],
  facts: [
    {
      id: 'fact-1',
      kind: 'Gross amount',
      status: 'checked',
      version_id: VERSION,
      value: '$12,500.00',
      quote: 'GROSS TOTAL $12,500.00',
      page: 2,
      checked_at: '2026-10-02',
      history: [{ value: '$12,000.00', corrected_at: '2026-10-02' }],
    },
    {
      id: 'fact-0',
      kind: 'Gross amount',
      status: 'withdrawn',
      version_id: VERSION,
      withdrawn_at: '2026-10-02',
    },
  ],
  dates: [],
  connections: [],
  current_source_version: VERSION,
};
const SUGGESTIONS = {
  key: KEY,
  version_id: VERSION,
  extraction_version: 'x',
  facts: [
    {
      field: 'net_amount',
      machine_field: 'net_amount',
      value: '$10,625.00',
      page: 2,
      pages: [2],
      quote: 'NET $10,625.00',
      in_source_text: true,
      already_checked: false,
    },
    {
      field: 'gross_amount',
      machine_field: 'gross_amount',
      value: '$12,500.00',
      page: 2,
      pages: [2],
      quote: 'GROSS TOTAL $12,500.00',
      in_source_text: true,
      already_checked: true,
    },
  ],
};

let container: HTMLDivElement;
let root: Root;
let posts: Array<{ path: string; body: Record<string, unknown> }>;
let writeAnswer: (path: string) => Response;
let lookup: ((url: URL, signal: AbortSignal | null | undefined) => Promise<Response>) | null;
let preview: ((signal: AbortSignal | null | undefined) => Promise<Response>) | null;
let accessToken: string;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(status < 300 ? { data } : data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
function serve() {
  const fetcher = vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    const path = url.pathname.replace('/api/v1/', '');
    if (init?.method === 'POST') {
      posts.push({ path, body: JSON.parse(String(init.body)) });
      return writeAnswer(path);
    }
    if (path.includes('/pages/'))
      return new Response(new Blob(['x'], { type: 'image/png' }), {
        headers: { 'content-type': 'image/png' },
      });
    if (path.endsWith('/queue'))
      return json({
        rows:
          url.searchParams.get('q') !== null
            ? [{ ...ROW, key: OTHER, name: 'other.pdf' }]
            : [ROW, { ...ROW, key: OTHER, name: 'other.pdf', suggestion_count: 0, reasons: [] }],
        total: 2,
        limit: 20,
        offset: 0,
        has_more: false,
        sort: 'suggested',
      });
    if (path.endsWith('/suggestions') && path.startsWith('finance/media-buys'))
      return json(SUGGESTIONS);
    if (path === 'finance/suggestions' && lookup) return lookup(url, init?.signal);
    if (path === 'finance/suggestions')
      return json({
        request_id: 'station-check',
        q: 'x',
        bills: [],
        money: {
          groups: [
            {
              kind: 'committees',
              state: 'reported',
              results: [
                {
                  kind: 'committee',
                  name: 'Example Committee',
                  registration_number: '90001',
                  filer_kind: null,
                },
              ],
            },
          ],
        },
      });
    if (path.endsWith('/target-preview') && preview) return preview(init?.signal);
    if (path.endsWith('/target-preview'))
      return json({
        kind: 'committee',
        target_id: '90001',
        label: 'Example Committee',
        target_fingerprint: 'fp-1',
        fields: [{ label: 'Registration number', value: '90001' }],
      });
    if (path.endsWith(`/files/${OTHER}`))
      return json({ ...DETAIL, key: OTHER, name: 'other.pdf', facts: [] });
    if (path.endsWith(`/files/${KEY}`)) return json(DETAIL);
    return json({}, 404);
  });
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
}
async function flush() {
  for (let i = 0; i < 8; i += 1)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
}
async function open(path: string) {
  await act(async () => {
    navigate(path);
    root.render(<CheckStationFiles />);
  });
  await flush();
}
const text = () => (container.textContent ?? '').replace(/ /g, ' ');
async function press(label: string | RegExp) {
  const element = [...document.querySelectorAll<HTMLElement>('button, a')].find((e) =>
    typeof label === 'string' ? e.textContent?.trim() === label : label.test(e.textContent ?? ''),
  );
  expect(element, String(label)).toBeTruthy();
  await act(async () => element!.click());
  await flush();
}
async function type(id: string, value: string) {
  const element = document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement;
  expect(element, id).toBeTruthy();
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value')!.set!;
  await act(async () => {
    setter.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function tick(id: string) {
  await act(async () => (document.getElementById(id) as HTMLInputElement).click());
}
async function chooseFact(label: string) {
  await press(/Choose a fact|Gross amount|Net amount/);
  await press(label);
}

beforeEach(() => {
  clearReadCache();
  const storage = new MemoryStorage();
  vi.stubGlobal('localStorage', storage);
  Object.defineProperty(window, 'localStorage', { value: storage, configurable: true });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  window.scrollTo = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
  URL.createObjectURL = vi.fn(() => 'blob:page');
  URL.revokeObjectURL = vi.fn();
  posts = [];
  lookup = null;
  preview = null;
  accessToken = 'test-token';
  writeAnswer = () => json({ id: 'new-1', status: 'checked' }, 201);
  serve();
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Check TV station files', () => {
  it('lists the queue with each file’s reason and opens the first file at its current version', async () => {
    await open('/media-buys/check');
    expect(text()).toContain('Check TV station files');
    expect(text()).toContain('Each check belongs to one exact source version');
    expect(text()).toContain('Queue 2');
    expect(text()).toContain(
      'KSTP-TV · 1 suggestion · saved Mar 5, 2026 · Folder checked as relating to Example Committee',
    );
    expect(text()).toContain('Source version First saved');
    expect(text()).toContain('Suggestions 2');
    expect(text()).toContain('Already checked · Checked on Oct 2, 2026');
    expect(text()).toContain('Checks on this version 1');
    expect(text()).toContain('Corrected · Oct 2, 2026');
    expect(text()).not.toContain('Withdrawn ·');
    const openFile = [...container.querySelectorAll('a')].find((a) =>
      a.textContent?.includes('Open'),
    );
    expect(openFile?.getAttribute('href')).toContain(`/media-buys/files/${KEY}?version=${VERSION}`);
  });

  it('shows the version-mismatch notice for a link naming an older version', async () => {
    await open(`/media-buys/check?file=${KEY}&version=${OLD}`);
    expect(text()).toContain('This link is for the version first saved');
    expect(text()).toContain('which can’t be checked. Checks are added to the current copy');
    expect(text()).not.toContain('Check a fact');
    await press('Check the current copy');
    expect(window.location.search).toContain(`version=${VERSION}`);
    expect(text()).toContain('Check a fact');
  });

  it('refuses a save with the drawn field words and keeps the entries', async () => {
    await open(`/media-buys/check?file=${KEY}&version=${VERSION}`);
    await press('Save');
    expect(text()).toContain('Choose the fact this value shows');
    expect(text()).toContain('Enter the value as printed');
    expect(text()).toContain('Copy the line from the page that shows this value');
    expect(text()).toContain('Say what on the page supports this');
    expect(text()).toContain('Check the page image first');
    await chooseFact('Net amount');
    await type('f-value', '$10,625.00');
    await type('f-page', '3');
    await type('f-quote', 'NET $10,625.00');
    await press('Save');
    expect(text()).toContain(
      'Machine-read text is not available for this page. Your draft is kept; choose a page with text before saving.',
    );
    await type('f-page', '9');
    await press('Save');
    expect(text()).toContain('This version has 3 pages');
    expect(posts).toEqual([]);
  });

  it('saves a fact from a suggestion on the exact version and says Saved only after the write', async () => {
    await open(`/media-buys/check?file=${KEY}&version=${VERSION}`);
    await press(/Use suggestion/);
    expect(text()).toContain('Used · fills the form below');
    expect((document.getElementById('f-value') as HTMLInputElement).value).toBe('$10,625.00');
    expect(window.location.search).toContain('page=2');
    await type('f-evidence', 'Totals line on page 2');
    await tick('f-confirm');
    await press('Save');
    expect(posts).toHaveLength(1);
    expect(posts[0].path).toBe(`finance/media-buys/files/${KEY}/versions/${VERSION}/facts`);
    expect(posts[0].body).toMatchObject({
      field: 'net_amount',
      value: '$10,625.00',
      page: 2,
      quote: 'NET $10,625.00',
      evidence: 'Totals line on page 2',
      correctness_reviewed: true,
    });
    expect(text()).toMatch(/Saved · Checked on \w{3} \d+, \d{4}/);
    expect((document.getElementById('f-value') as HTMLInputElement).value).toBe('');
    expect(localStorage.getItem(`alethical-finance-draft:${draftKey(KEY, VERSION)}`)).toBeNull();
  });

  it('shows a server refusal beside its field and a failed write as Not saved with Try again', async () => {
    writeAnswer = () => json({ detail: 'Amount must be explicitly printed in the quotation' }, 422);
    await open(`/media-buys/check?file=${KEY}&version=${VERSION}`);
    await chooseFact('Net amount');
    await type('f-value', '$600');
    await type('f-page', '2');
    await type('f-quote', 'NET $10,625.00');
    await type('f-evidence', 'Totals');
    await tick('f-confirm');
    await press('Save');
    expect(text()).toContain('The quote doesn’t show this value');
    expect((document.getElementById('f-value') as HTMLInputElement).value).toBe('$600');
    writeAnswer = () => json({}, 500);
    await press('Save');
    expect(text()).toContain('Not saved. Your entries are kept.');
    expect(text()).toContain('Try again');
    expect(text()).not.toContain('Saved ·');
    expect((document.getElementById('f-quote') as HTMLTextAreaElement).value).toBe(
      'NET $10,625.00',
    );
  });

  it('says Already saved for an exact duplicate and writes nothing', async () => {
    await open(`/media-buys/check?file=${KEY}&version=${VERSION}`);
    await chooseFact('Gross amount');
    await type('f-value', '$12,500.00');
    await type('f-page', '2');
    await type('f-quote', 'GROSS TOTAL $12,500.00');
    await type('f-evidence', 'Totals');
    await tick('f-confirm');
    await press('Save');
    expect(text()).toContain('Already saved · Checked on Oct 2, 2026');
    expect(posts).toEqual([]);
  });

  it('keeps one draft per file and version, each mode with its own entries', async () => {
    await open(`/media-buys/check?file=${KEY}&version=${VERSION}`);
    await type('f-value', 'Fact value');
    await press('Check a connection');
    await type('f-quote', 'Connection quote');
    await press('Check a fact');
    expect((document.getElementById('f-value') as HTMLInputElement).value).toBe('Fact value');
    expect(localStorage.getItem(`alethical-finance-draft:${draftKey(KEY, VERSION)}`)).toContain(
      'Fact value',
    );
    await press(/other\.pdf/);
    expect(window.location.search).toContain(`file=${OTHER}`);
    expect(text()).toContain('Unsaved draft');
    expect((document.getElementById('f-value') as HTMLInputElement).value).toBe('');
    await press(/invoice\.pdf/);
    expect((document.getElementById('f-value') as HTMLInputElement).value).toBe('Fact value');
    await press('Check a connection');
    expect((document.getElementById('f-quote') as HTMLTextAreaElement).value).toBe(
      'Connection quote',
    );
    await press('Discard draft');
    expect(localStorage.getItem(`alethical-finance-draft:${draftKey(KEY, VERSION)}`)).toBeNull();
    expect(text()).not.toContain('Unsaved draft');
  });

  it('withdraws a check only after the write succeeds, keeping the reason on failure', async () => {
    writeAnswer = () => json({}, 500);
    await open(`/media-buys/check?file=${KEY}&version=${VERSION}&check=fact-1&action=withdraw`);
    expect(document.getElementById('wr-fact-1')).toBeTruthy();
    expect(window.location.search).not.toContain('action=');
    await press('Withdraw check');
    expect(text()).toContain('Give a reason');
    await type('wr-fact-1', 'The gross line belongs to the earlier order');
    await press('Withdraw check');
    expect(posts[0]).toEqual({
      path: 'finance/media-buys/facts/fact-1/withdraw',
      body: { reason: 'The gross line belongs to the earlier order' },
    });
    expect(text()).toContain(
      'We couldn’t withdraw this check. This is a problem on our side; your reason is kept.',
    );
    expect((document.getElementById('wr-fact-1') as HTMLTextAreaElement).value).toBe(
      'The gross line belongs to the earlier order',
    );
    expect(text()).not.toContain('Check withdrawn');
    writeAnswer = () => json({ id: 'fact-1', status: 'withdrawn' });
    await press('Try again');
    expect(text()).toContain('Check withdrawn');
  });

  it('opens Correct fact from the evidence panel locked to that fact', async () => {
    await open(`/media-buys/check?file=${KEY}&version=${VERSION}`);
    await press('View evidence');
    const panel = document.querySelector('[role="dialog"]')!;
    expect(panel.textContent).toContain('Gross amount: $12,500.00');
    expect(panel.querySelector('mark')?.textContent).toBe('GROSS TOTAL $12,500.00');
    await press('Correct fact');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect((document.getElementById('f-current') as HTMLInputElement).value).toBe('$12,500.00');
    expect((document.getElementById('fact-btn') as HTMLButtonElement).disabled).toBe(true);
    expect(text()).toContain('Save correction');
    await type('f-value', '$12,600.00');
    await type('f-quote', 'GROSS TOTAL $12,500.00');
    await type('f-evidence', 'Totals');
    await tick('f-confirm');
    writeAnswer = () =>
      json({ detail: 'This fact was corrected a moment ago. Reload and check.' }, 409);
    await press('Save correction');
    expect(posts[0].body).toMatchObject({ supersedes_id: 'fact-1', field: 'gross_amount' });
    expect(text()).toContain('This fact was corrected a moment ago. Reload and check.');
  });

  it('saves a connection only to the previewed record, by its fingerprint', async () => {
    vi.spyOn(routes, 'isBuilt').mockReturnValue(true);
    await open(`/media-buys/check?file=${KEY}&version=${VERSION}`);
    await press('Check a connection');
    await press(/Choose a connection/);
    await press('Committee');
    await type('c-query', 'Example');
    await press('Search');
    expect(text()).toContain('Registration 90001');
    await press('Preview record');
    expect(text()).toContain('Selected record');
    expect(text()).toContain('A matching name alone does not establish identity');
    await type('f-page', '1');
    await type('f-quote', 'BILL TO: EXAMPLE MEDIA BUYING');
    await type('f-evidence', 'Bill-to block');
    await tick('f-confirm');
    writeAnswer = () =>
      json(
        { detail: 'Target changed or was not previewed; review its exact fingerprint again' },
        422,
      );
    await press('Save connection');
    expect(posts[0].path).toBe(`finance/media-buys/files/${KEY}/versions/${VERSION}/connections`);
    expect(posts[0].body).toMatchObject({
      kind: 'committee',
      target_id: '90001',
      expected_target_fingerprint: 'fp-1',
      page: 1,
    });
    expect(text()).toContain('The selected record changed. Preview it again before saving.');
    await press('Preview again');
    expect(text()).not.toContain('The selected record changed');
  });

  it('finds issues as typed and clears the selected record with the query', async () => {
    vi.spyOn(routes, 'isBuilt').mockReturnValue(true);
    await open(`/media-buys/check?file=${KEY}&version=${VERSION}`);
    await press('Check a connection');
    await press(/Choose a connection/);
    await press('Issue');
    await type('c-query', 'Transit ');
    expect(document.querySelector('[aria-label="Records found"]')?.textContent ?? '').toContain(
      'Transit',
    );
    expect((document.getElementById('c-query') as HTMLInputElement).value).toBe('Transit ');
    await press('Preview record');
    expect(text()).toContain('Selected record');
    await type('c-query', '');
    expect(text()).not.toContain('Selected record');
    expect(document.querySelector('[aria-label="Records found"]')).toBeNull();
    expect(posts).toEqual([]);
  });

  it('keeps earlier results on failure and ignores replies after clearing or switching type', async () => {
    vi.spyOn(routes, 'isBuilt').mockReturnValue(true);
    await open(`/media-buys/check?file=${KEY}&version=${VERSION}`);
    await press('Check a connection');
    await press(/Choose a connection/);
    await press('Committee');
    await type('c-query', 'Example');
    await vi.waitFor(() => expect(text()).toContain('Registration 90001'));

    const requests: Array<{
      query: string | null;
      signal?: AbortSignal | null;
      resolve: (response: Response) => void;
    }> = [];
    lookup = (url, signal) =>
      new Promise((resolve) => {
        requests.push({ query: url.searchParams.get('q'), signal, resolve });
      });
    await type('c-query', 'Another');
    await press('Search');
    expect(requests.map((request) => request.query)).toEqual(['Another']);
    expect(text()).toContain('Registration 90001');
    expect(text()).toContain('Previous results');
    await act(async () => requests[0].resolve(json({}, 500)));
    expect(text()).toContain('We couldn’t load these records');
    expect(text()).toContain('Registration 90001');
    expect(text()).not.toContain('No held records match');

    await press('Try again');
    expect(requests).toHaveLength(2);
    await type('c-query', '');
    expect(requests[1].signal?.aborted).toBe(true);
    await act(async () => requests[1].resolve(json({}, 500)));
    expect(text()).not.toContain('We couldn’t load these records');
    expect(text()).not.toContain('Registration 90001');

    await type('c-query', 'A third');
    await press('Search');
    expect(requests).toHaveLength(3);
    await press('Committee');
    await press('Issue');
    expect(requests[2].signal?.aborted).toBe(true);
    await act(async () => requests[2].resolve(json({}, 500)));
    expect(document.querySelector('[aria-label="Records found"]')?.textContent).toContain(
      'A third',
    );
    expect(text()).not.toContain('We couldn’t load these records');
  });

  it('shows the minimum for a short record search instead of reporting no matches', async () => {
    vi.spyOn(routes, 'isBuilt').mockReturnValue(true);
    await open(`/media-buys/check?file=${KEY}&version=${VERSION}`);
    await press('Check a connection');
    await press(/Choose a connection/);
    await press('Committee');
    lookup = async () =>
      json({
        money: {
          state: 'unavailable',
          groups: [
            { kind: 'committees', state: 'unavailable', reason: 'query_too_short', results: [] },
          ],
        },
      });
    await type('c-query', 'Ex');
    await press('Search');
    expect(text()).toContain('Type at least 3 characters');
    expect(text()).not.toContain('No held records match');
    expect(text()).not.toContain('Try again');
  });

  it('keeps the old query’s results when the selected record group is unavailable', async () => {
    vi.spyOn(routes, 'isBuilt').mockReturnValue(true);
    await open(`/media-buys/check?file=${KEY}&version=${VERSION}`);
    await press('Check a connection');
    await press(/Choose a connection/);
    await press('Committee');
    await type('c-query', 'Example');
    await press('Search');
    expect(text()).toContain('Registration 90001');

    lookup = async () =>
      json({
        money: {
          state: 'reported',
          groups: [
            { kind: 'committees', state: 'unavailable', reason: 'no_register', results: [] },
            { kind: 'principals', state: 'not_reported', results: [] },
          ],
        },
      });
    await type('c-query', 'Another');
    await press('Search');
    expect(text()).toContain('We couldn’t load these records');
    expect(text()).toContain('Previous results for “Example”');
    expect(text()).toContain('Registration 90001');
    expect(text()).not.toContain('No held records match');

    lookup = async () =>
      json({
        money: {
          state: 'reported',
          groups: [
            { kind: 'committees', state: 'not_reported', results: [] },
            {
              kind: 'principals',
              state: 'unavailable',
              reason: 'no_lobbying_release',
              results: [],
            },
          ],
        },
      });
    await press('Try again');
    expect(text()).toContain('No held records match');
    expect(text()).not.toContain('We couldn’t load these records');
    expect(text()).not.toContain('Registration 90001');

    const unexpectedRead = vi.fn(async () => json({}, 500));
    lookup = unexpectedRead;
    await press('Committee');
    await press('Lobbying principal');
    await press('Search');
    expect(unexpectedRead).not.toHaveBeenCalled();
    expect(text()).toContain('We couldn’t load these records');
    expect(text()).not.toContain('No held records match');
  });

  it('cannot restore a preview after the reviewer changes the query', async () => {
    vi.spyOn(routes, 'isBuilt').mockReturnValue(true);
    await open(`/media-buys/check?file=${KEY}&version=${VERSION}`);
    await press('Check a connection');
    await press(/Choose a connection/);
    await press('Issue');
    await type('c-query', 'Transit');
    let finish!: (answer: Response) => void;
    let requestSignal: AbortSignal | null | undefined;
    preview = (signal) =>
      new Promise((resolve) => {
        requestSignal = signal;
        finish = resolve;
      });
    await press('Preview record');
    expect(text()).toContain('Selected record');
    await type('c-query', 'Housing');
    expect(requestSignal?.aborted).toBe(true);
    await act(async () =>
      finish(json({ label: 'Transit', target_fingerprint: 'fp-1', fields: [] })),
    );
    expect(text()).not.toContain('Selected record');
    expect(document.querySelector('[aria-label="Records found"]')?.textContent).toContain(
      'Housing',
    );
    expect(posts).toEqual([]);
  });

  it('drops private matches and cancels the lookup when the account changes', async () => {
    vi.spyOn(routes, 'isBuilt').mockReturnValue(true);
    await open(`/media-buys/check?file=${KEY}&version=${VERSION}`);
    await press('Check a connection');
    await press(/Choose a connection/);
    await press('Committee');
    await type('c-query', 'Example');
    await press('Search');
    expect(text()).toContain('Registration 90001');
    let finish!: (answer: Response) => void;
    let requestSignal: AbortSignal | null | undefined;
    lookup = (_url, signal) =>
      new Promise((resolve) => {
        requestSignal = signal;
        finish = resolve;
      });
    await type('c-query', 'Another account’s record');
    await press('Search');
    await act(async () => {
      clearDrafts();
      accessToken = 'different-account-token';
      root.render(<CheckStationFiles />);
    });
    expect(requestSignal?.aborted).toBe(true);
    await act(async () => finish(json({}, 500)));
    await flush();
    expect(text()).not.toContain('Registration 90001');
    expect(text()).not.toContain('We couldn’t load these records');
    expect(document.querySelector('[aria-label="Records found"]')).toBeNull();
  });
});

describe('Check TV station files rules', () => {
  it('words the queue row from the server’s reasons', () => {
    expect(
      queueNote({
        ...ROW,
        suggestion_count: 0,
        reasons: [{ kind: 'agency_checked_elsewhere', label: 'X' }],
      }),
    ).toBe('KSTP-TV · no suggestions · saved Mar 5, 2026 · Agency name checked on another file');
  });

  it('maps server refusals to their field, the stale correction and a changed record', () => {
    const draft = { ...blankDraft('2'), fact: { ...blankDraft('2').fact, page: '2' } };
    expect(
      refusalField(
        "Quotation must appear in this original's machine-read text on that page",
        draft,
        3,
      ),
    ).toEqual({
      field: 'quote',
      message: 'This line isn’t in page 2’s machine-read text',
    });
    expect(
      refusalField(
        'Correction must replace a standing check of this field on this exact version',
        draft,
        3,
      ),
    ).toBe('stale');
    expect(
      refusalField(
        'Target changed or was not previewed; review its exact fingerprint again',
        draft,
        3,
      ),
    ).toBe('changed');
    expect(
      refusalField(
        'Agency address needs the same exact checked agency name on this version',
        draft,
        3,
      ),
    ).toBeNull();
  });

  it('never counts the corrected fact as its own duplicate', () => {
    const draft = blankDraft('2');
    draft.fact = {
      ...draft.fact,
      field: 'gross_amount',
      value: '$12,500.00',
      quote: 'GROSS TOTAL $12,500.00',
      correcting: 'fact-1',
    };
    expect(findDuplicate(draft, DETAIL)).toBeNull();
    draft.fact.correcting = null;
    expect(findDuplicate(draft, DETAIL)?.id).toBe('fact-1');
  });

  it('lists a corrected fact once, as corrected', () => {
    expect(historyRows(DETAIL)).toEqual([
      { key: 'c0', label: 'Gross amount', value: '$12,000.00', meta: 'Corrected · Oct 2, 2026' },
    ]);
  });

  it('asks for a previewed record before a connection saves', () => {
    const draft = { ...blankDraft('1'), mode: 'connection' as const };
    draft.connection = {
      ...draft.connection,
      type: 'issue',
      quote: 'BILL TO: EXAMPLE MEDIA BUYING',
      evidence: 'x',
      confirmed: true,
    };
    expect(validate(draft, DETAIL, KEY)).toEqual({ target: 'Preview a record before saving' });
  });
});
