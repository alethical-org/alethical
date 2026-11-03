import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { useIdentities } from '../pages/identities/reads';
import { historyRows } from '../pages/identities/history';
import type { Identity } from '../pages/identities/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const session = vi.hoisted(() => ({
  apiBaseUrl: 'https://api.example.test',
  accessToken: 'token',
}));
vi.mock('../auth/session', () => ({
  useFinanceSession: () => session,
}));

let container: HTMLDivElement;
let root: Root;
const record = (id: string, history: Identity['history'] = []): Identity => ({
  id,
  name: `Name ${id}`,
  reference: `ORG-${id}`,
  kind: 'organization',
  status: 'active',
  created_at: null,
  confirmations: [],
  printed_names: [],
  history,
});
const madeFrom = (id: string): Identity['history'] => [
  { action: 'created', at: '2026-10-20', detail: { split_from: id } },
];
function Probe() {
  const read = useIdentities(['part'], 0);
  return (
    <>
      <span>{read.failed ? 'failed' : read.settled ? 'ready' : 'loading'}</span>
      <span>{[...read.byId.keys()].join(',')}</span>
      <button onClick={read.retry}>Retry</button>
      {historyRows(read.byId, 'payee_name', 'Printed name', 1).map((row) => (
        <p key={row.key}>{row.text}</p>
      ))}
    </>
  );
}
async function render() {
  await act(async () => root.render(<Probe />));
  for (let n = 0; n < 12; n++)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
}
function serve(records: Map<string, Identity>, missingStatus = 404) {
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const id = new URL(url).pathname.split('/').at(-1)!;
      calls.push(id);
      return records.has(id)
        ? new Response(JSON.stringify({ data: records.get(id) }), { status: 200 })
        : new Response('{}', { status: missingStatus });
    }),
  );
  return calls;
}
beforeEach(() => {
  session.accessToken = 'token';
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it('follows merge then split history to the original confirmation holder', async () => {
  const original = record('original');
  original.status = 'merged';
  original.redirect_to = 'combined';
  const combined = record('combined', [
    { action: 'merged', at: '2026-10-15', detail: { from: 'original', into: 'combined' } },
  ]);
  combined.status = 'split';
  combined.confirmations = [
    {
      id: 'confirmation',
      identity_id: 'original',
      record_kind: 'payee_name',
      record_key: 'Printed name',
      relation: null,
      status: 'withdrawn',
      checked_at: '2026-10-01',
      withdrawn_at: null,
      withdrawal_reason: null,
      basis: 'Held evidence',
      source: 'Held source',
      replaces: null,
      replaced_by: 'replacement',
      evidence: null,
      records: null,
    },
  ];
  const part = record('part', madeFrom('combined'));
  const calls = serve(
    new Map([
      ['part', part],
      ['combined', combined],
      ['original', original],
    ]),
  );
  await render();
  expect(container.textContent).toContain('ready');
  expect(container.textContent).toContain('Confirmed as Name original (ORG-original)');
  expect(calls.filter((id) => id === 'original')).toHaveLength(1);
});

it('follows a longer chain once per identity even when references cycle', async () => {
  const records = new Map([['part', record('part', madeFrom('older1'))]]);
  for (let n = 1; n <= 5; n++)
    records.set(`older${n}`, record(`older${n}`, madeFrom(n === 5 ? 'part' : `older${n + 1}`)));
  const calls = serve(records);
  await render();
  expect(container.textContent).toContain('ready');
  expect(calls).toHaveLength(6);
  expect(container.textContent).toContain('older5');
});

it.each([404, 500])(
  'fails the whole history when a later dependency answers %s, and retries',
  async (status) => {
    const records = new Map([
      ['part', record('part', madeFrom('older1'))],
      ['older1', record('older1', madeFrom('older2'))],
    ]);
    serve(records, status);
    await render();
    expect(container.textContent).toContain('failed');
    records.set('older2', record('older2'));
    await act(async () => container.querySelector('button')!.click());
    await render();
    expect(container.textContent).toContain('ready');
    expect(container.textContent).not.toContain('failed');
  },
);

it('does not rewrite a past split when current part counts change', () => {
  const before = record('old', [
    { action: 'split', at: '2026-10-15', detail: { from: 'old', into: ['part', 'other'] } },
  ]);
  before.status = 'split';
  before.split_into = [
    { ...record('part'), confirmed_records: 3 },
    { ...record('other'), confirmed_records: 4 },
  ];
  const records = new Map([
    ['old', before],
    ['part', record('part', madeFrom('old'))],
  ]);
  const first = historyRows(records, 'payee_name', 'Printed name', 7);
  before.split_into[0].confirmed_records = 99;
  expect(historyRows(records, 'payee_name', 'Printed name', 103)).toEqual(first);
  expect(first[0].text).not.toMatch(/\d+ records?/);
});

it('keeps earlier merge events when their receiving identity is merged again', () => {
  const original = record('original');
  original.status = 'merged';
  const middle = record('middle', [
    { action: 'merged', at: '2026-10-10', detail: { from: 'original', into: 'middle' } },
  ]);
  middle.status = 'merged';
  const current = record('part', [
    { action: 'merged', at: '2026-10-20', detail: { from: 'middle', into: 'part' } },
  ]);
  const identities = new Map([
    ['part', current],
    ['middle', middle],
    ['original', original],
  ]);
  const rows = historyRows(identities, 'payee_name', 'Printed name', 1);
  expect(rows.map((row) => row.key)).toEqual(['merge|middle|part', 'merge|original|middle']);
  expect(rows[1].text).toContain('Name original');
});

it('keeps creation wording when a merged-in confirmation arrives before its original holder', () => {
  const original = record('original', [
    { action: 'created', at: '2026-10-01', detail: {} },
    { action: 'confirmed', at: '2026-10-01', detail: { confirmation_id: 'created-confirmation' } },
  ]);
  original.status = 'merged';
  const confirmation = {
    id: 'created-confirmation',
    identity_id: 'original',
    record_kind: 'payee_name',
    record_key: 'Printed name',
    relation: null,
    status: 'confirmed',
    checked_at: '2026-10-01',
    withdrawn_at: null,
    withdrawal_reason: null,
    basis: 'Saved evidence',
    source: 'Saved source',
    replaces: null,
    replaced_by: null,
    evidence: null,
    records: null,
  } as NonNullable<Identity['confirmations']>[number];
  original.confirmations = [confirmation];
  const current = record('current');
  current.confirmations = [confirmation];
  const rows = historyRows(
    new Map([
      ['current', current],
      ['original', original],
    ]),
    'payee_name',
    'Printed name',
    1,
  );
  expect(rows).toHaveLength(1);
  expect(rows[0].text).toContain(
    'Created Name original (ORG-original) and confirmed this name as it',
  );
});

it('keeps the last complete history when retry fails halfway through the chain', async () => {
  const records = new Map([
    ['part', record('part', madeFrom('older'))],
    ['older', record('older')],
  ]);
  serve(records);
  await render();
  expect(container.textContent).toContain('part,older');
  records.delete('older');
  await act(async () => container.querySelector('button')!.click());
  await render();
  expect(container.textContent).toContain('failed');
  expect(container.textContent).toContain('part,older');
});

it('never retains another account history when its new read fails', async () => {
  serve(new Map([['part', record('part')]]));
  await render();
  expect(container.textContent).toContain('part');
  session.accessToken = 'another-account';
  let finish: (response: Response) => void;
  vi.stubGlobal(
    'fetch',
    vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    ),
  );
  await act(async () => root.render(<Probe />));
  expect(container.textContent).not.toContain('part');
  await act(async () => finish!(new Response('{}', { status: 500 })));
  await render();
  expect(container.textContent).toContain('failed');
  expect(container.textContent).not.toContain('part');
});
