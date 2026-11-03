import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearReadCache } from '../api/read';
import { ConfirmIdentities, sourceLine } from '../pages/ConfirmIdentities';
import { historyRows } from '../pages/identities/history';
import type { Identity, QueuePage, QueueRow, RecordsPage } from '../pages/identities/types';
import {
  beyondName,
  joinBasis,
  queueAmount,
  queuePeriod,
  splitBasis,
} from '../pages/identities/words';
import { hasDraft } from '../ui/drafts';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock('../auth/session', () => ({
  useFinanceSession: () => ({ apiBaseUrl: 'https://api.example.test', accessToken: 'token' }),
}));

// The page's route turns on with the lead's change to BUILT; until then, treat it as on
// so return links carry this page's address.
vi.mock('../routes', async () => {
  const actual = await vi.importActual<typeof import('../routes')>('../routes');
  return {
    ...actual,
    isBuilt: (name: Parameters<typeof actual.isBuilt>[0]) =>
      name === 'identities' || actual.isBuilt(name),
  };
});

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

const NAME = 'Example Media, L.L.C.';
const FP = (n: number) => String(n).repeat(64).slice(0, 64);
const SNAP = '11111111-1111-1111-1111-111111111111';
const ORG = 'aaaaaaaa-0000-0000-0000-000000000002';
const DULUTH = 'aaaaaaaa-0000-0000-0000-000000000043';

function queueRow(over: Partial<QueueRow> = {}): QueueRow {
  return {
    record_kind: 'payee_name',
    record_key: NAME,
    name: NAME,
    records: 4,
    confirmed: 0,
    amount: '77600',
    amount_state: 'reported',
    missing_amounts: 0,
    undated_records: 0,
    period_basis: 'dates',
    first_year: 2024,
    last_year: 2026,
    first_date: '2024-09-30',
    last_date: '2026-06-12',
    snapshot_id: SNAP,
    source_url: null,
    copied_at: '2026-09-01T12:00:00Z',
    file: 'expenditures',
    ...over,
  };
}
function queuePage(rows: QueueRow[]): QueuePage {
  return {
    rows,
    page: 1,
    page_size: 20,
    total: rows.length,
    pages: 1,
    sources: {
      payee_name: {
        snapshot_id: SNAP,
        source_url: null,
        copied_at: '2026-09-01T12:00:00Z',
        file: 'expenditures',
      },
    },
  };
}
function fingerprint(n: number, over: Record<string, unknown> = {}) {
  return {
    fingerprint: FP(n),
    fields: {
      vendor_name: NAME,
      committee_reg_num: '18135',
      transaction_date: `2026-0${n}-0${n}`,
      amount: String(1000 * n),
    },
    rows: [{ row_number: 200 + n, year: 2026 }],
    confirmation: null,
    display: {
      filer_name: 'Example Candidate Committee',
      filer_registration_number: '18135',
      filer_is_held: true,
      record_type: 'Expenditure',
    },
    ...over,
  };
}
function recordsPage(over: Partial<RecordsPage> = {}): RecordsPage {
  return {
    record_kind: 'payee_name',
    record_key: NAME,
    file: 'expenditures',
    source_url: null,
    copied_at: '2026-09-01T12:00:00Z',
    snapshot_id: SNAP,
    records: 2,
    confirmed: 0,
    page: 1,
    page_size: 50,
    total_fingerprints: 2,
    pages: 1,
    years: [2026],
    identities: [],
    fingerprints: [fingerprint(1), fingerprint(2)] as RecordsPage['fingerprints'],
    no_longer_in_board_file: [],
    ...over,
  };
}
function confirmation(
  id: string,
  identity: string,
  fps: number[],
  over: Record<string, unknown> = {},
) {
  return {
    id,
    identity_id: identity,
    record_kind: 'payee_name',
    record_key: NAME,
    relation: 'Payee name as printed',
    status: 'confirmed',
    checked_at: '2026-08-02T15:00:00Z',
    withdrawn_at: null,
    withdrawal_reason: null,
    basis: 'Registration number 7654321 on both filings\nSource: Secretary of State record 7654321',
    replaces: null,
    replaced_by: null,
    evidence: {
      source: 'cf_expenditure_row',
      snapshot_id: SNAP,
      locator: '201',
      url: null,
      quote: NAME,
    },
    records: fps.map((n) => ({
      fingerprint: FP(n),
      fields: { transaction_date: `2026-0${n}-0${n}` },
      rows: 1,
      in_board_file: true,
    })),
    ...over,
  };
}
function identity(
  id: string,
  name: string,
  confirmations: unknown[],
  history: unknown[] = [],
): Identity {
  return {
    id,
    kind: 'organization',
    name,
    status: 'active',
    created_at: '2026-08-02T15:00:00Z',
    confirmations,
    printed_names: [],
    history,
  } as Identity;
}

