import { Children, useLayoutEffect, useRef, useState } from 'react';
import type {
  SavedMailSubmission,
  MailRegistration,
  MailRecordBlock,
  MailPayment,
} from '../data/mailAnalysis';
import type { MailImageSide } from '../data/mailUpload';
import { useMailAnalysis } from '../hooks/useMailAnalysis';
import { formatDay, formatMoney } from '../lib/moneyFormat';
import { centralDateLabel } from '../lib/moneyLanding';
import { MailPhotoDialog } from './MailPhotoDialog';

const css = `
.mail-upload .saved-results{display:grid;grid-template-columns:360px minmax(0,720px);gap:56px;align-items:start}
.mail-upload .saved-results>.success{margin-top:calc(17px * 1.4 + 10px)}
.mail-upload .mail-results{min-width:0;font-size:16px;line-height:1.5}
.mail-results section+section{margin-top:28px}.mail-upload .mail-results h2{font-size:17px;line-height:1.4;font-weight:700;margin:0 0 10px}
.mail-results .result-card{background:#fff;border:1px solid rgba(17,21,15,.12);border-radius:16px;padding:16px 17px 10px;min-width:0;overflow-wrap:anywhere}
.mail-results .result-card+.result-card{margin-top:12px}.mail-results p{margin:0}.mail-results p+p{margin-top:8px}
.mail-results .muted{color:#4f5651}.mail-results blockquote{margin:12px 7px 0 0;line-height:1.45;font-size:17px;font-weight:600;white-space:pre-wrap;overflow-wrap:anywhere}
.mail-results .payer-card{padding:8px 10px 16px 17px}.mail-results .source-row{border-bottom:1px solid rgba(17,21,15,.08);padding-bottom:8px;flex-wrap:wrap;display:flex;align-items:center;justify-content:space-between;gap:12px}
.mail-results .result-name{font-size:19px;line-height:1.25;letter-spacing:-.01em;font-weight:800;margin:0 0 4px}
.mail-results .result-source{display:inline-flex;align-items:center;min-height:44px;color:#0f7a45;text-decoration:underline;text-underline-offset:3px;font-weight:600}
.mail-results .result-source:hover{color:#11832b;text-decoration-thickness:2px}.mail-results a:focus-visible,.mail-results h2:focus-visible,.mail-results h3:focus-visible,.mail-results .reading:focus-visible,.mail-results .results-failure:focus-visible{outline:3px solid rgba(91,48,214,.55);outline-offset:3px;border-radius:3px}
.mail-results .record-meta{color:#4f5651;font-size:15px;font-variant-numeric:tabular-nums}.mail-results .count{font-variant-numeric:tabular-nums}
.mail-upload .mail-results .text-card{padding:4px 10px 4px 7px}.mail-results .text-side+.text-side{border-top:1px solid rgba(17,21,15,.1)}
.mail-results .text-controls{display:flex;flex-wrap:wrap;align-items:center;gap:4px 10px;padding:4px 0}.mail-upload .mail-results .text-toggle{display:flex;align-items:center;gap:8px;flex:1 1 120px;min-width:0;min-height:48px;text-align:left;border:0;border-radius:10px;padding:0 10px 0 4px;font-size:17px}
.mail-upload .mail-results .text-toggle:hover{background:#f1f3f2}.mail-results .text-content{margin:0 0 12px 4px;background:#f5f6f7;border-radius:10px;padding:12px 14px;font-size:16px;line-height:1.55;color:#2c322c;white-space:pre-wrap;overflow-wrap:anywhere}
.mail-upload .mail-results .view-photo{display:inline-flex;align-items:center;gap:8px;padding:0 14px 0 12px;border-radius:10px;font-size:15px;line-height:1.3;min-height:44px;flex:0 1 auto;max-width:100%;text-align:left}
.mail-results .view-photo svg{flex:none}.mail-results .reading{display:flex;align-items:center;gap:12px}
.mail-upload .mail-photo-dialog{position:fixed;inset:10px;margin:0;padding:0;border:0;border-radius:20px;width:calc(100vw - 20px);height:calc(100dvh - 20px);max-width:none;max-height:none;color:#11150f;background:#fff;font-family:'Libre Franklin',sans-serif;overflow:visible;box-shadow:0 1px 2px rgba(17,21,15,.1),0 12px 26px rgba(17,21,15,.16),0 40px 80px rgba(17,21,15,.3)}
.mail-photo-dialog::backdrop{background:rgba(17,21,15,.42)}.mail-photo-panel{padding:10px;box-sizing:border-box;height:100%;display:flex;flex-direction:column;gap:10px}
.mail-photo-heading{display:flex;flex:none;align-items:center;justify-content:space-between;gap:12px;padding-left:8px}.mail-upload .mail-photo-heading h2{font-size:19px;line-height:1.25;font-weight:800;margin:0}.mail-photo-image-area{position:relative;flex:1;min-height:0;overflow:hidden;text-align:center;background:#e4e8e6;border-radius:12px;touch-action:none;user-select:none}.mail-photo-image-area img{position:absolute;left:50%;top:50%;max-width:none;max-height:none;object-fit:contain;transform-origin:center;pointer-events:none}.mail-photo-image-area p{padding:16px}.mail-photo-failed{position:absolute;inset:0;background:#f5f6f7;border:1px solid #e0b673;border-radius:12px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:20px}.mail-photo-image-area .mail-photo-error{display:flex;align-items:flex-start;gap:7px;color:#8f5a12;font-size:14.5px;line-height:1.45;font-weight:600;text-wrap:pretty}.mail-photo-error svg{flex:none;margin-top:2px}
.mail-upload .mail-photo-dialog button{font:700 15px/1.3 'Libre Franklin',sans-serif;border:1px solid rgba(17,21,15,.16);border-radius:10px;background:#fff;min-height:44px;padding:0 14px 0 11px;cursor:pointer;display:inline-flex;align-items:center;gap:6px;white-space:nowrap}.mail-upload .mail-photo-dialog button svg{flex:none;color:#4f5651}.mail-upload .mail-photo-dialog button:hover:not([aria-disabled="true"]){background:#f7f8fa;border-color:rgba(17,21,15,.3)}.mail-upload .mail-photo-dialog button[aria-disabled="true"]{border-color:rgba(17,21,15,.12);color:#8a908a;background:#fff;opacity:1;cursor:not-allowed}.mail-upload .mail-photo-dialog button[aria-disabled="true"] svg{color:#8a908a}.mail-upload .mail-photo-dialog .mail-photo-close{width:44px;height:44px;flex:none;justify-content:center;padding:0;border-radius:11px}.mail-photo-tools{display:flex;flex:none;flex-wrap:wrap;justify-content:center;gap:8px}.mail-upload .mail-photo-dialog button:focus-visible,.mail-photo-image-area:focus-visible{outline:2px solid #7c5cff;outline-offset:2px}
@media(max-width:1099px){.mail-upload .saved-results{grid-template-columns:minmax(0,1fr);gap:32px}.mail-upload .saved-results>.success{margin-top:0}}
.mail-results .record-basis{font-size:15px;line-height:1.45;font-weight:600;color:#4f5651}
.mail-results .committee-records{margin-top:14px;padding-top:12px;border-top:1px solid rgba(17,21,15,.08)}.mail-results .committee-records h4{margin:0;font-size:16px;line-height:1.4;font-weight:800}.mail-results .registration-record{margin-top:6px;padding-bottom:12px}.mail-results .registration-record p+p{margin-top:0}
.mail-results .record-group{border-top:1px solid rgba(17,21,15,.08);padding:4px 0 12px}.mail-results .record-group h4{margin:0}.mail-results .record-group h4 a{font-size:16px;font-weight:700;line-height:1.35;text-underline-offset:2px}
.mail-results .payment-rows{list-style:none;margin:2px 0 0;padding:0}.mail-results .payment-row{margin-top:10px;padding-top:10px;border-top:1px solid rgba(17,21,15,.08)}.mail-results .payment-row:first-child{margin-top:2px;padding-top:0;border-top:0}.mail-results .payment-value{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:0 12px;font-variant-numeric:tabular-nums}.mail-results .payment-amount{font-size:18px;line-height:1.35;font-weight:800;white-space:nowrap}.mail-results .payment-value>span{font-size:15px;line-height:1.45;color:#4f5651}.mail-results .payment-row .payment-fact{font-size:15px;line-height:1.5;margin:2px 0 0;overflow-wrap:anywhere;text-wrap:pretty}.mail-results .payment-fact b{margin-right:6px;font-weight:700;color:#4f5651}.mail-results .retrieved{margin-top:8px;font-size:14px}
.mail-results .results-failure{display:flex;align-items:flex-start;gap:8px;background:#fdecec;border:1px solid #f4c9c6;border-radius:12px;padding:11px 13px;color:#8f2a20;font-size:15px;line-height:1.45;font-weight:600}.mail-results .results-failure svg{flex:none;margin-top:1px}.mail-upload .mail-results .results-retry{margin-top:10px;width:240px;max-width:100%;min-height:48px;display:inline-flex;align-items:center;justify-content:center;gap:10px;padding:11px 14px;font-size:16px}.mail-upload .mail-results .results-retry[aria-disabled="true"]{cursor:default;opacity:.6;background:#fff;border-color:rgba(17,21,15,.18)}.mail-results .results-spinner{display:inline-block;width:18px;height:18px;border:2.6px solid rgba(6,35,26,.25);border-top-color:#06231a;border-radius:50%;animation:mail-spin .8s linear infinite;flex:none}.mail-results .reading{min-height:64px;padding:18px 17px;font-weight:600}.mail-results .partial-note{padding:0 0 10px 30px;font-size:14.5px;line-height:1.45;font-weight:600;color:#4f5651}
@media(prefers-reduced-motion:reduce){.mail-results .results-spinner{animation:none}}
@media(max-width:767px){.mail-upload .mail-results .results-retry{width:100%}}
`;

