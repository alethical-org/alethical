import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { partlyWithdrawn } from '../pages/identities/Detail';

import { clearReadCache } from '../api/read';
import { ConfirmIdentities, sourceLine } from '../pages/ConfirmIdentities';
import { historyRows } from '../pages/identities/history';
import type { Identity, QueuePage, QueueRow, RecordsPage } from '../pages/identities/types';
import {
  beyondName,
  coveredRows,
  named,
  queueAmount,
  queuePeriod,
  refOf,
  sumCounts,
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
const OTHER = 'aaaaaaaa-0000-0000-0000-000000000042';
const REFS: Record<string, string> = {
  [ORG]: 'ORG-0002',
  [DULUTH]: 'ORG-0043',
  [OTHER]: 'ORG-0042',
};

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
    basis: 'Registration number 7654321 on both filings',
    source: 'Secretary of State record 7654321',
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
/** A confirmation whose printed name's file the server does not hold: every record's
 * `rows` and `in_board_file` are null (identity_confirmations._payloads). */
function notHeld(c: ReturnType<typeof confirmation>) {
  return {
    ...c,
    records: c.records!.map((record) => ({ ...record, rows: null, in_board_file: null })),
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
    reference: REFS[id] ?? null,
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

  it('prints a reference, or the name when the payload has none, never the id', () => {
    expect(refOf({ reference: 'ORG-0042', name: 'Example Media Group' })).toBe('ORG-0042');
    expect(refOf({ reference: null, name: 'Example Media Group' })).toBe('Example Media Group');
    expect(named({ reference: 'ORG-0042', name: 'Example Media Group' })).toBe(
      'Example Media Group (ORG-0042)',
    );
    expect(named({ name: 'Example Media Group' })).toBe('Example Media Group');
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
      withdrawal_source: 'Secretary of State record 9999999',
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
              detail: { from: DULUTH, into: ORG, reason: 'Same registration', source: 'SOS 1' },
              references: { [DULUTH]: 'ORG-0043', [ORG]: 'ORG-0002' },
            },
          ],
        ),
      ],
      [DULUTH, { ...identity(DULUTH, 'Example Media LLC of Duluth', []), status: 'merged' }],
    ]);
    const rows = historyRows(reads, 'payee_name', NAME, 4);
    expect(rows.map((row) => row.text)).toEqual([
      'Example Media LLC of Duluth (ORG-0043) merged into Example Media LLC (ORG-0002); confirmed records moved to ORG-0002 with their own evidence and dates; ORG-0043 now opens ORG-0002',
      'Confirmation as Example Media LLC (ORG-0002) withdrawn for 1 record: Different registration number',
      'Confirmed as Example Media LLC (ORG-0002) for 2 of 4 records, Jan 1, 2026 to Feb 2, 2026',
      'Confirmed as Example Media LLC (ORG-0002) for 1 of 4 records, Mar 3, 2026',
    ]);
    expect(rows[0].evidence).toEqual(['Evidence: Same registration', 'Source: SOS 1']);
    expect(rows[1].evidence).toEqual([
      'Evidence: Different registration number',
      'Source: Secretary of State record 9999999',
      'Earlier confirmation, checked on Aug 2, 2026: Registration number 7654321 on both filings · Secretary of State record 7654321',
    ]);
  });
});