type Handler = (
  url: URL,
  init: RequestInit | undefined,
) => Response | Promise<Response> | undefined;
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(status < 300 ? { data } : data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
const problem = (status: number, detail: string) =>
  new Response(JSON.stringify({ detail: { type: 'x', title: 't', status, detail } }), {
    status,
    headers: { 'Content-Type': 'application/problem+json' },
  });

let container: HTMLDivElement;
let root: Root;
let posts: Array<{ path: string; body: Record<string, unknown> }>;
function serve(handler: Handler) {
  posts = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input);
      if (init?.method === 'POST')
        posts.push({
          path: url.pathname.replace('/api/v1/', ''),
          body: JSON.parse(String(init.body)),
        });
      const answer = await handler(url, init);
      return answer ?? new Response('{}', { status: 404 });
    }),
  );
}
async function flush() {
  for (let i = 0; i < 8; i++)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
}
async function render(address: string) {
  window.history.replaceState(null, '', address);
  await act(async () => root.render(<ConfirmIdentities />));
  await flush();
}
const text = () => container.textContent ?? '';
const button = (label: string) =>
  [...container.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent === label,
  )!;
async function click(element: HTMLElement) {
  await act(async () => element.click());
  await flush();
}
async function type(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value')!.set!;
  await act(async () => {
    setter.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
const noteField = () => container.querySelector<HTMLTextAreaElement>('#identity-form textarea')!;
const sourceField = () =>
  container.querySelector<HTMLInputElement>('#identity-form input[aria-describedby="src-hint"]')!;

beforeEach(() => {
  clearReadCache();
  const storage = new MemoryStorage();
  vi.stubGlobal('localStorage', storage);
  Object.defineProperty(window, 'localStorage', { value: storage, configurable: true });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('word and money rules', () => {
  it('withholds a queue total under the shared rule and labels a filing-year basis', () => {
    expect(queueAmount(queueRow())).toBe('$77,600');
    expect(queueAmount(queueRow({ amount_state: 'incomplete_amount', amount: null }))).toBe(
      'Missing payment amount',
    );
    expect(
      queueAmount(
        queueRow({ amount_state: 'incomplete_period', period_basis: null, amount: null }),
      ),
    ).toBe('Reporting period incomplete');
    expect(
      queuePeriod(queueRow({ period_basis: 'years', first_year: 2025, last_year: 2025 })),
    ).toBe('Filing year 2025');
    expect(
      queuePeriod(queueRow({ period_basis: 'years', first_year: 2024, last_year: 2026 })),
    ).toBe('Filing years 2024–2026');
    expect(queuePeriod(queueRow())).toBe('Sep 30, 2024 to Jun 12, 2026');
  });

  it('asks evidence to name something besides the shared name', () => {
    expect(beyondName('Same name as Example Media LLC', [NAME, 'Example Media LLC'])).toBe(false);
    expect(beyondName('Registration number 1234567 on both filings', [NAME])).toBe(true);
  });

  it('keeps the evidence note and its source apart in the stored basis', () => {
    expect(splitBasis(joinBasis('Registration 1234567', 'SOS record'))).toEqual({
      note: 'Registration 1234567',
      src: 'SOS record',
    });
    expect(splitBasis('Only a note')).toEqual({ note: 'Only a note', src: null });
  });

  it('names 1 copy date when the files share it, else each file with its own', () => {
    expect(sourceLine(null)).toBe(
      'Confirmations, merges and splits are Alethical’s, each with its own evidence and date.',
    );
    const page = queuePage([]);
    page.sources = {
      donor_name: { ...page.sources.payee_name, file: 'contributions' },
      payee_name: page.sources.payee_name,
    };
    expect(sourceLine(page)).toBe(
      'Printed names: Minnesota Campaign Finance and Public Disclosure Board contribution and expenditure files, copied Sep 1, 2026. Confirmations, merges and splits are Alethical’s, each with its own evidence and date.',
    );
    page.sources.payee_name = { ...page.sources.payee_name, copied_at: '2026-10-27T12:00:00Z' };
    expect(sourceLine(page)).toContain(
      'contribution file, copied Sep 1, 2026; expenditure file, copied Oct 27, 2026.',
    );
  });
});

describe('history', () => {
  it('lists confirmations, withdrawals with earlier evidence and merges, newest first', () => {
    const withdrawn = confirmation('c-old', ORG, [3], {
      status: 'withdrawn',
      withdrawn_at: '2026-10-01T12:00:00Z',
      withdrawal_reason: 'Different registration number',
    });
    const reads = new Map([
      [
        ORG,
        identity(
          ORG,
          'Example Media LLC',
          [confirmation('c-1', ORG, [1, 2]), withdrawn],
          [
            {
              action: 'merged',
              at: '2026-10-20T12:00:00Z',
              detail: { from: DULUTH, into: ORG, reason: 'Same registration\nSource: SOS 1' },
            },
          ],
        ),
      ],
      [DULUTH, { ...identity(DULUTH, 'Example Media LLC of Duluth', []), status: 'merged' }],
    ]);
    const rows = historyRows(reads, 'payee_name', NAME, 4);
    expect(rows.map((row) => row.text)).toEqual([
      `Example Media LLC of Duluth (${DULUTH}) merged into Example Media LLC (${ORG}); 0 confirmed records moved with their own evidence and dates; ${DULUTH} now opens ${ORG}`,
      `Confirmation as Example Media LLC (${ORG}) withdrawn for 1 record: Different registration number`,
      `Confirmed as Example Media LLC (${ORG}) for 2 of 4 records, Jan 1, 2026 to Feb 2, 2026`,
      `Confirmed as Example Media LLC (${ORG}) for 1 of 4 records, Mar 3, 2026`,
    ]);
    expect(rows[0].evidence).toEqual(['Evidence: Same registration', 'Source: SOS 1']);
    expect(rows[1].evidence).toEqual([
      'Evidence: Different registration number',
      'Earlier confirmation, checked on Aug 2, 2026: Registration number 7654321 on both filings · Secretary of State record 7654321',
    ]);
  });
});

describe('Confirm identities page', () => {
  it('lists names to review with the money rules and the shared period label', async () => {
    serve((url) => {
      if (url.pathname.endsWith('/queue'))
        return json(
          queuePage([
            queueRow({
              period_basis: 'years',
              first_year: 2025,
              last_year: 2025,
              amount: '420',
              name: 'Courier',
            }),
            queueRow({
              record_key: 'Banner Co',
              name: 'Banner Co',
              amount: null,
              amount_state: 'incomplete_period',
              period_basis: null,
              confirmed: 2,
            }),
          ]),
        );
      if (url.pathname.endsWith('/records'))
        return json(recordsPage({ records: 0, fingerprints: [] }));
    });
    await render('/money/identities');
    expect(text()).toContain('2 names · most money recorded under the name first');
    expect(text()).toContain('$420');
    expect(text()).toContain('Money recorded, Filing year 2025');
    expect(text()).toContain('Reporting period incomplete');
    expect(text()).toContain('Payee name · Campaign payments · 4 records · Confirmed for 2 of 4');
    expect(text()).toContain(
      'Printed names: Minnesota Campaign Finance and Public Disclosure Board',
    );
  });

  it('keeps a failed queue distinct from an empty one, with Try again', async () => {
    let fail = true;
    serve((url) => {
      if (url.pathname.endsWith('/queue'))
        return fail ? new Response('{}', { status: 500 }) : json(queuePage([]));
    });
    await render('/money/identities');
    expect(text()).toContain(
      'We couldn’t load the names to review. This is a problem on our side.',
    );
    expect(text()).not.toContain('No names match these choices');
    fail = false;
    await click(button('Try again'));
    expect(text()).toContain('No names match these choices');
  });

  it('shows "This record is not held" for an arrival with no records, and opens nothing else', async () => {
    serve((url) => {
      if (url.pathname.endsWith('/queue')) return json(queuePage([queueRow()]));
      if (url.pathname.endsWith('/records'))
        return json(recordsPage({ records: 0, fingerprints: [] }));
    });
    await render('/money/identities?name=Exmaple&role=donor');
    expect(text()).toContain('This record is not held');
    expect(text()).toContain('No records under “Exmaple” are waiting to be confirmed');
    expect(container.querySelector('#name-h')).toBeNull();
  });

  it('opens a contextual arrival, its records and links that carry year, tab, name and from', async () => {
    serve((url) => {
      if (url.pathname.endsWith('/queue')) return json(queuePage([]));
      if (url.pathname.endsWith('/records')) return json(recordsPage());
    });
    await render(`/money/identities?name=${encodeURIComponent(NAME)}&role=payee`);
    expect(container.querySelector('#name-h')?.textContent).toBe(NAME);
    expect(text()).toContain('PAYEE NAME AS PRINTED');
    expect(text()).toContain('Not confirmed');
    expect(text()).toContain('No person or organization was suggested for this spelling');
    expect(text()).toContain('No confirmations or suggestions yet');
    const link = container.querySelector<HTMLAnchorElement>('.ci-filer')!;
    const href = new URL(link.getAttribute('href')!, 'https://x.test');
    expect(href.pathname).toBe('/money/committees/18135');
    expect(href.searchParams.get('year')).toBe('2026');
    expect(href.searchParams.get('tab')).toBe('expenditures');
    expect(href.searchParams.get('q')).toBe(NAME);
    expect(href.searchParams.get('from')).toContain('/money/identities');
  });

  it('lists every identity holding records of the spelling and offers the remainder', async () => {
    serve((url) => {
      if (url.pathname.endsWith('/queue')) return json(queuePage([]));
      if (url.pathname.endsWith('/records'))
        return json(
          recordsPage({
            records: 4,
            confirmed: 3,
            identities: [
              { id: ORG, kind: 'organization', name: 'Example Media LLC', confirmed: 2 },
              {
                id: DULUTH,
                kind: 'organization',
                name: 'Example Media LLC of Duluth',
                confirmed: 1,
              },
            ],
          }),
        );
      if (url.pathname.endsWith(ORG))
        return json(identity(ORG, 'Example Media LLC', [confirmation('c-1', ORG, [1, 2])]));
      if (url.pathname.endsWith(DULUTH))
        return json(
          identity(DULUTH, 'Example Media LLC of Duluth', [confirmation('c-2', DULUTH, [3])]),
        );
    });
    await render(`/money/identities?name=${encodeURIComponent(NAME)}&kind=payee_name`);
    expect(text()).toContain('2 identities · Confirmed for 3 of 4 records');
    expect(text()).toContain(
      `Organization · ${ORG} · Confirmed for 2 of 4 records · Checked on Aug 2, 2026`,
    );
    expect(text()).toContain('Shown below');
    expect(text()).toContain('1 of 4 records not confirmed');
    expect(text()).toContain('Already confirmed for 2 of 4 records under this spelling');
    expect(text()).toContain('Already confirmed for 1 of 4 records under this spelling');
    expect(container.querySelector(`a[href^="/organizations/${ORG}"]`)).not.toBeNull();
    await click(button('Show this identity'));
    expect(container.querySelector('.ci-confirmed-name')?.textContent).toBe(
      'Example Media LLC of Duluth',
    );
  });

  function heldServer(write: (path: string) => Response) {
    serve((url, init) => {
      if (init?.method === 'POST') return write(url.pathname);
      if (url.pathname.endsWith('/queue')) return json(queuePage([queueRow()]));
      if (url.pathname.endsWith('/records'))
        return json(
          recordsPage({
            records: 3,
            confirmed: 1,
            fingerprints: [
              fingerprint(1),
              fingerprint(2),
              fingerprint(3, {
                confirmation: {
                  id: 'c-1',
                  identity: { id: ORG, kind: 'organization', name: 'Example Media LLC' },
                },
              }),
            ] as RecordsPage['fingerprints'],
            identities: [
              { id: ORG, kind: 'organization', name: 'Example Media LLC', confirmed: 1 },
            ],
          }),
        );
      if (url.pathname.endsWith(ORG))
        return json(identity(ORG, 'Example Media LLC', [confirmation('c-1', ORG, [3])]));
    });
  }
  async function openConfirm() {
    await render(`/money/identities?name=${encodeURIComponent(NAME)}&kind=payee_name`);
    await click(button('Confirm as this organization'));
  }

  it('confirms the selected fingerprints with evidence and says Saved only after success', async () => {
    heldServer(() => json(identity(ORG, 'Example Media LLC', [])));
    await openConfirm();
    expect(text()).toContain(`Confirm “${NAME}” as Example Media LLC`);
    // Only unconfirmed records are offered.
    expect(container.querySelectorAll('#identity-form .ci-option')).toHaveLength(2);
    await click(button('Confirm identity'));
    expect(text()).toContain('Write what in the records shows this');
    expect(text()).toContain('Name the record, file or address that shows it');
    expect(text()).toContain('Choose at least 1 record');
    expect(posts).toHaveLength(0);
    await type(noteField(), 'Same name as Example Media LLC');
    await type(sourceField(), 'Secretary of State record 1234567');
    await click(container.querySelector<HTMLInputElement>('#identity-form .ci-option input')!);
    await click(button('Confirm identity'));
    expect(text()).toContain(
      'Name something besides the shared name, such as a registration number or filing',
    );
    await type(noteField(), 'Both records give the registration number on the business filing');
    expect(text()).toContain('1 of 2 records selected · Jan 1, 2026');
    await click(button('Confirm identity'));
    expect(posts).toHaveLength(1);
    expect(posts[0].path).toBe(`finance/identities/${ORG}/confirmations`);
    expect(posts[0].body).toMatchObject({
      record_kind: 'payee_name',
      record_key: NAME,
      evidence_source: 'cf_expenditure_row',
      evidence_snapshot_id: SNAP,
      evidence_locator: 201,
      evidence_quote: NAME,
      fingerprints: [FP(1)],
      basis:
        'Both records give the registration number on the business filing\nSource: Secretary of State record 1234567',
    });
    expect(posts[0].body.record_selection).toBeUndefined();
    expect(container.querySelector('[aria-live]')?.textContent).toBe('Saved');
    expect(container.querySelector('#identity-form')).toBeNull();
    expect(hasDraft(`identities|payee_name|${NAME}|`)).toBe(false);
  });

  it('sends a year selection as the server quick selection on the pinned copy', async () => {
    heldServer(() => json(identity(ORG, 'Example Media LLC', [])));
    await openConfirm();
    await click(button('2026 records'));
    await type(noteField(), 'Registration number 1234567 on both filings');
    await type(sourceField(), 'SOS 1234567');
    await click(button('Confirm identity'));
    expect(posts[0].body.record_selection).toEqual({ snapshot_id: SNAP, year: 2026 });
    expect(posts[0].body.fingerprints).toBeUndefined();
  });

  async function fillAndSave() {
    await openConfirm();
    await type(noteField(), 'Registration number 1234567 on both filings');
    await type(sourceField(), 'SOS 1234567');
    await click(container.querySelector<HTMLInputElement>('#identity-form .ci-option input')!);
    await click(button('Confirm identity'));
  }

  it('keeps entries on a failed save, never says Saved, and Try again sends again', async () => {
    let fail = true;
    heldServer(() => (fail ? new Response('{}', { status: 500 }) : json(identity(ORG, 'x', []))));
    await fillAndSave();
    expect(text()).toContain('Not saved. Your entries are kept.');
    expect(container.querySelector('[aria-live]')?.textContent).toBe('Not saved');
    expect(noteField().value).toBe('Registration number 1234567 on both filings');
    fail = false;
    await click(button('Try again'));
    expect(posts).toHaveLength(2);
    expect(container.querySelector('[aria-live]')?.textContent).toBe('Saved');
  });

  it('refuses a save when the records changed since the form opened', async () => {
    heldServer(() =>
      problem(422, '1 of the selected records are already confirmed for an identity'),
    );
    await fillAndSave();
    expect(text()).toContain(
      'These records changed since this form opened. Review the current records and select again.',
    );
    expect(text()).not.toContain('Saved');
    expect(noteField().value).toBe('Registration number 1234567 on both filings');
  });

  it('asks for a reload when the Board’s file changed, keeping the words and clearing the selection', async () => {
    heldServer(() =>
      problem(422, "The Board's file changed. Reload the records and select again."),
    );
    await fillAndSave();
    expect(text()).toContain('The Board’s file changed. Reload the records and select again.');
    await click(button('Confirm identity'));
    expect(posts).toHaveLength(1);
    await click(button('Reload the records'));
    expect(container.querySelector('[aria-live]')?.textContent).toBe('Records reloaded');
    expect(noteField().value).toBe('Registration number 1234567 on both filings');
    expect(sourceField().value).toBe('SOS 1234567');
    expect(
      container.querySelectorAll('#identity-form input[type="checkbox"]:checked'),
    ).toHaveLength(0);
  });

  it('shows the reload notice when a pinned records page answers 409', async () => {
    let calls = 0;
    serve((url) => {
      if (url.pathname.endsWith('/queue')) return json(queuePage([]));
      if (url.pathname.endsWith('/records')) {
        calls += 1;
        if (url.searchParams.get('page') === '2') return new Response('{}', { status: 409 });
        return json(recordsPage({ pages: 2 }));
      }
    });
    await render(`/money/identities?name=${encodeURIComponent(NAME)}&kind=payee_name`);
    await click(button('Next'));
    expect(text()).toContain('The Board’s file changed. Reload the records and select again.');
    expect(calls).toBeGreaterThan(1);
  });

  it('pages records inside the form without sending it', async () => {
    serve((url) => {
      if (url.pathname.endsWith('/queue')) return json(queuePage([]));
      if (url.pathname.endsWith('/records'))
        return json(recordsPage({ pages: 2, page: Number(url.searchParams.get('page') ?? 1) }));
    });
    await render(`/money/identities?name=${encodeURIComponent(NAME)}&kind=payee_name`);
    await click(button('Create a new organization'));
    const next = [...container.querySelectorAll<HTMLButtonElement>('#identity-form button')].find(
      (b) => b.textContent === 'Next',
    )!;
    await click(next);
    expect(text()).not.toContain('Write the name of the new record');
    expect(text()).toContain('Page 2 of 2');
    expect(posts).toHaveLength(0);
  });

  it('keeps 1 draft per target, tags the queue row and restores it on return', async () => {
    heldServer(() => json({}));
    await openConfirm();
    await type(noteField(), 'Registration 1234567');
    await click(button('Cancel'));
    expect(hasDraft(`identities|payee_name|${NAME}|`)).toBe(true);
    expect(text()).toContain('Unsaved draft');
    await click(button('Confirm as this organization'));
    expect(noteField().value).toBe('Registration 1234567');
    await click(button('Discard draft'));
    expect(hasDraft(`identities|payee_name|${NAME}|`)).toBe(false);
    expect(container.querySelector('#identity-form')).toBeNull();
  });

  it('withdraws with a reason, 1 request per confirmation of this spelling', async () => {
    heldServer(() => json(identity(ORG, 'Example Media LLC', [])));
    await render(`/money/identities?name=${encodeURIComponent(NAME)}&kind=payee_name`);
    await click(button('Withdraw confirmation'));
    expect(text()).toContain('Withdraw the confirmation as Example Media LLC');
    const submit = [...container.querySelectorAll<HTMLButtonElement>('#identity-form button')].find(
      (b) => b.textContent === 'Withdraw confirmation',
    )!;
    await click(submit);
    expect(text()).toContain('Write why this confirmation is withdrawn');
    await type(noteField(), 'Different registration number on the later filing');
    await click(submit);
    expect(posts).toEqual([
      {
        path: 'finance/identities/confirmations/c-1/withdraw',
        body: { reason: 'Different registration number on the later filing' },
      },
    ]);
  });

  it('previews the links that move before a merge and merges the chosen record in', async () => {
    const other = 'aaaaaaaa-0000-0000-0000-000000000042';
    serve((url, init) => {
      if (init?.method === 'POST') return json(identity(ORG, 'Example Media LLC', []));
      if (url.pathname.endsWith('/queue')) return json(queuePage([]));
      if (url.pathname.endsWith('/records'))
        return json(
          recordsPage({
            confirmed: 2,
            identities: [
              { id: ORG, kind: 'organization', name: 'Example Media LLC', confirmed: 2 },
            ],
          }),
        );
      if (url.pathname.endsWith(other))
        return json(
          identity(other, 'Example Media Group', [
            { ...confirmation('c-9', other, [4, 5]), record_key: 'EXAMPLE MEDIA GROUP INC' },
          ]),
        );
      if (url.pathname.endsWith(ORG))
        return json(identity(ORG, 'Example Media LLC', [confirmation('c-1', ORG, [1, 2])]));
      if (url.pathname.endsWith('/identities'))
        return json({
          rows: [
            { id: ORG, kind: 'organization', name: 'Example Media LLC' },
            { id: other, kind: 'organization', name: 'Example Media Group' },
          ],
          total: 2,
          page: 1,
          page_size: 20,
          pages: 1,
        });
    });
    await render(`/money/identities?name=${encodeURIComponent(NAME)}&kind=payee_name`);
    await click(button('Merge with another record'));
    expect(container.querySelectorAll('input[type="radio"]')).toHaveLength(1);
    await click(container.querySelector<HTMLInputElement>('input[type="radio"]')!);
    expect(text()).toContain(
      `These 2 confirmed records will move from Example Media Group (${other}) to Example Media LLC (${ORG}). Each keeps its own evidence. ${other} will then open ${ORG}.`,
    );
    expect(text()).toContain('EXAMPLE MEDIA GROUP INC');
    await type(noteField(), 'Registration number 7654321 on both business filings');
    await type(sourceField(), 'SOS 7654321');
    await click(button('Merge records'));
    expect(posts[0]).toEqual({
      path: `finance/identities/${other}/merge`,
      body: {
        into: ORG,
        reason: 'Registration number 7654321 on both business filings\nSource: SOS 7654321',
      },
    });
  });

  it('refuses a split that leaves a part empty, then splits by confirmation', async () => {
    serve((url, init) => {
      if (init?.method === 'POST') return json(identity(ORG, 'Example Media LLC', []));
      if (url.pathname.endsWith('/queue')) return json(queuePage([]));
      if (url.pathname.endsWith('/records'))
        return json(
          recordsPage({
            confirmed: 2,
            identities: [
              { id: ORG, kind: 'organization', name: 'Example Media LLC', confirmed: 2 },
            ],
          }),
        );
      if (url.pathname.endsWith(ORG))
        return json(
          identity(ORG, 'Example Media LLC', [
            confirmation('c-1', ORG, [1]),
            { ...confirmation('c-2', ORG, [2]), record_key: 'Example Media LLC' },
            {
              ...confirmation('c-3', ORG, []),
              record_kind: 'committee',
              record_key: '30212',
              records: null,
            },
          ]),
        );
    });
    await render(`/money/identities?name=${encodeURIComponent(NAME)}&kind=payee_name`);
    await click(button('Split this record'));
    expect(text()).toContain('Roles that move to the new record');
    expect(text()).toContain('Campaign accounts · 30212');
    const boxes = () => [
      ...container.querySelectorAll<HTMLInputElement>('#identity-form input[type="checkbox"]'),
    ];
    for (const box of boxes()) await click(box);
    await type(
      container.querySelector<HTMLInputElement>('#identity-form input[type="text"]')!,
      'Example Media Buying Co',
    );
    await type(noteField(), 'Different registration numbers on the two filings');
    await type(sourceField(), 'SOS 1 and SOS 2');
    await click(button('Split record'));
    expect(text()).toContain('Every part needs at least 1 record');
    expect(posts).toHaveLength(0);
    await click(boxes()[0]);
    await click(button('Split record'));
    expect(posts[0].path).toBe(`finance/identities/${ORG}/split`);
    expect(posts[0].body.parts).toEqual([
      { name: 'Example Media LLC', confirmations: ['c-1'] },
      { name: 'Example Media Buying Co', confirmations: ['c-2', 'c-3'] },
    ]);
  });
});