const sideName = (side: MailImageSide) => (side === 'front' ? 'Front' : 'Back');

function SourceLink({
  url,
  children,
}: {
  url: string | null | undefined;
  children: React.ReactNode;
}) {
  let safe = false;
  let publisher = '';
  try {
    safe = !!url && ['https:', 'http:'].includes(new URL(url).protocol);
    const hostname = url ? new URL(url).hostname : '';
    if (hostname === 'cfb.mn.gov' || hostname.endsWith('.cfb.mn.gov'))
      publisher = 'Minnesota Campaign Finance Board';
    if (hostname === 'sos.mn.gov' || hostname.endsWith('.sos.mn.gov'))
      publisher = 'Minnesota Secretary of State';
  } catch {
    /* No unsafe href. */
  }
  return safe ? (
    <a
      className="result-source"
      href={url!}
      target="_blank"
      rel="noopener noreferrer"
      referrerPolicy="no-referrer"
      aria-label={[Children.toArray(children).join(''), publisher, 'opens in a new tab']
        .filter(Boolean)
        .join(', ')}
    >
      {children}
    </a>
  ) : null;
}

function PhotoButton({ side, open }: { side: MailImageSide; open: (side: MailImageSide) => void }) {
  return (
    <button
      type="button"
      className="view-photo"
      onClick={(event) => {
        // Safari does not focus buttons on pointer activation. Establish this
        // trigger before the modal captures where Escape/Close should return.
        event.currentTarget.focus({ preventScroll: true });
        open(side);
      }}
      aria-label={`View ${side} photo`}
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        aria-hidden="true"
      >
        <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
        <circle cx="9" cy="9.5" r="1.8" />
        <path d="M4 17 9.5 12.5 13 15.5 16 13 20 16.5" strokeLinejoin="round" />
      </svg>
      View photo
    </button>
  );
}

