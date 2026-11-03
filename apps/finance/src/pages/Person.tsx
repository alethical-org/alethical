import { useEffect, useMemo, useState } from 'react';
import { formatDay, formatMoney } from '../ui/money';
import { apiPath, useRead } from '../api/read';
import { copyDate, type ServedCounts } from '../landing/counts';
import {
  accountsFrom,
  CampaignFinance,
  KeyFigures,
  useFinanceYears,
} from '../parts/CampaignFinance';
import { useRecordRead } from '../parts/recordRead';
import { Link, navigate, useLocation } from '../router';
import { returnTarget, withFrom } from '../returnContext';
import { hrefFor, isBuilt, type RouteMatch } from '../routes';
import { EvidencePanel, Refused, type Evidence } from '../ui/controls';
import { Arrow, BackLink, LoadingLine, SourcesAndUpdates, WithArrow } from '../ui/parts';
import { finalOutcome, OUTCOME_LABELS, RESULT_LABELS, type CandidateRecord } from './Candidate';
import { ProfileMoneySection } from './Organization';
import {
  activeConfirmations,
  confirmationsOf,
  givingRows,
  loadSpellings,
  paymentCopyItems,
  periodOf,
  receivedRows,
  spellings,
} from './organization/data';
import type { GivenPayment, Identity, IdentitySummary, PaidPayment } from './organization/types';
import { splitPartSub, splitPartTarget } from './organization/split';
import { useLoad } from './organization/useLoad';
import './people.css';
import './person.css';
export interface PersonRecord {
  id: string;
  name: string;
  service: Array<{
    id: string;
    status: 'current' | 'elected' | 'former' | 'unknown';
    office: string;
    votingArea: string;
    source?: { authority?: string; url?: string; checkedDate?: string };
    startDate?: string;
    endDate?: string;
    termStart?: { value: string; precision: string };
    termEnd?: { value: string; precision: string };
    profileUrl?: string;
  }>;
  elections: Array<{
    candidateId: string;
    election: CandidateRecord['election'];
    office: string;
    votingArea: string;
    source: CandidateRecord['source'];
    result?: CandidateRecord['result'];
  }>;
  legislator?: { id?: string; slug: string };
}
/** The split choice page's words (Person drawing, Round 39). */
export const SPLIT_TITLE = 'This record was split';
export const SPLIT_LEAD =
  'Choose the person you meant. Each keeps its own confirmed records, evidence and history.';
