import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { boardRecordUrl } from '@alethical/shared/boardRecordLink';
import { campaignMoneyHistoryYears } from '@alethical/shared/campaignMoneyYears';
import {
  committeeEyebrow,
  isBallotQuestionFiler,
  registerKindFromEntityType,
  registrationNumberFromSlug,
} from '@alethical/shared/committeeMoneyShared';
import {
  committeeNoticesFromPayload,
  NOTICE_LIST_URL,
  NOTICES_SOURCE_LABEL,
  noticesCardDraws,
  type CommitteeNotice,
} from '@alethical/shared/committeeNotices';
import { PAYMENTS_LOAD_ERROR, REPORT_LOAD_ERROR } from '@alethical/shared/committeePaymentsPage';
import {
  CONTRIBUTION_PERIOD_LIMIT,
  OFFICIAL_TOTAL_RECORD_LIMIT,
  REPEATED_RECORD_LIMIT,
} from '@alethical/shared/moneyRecordTrust';
import { unlinkedStatementsFromPayload } from '@alethical/shared/disclosureStatementCopy';
import { centralDateLabel } from '@alethical/shared/moneyLanding';
import { formatDay, formatMoney } from '@alethical/shared/moneyFormat';
import { PAYMENT_FILE_LABELS, paymentCopyLines } from '@alethical/shared/paymentCopyDates';

import { apiPath, useRead } from '../api/read';
import { useLocation } from '../router';
import { returnTarget } from '../returnContext';
import type { RouteMatch } from '../routes';
import { useAddressState } from '../ui/addressState';
import { Dropdown, Empty, EvidencePanel, Refused, type Evidence } from '../ui/controls';
import { BackLink, SourcesAndUpdates, WithArrow } from '../ui/parts';
import { IndependentCard, RelatedCard } from './committee/Aside';
import { ScrollingTabs, Spinner } from './committee/bits';
import {
  AMOUNT_MISSING,
  contributionGroups,
  countsLine,
  expenditureGroups,
  isContribution,
  isSort,
  isTab,
  matchName,
  recordCount,
  SORTS,
  sortGroups,
  tableTotal,
  tabLabel,
  tabOfKind,
  TABS,
  type ContributionTab,
  type Group,
  type Row,
  type SortKey,
  type TabKey,
} from './committee/data';
import { Figures } from './committee/Figures';
import { AlertIcon, Notices, type NoticeTarget } from './committee/Notices';
import { PaymentTable } from './committee/PaymentTable';
import type {
  CommitteeConfirmationAnswer,
  CommitteeFinance,
  Filings,
  IndependentPayment,
  MadePayment,
  PaymentPage,
  ReceivedPayment,
} from './committee/types';
import { Unlinked } from './committee/Unlinked';
import { useYearPayments } from './committee/useYearPayments';
import './committee.css';

const BOARD = 'Minnesota Campaign Finance and Public Disclosure Board';
/** Names shown before "Show the other {n} names". */
const STEP = 25;

function chosenYear(raw: string, years: readonly number[]): number {
  const year = Number(raw);
  return Number.isInteger(year) && years.includes(year) ? year : years[0];
}

function evidenceFor(
  title: string,
  file: string,
  copiedAt: string | null,
  recordNumber: number,
  sourceHref: string,
): Evidence {
  return {
    title,
    authority: BOARD,
    rows: [
      { label: 'Saved source', value: file },
      ...(copiedAt
        ? [{ label: 'Source version', value: `Copy of ${centralDateLabel(copiedAt)}` }]
        : []),
      { label: 'Record number', value: String(recordNumber) },
    ],
    quote: 'No saved source excerpt is held for this record',
    quoteLabel: 'SOURCE TEXT',
    checked: 'Not checked',
    sourceHref,
    sourceLabel: 'View source',
  };
}

/**
 * Committee (Committee drawing, build notes Rounds 19 to 21): one registered
 * committee's official report figures, its itemized contributions by kind and its
 * expenditures for a year, grouped by printed name, with disclosure statements,
 * large-contribution notices, independent expenditures and related records.
 * Keyed on the Board's registration number.
 */