function Failure({ children }: { children: React.ReactNode }) {
  return (
    <div className="results-failure" role="alert" tabIndex={-1}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
        <path d="M12 7.5V13" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        <circle cx="12" cy="16.4" r="1.25" fill="currentColor" />
      </svg>
      <span>{children}</span>
    </div>
  );
}
function Spinner() {
  return <span className="results-spinner" aria-hidden="true" />;
}
function Retry({ busy, onClick }: { busy: boolean; onClick: () => void }) {
  const button = useRef<HTMLButtonElement>(null);
  useLayoutEffect(
    () => () => {
      const node = button.current;
      if (!node || document.activeElement !== node) return;
      const results = node.closest('.mail-results');
      const heading =
        node.closest('article')?.querySelector<HTMLElement>('h3') ??
        node.closest('section')?.querySelector<HTMLElement>('h2');
      // Wait for the replacement result to mount, and never interrupt someone
      // who moved focus elsewhere while the request completed.
      queueMicrotask(() => {
        if (
          !results?.isConnected ||
          (document.activeElement !== document.body && document.activeElement !== node)
        )
          return;
        const destination = heading?.isConnected
          ? heading
          : (results.querySelector<HTMLElement>('.session-recovery') ??
            results.querySelector<HTMLElement>(
              'h2, [role="status"][tabindex], [role="alert"][tabindex]',
            ) ??
            results.querySelector<HTMLElement>('button.results-retry'));
        destination?.focus({ preventScroll: true });
        if (destination) {
          const rect = destination.getBoundingClientRect();
          if (rect.top < 0 || rect.left < 0 || rect.bottom > innerHeight || rect.right > innerWidth)
            destination.scrollIntoView({
              block: 'nearest',
              inline: 'nearest',
              behavior: 'instant',
            });
        }
      });
    },
    [],
  );
  return (
    <button
      ref={button}
      type="button"
      className="results-retry"
      aria-disabled={busy}
      aria-busy={busy}
      onClick={() => {
        if (!busy) onClick();
      }}
    >
      {busy && <Spinner />}
      {busy ? 'Trying again…' : 'Try again'}
    </button>
  );
}
function Payment({
  row,
  kind,
}: {
  row: MailPayment;
  kind: 'received' | 'paid' | 'independent_spending';
}) {
  const type = row.receipt_type ?? row.expenditure_type;
  const unpaid =
    row.unpaid_amount && Number(row.unpaid_amount) > 0 ? formatMoney(row.unpaid_amount) : null;
  return (
    <li className="payment-row">
      <div className="payment-value">
        <strong className="payment-amount">{formatMoney(row.amount) ?? 'Not reported'}</strong>
        <span>{formatDay(row.received_on ?? row.paid_on)}</span>
      </div>
      {unpaid && <p className="payment-fact">{unpaid} of it unpaid</p>}
      {kind === 'received' && row.contributor && (
        <p className="payment-fact">
          <b>From</b> {row.contributor}
        </p>
      )}
      {row.affected_committee_name && (
        <p className="payment-fact">
          <b>{row.stance === 'For' || row.stance === 'Against' ? row.stance : 'To'}</b>{' '}
          {row.affected_committee_name}
        </p>
      )}
      {row.vendor_name && (
        <p className="payment-fact">
          <b>To</b> {row.vendor_name}
        </p>
      )}
      {type &&
        !['Contribution', 'General Expenditure', 'Independent Expenditure'].includes(type) && (
          <p className="payment-fact">{type}</p>
        )}
      {row.in_kind === 'Yes' && (
        <p className="payment-fact">
          In kind{row.in_kind_description ? `: ${row.in_kind_description}` : ''}
        </p>
      )}
      {row.purpose && (
        <p className="payment-fact">
          <b>Purpose</b> “{row.purpose}”
        </p>
      )}
    </li>
  );
}
function RecordBlock({
  block,
  kind,
  year,
}: {
  block?: MailRecordBlock;
  kind: 'received' | 'paid' | 'independent_spending';
  year?: number;
}) {
  if (block?.state === 'not_reported') return null;
  const title = {
    received: 'Contributions',
    paid: 'Payments',
    independent_spending: 'Independent spending',
  }[kind];
  const rows = block?.state === 'reported' ? block.payments.slice(0, 5) : [];
  const more =
    block?.has_more && block.total_payments !== null && block.total_payments > rows.length;
  const scope = rows.length
    ? `${block?.has_more ? `Latest ${rows.length}${more ? ` of ${block.total_payments}` : ''}` : rows.length} ${rows.length === 1 && !more ? 'record' : 'records'}`
    : null;
  return (
    <div className="record-group">
      <h4>{block?.source_url ? <SourceLink url={block.source_url}>{title}</SourceLink> : title}</h4>
      <p className="record-meta">
        {[scope, year].filter((value) => value !== null && value !== undefined).join(' · ')}
      </p>
      {!block || block.state === 'unavailable' ? (
        <Failure>We couldn’t load these results</Failure>
      ) : (
        <ul className="payment-rows">
          {rows.map((row, index) => (
            <Payment key={index} row={row} kind={kind} />
          ))}
        </ul>
      )}
      {block?.fetched_at && (
        <p className="record-meta retrieved">Retrieved {centralDateLabel(block.fetched_at)}</p>
      )}
    </div>
  );
}

