import {
  UNLINKED_FAILED,
  UNLINKED_HEADING,
  UNLINKED_LEAD,
  UNLINKED_LOADING,
  UNLINKED_REFRESH_FAILED,
  type UnlinkedStatements,
} from '@alethical/shared/disclosureStatementCopy';

import { Spinner } from './bits';
import { AlertIcon } from './Notices';
import { StatementPanel } from './StatementPanel';

/** Statements not linked to a payment: known apart from the payment list, so a
 * statement never vanishes because the list did. No amount here is added to anything. */
export function Unlinked({
  listed,
  loading,
  failed,
  retrying,
  onRetry,
}: {
  listed: UnlinkedStatements | null;
  loading: boolean;
  failed: boolean;
  retrying: boolean;
  onRetry: () => void;
}) {
  const retry = (
    <div className="f-alert-action">
      <button
        type="button"
        className="f-btn f-btn-secondary f-btn-small"
        aria-disabled={retrying || undefined}
        onClick={() => !retrying && onRetry()}
      >
        Try again
      </button>
    </div>
  );
  return (
    <section aria-labelledby="cmt-unlinked-h" className="f-card cmt-card">
      <h2 id="cmt-unlinked-h" className="f-section-title">
        {UNLINKED_HEADING}
      </h2>
      <p className="cmt-lead">{UNLINKED_LEAD}</p>
      {loading && (
        <div role="status" aria-busy="true" className="cmt-inline-status">
          <Spinner />
          {UNLINKED_LOADING}
        </div>
      )}
      {failed && (
        <div role="alert" className="f-alert cmt-alert-narrow">
          <AlertIcon />
          <div>
            {listed ? UNLINKED_REFRESH_FAILED : UNLINKED_FAILED}
            {retry}
          </div>
        </div>
      )}
      {listed && !loading && (
        <div className="cmt-unlinked-list">
          {listed.statements.map((statement) => (
            <StatementPanel
              key={statement.id}
              id={statement.id}
              readable={statement.state !== 'not_read'}
              pdfUrl={statement.pdfUrl}
              level={3}
              fields={{
                donor: statement.donorName,
                recipient: statement.recipientName,
                date: statement.giftDate,
                amount: statement.giftAmount,
              }}
              pdfDonor={statement.donorName}
              pdfDate={statement.giftDate}
            />
          ))}
        </div>
      )}
    </section>
  );
}
