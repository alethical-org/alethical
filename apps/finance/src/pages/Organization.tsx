import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { formatDay } from '@alethical/shared/moneyFormat';
import { centralDateLabel } from '@alethical/shared/moneyLanding';

import { apiPath, useRead } from '../api/read';
import { Link, navigate, useLocation } from '../router';
import { returnTarget, withFrom } from '../returnContext';
import { hrefFor, isBuilt, type RouteMatch } from '../routes';
import { EvidencePanel, LoadingRows, Refused, type Evidence } from '../ui/controls';
import { RecordMark } from '../ui/marks';
import { BackLink, LoadingLine, SourcesAndUpdates } from '../ui/parts';
import {
  BOARD,
  confirmationsOf,
  EMPTY_SECTION,
  givingRows,
  loadCommittees,
  loadPrincipals,
  loadSpellings,
  lobbyingRow,
  paymentCopyItems,
  periodOf,
  receivedRows,
  relatedRow,
  rolesOf,
  SECTION_FAILED,
  spellings,
  UUID_PATTERN,
  type ProfileRow,
  type SpellingLoad,
} from './organization/data';
import type {
  GivenPayment,
  Identity,
  IdentityConfirmation,
  PaidPayment,
} from './organization/types';
import { useLoad, type Load } from './organization/useLoad';
import './organization.css';

function NotFound() {
  return (
    <section className="org-gone">
      <h1 tabIndex={-1} className="org-gone-title">
        This record is no longer available
      </h1>
      <p>
        No organization with this reference is in the current copy. Open Vendors and payees to
        search the held records.
      </p>
    </section>
  );
}

/** D24: a split record's old reference opens this correction page listing every
 * record its names moved to. */