describe('history of a split', () => {
  const OLD = 'aaaaaaaa-0000-0000-0000-000000000090';
  const STAY = 'aaaaaaaa-0000-0000-0000-000000000091';
  const MOVED = 'aaaaaaaa-0000-0000-0000-000000000092';
  const SPLIT_REFS: Record<string, string> = {
    [OLD]: 'ORG-0090',
    [STAY]: 'ORG-0091',
    [MOVED]: 'ORG-0092',
  };
  // Each part as the merged server serves it (identity_confirmations._part): an active
  // part carries its count; a part later merged carries no count but its redirect.
  const active = (id: string, name: string, count: number | null, reference: string | null) => ({
    id,
    reference,
    kind: 'organization',
    name,
    status: 'active',
    confirmed_records: count,
  });
  const merged = (id: string, name: string, into: string) => ({
    id,
    reference: SPLIT_REFS[id],
    kind: 'organization',
    name,
    status: 'merged',
    confirmed_records: null,
    redirect_to: into,
    redirect_to_reference: SPLIT_REFS[into],
  });
  function splitReads(parts: unknown[], partHistory: unknown[] = [], partConfs: unknown[] = []) {
    const old = {
      ...identity(
        OLD,
        'Example Media LLC',
        [],
        [
          {
            action: 'split',
            at: '2026-10-22T12:00:00Z',
            detail: {
              from: OLD,
              into: [STAY, MOVED],
              reason: 'Two registrations',
              source: 'SOS 1 and SOS 2',
            },
            references: SPLIT_REFS,
          },
        ],
      ),
      reference: 'ORG-0090',
      status: 'split',
      split_into: parts,
    } as Identity;
    const part = {
      ...identity(MOVED, 'Example Media Buying Co', partConfs, [
        {
          action: 'created',
          at: '2026-10-22T12:00:00Z',
          detail: { split_from: OLD },
          references: { [OLD]: 'ORG-0090' },
        },
        ...partHistory,
      ]),
      reference: SPLIT_REFS[MOVED],
    } as Identity;
    return new Map([
      [OLD, old],
      [
        STAY,
        { ...identity(STAY, 'Example Media LLC', [], []), reference: SPLIT_REFS[STAY] } as Identity,
      ],
      [MOVED, part],
    ]);
  }

  it('names each active part in the split order without current counts', () => {
    const rows = historyRows(
      splitReads([
        active(STAY, 'Example Media LLC', 2, 'ORG-0091'),
        active(MOVED, 'Example Media Buying Co', 1, 'ORG-0092'),
      ]),
      'payee_name',
      NAME,
      3,
    );
    expect(rows.map((row) => row.text)).toEqual([
      'Split: records moved to ORG-0092; records stay with ORG-0091; ORG-0090 now opens a choice of both',
    ]);
    expect(rows[0].evidence).toEqual(['Evidence: Two registrations', 'Source: SOS 1 and SOS 2']);
  });

  it('names a part by its name while its reference is not served yet', () => {
    const rows = historyRows(
      splitReads([
        active(STAY, 'Example Media LLC', 2, 'ORG-0091'),
        active(MOVED, 'Example Media Buying Co', 1, null),
      ]),
      'payee_name',
      NAME,
      3,
    );
    expect(rows.map((row) => row.text)).toEqual([
      'Split: records moved to Example Media Buying Co; records stay with ORG-0091; ORG-0090 now opens a choice of both',
    ]);
    expect(rows[0].text).not.toContain(MOVED);
  });

  it('prints repeated identical rows as separate records, as the server counts them', () => {
    // 1 fingerprint matching 2 identical rows in the Board's file: the server counts 2,
    // and so does the confirmation's own "for k of n records".
    const repeated = confirmation('c-twice', MOVED, [1], {
      checked_at: '2026-10-23T12:00:00Z',
      records: [
        {
          fingerprint: FP(1),
          fields: { transaction_date: '2026-03-03' },
          rows: 2,
          in_board_file: true,
        },
      ],
    });
    const rows = historyRows(
      splitReads(
        [
          active(STAY, 'Example Media LLC', 2, 'ORG-0091'),
          active(MOVED, 'Example Media Buying Co', 2, 'ORG-0092'),
        ],
        [],
        [repeated],
      ),
      'payee_name',
      NAME,
      4,
    );
    expect(rows.map((row) => row.text)).toEqual([
      'Confirmed as Example Media Buying Co (ORG-0092) for 2 of 4 records, Mar 3, 2026',
      'Split: records moved to ORG-0092; records stay with ORG-0091; ORG-0090 now opens a choice of both',
    ]);
  });

  it('does not present a current single-record count as a historical count', () => {
    const rows = historyRows(
      splitReads([
        active(STAY, 'Example Media LLC', 1, 'ORG-0091'),
        active(MOVED, 'Example Media Buying Co', 2, 'ORG-0092'),
      ]),
      'payee_name',
      NAME,
      3,
    );
    expect(rows.map((row) => row.text)).toEqual([
      'Split: records moved to ORG-0092; records stay with ORG-0091; ORG-0090 now opens a choice of both',
    ]);
  });

  it('keeps the split row when a part’s file is not held, naming it by reference alone', () => {
    const rows = historyRows(
      splitReads([
        active(STAY, 'Example Media LLC', null, 'ORG-0091'),
        active(MOVED, 'Example Media Buying Co', 1, 'ORG-0092'),
      ]),
      'payee_name',
      NAME,
      3,
    );
    expect(rows.map((row) => row.text)).toEqual([
      'Split: records moved to ORG-0092; records stay with ORG-0091; ORG-0090 now opens a choice of both',
    ]);
  });

  it('never prints a count for a part later merged; the merge names where it opens', () => {
    // The survivor's read carries the merged part's confirmations, each a replacement
    // made by the split.
    const fromSplit = confirmation('c-moved', STAY, [1, 2], { replaces: 'c-before-split' });
    const reads = splitReads(
      [
        merged(STAY, 'Example Media LLC', MOVED),
        active(MOVED, 'Example Media Buying Co', 3, 'ORG-0092'),
      ],
      [
        {
          action: 'merged',
          at: '2026-10-25T12:00:00Z',
          detail: { from: STAY, into: MOVED, reason: 'Same registration after all' },
          references: { [STAY]: 'ORG-0091', [MOVED]: 'ORG-0092' },
        },
      ],
      [fromSplit],
    );
    reads.set(STAY, {
      ...identity(STAY, 'Example Media LLC', []),
      reference: 'ORG-0091',
      status: 'merged',
      redirect_to: MOVED,
      redirect_to_reference: 'ORG-0092',
    });
    const rows = historyRows(reads, 'payee_name', NAME, 3);
    expect(rows.map((row) => row.text)).toEqual([
      'Example Media LLC (ORG-0091) merged into Example Media Buying Co (ORG-0092); confirmed records moved to ORG-0092 with their own evidence and dates; ORG-0091 now opens ORG-0092',
      'Split: records moved to ORG-0092; records stay with ORG-0091; ORG-0090 now opens a choice of both',
    ]);
    expect(rows.some((row) => /\b0 records?\b/.test(row.text))).toBe(false);
    expect(rows.some((row) => row.text.includes(STAY) || row.text.includes(MOVED))).toBe(false);
  });

  it('names a part the server no longer lists by the split’s own references', () => {
    // split_into lists only parts the server still holds; the split event names all.
    const rows = historyRows(
      splitReads([active(MOVED, 'Example Media Buying Co', 1, 'ORG-0092')]),
      'payee_name',
      NAME,
      3,
    );
    expect(rows.map((row) => row.text)).toEqual([
      'Split: records moved to ORG-0092; records stay with ORG-0091; ORG-0090 now opens a choice of both',
    ]);
  });

  it('keeps a split into more than 2 parts, each part named', () => {
    const THIRD = 'aaaaaaaa-0000-0000-0000-000000000093';
    const reads = splitReads([
      active(STAY, 'Example Media LLC', 2, 'ORG-0091'),
      active(MOVED, 'Example Media Buying Co', 1, 'ORG-0092'),
      active(THIRD, 'Example Media Sales', 3, 'ORG-0093'),
    ]);
    const old = reads.get(OLD)!;
    old.history = [
      {
        ...old.history[0],
        detail: { ...old.history[0].detail, into: [STAY, MOVED, THIRD] },
        references: { ...SPLIT_REFS, [THIRD]: 'ORG-0093' },
      },
    ];
    expect(historyRows(reads, 'payee_name', NAME, 6).map((row) => row.text)).toEqual([
      'Split: records moved to ORG-0092; records moved to ORG-0093; records stay with ORG-0091; ORG-0090 now opens a choice of all 3',
    ]);
  });

  it('on the page, keeps a split with an uncounted part in a History that is not empty', async () => {
    const reads = splitReads([
      active(STAY, 'Example Media LLC', null, 'ORG-0091'),
      active(MOVED, 'Example Media Buying Co', 1, 'ORG-0092'),
    ]);
    reads.get(MOVED)!.confirmations = [
      confirmation('c-b', MOVED, [1], { replaces: 'c-was' }),
    ] as Identity['confirmations'];
    serve((url) => {
      if (url.pathname.endsWith('/queue')) return json(queuePage([]));
      if (url.pathname.endsWith('/records'))
        return json(
          recordsPage({
            confirmed: 1,
            fingerprints: [
              fingerprint(1, {
                confirmation: {
                  id: 'c-b',
                  identity: {
                    id: MOVED,
                    reference: 'ORG-0092',
                    kind: 'organization',
                    name: 'Example Media Buying Co',
                  },
                },
              }),
              fingerprint(2),
            ] as RecordsPage['fingerprints'],
            identities: [
              {
                id: MOVED,
                reference: 'ORG-0092',
                kind: 'organization',
                name: 'Example Media Buying Co',
                confirmed: 1,
              },
            ],
          }),
        );
      for (const [id, read] of reads) if (url.pathname.endsWith(id)) return json(read);
    });
    await render(`/money/identities?name=${encodeURIComponent(NAME)}&role=payee_name`);
    expect(text()).toContain('Example Media Buying Co');
    expect(container.querySelector('#hist-h')?.textContent).toBe('History');
    expect(text()).toContain(
      'Split: records moved to ORG-0092; records stay with ORG-0091; ORG-0090 now opens a choice of both',
    );
    expect(text()).not.toContain('No confirmations or suggestions yet');
    expect(text()).not.toMatch(/\b0 records?\b/);
  });
});

