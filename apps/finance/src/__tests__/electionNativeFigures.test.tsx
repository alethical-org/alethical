import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  AuthorityFigures,
  AuthorityComparisons,
  authorityEvidence,
} from '../pages/elections/expenseExternal';
import { reportLabel } from '../pages/elections/expenseReportData';
vi.mock('../ui/band', () => ({ useBand: () => 'desktop' }));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
const binding = {
  source_sha256: 'a'.repeat(64),
  locator: { row: 2 },
  quote: 'literal source',
};
const native = (key = 'b'.repeat(64), classification = 'single_ballot_party') => ({
  authority: 'fec',
  authority_name: 'Federal Election Commission',
  account_id: 'C00000001',
  account_name: 'Synthetic committee',
  report_key: key,
  source_report_id: '101',
  report_type: 'F3:Q3',
  series_id: 'period',
  predecessor_report_key: null,
  effective: true,
  period_start: '2026-07-01',
  period_end: '2026-09-30',
  received_date: '2026-10-15',
  check_status: 'checked',
  sources: [binding],
  reported_measures: [
    {
      measure: 'total_disbursements',
      label: 'Disbursements this period',
      value: '12.99',
      unit: 'money',
      currency: 'CAD',
      period_start: '2026-07-01',
      period_end: '2026-09-30',
      sources: [binding],
    },
  ],
  reported_itemized_before_exclusions: [],
  reported_itemized_after_exclusions: [],
  memo_detail_count: 0,
  claims: [],
  display_claims: [],
  party_group: 'unknown',
  party_classification_state: classification,
});
it('keeps source currency and display truncation on a native cover figure', async () => {
  const account = native();
  await act(async () =>
    root.render(<AuthorityFigures account={account as any} enabled showSource={() => {}} />),
  );
  expect(container.textContent).toContain('12 CAD');
  expect(container.textContent).not.toContain('12.99');
});
it('keeps an unknown report type null while displaying a useful report label', async () => {
  const account = { ...native(), report_type: null };
  await act(async () =>
    root.render(<AuthorityFigures account={account as any} enabled showSource={() => {}} />),
  );
  expect(container.textContent).toContain('Report · Jul 1 to Sep 30, 2026');
  expect(
    reportLabel({
      filing: { report_type: null, report_name: null, cut_off_date: '2026-09-30' },
      period_start: account.period_start,
      period_end: account.period_end,
    }),
  ).toBe('Report · Jul 1 to Sep 30, 2026');
  const evidence = authorityEvidence(
    { election_key: 'mn-2026-11-03-general', external_generation_id: 'c'.repeat(64) } as any,
    account as any,
    `external-report:${account.report_key}:report:0`,
  )!;
  expect(evidence.evidence.title).toBe('Synthetic committee · Report');
  expect(account.report_type).toBeNull();
});
it('keeps the same currency visible in the exact figure evidence panel', () => {
  const account = native();
  const evidence = authorityEvidence(
    {
      election_key: 'mn-2026-11-03-general',
      external_generation_id: 'c'.repeat(64),
    } as any,
    account as any,
    `external-report:${account.report_key}:figure.0:0`,
  );
  const money = evidence!.evidence.rows.find((row) => row.label === 'Disbursements this period');
  expect(money!.value).toBe('12 CAD');
});
it('keeps the listing date and individual original dates distinct in expense evidence', async () => {
  const report = {
    ...native(),
    version_scope: 'publisher_inventory_as_of',
    amendment_status: 'offered_inventory_checked',
    version_as_of: '2026-11-11T20:00:00Z',
    version_sources: [
      { ...binding, locator: { page: 2 }, source_copied_at: '2026-11-13T01:00:00Z' },
    ],
  };
  const showSource = vi.fn();
  await act(async () =>
    root.render(<AuthorityFigures account={report as any} enabled showSource={showSource} />),
  );
  expect(container.textContent).toContain('Only listed version for this period as of Nov 11, 2026');
  const button = [...container.querySelectorAll('button')].find(
    (b) => b.textContent === 'View version source',
  )!;
  await act(async () => button.click());
  const key = `external-report:${report.report_key}:version:0`;
  expect(showSource).toHaveBeenCalledWith(key);
  const evidence = authorityEvidence(
    { election_key: 'mn-2026-11-03-general', external_generation_id: 'c'.repeat(64) } as any,
    report as any,
    key,
  )!;
  expect(evidence.pdfPage).toBe(2);
  expect(evidence.attachment).toContain(binding.source_sha256);
  expect(evidence.evidence.rows).toContainEqual({ label: 'Copied', value: 'Nov 13, 2026' });
  expect(evidence.evidence.rows).toContainEqual({
    label: 'Version',
    value: 'Only listed version for this period as of Nov 11, 2026',
  });
});
it('does not describe mixed-party account money as missing candidate party', async () => {
  const mixed = native('b'.repeat(64), 'mixed_ballot_parties');
  const unknown = {
    ...native('d'.repeat(64), 'ballot_party_not_in_source'),
    account_id: 'C00000002',
  };
  const claim = (id: string, party: string) => ({
    race_id: 'race',
    candidate_id: id,
    name: id,
    filed_party: party === 'unknown' ? null : party,
    party_group: party,
  });
  mixed.claims = [claim('candidate-r', 'R'), claim('candidate-dfl', 'DFL')] as any;
  mixed.display_claims = mixed.claims;
  unknown.claims = [claim('candidate-unknown', 'unknown')] as any;
  unknown.display_claims = unknown.claims;
  const summary = (report: any, amount: string) => ({
    authority: report.authority,
    authority_name: report.authority_name,
    account_id: report.account_id,
    report_key: report.report_key,
    measure: 'fec_schedule_b_disbursements',
    label: 'FEC Schedule B disbursements',
    basis: 'itemized_schedule_b',
    currency: 'USD',
    period_start: report.period_start,
    period_end: report.period_end,
    baseline: amount,
    adjusted: amount,
    by_party: {
      R: { baseline: '0.00', adjusted: '0.00' },
      DFL: { baseline: '0.00', adjusted: '0.00' },
      NP: { baseline: '0.00', adjusted: '0.00' },
      other: { baseline: '0.00', adjusted: '0.00' },
      unknown: { baseline: amount, adjusted: amount },
    },
    by_filed_address: {},
  });
  const data = {
    authority_reports: [mixed, unknown],
    authority_summary: [summary(mixed, '100.00'), summary(unknown, '200.00')],
  };
  await act(async () => root.render(<AuthorityComparisons data={data as any} />));
  const rows = Array.from(container.querySelectorAll('tr'));
  const unassigned = rows.find(
    (row) => row.querySelector('th')?.textContent === 'Party cannot be assigned',
  );
  expect(unassigned, 'mixed-account money requires its own existing party label').toBeTruthy();
  expect(unassigned!.textContent).toContain('$100');
  const missing = rows.find((row) => row.querySelector('th')?.textContent === 'Party not reported');
  expect(missing!.textContent).toContain('$200');
  expect(missing!.textContent).not.toContain('$300');
});