export function Committee({ match }: { match: RouteMatch }) {
  const location = useLocation();
  const here = location.pathname + location.search;
  const back = returnTarget(location.search);
  const registration = registrationNumberFromSlug(match.params.id) ?? match.params.id;
  const id = encodeURIComponent(registration);
  const years = useMemo(() => campaignMoneyHistoryYears(), []);
  const [address, setAddress] = useAddressState({
    year: String(years[0]),
    tab: 'individuals',
    q: '',
    sort: 'total',
    report: '',
  });
  const year = chosenYear(address.year, years);
  const focusIndependent = address.tab === 'independent';
  const tab: TabKey = isTab(address.tab) ? address.tab : 'individuals';
  const sort: SortKey = isSort(address.sort) ? address.sort : 'total';
  const isExp = tab === 'expenditures';

  // --- Reads -------------------------------------------------------------------------
  const finance = useRead<CommitteeFinance>(
    apiPath(['committees', id, 'finance'], { year, include_confirmation: 'false' }),
    { keepPrevious: true },
  );
  const record =
    finance.data && finance.data.registration_number === registration ? finance.data : null;
  const current = record && record.year === year && !finance.updating ? record : null;
  const filings = useRead<Filings>(apiPath(['committees', id, 'filings']));
  const confirmation = useRead<CommitteeConfirmationAnswer>(
    apiPath(['committees', id, 'confirmation']),
  );
  const notices = useRead<unknown>(apiPath(['committees', id, 'notices'], { year }));
  const unlinked = useRead<unknown>(
    apiPath(['committees', id, 'disclosure-statements'], { year }),
    {
      keepPrevious: true,
    },
  );
  const received = useYearPayments<ReceivedPayment>(
    apiPath(['committees', id, 'payments'], { direction: 'received', year, sort: 'date' }),
  );
  const made = useYearPayments<MadePayment>(
    isExp
      ? apiPath(['committees', id, 'payments'], { direction: 'made', year, sort: 'date' })
      : null,
  );
  const independent = useRead<PaymentPage<IndependentPayment>>(
    apiPath(['committees', id, 'payments'], {
      direction: 'independent_by',
      year,
      sort: 'date',
      limit: 250,
    }),
  );
  const independentEver = useRead<PaymentPage<IndependentPayment>>(
    apiPath(['committees', id, 'payments'], { direction: 'independent_by', limit: 1 }),
  );

  // --- In-page state ------------------------------------------------------------------
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [shown, setShown] = useState(STEP);
  const [jumped, setJumped] = useState<string | null>(null);
  const [evidence, setEvidence] = useState<Evidence | null>(null);
  const closeEvidence = useCallback(() => setEvidence(null), []);
  useEffect(() => {
    setOpen(new Set());
    setShown(STEP);
    setJumped(null);
  }, [registration, year]);

  const groups = useMemo(
    () =>
      received.data
        ? contributionGroups(
            received.data.payments,
            received.data.linkable,
            received.data.statements,
          )
        : null,
    [received.data],
  );
  const spent = useMemo(
    () => (made.data ? expenditureGroups(made.data.payments, made.data.linkable) : null),
    [made.data],
  );

  const list = isExp ? made : received;
  const tabGroups: Group[] | null = isExp ? spent : (groups?.[tab as ContributionTab] ?? null);
  const matched = tabGroups ? matchName(tabGroups, address.q) : [];
  const sorted = sortGroups(matched, sort);
  const visible = sorted.slice(0, shown);
  const remaining = sorted.length - visible.length;

  // Moving to a matched notice's payment: open its name, then bring it into view below
  // the sticky header and give it focus.
  useEffect(() => {
    if (!jumped) return;
    const frame = window.requestAnimationFrame(() => {
      const element = document.getElementById(jumped);
      if (!element) return;
      window.scrollTo({
        top: element.getBoundingClientRect().top + window.scrollY - 96,
        behavior: 'smooth',
      });
      element.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [jumped, tab, open]);

  // An address with tab=independent opens the page at the Independent expenditures card.
  const independentShown = independent.data !== null;
  useEffect(() => {
    if (!focusIndependent || !independentShown) return;
    const element = document.getElementById('committee-ie');
    if (!element) return;
    window.scrollTo({ top: element.getBoundingClientRect().top + window.scrollY - 80 });
    element.focus({ preventScroll: true });
  }, [focusIndependent, independentShown]);

  const registerKind =
    record?.register.kind ?? registerKindFromEntityType(record?.entity_type ?? null);
  const sourceHref = boardRecordUrl(registerKind, registration, year);

  const toggle = useCallback((key: string) => {
    setOpen((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const view = useCallback(
    (group: Group, row: Row) => {
      const copied = (isExp ? made.data?.fetchedAt : received.data?.fetchedAt) ?? null;
      setEvidence(
        evidenceFor(
          `${group.name} · ${row.amount === null ? AMOUNT_MISSING : (formatMoney(row.amount) ?? AMOUNT_MISSING)}`,
          isExp ? PAYMENT_FILE_LABELS.expenditures : PAYMENT_FILE_LABELS.contributions,
          copied,
          row.recordNumber,
          sourceHref,
        ),
      );
    },
    [isExp, made.data, received.data, sourceHref],
  );

  const parsedNotices = notices.data ? committeeNoticesFromPayload(notices.data) : null;
  const noticesUnreadable = notices.data !== null && parsedNotices === null;
  const targetFor = useCallback(
    (notice: CommitteeNotice): NoticeTarget | null => {
      const wanted = notice.matchedPayment?.recordNumber;
      if (wanted === undefined || !received.data || !groups) return null;
      const payment = received.data.payments.find(
        (item) => item.record_number === wanted && isContribution(item),
      );
      if (!payment) return null;
      const where = tabOfKind(payment.contributor_type);
      const group = groups[where].find((item) =>
        item.rows.some((row) => row.recordNumber === wanted),
      );
      const row = group?.rows.find((item) => item.recordNumber === wanted);
      if (!group || !row) return null;
      return {
        tabLabel: tabLabel(where),
        jump: () => {
          setAddress({ tab: where, q: '' });
          setShown(Number.POSITIVE_INFINITY);
          setOpen((previous) => new Set(previous).add(group.key));
          setJumped(row.id);
        },
      };
    },
    [received.data, groups, setAddress],
  );

  const listed = unlinked.data ? unlinkedStatementsFromPayload(unlinked.data) : null;
  const listedHere =
    listed && listed.registrationNumber === registration && listed.year === year ? listed : null;

  // --- Whole-page states ------------------------------------------------------------
  if (finance.notFound) {
    return (
      <main id="main" className="f-page">
        <div className="f-content">
          {back && <BackLink to={back.to} name={back.name} />}
          <section className="f-card cmt-gone">
            <h1 tabIndex={-1} className="cmt-gone-title">
              This record is no longer available
            </h1>
            <p>
              The registration this address pointed to is not in the current copy of the Board’s
              register. Earlier copies are kept; this page does not stand in for another record.
            </p>
          </section>
        </div>
      </main>
    );
  }
  if (!record) {
    return (
      <main id="main" className="f-page">
        <div className="f-content">
          {back && <BackLink to={back.to} name={back.name} />}
          {finance.failed ? (
            <div className="cmt-top-gap">
              <Refused onRetry={finance.retry} retrying={finance.pending}>
                We couldn’t load this committee right now. This is a problem on our side and says
                nothing about the committee.
              </Refused>
            </div>
          ) : (
            <div role="status" aria-busy="true" className="cmt-loading">
              <Spinner />
              Loading…
            </div>
          )}
        </div>
      </main>
    );
  }

  const name = record.register.name ?? record.committee_name ?? `Registration ${registration}`;
  const kind = committeeEyebrow(registerKind, record.entity_sub_type);
  const ballot = isBallotQuestionFiler(record.entity_sub_type);

  const tabs = TABS.map((item) => {
    let count: number | null = null;
    if (item.value === 'expenditures') {
      if (made.data) count = made.data.state === 'reported' ? made.data.payments.length : null;
      else if (current?.money_out.state === 'reported') count = current.money_out.itemized_payments;
    } else if (received.data?.state === 'reported' && groups) {
      count = recordCount(groups[item.value as ContributionTab]);
    }
    return {
      value: item.value,
      label: item.label,
      count: count === null ? null : count.toLocaleString('en-US'),
    };
  });

  const label = tabLabel(tab);
  const listUnavailable = list.data?.state === 'unavailable';
  const emptyLine = isExp
    ? 'No expenditure records are held for this account and year'
    : `No ${label} contribution records are held for this account and year`;
  const tabNote = isExp
    ? 'Minnesota makes a committee name a recipient only once payments to them pass $200 in total for the year. The listed payments may leave out smaller payments whose recipients are not named.'
    : `Itemized contributions list donor names and amounts; non-itemized contributions are reported as a combined total without names. Minnesota requires donors to be named when their total giving to this committee exceeds ${ballot ? '$500' : '$200'} in a year; committees may also name donors who give ${ballot ? '$500' : '$200'} or less.`;

  const showNotices =
    notices.loading ||
    notices.failed ||
    noticesUnreadable ||
    (parsedNotices !== null && noticesCardDraws(parsedNotices));
  const showUnlinked =
    (unlinked.failed && !unlinked.pending) ||
    (listedHere !== null && listedHere.statements.length > 0);

  // --- Sources and updates ------------------------------------------------------------
  const copies = record.payment_copied_at;
  const sourceItems: ReactNode[] = [
    'Registered with the Minnesota Campaign Finance and Public Disclosure Board',
    ...paymentCopyLines(
      {
        contributions: copies?.contributions ?? null,
        expenditures: copies?.expenditures ?? null,
        independentExpenditures: copies?.independent_expenditures ?? null,
      },
      record.filings_copied_at ? centralDateLabel(record.filings_copied_at) : null,
    ),
  ];
  if (parsedNotices && noticesCardDraws(parsedNotices)) {
    const day = formatDay(parsedNotices.copiedOn);
    sourceItems.push(
      <>
        <a
          href={NOTICE_LIST_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="cmt-source-link"
        >
          {NOTICES_SOURCE_LABEL}
        </a>
        {day && ` copied ${day}`}
      </>,
    );
  }
  const statementDays = new Set<string>([
    ...(received.data?.statementsCopiedOn ?? []),
    ...(listedHere && listedHere.statements.length > 0 && listedHere.copiedOn
      ? [listedHere.copiedOn]
      : []),
  ]);
  const anyStatement =
    (received.data?.statements.length ?? 0) > 0 || (listedHere?.statements.length ?? 0) > 0;
  if (anyStatement) {
    const days = [...statementDays].map((day) => formatDay(day)).filter(Boolean);
    sourceItems.push(
      `Minnesota Campaign Finance Board committee report catalogues · Disclosure statements listed${
        days.length === 1 ? ` · copied ${days[0]}` : ''
      }`,
    );
  }
  sourceItems.push(OFFICIAL_TOTAL_RECORD_LIMIT, CONTRIBUTION_PERIOD_LIMIT, REPEATED_RECORD_LIMIT);
  sourceItems.push(
    <a href={sourceHref} target="_blank" rel="noopener noreferrer" className="f-dest cmt-link-44">
      <span>
        <WithArrow>Official source website</WithArrow>
      </span>
      <span className="f-visually-hidden"> (opens in a new tab)</span>
    </a>,
  );

  return (
    <main id="main" className="f-page cmt-page">
      <div className="f-content">
        {back && <BackLink to={back.to} name={back.name} />}
        <header className="cmt-header">
          <div className="cmt-eyebrow">
            {kind && <span className="cmt-kind">{kind}</span>}
            <span className="cmt-reg">Registration {registration}</span>
          </div>
          <h1 tabIndex={-1} className="f-page-title cmt-title">
            {name}
          </h1>
        </header>

        <div className="cmt-layout">
          <div className="cmt-main">
            <section aria-labelledby="cmt-money-h">
              <div className="cmt-money-head">
                <h2 id="cmt-money-h" className="f-section-title">
                  Campaign money
                </h2>
                <div role="group" aria-label="Year" className="cmt-years">
                  <span className="cmt-years-label" aria-hidden="true">
                    Year
                  </span>
                  {years.map((value) => (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={value === year}
                      className="f-chip"
                      onClick={() =>
                        value !== year && setAddress({ year: String(value), report: '' })
                      }
                    >
                      {value}
                    </button>
                  ))}
                </div>
              </div>

              {!current && finance.failed && (
                <div className="cmt-gap">
                  <Refused onRetry={finance.retry} retrying={finance.pending}>
                    {REPORT_LOAD_ERROR}
                  </Refused>
                </div>
              )}
              {!current && !finance.failed && (
                <div role="status" aria-busy="true" className="cmt-loading">
                  <Spinner />
                  Loading…
                </div>
              )}

              {current && (
                <>
                  {list.failed && list.data && (
                    <div role="alert" className="f-alert cmt-gap">
                      <AlertIcon />
                      <div>
                        We could not refresh these payments. This is a problem on our side. The last
                        complete payment list is still shown.{' '}
                        <button
                          type="button"
                          className="f-btn f-btn-secondary cmt-inline-retry"
                          aria-disabled={list.pending || undefined}
                          onClick={() => !list.pending && list.retry()}
                        >
                          Try again
                        </button>
                      </div>
                    </div>
                  )}
                  <Figures
                    finance={current}
                    filings={filings.data?.state === 'reported' ? filings.data.filings : []}
                    report={address.report}
                    onReport={(value) => setAddress({ report: value })}
                  />

                  <div className="cmt-tab-row">
                    <ScrollingTabs
                      label="Contribution kinds and expenditures"
                      value={tab}
                      tabs={tabs}
                      onChange={(value) => {
                        setAddress({ tab: value, q: '' });
                        setShown(STEP);
                      }}
                    />
                  </div>

                  <div className="cmt-controls">
                    <label className="cmt-search">
                      <span className="f-visually-hidden">Search names in this tab</span>
                      <input
                        type="search"
                        className="f-field cmt-field"
                        value={address.q}
                        placeholder="Search names in this tab"
                        autoComplete="off"
                        onChange={(event) => {
                          setAddress({ q: event.target.value });
                          setShown(STEP);
                        }}
                      />
                    </label>
                    <div className="cmt-sort">
                      <Dropdown
                        name="Sort names"
                        value={sort}
                        options={SORTS}
                        onChange={(value) => setAddress({ sort: value })}
                      />
                    </div>
                  </div>

                  {list.loading && (
                    <div role="status" aria-busy="true" className="cmt-loading">
                      <Spinner />
                      Loading…
                    </div>
                  )}
                  {!list.loading && (listUnavailable || (list.failed && !list.data)) && (
                    <div className="cmt-gap">
                      <Refused onRetry={list.retry} retrying={list.pending}>
                        {PAYMENTS_LOAD_ERROR}
                      </Refused>
                    </div>
                  )}
                  {list.data && !listUnavailable && tabGroups && (
                    <>
                      {tabGroups.length === 0 && (
                        <div className="cmt-gap">
                          <Empty title={emptyLine} />
                        </div>
                      )}
                      {tabGroups.length > 0 && matched.length === 0 && (
                        <div className="cmt-gap">
                          <Empty title="No names in this tab match that" />
                        </div>
                      )}
                      {matched.length > 0 && (
                        <>
                          <div className="cmt-summary">
                            <span>{countsLine(matched)}</span>
                            <span>
                              {isExp ? 'Total itemized expenditures' : 'Itemized contributions'}{' '}
                              <strong>{tableTotal(matched)}</strong>
                            </span>
                          </div>
                          <PaymentTable
                            label={isExp ? 'Expenditures' : `Contributions, ${label}`}
                            groups={visible}
                            open={open}
                            onToggle={toggle}
                            jumped={jumped}
                            here={here}
                            onView={view}
                            statementLevel={4}
                          />
                          {remaining > 0 && (
                            <div className="cmt-more">
                              <button
                                type="button"
                                className="f-btn f-btn-secondary"
                                onClick={() => setShown(Number.POSITIVE_INFINITY)}
                              >
                                {`Show the other ${remaining.toLocaleString('en-US')} ${
                                  isExp
                                    ? remaining === 1
                                      ? 'payee'
                                      : 'payees'
                                    : remaining === 1
                                      ? 'name'
                                      : 'names'
                                }`}
                              </button>
                            </div>
                          )}
                          <p className="cmt-tab-note">{tabNote}</p>
                        </>
                      )}
                    </>
                  )}
                </>
              )}
            </section>

            {showNotices && (
              <Notices
                notices={parsedNotices}
                loading={notices.loading}
                failed={notices.failed || noticesUnreadable}
                retrying={notices.pending}
                onRetry={notices.retry}
                targetFor={targetFor}
              />
            )}

            {showUnlinked && (
              <Unlinked
                listed={listedHere}
                loading={false}
                failed={unlinked.failed}
                retrying={unlinked.pending}
                onRetry={unlinked.retry}
              />
            )}
          </div>

          <aside className="cmt-aside">
            {independent.data && independent.data.state !== 'unavailable' && (
              <IndependentCard
                year={year}
                page={independent.data}
                everFiled={(independentEver.data?.page.total_payments ?? 0) > 0}
                onView={(payment) =>
                  setEvidence(
                    evidenceFor(
                      // "{payer} to {recipient}" (Design copy 22, Round 23); the
                      // amount stays in the row it opened from.
                      payment.vendor_name ? `${name} to ${payment.vendor_name}` : name,
                      PAYMENT_FILE_LABELS.independentExpenditures,
                      independent.data?.fetched_at ?? null,
                      payment.record_number,
                      sourceHref,
                    ),
                  )
                }
              />
            )}
            <RelatedCard confirmation={confirmation} here={here} />
          </aside>
        </div>
      </div>
      <SourcesAndUpdates groups={[{ source: BOARD, items: sourceItems }]} />
      <EvidencePanel evidence={evidence} onClose={closeEvidence} />
    </main>
  );
}