function SplitCorrection({ identity, here }: { identity: Identity; here: string }) {
  const parts = identity.split_into ?? [];
  return (
    <section className="org-split">
      <span className="org-kind">ORGANIZATION PROFILE</span>
      <h1 tabIndex={-1} className="f-page-title org-title">
        {identity.name} was split into {parts.length} records
      </h1>
      <p className="org-split-lead">
        Its records now belong to the records below. Each keeps its full history.
      </p>
      <ul className="org-split-list">
        {parts.map((part) => {
          const organization = part.kind === 'organization';
          return (
            <li key={part.id} className="f-marked">
              <RecordMark kind={organization ? 'organization' : 'person'} />
              {organization ? (
                <Link
                  to={withFrom(hrefFor('organization', { id: part.id }), here)}
                  className="org-split-link"
                >
                  {part.name}
                </Link>
              ) : (
                <span className="org-split-name">{part.name}</span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Row({ row, onView }: { row: ProfileRow; onView: (evidence: Evidence) => void }) {
  return (
    <li className="org-row">
      <span className="org-row-text">
        <span className="org-row-title">{row.title}</span>
        {row.note && <span className="org-row-note f-num">{row.note}</span>}
      </span>
      <span className="org-row-amount f-num" data-missing={row.missing || undefined}>
        {row.amount}
      </span>
      <span className="org-row-actions">
        {row.links.map((link) => (
          <Link
            key={link.label}
            to={link.href}
            className="org-action"
            aria-label={`${link.label}, ${row.title}`}
          >
            {link.label}
          </Link>
        ))}
        {row.evidence && (
          <button
            type="button"
            className="org-action"
            aria-label={`View source, ${row.title}`}
            onClick={() => onView(row.evidence!)}
          >
            View source
          </button>
        )}
      </span>
    </li>
  );
}

interface SectionState {
  loading: boolean;
  failed: boolean;
  pending: boolean;
  retry: () => void;
}

const SETTLED: SectionState = { loading: false, failed: false, pending: false, retry: () => {} };

function stateOf<T>(load: Load<T>, needed: boolean): SectionState {
  return needed ? load : SETTLED;
}

function Section({
  id,
  title,
  period,
  rows,
  state,
  onView,
}: {
  id: string;
  title: string;
  period: string | null;
  rows: ProfileRow[];
  state: SectionState;
  onView: (evidence: Evidence) => void;
}) {
  let body: ReactNode;
  if (state.loading) body = <LoadingRows />;
  else if (state.failed && rows.length === 0)
    body = (
      <Refused onRetry={state.retry} retrying={state.pending}>
        {SECTION_FAILED}
      </Refused>
    );
  else if (rows.length === 0) body = <div className="f-empty-box">{EMPTY_SECTION}</div>;
  else
    body = (
      <>
        {state.failed && (
          <Refused onRetry={state.retry} retrying={state.pending}>
            {SECTION_FAILED}
          </Refused>
        )}
        <ul className="org-rows">
          {rows.map((row) => (
            <Row key={row.key} row={row} onView={onView} />
          ))}
        </ul>
      </>
    );
  return (
    <section aria-labelledby={id} className="org-section">
      <div className="org-section-head">
        <h2 id={id} className="f-section-title">
          {title}
        </h2>
        {period && rows.length > 0 && !state.loading && (
          <span className="org-period f-num">{period}</span>
        )}
      </div>
      {body}
    </section>
  );
}

function keyOf(identity: Identity, items: IdentityConfirmation[], part: string): string | null {
  return items.length > 0
    ? `${part}|${identity.id}|${items.map((item) => item.id).join(',')}`
    : null;
}

function datesOf(loads: ReadonlyArray<SpellingLoad<GivenPayment | PaidPayment>> | null) {
  return (loads ?? []).flatMap((load) =>
    load.payments.map((payment) =>
      'received_on' in payment ? payment.received_on : payment.paid_on,
    ),
  );
}

function firstCopy<T extends GivenPayment | PaidPayment>(
  loads: ReadonlyArray<SpellingLoad<T>> | null,
  kinds: readonly string[],
): string | null | undefined {
  const used = (loads ?? []).filter(
    (load) => kinds.includes(load.kind) && load.payments.length > 0,
  );
  return used.length > 0 ? (used[0].fetchedAt ?? null) : undefined;
}

/** The confirmed organization: lobbying, its own giving, payments it received and
 * related committees, each read for exactly the records its confirmations cover. */
function Profile({
  identity,
  here,
  top,
}: {
  identity: Identity;
  here: string;
  /** The return link, when the page was reached with one. */
  top: ReactNode;
}) {
  const [evidence, setEvidence] = useState<Evidence | null>(null);
  const closeEvidence = useCallback(() => setEvidence(null), []);

  const giveConfirmations = useMemo(() => confirmationsOf(identity, 'donor_name'), [identity]);
  const recdConfirmations = useMemo(
    () => [
      ...confirmationsOf(identity, 'payee_name'),
      ...confirmationsOf(identity, 'independent_payee_name'),
    ],
    [identity],
  );
  const principals = useMemo(() => confirmationsOf(identity, 'principal'), [identity]);
  const committees = useMemo(() => confirmationsOf(identity, 'committee'), [identity]);

  const giving = useLoad(
    keyOf(identity, giveConfirmations, 'give'),
    loadSpellings<GivenPayment>(identity.id, spellings(identity, ['donor_name'] as const)),
  );
  const received = useLoad(
    keyOf(identity, recdConfirmations, 'recd'),
    loadSpellings<PaidPayment>(
      identity.id,
      spellings(identity, ['payee_name', 'independent_payee_name'] as const),
    ),
  );
  const lobbying = useLoad(
    keyOf(identity, principals, 'lob'),
    loadPrincipals([...new Set(principals.map((item) => item.record_key))]),
  );
  const related = useLoad(
    keyOf(identity, committees, 'rel'),
    loadCommittees([...new Set(committees.map((item) => item.record_key))]),
  );

  const giveRows = useMemo(
    () => (giving.data ? givingRows(giving.data, here) : []),
    [giving.data, here],
  );
  const recdRows = useMemo(
    () => (received.data ? receivedRows(received.data, here) : []),
    [received.data, here],
  );
  const lobRows = useMemo(
    () =>
      lobbying.data
        ? principals.map((item) =>
            lobbyingRow(
              item,
              lobbying.data!.find((held) => held.key === item.record_key)?.record ?? null,
              identity.name,
              here,
            ),
          )
        : [],
    [lobbying.data, principals, identity.name, here],
  );
  const relRows = useMemo(
    () =>
      related.data
        ? committees.map((item) =>
            relatedRow(
              item,
              related.data!.find((held) => held.key === item.record_key)?.record ?? null,
              here,
            ),
          )
        : [],
    [related.data, committees, here],
  );

  const lobbyCopied =
    lobbying.data?.find((held) => held.record?.copied_at)?.record?.copied_at ?? null;
  const registerCopied =
    related.data?.find((held) => held.record?.register?.copied_on)?.record?.register?.copied_on ??
    null;
  const givePeriod = periodOf(datesOf(giving.data));
  const recdPeriod = periodOf(datesOf(received.data));
  const roles = rolesOf(principals.length > 0, giveRows.length > 0, recdRows.length > 0);

  const copies: Parameters<typeof paymentCopyItems>[0] = {};
  const contributions = firstCopy(giving.data, ['donor_name']);
  const expenditures = firstCopy(received.data, ['payee_name']);
  const independent = firstCopy(received.data, ['independent_payee_name']);
  if (contributions !== undefined) copies.contributions = contributions;
  if (expenditures !== undefined) copies.expenditures = expenditures;
  if (independent !== undefined) copies.independentExpenditures = independent;
  const boardItems = [
    ...paymentCopyItems(copies),
    ...(lobbyCopied && lobRows.length > 0
      ? [`Lobbyist list and spending reports copied ${centralDateLabel(lobbyCopied)}`]
      : []),
    ...(registerCopied && formatDay(registerCopied)
      ? [`Committee registrations copied ${formatDay(registerCopied)}`]
      : []),
  ];
  const identifiers = [...new Set(principals.map((item) => item.record_key))];

  return (
    <>
      <div className="f-content">
        {top}
        <header className="org-header">
          <span className="org-kind">ORGANIZATION PROFILE</span>
          <h1 tabIndex={-1} className="f-page-title org-title">
            {identity.name}
          </h1>
          {roles.length > 0 && (
            <div role="list" aria-label="Roles" className="org-roles">
              {roles.map((role) => (
                <span key={role} role="listitem" className="org-role">
                  {role}
                </span>
              ))}
            </div>
          )}
        </header>
        <div className="org-sections">
          <Section
            id="org-lobbying"
            title="Lobbying"
            period={lobbyCopied ? `Listed ${centralDateLabel(lobbyCopied)}` : null}
            rows={lobRows}
            state={stateOf(lobbying, principals.length > 0)}
            onView={setEvidence}
          />
          <Section
            id="org-giving"
            title="Political giving"
            period={givePeriod ? `Period ${givePeriod}` : null}
            rows={giveRows}
            state={stateOf(giving, giveConfirmations.length > 0)}
            onView={setEvidence}
          />
          <Section
            id="org-received"
            title="Payments received"
            period={recdPeriod ? `Period ${recdPeriod}` : null}
            rows={recdRows}
            state={stateOf(received, recdConfirmations.length > 0)}
            onView={setEvidence}
          />
          <Section
            id="org-made"
            title="Payments made"
            period={null}
            rows={[]}
            state={SETTLED}
            onView={setEvidence}
          />
          <Section
            id="org-related"
            title="Related committees and funds"
            period={null}
            rows={relRows}
            state={stateOf(related, committees.length > 0)}
            onView={setEvidence}
          />
        </div>
      </div>
      <SourcesAndUpdates>
        <dl>
          {boardItems.length > 0 && (
            <div className="f-sources-row">
              <dt>{BOARD}</dt>
              <dd>
                {boardItems.map((item) => (
                  <span key={item}>{item}</span>
                ))}
              </dd>
            </div>
          )}
          <div className="f-sources-row">
            <dt>Confirmed identity</dt>
            <dd>
              <span>Organization reference {identity.id}</span>
            </dd>
          </div>
        </dl>
        {identifiers.length > 0 && (
          <>
            <h3 className="org-ids-title">Official identifiers</h3>
            <ul className="org-ids">
              {identifiers.map((key) => (
                <li key={key} className="f-num">
                  <span className="org-id">Lobbying principal entity ID {key}</span>
                  {BOARD} · Minnesota
                </li>
              ))}
            </ul>
          </>
        )}
      </SourcesAndUpdates>
      <EvidencePanel evidence={evidence} onClose={closeEvidence} />
    </>
  );
}

/**
 * Organization profile (Organization drawing; decisions D23 and D24; build notes
 * Rounds 19 and 20): 1 confirmed organization, keyed on its identity id. A merged
 * record's reference opens the surviving record; a split one opens a correction
 * page listing the records it became.
 */
export function Organization({ match }: { match: RouteMatch }) {
  const location = useLocation();
  const here = location.pathname + location.search;
  const back = returnTarget(location.search);
  const from = location.searchParams.get('from');
  const id = match.params.id;
  const valid = UUID_PATTERN.test(id);
  const read = useRead<Identity>(valid ? apiPath(['finance', 'identities', id]) : null);
  const identity = read.data;
  const organization = identity && identity.kind === 'organization' ? identity : null;
  const redirect =
    organization?.status === 'merged' &&
    organization.redirect_to &&
    organization.redirect_to !== organization.id &&
    isBuilt('organization')
      ? organization.redirect_to
      : null;

  useEffect(() => {
    if (redirect)
      navigate(withFrom(hrefFor('organization', { id: redirect }), from), { replace: true });
  }, [redirect, from]);

  const notFound = !valid || read.notFound || (identity !== null && organization === null);
  let content: ReactNode = null;
  if (notFound) content = <NotFound />;
  else if (organization?.status === 'split')
    content = <SplitCorrection identity={organization} here={here} />;
  else if (organization && organization.status !== 'merged') {
    return (
      <main id="main" className="f-page">
        <Profile
          key={organization.id}
          identity={organization}
          here={here}
          top={back && <BackLink to={back.to} name={back.name} />}
        />
      </main>
    );
  } else if (read.failed)
    content = (
      <Refused onRetry={read.retry} retrying={read.pending}>
        We couldn’t load this record. This is a problem on our side.
      </Refused>
    );
  else content = <LoadingLine>Loading…</LoadingLine>;

  return (
    <main id="main" className="f-page">
      <div className="f-content">
        {back && <BackLink to={back.to} name={back.name} />}
        {content}
      </div>
    </main>
  );
}
