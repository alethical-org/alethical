import {
  minnesotaToday,
  NOTICE_AMENDED_NOTE,
  NOTICE_PDF_LABEL,
  NOTICE_WINDOW_NONE,
  NOTICE_WINDOW_NOT_OPEN,
  NOTICE_WINDOW_OPEN,
  noticeDetailParts,
  noticeFirstFiledLine,
  noticeMatchedAccessibleName,
  noticePdfAccessibleName,
  NOTICES_FAILED,
  NOTICES_HEADING,
  NOTICES_LOADING,
  noticesLead,
  noticeStatusText,
  noticeWindowDates,
  windowOpenState,
  type CommitteeNotice,
  type CommitteeNotices,
} from '@alethical/shared/committeeNotices';
import { IN_KIND_CHIP } from '@alethical/shared/committeeMoneyShared';
import { formatMoney } from '@alethical/shared/moneyFormat';

import { Arrow } from '../../ui/parts';
import { Spinner } from './bits';

/** Where a matched notice's payment sits in the list above, or null when the list
 * does not hold it (then the notice offers no jump). */
export interface NoticeTarget {
  tabLabel: string;
  jump: () => void;
}

function Words({ text }: { text: string }) {
  const words = text.split(' ');
  const last = words.pop() ?? '';
  return (
    <span>
      {words.length > 0 && `${words.join(' ')} `}
      <span className="f-nowrap">
        {last}
        <Arrow className="f-arrow f-arrow-after" />
      </span>
    </span>
  );
}

function Notice({
  notice,
  coveredThrough,
  target,
}: {
  notice: CommitteeNotice;
  coveredThrough: string | null;
  target: NoticeTarget | null;
}) {
  const firstFiled = notice.amended ? noticeFirstFiledLine(notice) : null;
  const status = noticeStatusText(notice, target?.tabLabel ?? null, coveredThrough);
  return (
    <li className="cmt-notice">
      <div className="cmt-notice-top">
        <span className="cmt-notice-who">
          <span className="cmt-notice-name">{notice.contributor}</span>
          {notice.amended && <span className="cmt-amended">AMENDED</span>}
        </span>
        <span className="cmt-figure cmt-notice-amount">{formatMoney(notice.amount)}</span>
      </div>
      <div className="cmt-small">
        {noticeDetailParts(notice, IN_KIND_CHIP.toUpperCase()).join(' · ')}
      </div>
      {firstFiled && <div className="cmt-small">{firstFiled}</div>}
      <div className="cmt-notice-actions">
        {notice.status === 'matched' && target ? (
          <button
            type="button"
            className="cmt-text-button cmt-link-36"
            aria-label={noticeMatchedAccessibleName(notice, target.tabLabel)}
            onClick={target.jump}
          >
            <Words text={status} />
          </button>
        ) : (
          <span className="cmt-small">{status}</span>
        )}
        <a
          href={notice.pdfUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={noticePdfAccessibleName(notice)}
          className="f-dest cmt-link-36"
        >
          <Words text={NOTICE_PDF_LABEL} />
        </a>
      </div>
    </li>
  );
}

/**
 * Large-contribution notices for the selected year, by window. No notice amount is
 * added to any figure on the page. The card draws only for a listed answer with a
 * window; every other answer is absent by scope (the shared notices rule).
 */
export function Notices({
  notices,
  loading,
  failed,
  retrying,
  onRetry,
  targetFor,
}: {
  notices: CommitteeNotices | null;
  loading: boolean;
  failed: boolean;
  retrying: boolean;
  onRetry: () => void;
  targetFor: (notice: CommitteeNotice) => NoticeTarget | null;
}) {
  const today = minnesotaToday();
  return (
    <section aria-labelledby="cmt-notices-h" className="f-card cmt-card">
      <h2 id="cmt-notices-h" className="f-section-title">
        {NOTICES_HEADING}
      </h2>
      {notices && !loading && !failed && (
        <p className="cmt-lead">{noticesLead(notices.threshold)}</p>
      )}
      {loading && (
        <div role="status" aria-busy="true" className="cmt-inline-status">
          <Spinner />
          {NOTICES_LOADING}
        </div>
      )}
      {failed && (
        <div role="alert" className="f-alert cmt-alert-narrow">
          <AlertIcon />
          <div>
            {NOTICES_FAILED}
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
          </div>
        </div>
      )}
      {notices && !loading && !failed && (
        <>
          {notices.anyAmended && <p className="cmt-note">{NOTICE_AMENDED_NOTE}</p>}
          {notices.windows.map((window, index) => {
            const open = windowOpenState(window, today);
            const id = `cmt-notice-window-${index}`;
            return (
              <section key={window.key} aria-labelledby={id} className="cmt-window">
                <div className="cmt-window-head">
                  <h3 id={id}>{window.label}</h3>
                  <span className="cmt-secondary cmt-num">{noticeWindowDates(window)}</span>
                  {open !== 'closed' && (
                    <span className="cmt-chip">
                      {open === 'open' ? NOTICE_WINDOW_OPEN : NOTICE_WINDOW_NOT_OPEN}
                    </span>
                  )}
                </div>
                {open !== 'not_open' && window.notices.length === 0 && (
                  <p className="cmt-none">{NOTICE_WINDOW_NONE}</p>
                )}
                {open !== 'not_open' && window.notices.length > 0 && (
                  <ul className="cmt-notice-list">
                    {window.notices.map((notice) => (
                      <Notice
                        key={notice.id}
                        notice={notice}
                        coveredThrough={notices.reportCoveredThrough}
                        target={targetFor(notice)}
                      />
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </>
      )}
    </section>
  );
}

export function AlertIcon() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="#c0392b" strokeWidth="2" />
      <path d="M12 7.5 V13 M12 16 V16.5" stroke="#c0392b" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}
