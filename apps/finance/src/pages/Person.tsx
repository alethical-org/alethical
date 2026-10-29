import { useEffect, useMemo, useState } from 'react';
import { formatDay, formatMoney } from '@alethical/shared/moneyFormat';
import { apiPath, useRead } from '../api/read';
import { accountsFrom, CampaignFinance, useFinanceYears } from '../parts/CampaignFinance';
import { useRecordRead } from '../parts/recordRead';
import { Link, navigate, useLocation } from '../router';
import { returnTarget, withFrom } from '../returnContext';
import { hrefFor, type RouteMatch } from '../routes';
import { EvidencePanel, Refused, type Evidence } from '../ui/controls';
import { BackLink, LoadingLine, SourcesAndUpdates } from '../ui/parts';
import { resultLine, type CandidateRecord } from './Candidate';
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
export function serviceTitle(row: PersonRecord['service'][number]) {
  return row.status === 'current'
    ? `Currently serving as ${row.office}`
    : row.status === 'former'
      ? `Formerly served as ${row.office}`
      : row.status === 'elected'
        ? `Elected to ${row.office}`
        : `${row.office} · Current service not confirmed`;
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
}
export function timelineRows(
  record: PersonRecord | null,
  identity: Identity | null,
): TimelineRow[] {
  const rows: TimelineRow[] = [];
  for (const e of record?.elections ?? [])
    rows.push({
      key: `e|${e.candidateId}`,
      date: e.election.date,
      kind: 'ELECTION',
      title: `${resultLine(e.result)} · ${e.office}`,
      detail: [e.election.label ?? `${e.election.type} election`, e.votingArea].join(' · '),
      href: hrefFor('candidate', { id: e.candidateId }),
      link: 'View candidate profile',
      source: [
        e.source.retained ? 'Ballot record saved' : 'Checked',
        formatDay(e.source.checkedDate),
      ]
        .filter(Boolean)
        .join(' '),
    });
  for (const s of record?.service ?? [])
    rows.push({
      key: `s|${s.id}`,
      date: s.startDate ?? s.termStart?.value ?? null,
      kind: 'SERVICE',
      title: serviceTitle(s),
      detail: [s.votingArea, s.endDate ? `Ended ${formatDay(s.endDate) ?? s.endDate}` : null]
        .filter(Boolean)
        .join(' · '),
      href: record?.legislator ? hrefFor('legislator', { id: record.legislator.slug }) : null,
      link: 'View legislator profile',
      source: s.source?.authority ?? 'Minnesota Legislature',
    });
  for (const c of identity ? confirmationsOf(identity, 'lobbyist') : [])
    rows.push({
      key: c.id,
      date: c.checked_at?.slice(0, 10) ?? null,
      kind: 'LOBBYING',
      title: 'Registered lobbyist',
      detail: `Registration ${c.record_key}`,
      href: hrefFor('lobbyist', { id: c.record_key }),
      link: 'Open lobbying record',
      source: c.checked_at ? `Checked ${formatDay(c.checked_at.slice(0, 10))}` : 'Not checked',
    });
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
  const notFound = initial.notFound && (identityRead.notFound || (identityRead.data && !identity));
  const rows = timelineRows(record, identity);
  useEffect(() => {
    if (identity?.status === 'merged' && identity.redirect_to)
      navigate(
        withFrom(
          hrefFor('person', { id: identity.redirect_to }),
          location.searchParams.get('from'),
        ),
        { replace: true },
      );
  }, [identity, location.search]);
  const available = record || (identity && identity.status === 'active');
  return (
    <main id="main" className="f-page">
      <div className="f-content">
        {back && <BackLink to={back.to} name={back.name} />}
        {loading && !available && <LoadingLine>Loading…</LoadingLine>}
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
            We couldn’t load this record. This is a problem on our side.
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
        {identity?.status === 'split' && (
          <section className="f-card lg2-gone">
            <h1 tabIndex={-1} className="lg2-gone-title">
              {identity.name} was split into {identity.split_into?.length ?? 0} records
            </h1>
            <p>Its records now belong to the records below. Each keeps its full history.</p>
            <ul>
              {identity.split_into?.map((p) => (
                <li key={p.id}>
                  <Link
                    to={withFrom(
                      hrefFor(p.kind === 'person' ? 'person' : 'organization', { id: p.id }),
                      here,
                    )}
                  >
                    {p.name}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
        {available && (
          <>
            <header className="lg2-header">
              <span className="pp-kind">PERSON PROFILE</span>
              <h1 tabIndex={-1} className="f-page-title lg2-title">
                {record?.name ?? identity?.name}
              </h1>
              <p className="lg2-line">Confirmed links to this person’s records</p>
            </header>
            <div className="lg2-layout">
              <div className="lg2-main">
                {record && record.elections.length > 0 && (
                  <CampaignFinance
                    legislatorId={leg}
                    years={finance}
                    accounts={accounts}
                    emptyLine="No campaign committee is confirmed for this person"
                    from={here}
                  />
                )}
                <section className="person-timeline">
                  <h2 className="f-section-title">
                    {record ? 'Elections and service over time' : 'Registrations over time'}
                  </h2>
                  {rows.length ? (
                    <ul className="lg2-list">
                      {rows.map((r) => (
                        <li key={r.key} className="person-event">
                          <span className="person-date f-num">
                            {formatDay(r.date) ?? r.date ?? 'Date not held'}
                          </span>
                          <div>
                            <span className="person-event-kind f-label">{r.kind}</span>
                            <strong>{r.title}</strong>
                            <span className="lg2-muted">{r.detail}</span>
                            <span className="lg2-muted">{r.source}</span>
                            {r.href && (
                              <Link className="f-dest person-link" to={withFrom(r.href, here)}>
                                {r.link}
                              </Link>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="f-empty-box">
                      No confirmed records are held for this section
                    </div>
                  )}
                  {record && (
                    <p className="lg2-note">
                      Candidacy and election results do not prove current service.
                    </p>
                  )}
                </section>
                {identity && identity.status === 'active' && (
                  <PersonMoney identity={identity} here={here} onSources={setSourceItems} />
                )}
              </div>
              <aside className="lg2-aside">
                <section className="f-card lg2-related">
                  <h2 className="f-label">Connected records</h2>
                  <ul className="lg2-related-list">
                    {rows
                      .filter((r) => r.href)
                      .map((r) => (
                        <li key={r.key}>
                          <Link className="lg2-related-link" to={withFrom(r.href!, here)}>
                            <span>
                              <span className="lg2-related-label">{r.link}</span>
                              <span className="lg2-related-note">{r.detail}</span>
                            </span>
                          </Link>
                        </li>
                      ))}
                  </ul>
                  {!rows.some((r) => r.href) && (
                    <p className="lg2-muted">No confirmed records are held for this section</p>
                  )}
                </section>
              </aside>
            </div>
          </>
        )}
      </div>
      <SourcesAndUpdates
        groups={
          record
            ? [
                { source: 'Minnesota Secretary of State', items: ['Candidate records'] },
                { source: 'Minnesota Legislature', items: ['Service records'] },
              ]
            : []
        }
      >
        {sourceItems.map((line) => (
          <p key={line} className="f-sources-line">
            {line}
          </p>
        ))}
      </SourcesAndUpdates>
    </main>
  );
}