function Registration({ record, retry }: { record: MailRegistration; retry?: React.ReactNode }) {
  const basis =
    record.basis === 'same_website'
      ? 'Same website'
      : record.basis === 'similar_committee_name'
        ? 'Similar name'
        : record.basis === 'same_committee_name'
          ? 'Name matches only'
          : null;
  const records = record.records;
  return (
    <article className="result-card">
      <h3 tabIndex={-1} className="result-name">
        {record.name}
      </h3>
      {basis && <p className="record-basis">{basis}</p>}
      <div className="committee-records">
        <h4>Records for this committee</h4>
        <p className="record-meta">Minnesota Campaign Finance Board</p>
        <div className="registration-record">
          <SourceLink url={record.source_url}>Registration {record.registration_number}</SourceLink>
          {record.roles?.map(({ role, name }, index) => (
            <p key={index}>
              {role}: {name}
            </p>
          ))}
          {record.person && <p>{record.person}</p>}
          {record.office && <p>{record.office}</p>}
          {record.checked_on && (
            <p className="record-meta">Checked {formatDay(record.checked_on)}</p>
          )}
        </div>
        {records?.refresh_failed && (
          <>
            <Failure>We couldn’t refresh these records</Failure>
            {retry}
          </>
        )}
        {records?.state === 'available' ? (
          <>
            {(['received', 'paid', 'independent_spending'] as const).map((kind) => (
              <RecordBlock key={kind} kind={kind} block={records[kind]} year={records.year} />
            ))}
          </>
        ) : (
          <>
            <Failure>We couldn’t load these results</Failure>
            {retry}
          </>
        )}
      </div>
    </article>
  );
}

