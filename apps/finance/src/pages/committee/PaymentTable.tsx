import { Link } from '../../router';
import { withFrom } from '../../returnContext';
import { hrefFor, isBuilt } from '../../routes';
import { useBand } from '../../ui/band';
import {
  amountOrMissing,
  dayOrMissing,
  groupCountLabel,
  totalOrWithheld,
  type Group,
  type Row,
} from './data';
import { StatementPanel } from './StatementPanel';

/** A name links to its own committee, or to payments under that exact spelling, only
 * where that page is built; otherwise it is plain text. The name is the link and
 * expansion is a separate control (RULE Design system §07). */
function groupHref(group: Group, here: string): string | null {
  if (group.committeeNumber && isBuilt('committee')) {
    return withFrom(hrefFor('committee', { id: group.committeeNumber }), here);
  }
  if (group.printed && isBuilt('payments-under-name')) {
    return withFrom(
      hrefFor('payments-under-name', { query: group.printed.name }, { role: group.printed.role }),
      here,
    );
  }
  return null;
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={open ? 'f-caret-up' : undefined}
    >
      <path
        d="M6 9 L12 15 L18 9"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function GroupName({ group, here }: { group: Group; here: string }) {
  const href = groupHref(group, here);
  return href ? (
    <Link to={href} className="cmt-name-link">
      {group.name}
    </Link>
  ) : (
    <span className="cmt-name">{group.name}</span>
  );
}

function InKind() {
  return <span className="cmt-inkind">DONATED GOODS OR SERVICES</span>;
}

export function PaymentTable({
  label,
  groups,
  open,
  onToggle,
  jumped,
  here,
  onView,
  statementLevel,
}: {
  label: string;
  groups: readonly Group[];
  open: ReadonlySet<string>;
  onToggle: (key: string) => void;
  jumped: string | null;
  here: string;
  onView: (group: Group, row: Row) => void;
  statementLevel: 3 | 4;
}) {
  const band = useBand();
  const phone = band === 'phone';
  return (
    <div role="table" aria-label={label} className="cmt-table">
      {!phone && (
        <div role="row" className="cmt-grid cmt-table-head">
          <span role="columnheader">DATE</span>
          <span role="columnheader">NAME</span>
          <span role="columnheader" className="cmt-right">
            AMOUNT
          </span>
          <span role="columnheader">TYPE</span>
          <span />
        </div>
      )}
      {groups.map((group) => {
        const isOpen = open.has(group.key);
        const countLabel = groupCountLabel(group);
        const toggleText = isOpen ? 'Hide details' : 'Show details';
        const toggleLabel = `${isOpen ? 'Hide' : 'Show'} the ${countLabel} from ${group.name}`;
        const toggle = (
          <button
            type="button"
            aria-expanded={isOpen}
            aria-label={toggleLabel}
            className="cmt-toggle"
            onClick={() => onToggle(group.key)}
          >
            {toggleText}
            <Chevron open={isOpen} />
          </button>
        );
        const withheld = group.total === null;
        return (
          <div
            role="rowgroup"
            key={group.key}
            className="cmt-group"
            data-open={isOpen || undefined}
          >
            {phone ? (
              <div role="row" className="cmt-phone-row">
                <div className="cmt-phone-top">
                  <span role="cell" className="cmt-phone-name">
                    <GroupName group={group} here={here} />
                    {group.inKind && (
                      <>
                        {' '}
                        <InKind />
                      </>
                    )}
                  </span>
                  <span
                    role="cell"
                    className="cmt-figure cmt-phone-total"
                    data-missing={withheld || undefined}
                  >
                    {totalOrWithheld(group.total)}
                  </span>
                </div>
                <div className="cmt-small">
                  {dayOrMissing(group.rows[0]?.date ?? null)} · {countLabel}
                  {group.kind && ` · ${group.kind}`}
                </div>
                {toggle}
              </div>
            ) : (
              <div role="row" className="cmt-grid cmt-group-row">
                <span role="cell" className="cmt-date">
                  {dayOrMissing(group.rows[0]?.date ?? null)}
                </span>
                <span role="cell" className="cmt-wrap">
                  <GroupName group={group} here={here} />{' '}
                  <span className="cmt-count">· {countLabel}</span>
                  {group.inKind && (
                    <>
                      {' '}
                      <InKind />
                    </>
                  )}
                </span>
                <span
                  role="cell"
                  className="cmt-right cmt-figure"
                  data-missing={withheld || undefined}
                >
                  {totalOrWithheld(group.total)}
                </span>
                <span role="cell" className="cmt-secondary">
                  {group.kind}
                </span>
                <span role="cell" className="cmt-end">
                  {toggle}
                </span>
              </div>
            )}
            {isOpen && (
              <div className="cmt-details">
                {group.rows.map((row) => (
                  <div key={row.id}>
                    <div
                      role="row"
                      id={row.id}
                      tabIndex={-1}
                      className={`cmt-detail ${phone ? 'cmt-detail-phone' : 'cmt-grid'}`}
                      data-jumped={jumped === row.id || undefined}
                    >
                      <span role="cell" className="cmt-date" data-missing={!row.date || undefined}>
                        {dayOrMissing(row.date)}
                      </span>
                      <span role="cell" className="cmt-secondary cmt-wrap cmt-detail-label">
                        Payment record · {group.name}
                      </span>
                      <span
                        role="cell"
                        className="cmt-right cmt-figure"
                        data-missing={!row.amount || undefined}
                      >
                        {amountOrMissing(row.amount)}
                      </span>
                      <span role="cell" className="cmt-secondary cmt-detail-kind">
                        {row.kind}
                      </span>
                      <span role="cell" className="cmt-end cmt-detail-view">
                        <button
                          type="button"
                          className="cmt-text-button cmt-view"
                          onClick={() => onView(group, row)}
                        >
                          View source
                        </button>
                      </span>
                    </div>
                    {row.statement && (
                      <div className="cmt-detail-stmt">
                        <StatementPanel
                          id={row.statement.statement_id}
                          readable
                          pdfUrl={row.statement.pdf_url}
                          level={statementLevel}
                          pdfDonor={group.name}
                          pdfDate={row.date}
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