export const NO_ADDRESS_LINE = 'No home address, phone or email is held';
export const NO_CONNECTED = 'No confirmed records held';
export function serviceTitle(row: PersonRecord['service'][number]) {
  return row.status === 'current'
    ? `Serving as ${row.office}`
    : row.status === 'former'
      ? `Formerly served as ${row.office}`
      : row.status === 'elected'
        ? `Elected to ${row.office}`
        : `${row.office} · Current service not confirmed`;
}
/** "General election", from the record's own election type. */
function electionKind(election: CandidateRecord['election']) {
  const type = election.type ? `${election.type[0].toUpperCase()}${election.type.slice(1)}` : '';
  return type ? `${type} election` : 'Election';
}
/** An election whose day has not come and whose result is pending: "Running for". */
function upcoming(e: PersonRecord['elections'][number], today: string) {
  return (!e.result || e.result.status === 'pending') && e.election.date >= today;
}
interface TimelineRow {
  key: string;
  date: string | null;
  kind: string;
  title: string;
  detail: string;
  href: string | null;
  link: string;
  source: string;
  /** The connected-records note: what the record is and when the link was confirmed. */
  note: string;
}
/** "identity confirmed {date}" where a confirmation of this kind and key is held. */
function confirmedNote(identity: Identity | null, kind: string, key: string): string | null {
  const item = identity
    ? confirmationsOf(identity, kind).find((c) => c.record_key === key)
    : undefined;
  const day = formatDay(item?.checked_at?.slice(0, 10));
  return day ? `identity confirmed ${day}` : null;
}
export function timelineRows(
  record: PersonRecord | null,
  identity: Identity | null,
  today = new Date().toISOString().slice(0, 10),
): TimelineRow[] {
  const rows: TimelineRow[] = [];
  for (const e of record?.elections ?? []) {
    const outcome = finalOutcome(e.result);
    const status = e.result ? RESULT_LABELS[e.result.status] : RESULT_LABELS.pending;
    const title = outcome
      ? `${OUTCOME_LABELS[outcome]} · ${e.office}`
      : upcoming(e, today)
        ? `Running for ${e.office}`
        : `${status} · ${e.office}`;
    const year = e.election.date.slice(0, 4);
    rows.push({
      key: `e|${e.candidateId}`,
      date: e.election.date,
      kind: 'ELECTION',
      title,
      detail: [electionKind(e.election), e.votingArea, status].filter(Boolean).join(' · '),
      href: isBuilt('candidate') ? hrefFor('candidate', { id: e.candidateId }) : null,
      link: 'View candidate profile',
      source: [
        e.source.retained ? 'Ballot record saved' : 'Checked',
        formatDay(e.source.checkedDate),
      ]
        .filter(Boolean)
        .join(' '),
      note: [
        [year, e.election.type].filter(Boolean).join(' '),
        confirmedNote(identity, 'public_person', record?.id ?? ''),
      ]
        .filter(Boolean)
        .join(' · '),
    });
  }
  for (const s of record?.service ?? []) {
    const started = formatDay(s.startDate);
    const ended = formatDay(s.endDate);
    const href =
      record?.legislator && isBuilt('legislator')
        ? hrefFor('legislator', { id: record.legislator.slug })
        : null;
    rows.push({
      key: `s|${s.id}`,
      date: s.startDate ?? s.termStart?.value ?? null,
      kind: 'SERVICE',
      title: serviceTitle(s),
      detail: [s.votingArea, started ? `Started ${started}` : null, ended ? `Ended ${ended}` : null]
        .filter(Boolean)
        .join(' · '),
      href,
      link: 'View legislator profile',
      source: 'Service records from the Minnesota Legislature',
      note: [s.votingArea, confirmedNote(identity, 'legislator', record?.legislator?.slug ?? '')]
        .filter(Boolean)
        .join(' · '),
    });
  }
  for (const c of identity ? confirmationsOf(identity, 'lobbyist') : []) {
    const checked = formatDay(c.checked_at?.slice(0, 10));
    rows.push({
      key: c.id,
      date: c.checked_at?.slice(0, 10) ?? null,
      kind: 'LOBBYING',
      title: 'Registered lobbyist',
      detail: `Registration ${c.record_key}`,
      href: isBuilt('lobbyist') ? hrefFor('lobbyist', { id: c.record_key }) : null,
      link: 'Open lobbying record',
      source: checked ? `Checked ${checked}` : 'Not checked',
      note: ['Lobbyist', `Registration ${c.record_key}`, checked && `identity confirmed ${checked}`]
        .filter(Boolean)
        .join(' · '),
    });
  }
  return rows.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
}
function PersonMoney({
  identity,
  here,
  onSources,
}: {
  identity: Identity;
  here: string;
  onSources: (items: string[]) => void;
}) {
  const [evidence, setEvidence] = useState<Evidence | null>(null);
  const giv = useMemo(() => spellings(identity, ['donor_name'] as const), [identity]);
  const rec = useMemo(
    () => spellings(identity, ['payee_name', 'independent_payee_name'] as const),
    [identity],
  );
  const revision = activeConfirmations(identity)
    .map((c) => c.id)
    .join(',');
  const giving = useLoad(
    giv.length ? `person-give|${identity.id}|${revision}` : null,
    loadSpellings<GivenPayment>(identity.id, giv),
  );
  const received = useLoad(
    rec.length ? `person-received|${identity.id}|${revision}` : null,
    loadSpellings<PaidPayment>(identity.id, rec),
  );
  useEffect(() => {
    onSources(
      paymentCopyItems({
        ...(giving.data?.length ? { contributions: giving.data[0].fetchedAt } : {}),
        ...(received.data?.some((r) => r.kind === 'payee_name')
          ? { expenditures: received.data.find((r) => r.kind === 'payee_name')!.fetchedAt }
          : {}),
        ...(received.data?.some((r) => r.kind === 'independent_payee_name')
          ? {
              independentExpenditures: received.data.find(
                (r) => r.kind === 'independent_payee_name',
              )!.fetchedAt,
            }
          : {}),
      }),
    );
  }, [giving.data, received.data, onSources]);
  const giveRows = givingRows(giving.data ?? [], here);
  // Each received payment stays a row; never add a person's payments to their giving.
  const recRows = (received.data ?? []).flatMap((load) =>
    load.payments.flatMap((payment) =>
      receivedRows([{ ...load, payments: [payment] }], here).map((row) => ({
        ...row,
        key: `${row.key}|${payment.record_number}`,
        amount: formatMoney(payment.amount) ?? 'Amount not given',
        note: [
          formatDay(payment.paid_on) ?? 'Date not given in the public file',
          payment.expenditure_type,
          payment.purpose,
          load.kind === 'independent_payee_name' ? 'Outside spending payment' : null,
        ]
          .filter(Boolean)
          .join(' · '),
      })),
    ),
  );
  return (
    <>
      {giv.length > 0 && (
        <ProfileMoneySection
          linkTitle
          id="person-giving"
          title="Political giving"
          period={periodOf(giveRows.map((r) => r.latest))}
          rows={giveRows}
          state={giving}
          onView={setEvidence}
        />
      )}
      {rec.length > 0 && (
        <ProfileMoneySection
          linkTitle
          id="person-received"
          title="Payments received"
          period={periodOf(recRows.map((r) => r.latest))}
          rows={recRows}
          state={received}
          onView={setEvidence}
        />
      )}
      <EvidencePanel evidence={evidence} onClose={() => setEvidence(null)} />
    </>
  );
}
/** A split record's old reference: the choice of the person meant (Round 39). */
function SplitChoice({ parts, here }: { parts: IdentitySummary[]; here: string }) {
  return (
    <section aria-labelledby="split-h" className="person-split">
      <h1 id="split-h" tabIndex={-1}>
        {SPLIT_TITLE}
      </h1>
      <p>{SPLIT_LEAD}</p>
      <ul className="f-row-links">
        {parts.map((part) => {
          const person = part.kind === 'person';
          const id = splitPartTarget(part);
          const sub = splitPartSub(part);
          const to = person
            ? isBuilt('person')
              ? withFrom(hrefFor('person', { id }), here)
              : null
            : isBuilt('organization')
              ? withFrom(hrefFor('organization', { id }), here)
              : null;
          return (
            <li key={part.id}>
              {to ? (
                <Link to={to} className="f-row-link person-split-link">
                  <span className="f-row-link-name">{part.name}</span>
                  {sub && <span className="f-row-link-note f-num">{sub}</span>}
                </Link>
              ) : (
                <span className="f-row-link person-split-link">
                  <span className="f-row-link-name">{part.name}</span>
                  {sub && <span className="f-row-link-note f-num">{sub}</span>}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
export function Person({ match }: { match: RouteMatch }) {
  const location = useLocation(),
    here = location.pathname + location.search,
    back = returnTarget(location.search),
    id = match.params.id;
  const [sourceItems, setSourceItems] = useState<string[]>([]);
  useEffect(() => setSourceItems([]), [id]);
  const initial = useRecordRead<PersonRecord>(`people/${encodeURIComponent(id)}`);
  const lookup = useRead<{ identity: IdentitySummary } | null>(
    initial.data
      ? apiPath(['finance', 'identities', 'lookup'], {
          record_kind: 'public_person',
          record_key: id,
        })
      : null,
  );
  const identityId = initial.notFound ? id : lookup.data?.identity.id;
  const identityRead = useRead<Identity>(
    identityId ? apiPath(['finance', 'identities', identityId]) : null,
  );
  const identity = identityRead.data?.kind === 'person' ? identityRead.data : null;
  const publicId = identity ? confirmationsOf(identity, 'public_person')[0]?.record_key : null;
  const linked = useRecordRead<PersonRecord>(
    !initial.data && publicId ? `people/${encodeURIComponent(publicId)}` : null,
  );
  const record = initial.data ?? linked.data;
  const leg = record?.legislator?.slug ?? null;
  const finance = useFinanceYears(leg);
  const accounts = accountsFrom(finance.data);
  const loading = initial.loading || lookup.loading || identityRead.loading || linked.loading;
  const failed = initial.failed || lookup.failed || identityRead.failed || linked.failed;
  // A merged reference opens the survivor; one with no survivor to open is not available.
  const redirect =
    identity?.status === 'merged' && identity.redirect_to && identity.redirect_to !== identity.id
      ? identity.redirect_to
      : null;
  const deadMerge = identity?.status === 'merged' && redirect === null;
  const notFound =
    (initial.notFound && (identityRead.notFound || (identityRead.data && !identity))) || deadMerge;
  const split = identity?.status === 'split' ? (identity.split_into ?? []) : null;
  const from = location.searchParams.get('from');
  useEffect(() => {
    if (redirect) navigate(withFrom(hrefFor('person', { id: redirect }), from), { replace: true });
  }, [redirect, from]);
  const rows = timelineRows(record, identity);
  const isCandidate = Boolean(record && record.elections.length > 0);
  const available = Boolean(record || (identity && identity.status === 'active'));
  const connected = rows.filter((r) => r.href);
  const served = useRead<ServedCounts>(record ? 'finance/landing/counts' : null);
  const legislatureDate = served.data ? copyDate(served.data, 'current_legislature_bills') : null;
  return (
    <main id="main" className="f-page">
      <div className="f-content">
        {back && <BackLink to={back.to} name={back.name} />}
        {loading && !available && !split && <LoadingLine>Loading…</LoadingLine>}
        {failed && (
          <Refused
            onRetry={() => {
              initial.retry();
              lookup.retry();
              identityRead.retry();
              linked.retry();
            }}
            retrying={loading}
          >
            We couldn’t load this record
          </Refused>
        )}
        {notFound && (
          <section className="f-card lg2-gone">
            <h1 tabIndex={-1} className="lg2-gone-title">
              This record is no longer available
            </h1>
            <p>
              No person record with this reference is in the current copy. Open People to search the
              held records.
            </p>
          </section>
        )}
        {split && <SplitChoice parts={split} here={here} />}
        {available && (
          <>
            <header className="lg2-header">
              <span className="pp-kind">PERSON PROFILE</span>
              <h1 tabIndex={-1} className="f-page-title lg2-title">
                {record?.name ?? identity?.name}
              </h1>
              <p className="lg2-line">
                {isCandidate
                  ? 'Confirmed links to this person’s candidate and legislative service records'
                  : 'Confirmed links to this person’s lobbying registration and contribution records'}
              </p>
              {leg && <KeyFigures legislatorId={leg} account={accounts[0] ?? null} />}
            </header>
            <div className="lg2-layout">
              <div className="lg2-main">
                {isCandidate && (
                  <CampaignFinance
                    legislatorId={leg}
                    years={finance}
                    accounts={accounts}
                    emptyLine="No campaign committee is confirmed for this person"
                    from={here}
                  />
                )}
                {identity && identity.status === 'active' && (
                  <PersonMoney identity={identity} here={here} onSources={setSourceItems} />
                )}
                <section aria-labelledby="timeline-heading" className="person-timeline">
                  <h2 id="timeline-heading" className="f-section-title">
                    {isCandidate ? 'Elections and service over time' : 'Registrations over time'}
                  </h2>
                  {rows.length ? (
                    <ol className="person-events">
                      {rows.map((r) => (
                        <li key={r.key} className="person-event">
                          <div className="person-date f-num">
                            {formatDay(r.date) ?? 'Date not held'}
                          </div>
                          <div className="person-event-body">
                            <div className="person-event-head">
                              <span className="person-event-kind">{r.kind}</span>
                              <span className="person-event-title">{r.title}</span>
                            </div>
                            <div className="person-event-detail f-num">{r.detail}</div>
                            <div className="person-event-foot">
                              <span className="person-event-source f-num">
                                <svg
                                  width="14"
                                  height="14"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  aria-hidden="true"
                                >
                                  <circle cx="12" cy="12" r="9" stroke="#0E6A82" strokeWidth="2" />
                                  <path
                                    d="M8 12.5 L10.8 15.2 L16 9.5"
                                    stroke="#0E6A82"
                                    strokeWidth="2.2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  />
                                </svg>
                                {r.source}
                              </span>
                              {r.href && (
                                <Link className="f-dest person-link" to={withFrom(r.href, here)}>
                                  <WithArrow>{r.link}</WithArrow>
                                </Link>
                              )}
                            </div>
                          </div>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <div className="f-empty-box">{NO_CONNECTED}</div>
                  )}
                  {isCandidate && (
                    <p className="lg2-note">
                      Candidacy and election results do not prove current service
                    </p>
                  )}
                </section>
              </div>
              <aside className="lg2-aside">
                <section className="f-card lg2-related">
                  <h2 className="f-card-title">Connected records</h2>
                  {connected.length > 0 ? (
                    <ul className="f-row-links">
                      {connected.map((r) => (
                        <li key={r.key}>
                          <Link
                            className="f-row-link lg2-related-link"
                            to={withFrom(r.href!, here)}
                          >
                            <span>
                              <span className="f-row-link-name">{r.link}</span>
                              {r.note && (
                                <>
                                  <br />
                                  <span className="f-row-link-note">{r.note}</span>
                                </>
                              )}
                            </span>
                            <Arrow />
                          </Link>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="lg2-muted">{NO_CONNECTED}</p>
                  )}
                </section>
              </aside>
            </div>
          </>
        )}
      </div>
      {available && (
        <SourcesAndUpdates>
          {record && (
            <p className="f-sources-line f-num">
              Candidate records from the Minnesota Secretary of State. Service records from the
              Minnesota Legislature{legislatureDate ? ` · updated ${legislatureDate}` : ''}
            </p>
          )}
          {sourceItems.map((line) => (
            <p key={line} className="f-sources-line">
              {line}
            </p>
          ))}
          <p className="f-sources-line person-no-address">{NO_ADDRESS_LINE}</p>
        </SourcesAndUpdates>
      )}
    </main>
  );
}