describe('counts whose file is not held', () => {
  it('never sums a missing row count as 0, nor a partial sum as the whole', () => {
    const held = confirmation('c-1', ORG, [1, 2]);
    expect(coveredRows(held as never)).toBe(2);
    expect(coveredRows(notHeld(held) as never)).toBeNull();
    const mixed = {
      ...held,
      records: [held.records[0], { ...held.records[1], rows: null, in_board_file: null }],
    };
    expect(coveredRows(mixed as never)).toBeNull();
    // A record no longer in the Board's file is a held 0, not a missing count.
    const gone = { ...held, records: [{ ...held.records[0], rows: 0, in_board_file: false }] };
    expect(coveredRows(gone as never)).toBe(0);
    expect(sumCounts([1, 2])).toBe(3);
    expect(sumCounts([1, null])).toBeNull();
  });

  it('keeps every history event and drops only a count that is not held', () => {
    const withdrawn = notHeld(
      confirmation('c-old', ORG, [3], {
        status: 'withdrawn',
        withdrawn_at: '2026-10-01T12:00:00Z',
        withdrawal_reason: 'Different registration number',
      }),
    );
    const merged = notHeld(confirmation('c-9', DULUTH, [4]));
    const rows = historyRows(
      new Map([
        [
          ORG,
          identity(
            ORG,
            'Example Media LLC',
            [
              confirmation('c-1', ORG, [1, 2]),
              notHeld(confirmation('c-2', ORG, [5])),
              withdrawn,
              merged,
            ],
            [
              {
                action: 'merged',
                at: '2026-10-20T12:00:00Z',
                detail: { from: DULUTH, into: ORG, reason: 'Same registration' },
                references: { [DULUTH]: 'ORG-0043', [ORG]: 'ORG-0002' },
              },
            ],
          ),
        ],
      ]),
      'payee_name',
      NAME,
      4,
    );
    expect(rows.map((row) => row.text)).toEqual([
      'ORG-0043 merged into Example Media LLC (ORG-0002); confirmed records moved to ORG-0002 with their own evidence and dates; ORG-0043 now opens ORG-0002',
      'Confirmation as Example Media LLC (ORG-0002) withdrawn: Different registration number',
      'Confirmed as Example Media LLC (ORG-0002) for 2 of 4 records, Jan 1, 2026 to Feb 2, 2026',
      'Confirmed as Example Media LLC (ORG-0002), May 5, 2026',
      'Confirmed as Example Media LLC (ORG-0002), Mar 3, 2026',
      'Confirmed as Example Media LLC (ORG-0002), Apr 4, 2026',
    ]);
  });

  it('drops only the count in Records covered, the split form and the merge preview', async () => {
    const other = OTHER;
    serve((url) => {
      if (url.pathname.endsWith('/queue')) return json(queuePage([]));
      if (url.pathname.endsWith('/records'))
        return json(
          recordsPage({
            confirmed: 2,
            identities: [
              {
                id: ORG,
                reference: 'ORG-0002',
                kind: 'organization',
                name: 'Example Media LLC',
                confirmed: 2,
              },
            ],
          }),
        );
      if (url.pathname.endsWith(other))
        return json(
          identity(other, 'Example Media Group', [
            {
              ...notHeld(confirmation('c-9', other, [4, 5])),
              record_key: 'EXAMPLE MEDIA GROUP INC',
            },
          ]),
        );
      if (url.pathname.endsWith(ORG))
        return json(
          identity(ORG, 'Example Media LLC', [
            notHeld(confirmation('c-1', ORG, [1])),
            confirmation('c-2', ORG, [2]),
          ]),
        );
      if (url.pathname.endsWith('/identities'))
        return json({
          rows: [
            { id: other, reference: 'ORG-0042', kind: 'organization', name: 'Example Media Group' },
          ],
          total: 1,
          page: 1,
          page_size: 20,
          pages: 1,
        });
    });
    await render(`/money/identities?name=${encodeURIComponent(NAME)}&kind=payee_name`);
    const covered = [...container.querySelectorAll('.ci-dl dd.f-num')].map((dd) => dd.textContent);
    expect(covered).toContain('Jan 1, 2026 · Checked on Aug 2, 2026');
    expect(covered).toContain('1 record · Feb 2, 2026 · Checked on Aug 2, 2026');
    expect(text()).not.toMatch(/\b0 records?\b/);

    await click(button('Split this record'));
    const metas = [...container.querySelectorAll('#identity-form .ci-option')].map(
      (option) => option.textContent ?? '',
    );
    expect(metas.some((meta) => meta.includes('Jan 1, 2026 · Checked on Aug 2, 2026'))).toBe(true);
    expect(metas.some((meta) => /\b0 records?\b/.test(meta))).toBe(false);
    // The total rests on a file that is not held: "{k} records selected", no "of n".
    expect(text()).toContain('0 records selected');
    const option = (label: string) =>
      [...container.querySelectorAll<HTMLElement>('#identity-form .ci-option')].find((o) =>
        (o.textContent ?? '').includes(label),
      )!;
    await click(option('Feb 2, 2026').querySelector('input')!);
    expect(text()).toContain('1 record selected · Feb 2, 2026');
    expect(text()).not.toMatch(/of \d+ records? selected/);
    // A selection resting on a file that is not held drops its number too.
    await click(option('Jan 1, 2026').querySelector('input')!);
    expect(text()).toContain('Records selected · Jan 1, 2026 to Feb 2, 2026');

    await click(button('Merge with another record'));
    await click(container.querySelector<HTMLInputElement>('input[type="radio"]')!);
    expect(text()).toContain('Links that will move');
    expect(text()).toContain('EXAMPLE MEDIA GROUP INC');
    expect(text()).toContain(
      'These confirmed records will move from Example Media Group (ORG-0042) to Example Media LLC (ORG-0002). Each keeps its own evidence. ORG-0042 will then open ORG-0002.',
    );
    expect(text()).not.toContain('holds no confirmed records');
    expect(text()).not.toMatch(/\b0 records?\b/);
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
              {
                id: ORG,
                reference: 'ORG-0002',
                kind: 'organization',
                name: 'Example Media LLC',
                confirmed: 2,
              },
              {
                id: DULUTH,
                reference: 'ORG-0043',
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
      'Organization · ORG-0002 · Confirmed for 2 of 4 records · Checked on Aug 2, 2026',
    );
    expect(text()).toContain('Shown below');
    // A reference never breaks at its hyphen.
    expect(
      [...container.querySelectorAll('.f-nowrap')].some((el) => el.textContent === 'ORG-0043'),
    ).toBe(true);
    // Readers see references; the ids stay in addresses only.
    expect(text()).not.toContain(ORG);
    expect(text()).not.toContain(DULUTH);
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
              {
                id: ORG,
                reference: 'ORG-0002',
                kind: 'organization',
                name: 'Example Media LLC',
                confirmed: 1,
              },
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
      basis: 'Both records give the registration number on the business filing',
      source: 'Secretary of State record 1234567',
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

  // The page's records answer for 1 identity holding records of the spelling.
  function oneIdentityRecords() {
    return json(
      recordsPage({
        confirmed: 2,
        identities: [
          {
            id: ORG,
            reference: 'ORG-0002',
            kind: 'organization',
            name: 'Example Media LLC',
            confirmed: 2,
          },
        ],
      }),
    );
  }
  const LEGISLATOR_ID = '8d39c91c-e7e3-4aa9-8a29-f9ce0df7e826';
  const PUBLIC_PERSON_ID = '1b2c3d4e-0000-4000-8000-00000000abcd';
  const heldRecord = (id: string, owner: string, kind: string, key: string) => ({
    ...confirmation(id, owner, []),
    record_kind: kind,
    record_key: key,
    records: null,
  });

  it('never prints a legislator’s or public person’s internal id in the split and merge forms', async () => {
    serve((url) => {
      if (url.pathname.endsWith('/queue')) return json(queuePage([]));
      if (url.pathname.endsWith('/records')) return oneIdentityRecords();
      if (url.pathname.endsWith(OTHER))
        return json(
          identity(OTHER, 'Example Media Group', [
            heldRecord('c-8', OTHER, 'public_person', PUBLIC_PERSON_ID),
          ]),
        );
      if (url.pathname.endsWith(ORG))
        return json(
          identity(ORG, 'Example Media LLC', [
            confirmation('c-1', ORG, [1]),
            confirmation('c-2', ORG, [2]),
            heldRecord('c-3', ORG, 'legislator', LEGISLATOR_ID),
            heldRecord('c-4', ORG, 'committee', '30212'),
          ]),
        );
      if (url.pathname.endsWith('/identities'))
        return json({
          rows: [
            { id: OTHER, reference: 'ORG-0042', kind: 'organization', name: 'Example Media Group' },
          ],
          total: 1,
          page: 1,
          page_size: 20,
          pages: 1,
        });
    });
    await render(`/money/identities?name=${encodeURIComponent(NAME)}&kind=payee_name`);
    await click(button('Split this record'));
    expect(text()).toContain('Legislative service');
    expect(text()).toContain('Campaign accounts · 30212');
    expect(text()).not.toContain(LEGISLATOR_ID);
    await click(button('Merge with another record'));
    await click(container.querySelector<HTMLInputElement>('input[type="radio"]')!);
    expect(text()).toContain('Links that will move');
    expect(text()).toContain('Official IDs');
    expect(text()).not.toContain(PUBLIC_PERSON_ID);
  });

  it('says History is empty only after its reads finish, and offers Try again on failure', async () => {
    let answer: 'pending' | 'fail' | 'ok' = 'pending';
    serve((url) => {
      if (url.pathname.endsWith('/queue')) return json(queuePage([]));
      if (url.pathname.endsWith('/records')) return oneIdentityRecords();
      if (url.pathname.endsWith(ORG)) {
        if (answer === 'pending') return new Promise<Response>(() => {});
        if (answer === 'fail') return new Response('{}', { status: 503 });
        return json(identity(ORG, 'Example Media LLC', [confirmation('c-1', ORG, [1, 2])]));
      }
    });
    await render(`/money/identities?name=${encodeURIComponent(NAME)}&kind=payee_name`);
    expect(container.querySelector('#hist-h')?.textContent).toBe('History');
    expect(text()).not.toContain('No confirmations or suggestions yet');

    answer = 'fail';
    clearReadCache();
    await act(async () => root.unmount());
    root = createRoot(container);
    await render(`/money/identities?name=${encodeURIComponent(NAME)}&kind=payee_name`);
    expect(text()).toContain('We couldn’t load the history');
    expect(text()).not.toContain('No confirmations or suggestions yet');

    answer = 'ok';
    const history = container.querySelector('.ci-history-section')!;
    await click(
      [...history.querySelectorAll<HTMLButtonElement>('button')].find(
        (b) => b.textContent === 'Try again',
      )!,
    );
    expect(text()).not.toContain('We couldn’t load the history');
    expect(text()).toContain('Confirmed as Example Media LLC (ORG-0002) for 2 of 2 records');
  });

  it('fails History with Try again when an identity its events name cannot be read', async () => {
    const SOURCE = 'aaaaaaaa-0000-0000-0000-000000000090';
    serve((url) => {
      if (url.pathname.endsWith('/queue')) return json(queuePage([]));
      if (url.pathname.endsWith('/records')) return oneIdentityRecords();
      if (url.pathname.endsWith(SOURCE)) return new Response('{}', { status: 503 });
      if (url.pathname.endsWith(ORG))
        return json(
          identity(
            ORG,
            'Example Media LLC',
            [confirmation('c-1', ORG, [1, 2], { replaces: 'c-was' })],
            [{ action: 'created', at: '2026-10-22T12:00:00Z', detail: { split_from: SOURCE } }],
          ),
        );
    });
    await render(`/money/identities?name=${encodeURIComponent(NAME)}&kind=payee_name`);
    expect(text()).toContain('We couldn’t load the history');
    expect(text()).not.toContain('No confirmations or suggestions yet');
  });

  it('counts what a partly failed withdrawal saved, marks it, and retries only the rest', async () => {
    const failing = new Set(['c-2', 'c-3']);
    const done = new Set<string>();
    const REASON = 'Different registration number on the later filing';
    let reads = 0;
    serve((url, init) => {
      if (init?.method === 'POST') {
        const id = url.pathname.split('/').at(-2)!;
        if (failing.has(id)) return new Response('{}', { status: 500 });
        done.add(id);
        return json({});
      }
      if (url.pathname.endsWith('/queue')) return json(queuePage([]));
      if (url.pathname.endsWith('/records')) return oneIdentityRecords();
      if (url.pathname.endsWith(ORG)) {
        reads += 1;
        // As the server answers: a withdrawn confirmation keeps its row, withdrawn.
        const state = (id: string) =>
          done.has(id)
            ? {
                status: 'withdrawn',
                withdrawn_at: '2026-11-03T12:00:00Z',
                withdrawal_reason: REASON,
              }
            : {};
        return json(
          identity(ORG, 'Example Media LLC', [
            confirmation('c-1', ORG, [1], state('c-1')),
            confirmation('c-2', ORG, [2], { checked_at: '2026-09-04T15:00:00Z', ...state('c-2') }),
            confirmation('c-3', ORG, [3], { checked_at: '2026-09-05T15:00:00Z', ...state('c-3') }),
          ]),
        );
      }
    });
    await render(`/money/identities?name=${encodeURIComponent(NAME)}&kind=payee_name`);
    const readsBefore = reads;
    await click(button('Withdraw confirmation'));
    const submit = () =>
      [...container.querySelectorAll<HTMLButtonElement>('#identity-form button')].find(
        (b) => b.textContent === 'Withdraw confirmation',
      )!;
    await type(noteField(), REASON);
    await click(submit());
    expect(posts.map((post) => post.path)).toEqual([
      'finance/identities/confirmations/c-1/withdraw',
      'finance/identities/confirmations/c-2/withdraw',
    ]);
    expect(text()).toContain(
      '1 of 3 confirmations was withdrawn. The other 2 were not saved. Your note is kept below.',
    );
    expect(text()).not.toContain('Not saved. Your entries are kept.');
    // The page reads the identity again; the withdrawn one is marked by its drawn
    // History row and leaves the confirmed card.
    expect(reads).toBeGreaterThan(readsBefore);
    expect(text()).toContain(
      `Confirmation as Example Media LLC (ORG-0002) withdrawn for 1 record: ${REASON}`,
    );
    expect(container.querySelectorAll('.ci-confirmed dl[data-group]')).toHaveLength(2);
    expect(noteField().value).toBe(REASON);

    const tryAgain = () =>
      [...container.querySelectorAll<HTMLButtonElement>('.ci-failed button')].find(
        (b) => b.textContent === 'Try again',
      )!;
    failing.delete('c-2');
    posts.length = 0;
    await click(tryAgain());
    expect(posts.map((post) => post.path)).toEqual([
      'finance/identities/confirmations/c-2/withdraw',
      'finance/identities/confirmations/c-3/withdraw',
    ]);
    expect(text()).toContain(
      '2 of 3 confirmations were withdrawn. The other 1 was not saved. Your note is kept below.',
    );

    failing.clear();
    posts.length = 0;
    await click(tryAgain());
    expect(posts.map((post) => post.path)).toEqual([
      'finance/identities/confirmations/c-3/withdraw',
    ]);
    expect(container.querySelector('#identity-form')).toBeNull();
  });

  it('previews the links that move before a merge and merges the chosen record in', async () => {
    const other = OTHER;
    serve((url, init) => {
      if (init?.method === 'POST') return json(identity(ORG, 'Example Media LLC', []));
      if (url.pathname.endsWith('/queue')) return json(queuePage([]));
      if (url.pathname.endsWith('/records'))
        return json(
          recordsPage({
            confirmed: 2,
            identities: [
              {
                id: ORG,
                reference: 'ORG-0002',
                kind: 'organization',
                name: 'Example Media LLC',
                confirmed: 2,
              },
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
            { id: ORG, reference: 'ORG-0002', kind: 'organization', name: 'Example Media LLC' },
            { id: other, reference: 'ORG-0042', kind: 'organization', name: 'Example Media Group' },
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
      'These 2 confirmed records will move from Example Media Group (ORG-0042) to Example Media LLC (ORG-0002). Each keeps its own evidence. ORG-0042 will then open ORG-0002.',
    );
    expect(text()).toContain('EXAMPLE MEDIA GROUP INC');
    await type(noteField(), 'Registration number 7654321 on both business filings');
    await type(sourceField(), 'SOS 7654321');
    await click(button('Merge records'));
    expect(posts[0]).toEqual({
      path: `finance/identities/${other}/merge`,
      body: {
        into: ORG,
        reason: 'Registration number 7654321 on both business filings',
        source: 'SOS 7654321',
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
              {
                id: ORG,
                reference: 'ORG-0002',
                kind: 'organization',
                name: 'Example Media LLC',
                confirmed: 2,
              },
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
    expect(text()).toContain('Split Example Media LLC (ORG-0002) into 2 records');
    expect(text()).toContain('ORG-0002 will then open a page listing both records');
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
    expect(posts[0].body.reason).toBe('Different registration numbers on the two filings');
    expect(posts[0].body.source).toBe('SOS 1 and SOS 2');
  });
});

describe('Partial withdrawal wording', () => {
  it('makes each verb follow its own count', () => {
    expect(partlyWithdrawn({ k: 1, n: 2 })).toBe(
      '1 of 2 confirmations was withdrawn. The other 1 was not saved. Your note is kept below.',
    );
    expect(partlyWithdrawn({ k: 2, n: 5 })).toBe(
      '2 of 5 confirmations were withdrawn. The other 3 were not saved. Your note is kept below.',
    );
  });
});
