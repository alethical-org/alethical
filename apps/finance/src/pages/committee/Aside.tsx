import { CONFIRMATION_UNAVAILABLE_LINE } from '@alethical/shared/committeeConfirmation';
import { UNNAMED_PAYMENT_PARTY } from '@alethical/shared/committeeMoneyShared';
import { showingLine } from '@alethical/shared/committeePaymentsPage';
import { currentClaimIsWithheld } from '@alethical/shared/currentClaimFreshness';
import { centralDateLabel } from '@alethical/shared/moneyLanding';
import { formatMoney } from '@alethical/shared/moneyFormat';

import type { Read } from '../../api/read';
import { Link } from '../../router';
import { withFrom } from '../../returnContext';
import { hrefFor, isBuilt } from '../../routes';
import { Arrow, LoadingLine } from '../../ui/parts';
import { AMOUNT_MISSING, dayOrMissing } from './data';
import type { CommitteeConfirmationAnswer, IndependentPayment, PaymentPage } from './types';

/**
 * Independent expenditures this committee filed about others, for the selected
 * payment year: separate from Expenditures and never added to any figure (build
 * notes Round 9, copy proposal C56).
 */
export function IndependentCard({
  year,
  page,
  everFiled,
  onView,
}: {
  year: number;
  page: PaymentPage<IndependentPayment>;
  everFiled: boolean;
  onView: (payment: IndependentPayment) => void;
}) {
  const rows = page.state === 'reported' ? page.payments : [];
  const copied = page.fetched_at ? centralDateLabel(page.fetched_at) : null;
  if (!everFiled && rows.length === 0) return null;
  const total = page.page.total_payments;
  return (
    <section id="committee-ie" tabIndex={-1} aria-labelledby="cmt-ie-h" className="f-card cmt-side">
      <h2 id="cmt-ie-h" className="f-card-title">
        Independent expenditures
      </h2>
      <p className="cmt-small">
        Payment year {year}
        {copied && ` · Independent expenditure file copied ${copied}`}
      </p>
      {rows.length === 0 && (
        <p className="cmt-none">
          No independent expenditure records are held for this account and year
        </p>
      )}
      {rows.length > 0 && (
        <ul className="cmt-ie-list">
          {rows.map((row, index) => {
            const amount = formatMoney(row.amount);
            const position = [row.stance, row.affected_committee_name].filter(Boolean).join(' ');
            return (
              <li key={`${row.record_number}-${index}`} className="cmt-ie">
                <span className="cmt-ie-top">
                  <span className="cmt-ie-payee">
                    {row.vendor_name ? `Paid to ${row.vendor_name}` : UNNAMED_PAYMENT_PARTY}
                  </span>
                  <span className="cmt-figure" data-missing={!amount || undefined}>
                    {amount ?? AMOUNT_MISSING}
                  </span>
                </span>
                <span className="cmt-small">
                  {dayOrMissing(row.paid_on)}
                  {(row.purpose ?? row.expenditure_type) &&
                    ` · ${row.purpose ?? row.expenditure_type}`}
                </span>
                {position && <span className="cmt-small">Position as filed: {position}</span>}
                <span>
                  <button
                    type="button"
                    className="cmt-text-button cmt-link-36"
                    onClick={() => onView(row)}
                  >
                    View source
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {page.page.has_more && total !== null && (
        <p className="cmt-small">{showingLine(rows.length, total, year)}</p>
      )}
    </section>
  );
}

/** Related records: the legislator a person confirmed this committee belongs to.
 * A claim about whose committee this is now expires (rule 12), so an old answer is
 * withheld rather than shown. */
export function RelatedCard({
  confirmation,
  here,
}: {
  confirmation: Read<CommitteeConfirmationAnswer>;
  here: string;
}) {
  const answer = confirmation.data;
  const validated = answer?.current_claim_validated_at
    ? Date.parse(answer.current_claim_validated_at)
    : Number.NaN;
  const stale =
    answer !== null && (Number.isNaN(validated) || currentClaimIsWithheld(Date.now() - validated));
  const member = answer && !stale ? answer.confirmed_for : null;
  return (
    <section aria-labelledby="cmt-related-h" className="f-card cmt-side">
      <h2 id="cmt-related-h" className="f-card-title">
        Related records
      </h2>
      {confirmation.loading && <LoadingLine>Loading…</LoadingLine>}
      {(confirmation.failed || stale) && (
        <p className="cmt-none">{CONFIRMATION_UNAVAILABLE_LINE}</p>
      )}
      {answer && !stale && member && isBuilt('legislator') && (
        <ul className="cmt-related">
          <li>
            <Link
              to={withFrom(hrefFor('legislator', { id: member.legislator_id }), here)}
              className="cmt-related-link"
            >
              <span className="cmt-related-words">
                <span className="cmt-related-label">Legislator profile</span>
                <span className="cmt-related-note">{member.full_name}</span>
              </span>
              <Arrow />
            </Link>
          </li>
        </ul>
      )}
      {answer && !stale && !member && (
        <p className="cmt-none">No candidate affiliation is held for this committee</p>
      )}
    </section>
  );
}
