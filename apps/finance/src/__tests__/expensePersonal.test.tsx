import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  PersonalFigures,
  PersonalComparisons,
  BoardRecordNotice,
  personalEvidence,
} from '../pages/elections/expensePersonal';
import {
  optionGroups,
  scopedReportKeys,
  type BoardCandidateRecord,
  type ExpenseAnswer,
  type PersonalField,
  type PersonalReport,
} from '../pages/elections/expenseReportData';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let band = 'computer';
vi.mock('../ui/band', () => ({ useBand: () => band }));
const source = 'a'.repeat(64),
  key = 'b'.repeat(64),
  collection = 'c'.repeat(64);
const attachment = `/api/v1/finance/elections/mn-2026-11-03-general/finance/sources/${source}?collection_id=${collection}`;
const field = (name: string, amount: string | null): PersonalField => ({
  field_id: name,
  page: 2,
  bounds: [10, 20, 40, 60],
  label: name,
  literal: amount ?? '',
  state: amount === null ? 'blank' : 'value',
  normalized: amount,
  value_type: 'money',
  currency: 'USD',
});
const claim = {
  name: 'Example candidate',
  candidate_id: 'candidate',
  race_id: 'race',
  filed_party: 'R',
  party_group: 'R' as const,
};
function report(): PersonalReport {
  return {
    report_key: key,
    record_id: '1234',
    source_sha256: source,
    source_url: attachment,
    source: {
      url: 'https://cfb.mn.gov/report',
      copied_at: '2026-11-13T20:00:00Z',
    },
    report_type: 'E',
    amendment: 0,
    latest_amendment: 0,
    name: claim.name,
    office: 'Senate 56',
    period: { start: '2026-01-01', end: '2026-10-19' },
    received_date: { ...field('received', '2026-10-20'), value_type: 'date' },
    certification_date: {
      ...field('signed', '2026-10-21'),
      value_type: 'date',
    },
    measures: {
      cash: field('cash', '1221.52'),
      unpaid: field('unpaid', null),
      in_kind: field('in_kind', '291.00'),
      total: field('total', '1512.52'),
    },
    nonitemized: {
      cash: field('cash', '90.61'),
      unpaid: field('unpaid', null),
      in_kind: field('in_kind', '291.00'),
      total: field('total', '381.61'),
    },
    items: [],
    claim,
    itemized_before_exclusions: '1130.91',
    itemized_after_exclusions: '933.73',
    by_filed_address: {
      MN: { before: '0.00', after: '0.00' },
      out_of_state: { before: '197.18', after: '0.00' },
      unknown: { before: '933.73', after: '933.73' },
    },
  };
}
function record(): BoardCandidateRecord {
  return {
    record_id: '1234',
    year: 2026,
    role: 'AOC',
    state: 'checked',
    claim,
    relationship: { race_id: claim.race_id, candidate_id: claim.candidate_id },
    availability: { state: 'reports_offered', offered_reports: 1 },
    reports: [report()],
    selected_report_key: key,
    sources: {
      catalogue: {
        url: 'https://cfb.mn.gov/catalogue',
        copied_at: '2026-11-13T20:00:00Z',
        retained_source_url: attachment.replace('?', '/raw?'),
      },
    },
  };
}
const answer = () =>
  ({
    personal_reports: [report()],
    board_candidate_records: [record()],
    account_reports: [],
    report_options: [],
  }) as unknown as ExpenseAnswer;
let node: HTMLDivElement, root: Root;
beforeEach(() => {
  band = 'computer';
  node = document.createElement('div');
  document.body.append(node);
  root = createRoot(node);
});
afterEach(async () => {
  await act(async () => root.unmount());
  node.remove();
});

it('keeps native figures and whole dollars, with a source action for each field', async () => {
  const show = vi.fn();
  await act(async () =>
    root.render(<PersonalFigures report={report()} enabled showSource={show} />),
  );
  expect(node.textContent).toContain('$1,512');
  expect(node.textContent).toContain('Pre-general · Jan 1 to Oct 19, 2026');
  expect(node.textContent).not.toContain('.52');
  expect(node.textContent).toContain('UnpaidN/A');
  expect(node.textContent).not.toContain('Campaign account');
  const sourceButton = [...node.querySelectorAll('button')].find((b) =>
    b.textContent?.includes('personal expenditures Unpaid'),
  )!;
  await act(async () => sourceButton.click());
  const evidence = personalEvidence(answer(), show.mock.calls[0][0])!;
  expect(evidence.attachment).toBe(attachment.replace('/api/v1/', ''));
  expect(evidence.pdfPage).toBe(2);
  expect(evidence.evidence.rows).toContainEqual({
    label: 'Status',
    value: 'Blank in source',
  });
  expect(evidence.evidence.rows).toContainEqual({
    label: 'Amount',
    value: 'N/A',
  });
});

it('preserves receipt and signature dates and refuses invalid source keys', () => {
  const evidence = personalEvidence(answer(), `board-report:${key}:report`)!;
  expect(evidence.evidence.rows).toContainEqual({
    label: 'Received',
    value: 'Oct 20, 2026',
  });
  expect(evidence.evidence.rows).toContainEqual({
    label: 'Signed',
    value: 'Oct 21, 2026',
  });
  expect(personalEvidence(answer(), `board-report:${key}`)).toBeNull();
  expect(personalEvidence(answer(), `board-report:${key}:measures.secret`)).toBeNull();
});

it('labels unchecked native amounts without implying a source omission', () => {
  const data = answer();
  data.personal_reports![0].measures.unpaid.state = 'not_checked';
  const evidence = personalEvidence(data, `board-report:${key}:measures.unpaid`)!;
  expect(evidence.evidence.rows).toContainEqual({ label: 'Status', value: 'Not checked' });
});

it('shows dated source-only availability without a zero expense or account', async () => {
  const row = record();
  row.reports = [];
  row.availability = {
    state: 'no_report_information_returned',
    offered_reports: 0,
  };
  await act(async () =>
    root.render(<BoardRecordNotice record={row} enabled showSource={vi.fn()} />),
  );
  expect(node.textContent).toContain('No report information returned for this Board record');
  expect(node.textContent).toContain('Nov 13, 2026');
  expect(node.textContent).not.toContain('$0');
  expect(node.textContent).not.toContain('campaign account');
});

it.each(['phone', 'computer'])(
  'keeps personal geography and exclusions separate at %s width',
  async (value) => {
    band = value;
    await act(async () => root.render(<PersonalComparisons data={answer()} />));
    expect(node.textContent).toContain('Example candidate · Republican');
    expect(node.textContent).toContain('separate from campaign-account totals');
    expect(node.textContent).toContain('$933');
    expect(node.textContent).toContain('Location N/A');
    expect(node.querySelectorAll(value === 'phone' ? 'li' : 'tbody tr')).toHaveLength(4);
  },
);

it('selects personal report periods without requiring a campaign account or page membership', () => {
  const data = answer();
  expect(optionGroups(data)).toHaveLength(1);
  expect(optionGroups(data)[0].keys).toEqual([key]);
  expect(scopedReportKeys(data, [key], (c) => c.candidate_id === 'candidate')).toEqual([key]);
  expect(scopedReportKeys(data, [key], (c) => c.candidate_id === 'other')).toEqual([]);
});
