import type { CommitteeRefunds, RefundState } from '../../../data/types';
import abeler from './fixtures/refunds-17868-2026-09-12.json';
import dibble from './fixtures/refunds-15667-2026-09-12.json';
import notes from './fixtures/refunds-source-notes-2026-09-12.json';

/** Keep the copied public figures and join the separately held per-file source evidence. */
export function refundFixture(registration: '17868' | '15667' = '17868'): CommitteeRefunds {
  const raw = registration === '17868' ? abeler : dibble;
  const sourceNotes: Record<string, (typeof notes)['2025']> = notes;
  return {
    state: raw.state as RefundState,
    sourceUrl: notes['2025'].source_url,
    copiedOn:
      raw.years
        .map((row) => row.copied_on)
        .filter((day) => day !== null)
        .sort()
        .at(-1) ?? null,
    years: raw.years.map((row) => ({
      year: row.year,
      state: row.state as RefundState,
      contributionsRefunded: row.contributions_refunded,
      amountRefunded: row.amount_refunded,
      sourceFileName: row.source_file_name,
      copiedOn: row.copied_on,
      jointFilingCountsAsOne: sourceNotes[String(row.year)]?.joint_filing_counts_as_one ?? null,
    })),
  };
}