export function MailAnalysisResults({
  submission,
  onStartAgain,
}: {
  submission: SavedMailSubmission;
  onStartAgain: () => void;
}) {
  const analysis = useMailAnalysis(submission);
  const [expanded, setExpanded] = useState<Partial<Record<MailImageSide, boolean>>>({});
  const [photoSide, setPhotoSide] = useState<MailImageSide | null>(null);
  const result = analysis.result;
  const reading = !result || result.status === 'pending' || result.status === 'processing';
  const uniqueRegistrations = (records: MailRegistration[]) =>
    records.filter(
      (record, index) =>
        records.findIndex(
          (other) =>
            other.registration_number === record.registration_number &&
            other.scope === record.scope,
        ) === index,
    );
  const candidates = uniqueRegistrations(
    result?.payers.flatMap((payer) => payer.candidates ?? []) ?? [],
  );
  const related = uniqueRegistrations(
    result?.payers.flatMap((payer) => payer.related_records ?? []) ?? [],
  );
  const organizations =
    result?.payers.flatMap((payer) =>
      payer.official_organization ? [payer.official_organization] : [],
    ) ?? [];
  const unreadable = result?.sides.filter((side) => side.status === 'unreadable') ?? [];
  const partialText = result?.sides.some((side) => side.status === 'partial');
  const bothRead = (['front', 'back'] as const).every((side) =>
    result?.sides.some((read) => read.side === side && read.status === 'read'),
  );
  const retained = !!result && (result.sides.length > 0 || result.payers.length > 0);
  const retry =
    result?.can_retry || analysis.retrying ? (
      <Retry busy={analysis.retrying || reading} onClick={analysis.retry} />
    ) : null;
  const announcement =
    result?.status === 'ready'
      ? 'Results ready'
      : result?.status === 'partial' && (partialText || unreadable.length)
        ? 'Some text could not be read'
        : '';
  return (
    <div className="mail-results">
      <style>{css}</style>
      <p className="sr-only" role="status">
        {announcement}
      </p>
      {reading && !analysis.retrying && !analysis.error && (
        <section role="status" tabIndex={-1} className="result-card reading">
          <Spinner />
          Reading your mail
        </section>
      )}
      {analysis.error && (
        <section>
          <Failure>
            {analysis.error === 'expired'
              ? 'This upload session is no longer available'
              : 'We couldn’t load these results'}
          </Failure>
          {analysis.error === 'expired' ? (
            <button type="button" className="results-retry session-recovery" onClick={onStartAgain}>
              Start again
            </button>
          ) : (
            <Retry busy={analysis.refreshing} onClick={analysis.refresh} />
          )}
        </section>
      )}
      {result?.status === 'failed' && !retained && !analysis.error && (
        <section>
          <Failure>We couldn’t load these results</Failure>
          {retry}
        </section>
      )}
      {!!unreadable.length && (
        <section>
          {unreadable.map((side) => (
            <div className="unreadable-side" key={side.side}>
              <h2 tabIndex={-1}>{sideName(side.side)}</h2>
              <Failure>We couldn’t read this photo</Failure>
            </div>
          ))}
          {retry}
        </section>
      )}
      {!!result?.payers.length && (
        <section aria-labelledby="mail-printed-payer">
          <h2 tabIndex={-1} id="mail-printed-payer">
            Printed payer
          </h2>
          {result.payers.map((payer, index) => (
            <article className="result-card payer-card" key={`${payer.side}-${index}`}>
              <div className="source-row">
                <span className="record-meta">Machine-read text · {sideName(payer.side)}</span>
                <PhotoButton side={payer.side} open={setPhotoSide} />
              </div>
              <blockquote>“{payer.quote}”</blockquote>
            </article>
          ))}
        </section>
      )}
      {bothRead && !result?.payers.length && !reading && (
        <section aria-labelledby="mail-printed-payer">
          <h2 tabIndex={-1} id="mail-printed-payer">
            Printed payer
          </h2>
          <div className="result-card">
            <strong>No payer found</strong>
          </div>
        </section>
      )}
      {!!organizations.length && (
        <section aria-labelledby="mail-public-records">
          <h2 tabIndex={-1} id="mail-public-records">
            Public records
          </h2>
          {organizations.map((organization, index) => (
            <article className="result-card" key={index}>
              <h3 tabIndex={-1} className="result-name">
                {organization.name}
              </h3>
              <p className="record-basis">Name and address match</p>
              {organization.address && (
                <div className="committee-records">Listed at {organization.address}</div>
              )}
              <SourceLink url={organization.source_url}>
                {organization.source_title ?? 'Public record'}
              </SourceLink>
              {organization.checked_on && (
                <p className="record-meta">Checked {formatDay(organization.checked_on)}</p>
              )}
            </article>
          ))}
        </section>
      )}
      {!!candidates.length && (
        <section aria-labelledby="mail-possible-matches">
          <h2 tabIndex={-1} id="mail-possible-matches">
            Possible matches
          </h2>
          {candidates.map((record, index) => (
            <Registration
              key={`${record.registration_number}-${index}`}
              record={record}
              retry={retry}
            />
          ))}
        </section>
      )}
      {!!related.length && (
        <section aria-labelledby="mail-related-records">
          <h2 tabIndex={-1} id="mail-related-records">
            Related records
          </h2>
          {related.map((record, index) => (
            <Registration
              key={`${record.registration_number}-${index}`}
              record={record}
              retry={retry}
            />
          ))}
        </section>
      )}
      {result && (!reading || retained || result.matching_mailers.count !== null) && (
        <section aria-labelledby="mail-matching-mailers">
          <h2 tabIndex={-1} id="mail-matching-mailers">
            Matching mailers
          </h2>
          <div className="result-card count">
            {result.matching_mailers.count === null
              ? 'Not counted yet'
              : `${result.matching_mailers.count.toLocaleString('en-US')} ${result.matching_mailers.count === 1 ? 'submission' : 'submissions'}`}
          </div>
        </section>
      )}
      {!!result?.sides.length && (
        <section aria-labelledby="mail-machine-text">
          <h2 tabIndex={-1} id="mail-machine-text">
            Machine-read text
          </h2>
          <div className="result-card text-card">
            {(['front', 'back'] as const).map((side) => {
              const read = result.sides.find((item) => item.side === side);
              if (!read) return null;
              return (
                <div className="text-side" key={side}>
                  <div className="text-controls">
                    {read.text ? (
                      <button
                        type="button"
                        className="text-toggle"
                        aria-expanded={!!expanded[side]}
                        aria-controls={`mail-text-${side}`}
                        onClick={() => setExpanded((old) => ({ ...old, [side]: !old[side] }))}
                      >
                        <svg
                          width="18"
                          height="18"
                          viewBox="0 0 24 24"
                          fill="none"
                          aria-hidden="true"
                        >
                          <path
                            d={expanded[side] ? 'M6 9 L12 15 L18 9' : 'M9 6 L15 12 L9 18'}
                            stroke="#4f5651"
                            strokeWidth="2.2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                        {sideName(side)}
                      </button>
                    ) : (
                      <div className="text-toggle text-unavailable">{sideName(side)}</div>
                    )}
                    <PhotoButton side={side} open={setPhotoSide} />
                  </div>
                  {read.status === 'partial' && (
                    <p className="partial-note">Some text could not be read</p>
                  )}
                  {read.text && (
                    <div id={`mail-text-${side}`} className="text-content" hidden={!expanded[side]}>
                      {read.text}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {partialText && !unreadable.length && retry}
        </section>
      )}
      {photoSide && (
        <MailPhotoDialog
          key={photoSide}
          side={photoSide}
          file={submission.photos[photoSide]}
          onClose={() => setPhotoSide(null)}
        />
      )}
    </div>
  );
}
