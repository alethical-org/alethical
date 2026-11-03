import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';

import { campaignMoneyHistoryYears } from '@alethical/shared/campaignMoneyYears';
import {
  registrationNumberFromSlug,
  UNNAMED_PAYMENT_PARTY,
} from '@alethical/shared/committeeMoneyShared';
import { formatDay, formatMoney } from '@alethical/shared/moneyFormat';
import { centralDateLabel, formatCount } from '@alethical/shared/moneyLanding';
import { paymentFileCopyLine } from '@alethical/shared/paymentCopyDates';
import {
  CAP_NEXT_LABEL,
  CAP_NOTE,
  filerRegistrationLabel,
  LOAD_MORE_ERROR,
  paymentsShowingLine,
  RECORDS_UNAVAILABLE_TITLE,
  RECORDS_UNAVAILABLE_WHY,
} from '@alethical/shared/paymentsUnderName';

import { apiPath, useRead } from '../api/read';
import { cameByHistory, Link, navigate, useLocation } from '../router';
import { returnTarget, withFrom } from '../returnContext';
import { hrefFor, isBuilt, type RouteMatch } from '../routes';
import { useAddressState } from '../ui/addressState';
import { useBand } from '../ui/band';
import {
  ClearAll,
  Dropdown,
  EvidencePanel,
  Refused,
  Updating,
  type Evidence,
} from '../ui/controls';
import { BackLink, SourcesAndUpdates, WithArrow } from '../ui/parts';
import { useRevealFocus } from '../ui/revealFocus';
import { tabOfKind } from './committee/data';
import {
  checkedDay,
  namePaymentsQuery,
  useIdentityRecords,
  useNamePayments,
  type IdentityRead,
  type IdentityRecords,
  type NamePayments,
  type NamePaymentsRead,
  type OutsideRow,
  type PrintedKind,
  type ReceivedRow,
  type ServerRole,
  type SpentRow,
} from './payments/data';
import './payments.css';

const BOARD = 'Minnesota Campaign Finance and Public Disclosure Board';
export const BOARD_FILES_URL =
  'https://cfb.mn.gov/reports-and-data/self-help/data-downloads/campaign-finance/';
const DATE_MISSING = 'Date not given in the public file';
const AMOUNT_MISSING = 'Amount not given';

/** The page's record types, as the address and the menu name them. */
export type Role = 'payee' | 'donor' | 'employer';

const ROLES: ReadonlyArray<{ value: Role; label: string }> = [
  { value: 'payee', label: 'Payee' },
  { value: 'donor', label: 'Donor' },
  { value: 'employer', label: 'Employer' },
];

/** The address's role, or Payee: an unknown value lands on the default view. */
export function roleFromParam(raw: string | null | undefined): Role {
  return ROLES.find((item) => item.value === raw)?.value ?? 'payee';
}

/** The year asked for, or null for every year we hold. */
export function yearFromParam(raw: string, years: readonly number[]): number | null {
  const year = Number(raw);
  return Number.isInteger(year) && years.includes(year) ? year : null;
}

type SectionId = 'campaign-payments' | 'outside-payments';

export interface SectionSpec {
  id: SectionId;
  title: string;
  serverRole: ServerRole;
  /** The evidence drawer's Dataset line. */
  dataset: string;
  /** The Sources line's file label (shared payment-file wording). */
  file: 'contributions' | 'expenditures' | 'independentExpenditures';
  note: string;
}

/** Each role's sections. Outside spending is paid to payees, so only the Payee view
 * has it (copy proposal C11, replaced: donor and employer views omit it). The 2
 * payee files are 2 answers and never 1 list. */
export function sectionsFor(role: Role): SectionSpec[] {
  if (role === 'payee') {
    return [
      {
        id: 'campaign-payments',
        title: 'Campaign payments',
        serverRole: 'vendor',
        dataset: 'Itemized expenditures file',
        file: 'expenditures',
        note: 'Each record comes from the paying committee’s filing. A payee is not necessarily a commercial vendor.',
      },
      {
        id: 'outside-payments',
        title: 'Outside spending payments',
        serverRole: 'independent_vendor',
        dataset: 'Independent expenditures file',
        file: 'independentExpenditures',
        note: 'Independent expenditures are reported by the spender, never by the candidate. A position as filed is the spender’s statement, not Alethical’s.',
      },
    ];
  }
  return [
    {
      id: 'campaign-payments',
      title: 'Campaign payments',
      serverRole: role === 'donor' ? 'contributor' : 'employer',
      dataset: 'Itemized contributions file',
      file: 'contributions',
      note: 'The count is of matching records, not a confirmed count of separate donations. These records may not capture all giving.',
    },
  ];
}

export interface PaymentRow {
  key: string;
  /** "Jul 20, 2026", or null where the filing carries no date. */
  date: string | null;
  /** The committee whose filing carries the row. */
  committee: string;
  /** Set only for a committee this release holds as a filer. */
  href: string | null;
  /** The filing committee's registration number, as the row carries it. */
  registration: string | null;
  /** Whole dollars, or null where the filing carries no readable amount. */
  amount: string | null;
  kind: string;
  note: string | null;
  evidence: Evidence;
}

interface RowContext {
  name: string;
  role: Role;
  spec: SectionSpec;
  linkable: ReadonlySet<string>;
  fetchedAt: string | null;
  sourceUrl: string | null;
  here: string;
}

/** The committee's page at the tab holding this record's kind, the record's own
 * filing year and the printed name filled in (Design Round 32). Committee's name
 * filter is its `q`. A year the record does not hold stays unclaimed. */
export function committeeHref(
  registration: string | null,
  linkable: ReadonlySet<string>,
  year: number | null,
  tab: string,
  name: string,
  here: string,
): string | null {
  if (!registration || !linkable.has(registration) || !isBuilt('committee')) return null;
  return withFrom(
    hrefFor(
      'committee',
      { id: registration },
      { year: year === null ? null : String(year), tab, q: name },
    ),
    here,
  );
}

/** The saved source each section's rows come from, as the evidence drawer names it. */
/** The printed-name kinds a role's confirmations are kept under. */
const KINDS: Record<Role, PrintedKind[]> = {
  payee: ['payee_name', 'independent_payee_name'],
  donor: ['donor_name'],
  employer: ['employer_name'],
};

const SAVED_SOURCE: Record<SectionSpec['file'], string> = {
  contributions: 'Contribution file',
  expenditures: 'Expenditure file',
  independentExpenditures: 'Independent expenditure file',
};

function row(
  context: RowContext,
  fields: {
    recordNumber: number;
    date: string | null;
    year: number | null;
    committee: string | null;
    registration: string | null;
    amount: string | null;
    kind: string | null;
    note: string | null;
    tab: string;
    /** The printed name the Committee link filters to. */
    filterName: string;
    employer?: string | null;
    zip?: string | null;
  },
): PaymentRow {
  const date = formatDay(fields.date);
  const amount = formatMoney(fields.amount);
  const committee = fields.committee ?? UNNAMED_PAYMENT_PARTY;
  const kind = fields.kind ?? '';
  return {
    key: `${context.spec.id}-${fields.recordNumber}`,
    date,
    committee,
    href: committeeHref(
      fields.registration,
      context.linkable,
      fields.year,
      fields.tab,
      fields.filterName,
      context.here,
    ),
    registration: fields.registration,
    amount,
    kind,
    note: fields.note,
    evidence: {
      title: `${context.name} · ${amount ?? AMOUNT_MISSING}`,
      authority: BOARD,
      // The held locators (Design Round 37): the saved source, the copy it was read
      // from and the row in it, then the row's fields as filed.
      rows: [
        { label: 'Saved source', value: SAVED_SOURCE[context.spec.file] },
        ...(context.fetchedAt
          ? [{ label: 'Source version', value: `Copy of ${centralDateLabel(context.fetchedAt)}` }]
          : []),
        { label: 'Row', value: String(fields.recordNumber) },
        { label: 'Filer', value: committee },
        { label: 'Date', value: date ?? DATE_MISSING },
        { label: 'Amount', value: amount ?? AMOUNT_MISSING },
        ...(kind ? [{ label: 'Type', value: kind }] : []),
        ...(fields.employer ? [{ label: 'Employer as filed', value: fields.employer }] : []),
        ...(fields.zip ? [{ label: 'ZIP as filed', value: fields.zip }] : []),
      ],
      // No excerpt of the source row is held, so the drawer says so and links the
      // Board's file instead.
      quote: 'No saved source excerpt held',
      quoteLabel: 'SOURCE TEXT',
      checked: 'Not checked',
      sourceHref: context.sourceUrl ?? BOARD_FILES_URL,
      sourceLabel: 'View the Board’s payment file',
    },
  };
}

/** A committee's payment to a payee (the expenditures file). */
export function spentRow(payment: SpentRow, context: RowContext): PaymentRow {
  return row(context, {
    recordNumber: payment.record_number,
    date: payment.paid_on,
    year: payment.year,
    committee: payment.committee_name,
    registration: payment.committee_registration_number,
    amount: payment.amount,
    kind: payment.purpose || payment.expenditure_type,
    note: null,
    tab: 'expenditures',
    filterName: context.name,
  });
}

/** The filing's own stance column, read as it is filed; a row recording neither way
 * says so rather than picking one (shared wording, lib/paymentsUnderName.ts). */
export function positionNote(payment: OutsideRow): string | null {
  const about = payment.affected_committee_name;
  if (!about) return null;
  if (payment.stance) return `Position as filed: ${payment.stance} ${about}`;
  return `Spent about ${about}, where the filing does not say which way`;
}

/** A spender's independent-expenditure payment to a payee. */
export function outsideRow(payment: OutsideRow, context: RowContext): PaymentRow {
  return row(context, {
    recordNumber: payment.record_number,
    date: payment.paid_on,
    year: payment.year,
    committee: payment.spender,
    registration: payment.spender_registration_number,
    amount: payment.amount,
    kind: payment.purpose || payment.expenditure_type,
    note: positionNote(payment),
    tab: 'independent',
    filterName: context.name,
  });
}

/** A received payment: under the donor's printed name, or under the employer the
 * donor printed, where the donor stays named on the row and the money stays theirs. */
export function receivedRow(payment: ReceivedRow, context: RowContext): PaymentRow {
  // On an employer row the Committee link filters to the donor who printed it.
  const donor = context.role === 'employer' ? payment.contributor : context.name;
  return row(context, {
    recordNumber: payment.record_number,
    date: payment.received_on,
    year: payment.year,
    committee: payment.recipient_name,
    registration: payment.recipient_registration_number,
    amount: payment.amount,
    kind: payment.receipt_type,
    note:
      context.role === 'employer' && payment.contributor ? `Donor: ${payment.contributor}` : null,
    tab: tabOfKind(payment.contributor_type),
    filterName: donor ?? '',
    employer: payment.employer,
    zip: payment.contributor_zip ?? null,
  });
}

/** The section's count: exact while every row is loaded, otherwise only what is
 * shown, because a name-keyed lookup serves no total (rule 11). */
export function countLine(shown: number, hasMore: boolean): string {
  if (hasMore) return paymentsShowingLine(shown, null, true);
  return `${formatCount(shown)} ${shown === 1 ? 'record' : 'records'}`;
}

/** The drawing's copy line when every loaded file was copied the same day, and 1
 * line per file otherwise; a file with no copy date borrows no other file's. */
export function copyLines(files: Array<{ file: SectionSpec['file']; fetchedAt: string | null }>) {
  const days = files.map((item) => (item.fetchedAt ? centralDateLabel(item.fetchedAt) : null));
  if (days.length === 0) return [];
  if (days[0] && days.every((day) => day === days[0])) {
    return [
      `Minnesota’s payment files copied ${days[0]}. This is a copy date, not a reporting period.`,
    ];
  }
  return files.map((item) => paymentFileCopyLine(item.file, item.fetchedAt));
}

export interface ConfirmedIdentity {
  id: string;
  kind: string;
  name: string;
  /** Records of this spelling, in the selected year, that this identity's
   * confirmations cover, over every file the role reads. */
  confirmed: number;
}

export interface IdentityCoverage {
  /** Every record of this spelling in the selected year, over every file the role reads. */
  records: number;
  identities: ConfirmedIdentity[];
}

/** Every identity holding records of exactly this spelling, each with its own
 * count, never 1 union under 1 name (Design Round 39). Null until every file's
 * answer is held, so a count is never over part of the role. Nothing is inferred
 * from a matching name. */
export function identityCoverage(reads: Array<IdentityRecords | null>): IdentityCoverage | null {
  if (reads.some((read) => read === null)) return null;
  const found = new Map<string, ConfirmedIdentity>();
  let records = 0;
  for (const read of reads as IdentityRecords[]) {
    records += read.records;
    for (const identity of read.identities ?? []) {
      if (!(identity.confirmed > 0)) continue;
      const entry = found.get(identity.id) ?? {
        id: identity.id,
        kind: identity.kind,
        name: identity.name,
        confirmed: 0,
      };
      entry.confirmed += identity.confirmed;
      found.set(identity.id, entry);
    }
  }
  return { records, identities: [...found.values()] };
}

/** "Confirmed for {k} of {n} records[ in {year}]" (Design Rounds 30 and 39). */
export function coverageLine(confirmed: number, records: number, year: number | null): string {
  const of = `Confirmed for ${formatCount(confirmed)} of ${formatCount(records)} ${records === 1 ? 'record' : 'records'}`;
  return year === null ? of : `${of} in ${year}`;
}

/** The page role a server role answers for. */
export function roleOf(serverRole: ServerRole): Role {
  if (serverRole === 'contributor') return 'donor';
  if (serverRole === 'employer') return 'employer';
  return 'payee';
}

function sectionOf(serverRole: ServerRole): SectionSpec {
  return sectionsFor(roleOf(serverRole)).find((spec) => spec.serverRole === serverRole)!;
}

/** The rows of 1 loaded answer, read by the role, name and year that answer was for,
 * so earlier results shown while a new view loads never take the new view's labels. */
export function rowsFor(data: NamePayments<unknown>, here: string): PaymentRow[] {
  const context: RowContext = {
    name: data.name,
    role: roleOf(data.role),
    spec: sectionOf(data.role),
    linkable: data.linkable,
    fetchedAt: data.fetchedAt,
    sourceUrl: data.sourceUrl,
    here,
  };
  if (data.role === 'vendor') {
    return (data.payments as SpentRow[]).map((item) => spentRow(item, context));
  }
  if (data.role === 'independent_vendor') {
    return (data.payments as OutsideRow[]).map((item) => outsideRow(item, context));
  }
  return (data.payments as ReceivedRow[]).map((item) => receivedRow(item, context));
}

/** The source file an address's `dataset` names (Design Round 40). */
const DATASET_FILE: Record<string, SectionSpec['file']> = {
  expenditures: 'expenditures',
  independent: 'independentExpenditures',
  contributions: 'contributions',
};

const SCOPE_FILE: Record<SectionSpec['file'], string> = {
  expenditures: 'campaign payments file',
  independentExpenditures: 'outside spending file',
  contributions: 'contributions file',
};

/** The sections an address's `dataset` keeps for this role. A dataset the role does
 * not read narrows nothing, so the page never empties itself on a mismatched link. */
export function scopedSections(role: Role, dataset: string): SectionSpec[] {
  const all = sectionsFor(role);
  const file = DATASET_FILE[dataset];
  const kept = file ? all.filter((spec) => spec.file === file) : [];
  return kept.length ? kept : all;
}

/** "Showing records filed by {committee}, {file}" (Design Round 40), or null with no
 * scope. The committee is named as its rows print it, else by its registration. */
export function scopeLine(
  filerName: string | null,
  file: SectionSpec['file'] | null,
): string | null {
  const bits = [filerName ? `filed by ${filerName}` : null, file ? SCOPE_FILE[file] : null].filter(
    Boolean,
  );
  return bits.length ? `Showing records ${bits.join(', ')}` : null;
}

/** The filer an address names, as a registration number (a committee slug ends in one). */
export function filerFromParam(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  return registrationNumberFromSlug(value) ?? value;
}

/** Nothing carries this spelling: a fact about the spelling and our records. */
export function emptyLine(data: NamePayments<unknown>): string {
  const title = sectionOf(data.role).title.toLowerCase();
  const year = data.year === null ? '' : ` in ${data.year}`;
  return `No ${title} are recorded under “${data.name}”${year}. This does not mean none were made.`;
}

/**
 * Payments under this name (Payments Under Name drawing): every payment recorded
 * under 1 exact printed name, in 1 role, per dataset and year, with source evidence.
 * Keyed on the printed string; a matching name never establishes identity.
 */
export function PaymentsUnderName({ match }: { match: RouteMatch }) {
  const location = useLocation();
  const here = location.pathname + location.search;
  const from = location.searchParams.get('from');
  const back = returnTarget(location.search);
  const band = useBand();
  const name = (match.params.query ?? '').trim();
  const years = useMemo(() => campaignMoneyHistoryYears(), []);
  const [address, setAddress] = useAddressState({
    role: 'payee',
    year: 'all',
    filer: '',
    dataset: '',
  });
  const role = roleFromParam(address.role);
  const year = yearFromParam(address.year, years);
  const all = sectionsFor(role);
  const sections = scopedSections(role, address.dataset);
  const keeps = (spec: SectionSpec | undefined) =>
    !!spec && sections.some((item) => item.id === spec.id);
  const filer = filerFromParam(address.filer);
  const datasetFile = sections.length < all.length ? sections[0].file : null;

  const [draft, setDraft] = useState(name);
  // Back and Forward restore the earlier name into the field.
  useEffect(() => setDraft(name), [name]);
  const [evidence, setEvidence] = useState<Evidence | null>(null);
  useEffect(() => setEvidence(null), [name, role, year]);

  const campaign = useNamePayments<ReceivedRow | SpentRow>(
    name && keeps(all[0]) ? namePaymentsQuery(name, all[0].serverRole, year) : null,
  );
  const outside = useNamePayments<OutsideRow>(
    name && keeps(all[1]) ? namePaymentsQuery(name, all[1].serverRole, year) : null,
  );
  const reads: NamePaymentsRead<unknown>[] = sections.map((spec) =>
    spec.id === all[0].id ? campaign : outside,
  );

  // Identity counts cover the files in scope. The server cannot count them for 1
  // filer, so under a filer scope no identity count is shown rather than one over
  // other filers' records.
  const kinds = KINDS[role];
  const counted = name && !filer;
  const firstIdentity = useIdentityRecords(kinds[0], counted && keeps(all[0]) ? name : null, year);
  const secondIdentity = useIdentityRecords(
    'independent_payee_name',
    counted && keeps(all[1]) ? name : null,
    year,
  );
  const coverage = counted
    ? identityCoverage(
        sections.map((spec) => (spec.id === all[0].id ? firstIdentity.data : secondIdentity.data)),
      )
    : null;
  const filerName = filer
    ? (reads
        .flatMap((read) => (read.data?.state === 'reported' ? rowsFor(read.data, here) : []))
        .find((item) => item.registration === filer)?.committee ?? filerRegistrationLabel(filer))
    : null;
  const scope = scopeLine(filerName, datasetFile);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = draft.trim();
    if (!next) return;
    navigate(
      withFrom(
        hrefFor(
          'payments-under-name',
          { query: next },
          { role: role === 'payee' ? null : role, year: year === null ? null : String(year) },
        ),
        from,
      ),
    );
  }

  const allLoading = reads.every((read) => read.loading);
  const allFailed = reads.every((read) => read.failed && !read.data);
  const updating = reads.some((read) => read.updating);
  const requestedSection = location.searchParams.get('section');
  const focusedSection = useRef<string | null>(null);
  useEffect(() => {
    const target = `${name}|${role}|${requestedSection}`;
    if (allLoading || allFailed || focusedSection.current === target || cameByHistory()) return;
    if (!sectionsFor(role).some((spec) => spec.id === requestedSection)) return;
    const heading = document.getElementById(`pn-${requestedSection}`);
    if (!heading) return;
    focusedSection.current = target;
    heading.focus({ preventScroll: true });
    heading.scrollIntoView?.({ block: 'start' });
  }, [name, role, requestedSection, allLoading, allFailed]);

  const loaded = sections.map((spec, index) => ({ spec, data: reads[index].data }));
  const copies = copyLines(
    loaded
      .filter((item) => item.data !== null && item.data.state !== 'unavailable')
      .map((item) => ({ file: item.spec.file, fetchedAt: item.data!.fetchedAt })),
  );
  return (
    <main id="main" className="f-page pn-page">
      <div className="f-content">
        {back && <BackLink to={back.to} name={back.name} />}
        <header className="pn-header">
          <h1 tabIndex={-1} className="f-page-title pn-title">
            Payments under this name
          </h1>
          <form onSubmit={submit} className="pn-form">
            <div className="pn-fields">
              <label className="pn-label">
                <span className="pn-label-text">
                  {role === 'employer' ? 'Employer name as reported' : 'Name as reported'}
                </span>
                <input
                  type="text"
                  className="f-field pn-field"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  autoComplete="off"
                />
              </label>
              <Dropdown
                name="Record type"
                value={role}
                options={ROLES}
                onChange={(value) => setAddress({ role: value })}
              />
              <Dropdown
                name="Year"
                value={year === null ? 'all' : String(year)}
                options={[
                  { value: 'all', label: 'All years' },
                  ...years.map((value) => ({ value: String(value), label: String(value) })),
                ]}
                onChange={(value) => setAddress({ year: value })}
              />
              <button type="submit" className="f-btn pn-submit">
                Search
              </button>
            </div>
            <p className="pn-notice">
              {role === 'employer'
                ? 'Employer name as written in contribution records, not the organization’s giving'
                : 'Records are grouped by the name printed in the source'}
            </p>
            {scope && (
              <p className="pn-scope">
                {scope}
                <ClearAll onClick={() => setAddress({ filer: '', dataset: '' })} />
              </p>
            )}
          </form>
          {coverage && (
            <IdentityCard coverage={coverage} name={name} role={role} year={year} here={here} />
          )}
        </header>

        {updating && !allLoading && (
          <div className="pn-gap">
            <Updating />
          </div>
        )}
        {allLoading && (
          <div role="status" aria-busy="true" className="pn-loading">
            <span className="f-spinner" aria-hidden="true" />
            Loading…
          </div>
        )}
        {!allLoading && allFailed && (
          <div className="pn-gap pn-narrow">
            <Refused
              onRetry={() => reads.forEach((read) => read.retry())}
              retrying={reads.some((read) => read.pending)}
            >
              We couldn’t load these results. This is a problem on our side and says nothing about
              what was filed under this name.
            </Refused>
          </div>
        )}
        {!allLoading &&
          !allFailed &&
          sections.map((spec, index) => (
            <Section
              key={spec.id}
              spec={spec}
              read={reads[index]}
              phone={band === 'phone'}
              here={here}
              filer={filer}
              onView={setEvidence}
            />
          ))}
      </div>
      <SourcesAndUpdates>
        {copies.map((line) => (
          <p key={line} className="pn-source-line">
            {line}
          </p>
        ))}
        <a
          href={BOARD_FILES_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="f-dest pn-source-link"
        >
          <span>
            <WithArrow>View the Board’s payment files</WithArrow>
          </span>
          <span className="f-visually-hidden"> (opens in a new tab)</span>
        </a>
      </SourcesAndUpdates>
      <EvidencePanel evidence={evidence} onClose={() => setEvidence(null)} />
    </main>
  );
}

/** Where "Review confirmation" and "Confirm identity" open: Confirm identities for
 * exactly this spelling, role and year, only once that screen is built. */
export function confirmHref(
  name: string,
  role: Role,
  year: number | null,
  here: string,
): string | null {
  if (!isBuilt('identities')) return null;
  return withFrom(
    hrefFor('identities', {}, { name, role, year: year === null ? null : String(year) }),
    here,
  );
}

function IdentityCard({
  coverage,
  name,
  role,
  year,
  here,
}: {
  coverage: IdentityCoverage;
  name: string;
  role: Role;
  year: number | null;
  here: string;
}) {
  const confirm = confirmHref(name, role, year, here);
  if (coverage.identities.length === 0) {
    return (
      <section aria-label="Identity" className="pn-identity">
        <span className="pn-identity-none">No confirmed identity for this spelling</span>
        {confirm && (
          <Link to={confirm} className="f-dest pn-identity-link">
            <span>
              <WithArrow>Confirm identity</WithArrow>
            </span>
          </Link>
        )}
      </section>
    );
  }
  return (
    <section aria-label="Confirmed identity" className="pn-identity">
      <span className="pn-identity-text">
        <span className="f-label pn-identity-label">
          {coverage.identities.length > 1 ? 'CONFIRMED IDENTITIES' : 'CONFIRMED IDENTITY'}
        </span>
        {coverage.identities.map((identity) => (
          <IdentityLine
            key={identity.id}
            identity={identity}
            records={coverage.records}
            name={name}
            role={role}
            year={year}
            here={here}
          />
        ))}
      </span>
      {confirm && (
        <Link to={confirm} className="f-dest pn-identity-link">
          <span>
            <WithArrow>Review confirmation</WithArrow>
          </span>
        </Link>
      )}
    </section>
  );
}

function IdentityLine({
  identity,
  records,
  name,
  role,
  year,
  here,
}: {
  identity: ConfirmedIdentity;
  records: number;
  name: string;
  role: Role;
  year: number | null;
  here: string;
}) {
  const read = useRead<IdentityRead>(apiPath(['finance', 'identities', identity.id]));
  const checked = checkedDay(read.data, KINDS[role], name, centralDateLabel);
  const organization = identity.kind === 'organization';
  const href =
    organization && isBuilt('organization')
      ? withFrom(hrefFor('organization', { id: identity.id }), here)
      : !organization && identity.kind === 'person' && isBuilt('person')
        ? withFrom(hrefFor('person', { id: identity.id }), here)
        : null;
  return (
    <span className="pn-identity-item">
      <span className="pn-identity-name">
        {href ? (
          <Link to={href} className="pn-identity-name-link">
            {identity.name}
          </Link>
        ) : (
          identity.name
        )}
      </span>
      <span className="pn-identity-note f-num">
        {coverageLine(identity.confirmed, records, year)}
        {checked ? ` · Checked on ${checked}` : ''}
      </span>
    </span>
  );
}

function Section({
  spec,
  read,
  phone,
  here,
  filer,
  onView,
}: {
  spec: SectionSpec;
  read: NamePaymentsRead<unknown>;
  phone: boolean;
  here: string;
  /** Only this filer's rows, of those loaded (the server reads every filer's). */
  filer: string | null;
  onView: (evidence: Evidence) => void;
}) {
  const data = read.data;
  const rows = (data && data.state === 'reported' ? rowsFor(data, here) : []).filter(
    (item) => filer === null || item.registration === filer,
  );
  // Under a filer scope a capped list says nothing about how many rows it shows: the
  // rows not loaded yet may hold more of that filer's.
  const count =
    data && data.state !== 'unavailable' && !(filer !== null && data.hasMore)
      ? countLine(rows.length, data.hasMore)
      : null;
  const headingId = `pn-${spec.id}`;
  const reveal = useRevealFocus<HTMLElement>();
  return (
    <section aria-labelledby={headingId} className="pn-section" ref={reveal.list}>
      <div className="pn-section-head">
        <h2 id={headingId} tabIndex={-1} className="f-section-title">
          {spec.title}
        </h2>
        {count && <span className="pn-count f-num">{count}</span>}
      </div>
      {read.loading && (
        <div role="status" aria-busy="true" className="pn-loading pn-loading-section">
          <span className="f-spinner" aria-hidden="true" />
          Loading…
        </div>
      )}
      {read.failed && !data && (
        <div className="pn-gap pn-narrow">
          <Refused onRetry={read.retry} retrying={read.pending}>
            We couldn’t load these results. This is a problem on our side and says nothing about
            what was filed under this name.
          </Refused>
        </div>
      )}
      {data && data.state === 'unavailable' && (
        <div className="f-empty-box pn-empty">
          {RECORDS_UNAVAILABLE_TITLE}
          <div className="f-empty-next">{RECORDS_UNAVAILABLE_WHY}</div>
        </div>
      )}
      {data && data.state !== 'unavailable' && rows.length === 0 && !data.hasMore && (
        <div className="f-empty-box pn-empty">{emptyLine(data)}</div>
      )}
      {rows.length > 0 && (
        <div role="table" aria-label={spec.title} className="pn-table">
          {!phone && (
            <div role="row" className="pn-row pn-head">
              <span role="columnheader">DATE</span>
              <span role="columnheader">COMMITTEE</span>
              <span role="columnheader" className="pn-amount">
                AMOUNT
              </span>
              <span role="columnheader">TYPE</span>
              <span />
            </div>
          )}
          {rows.map((item) =>
            phone ? (
              <div role="row" key={item.key} className="pn-phone-row">
                <div className="pn-phone-top">
                  <span role="cell" className="pn-committee">
                    <CommitteeName row={item} />
                  </span>
                  <span
                    role="cell"
                    className="pn-amount f-num"
                    data-missing={item.amount === null || undefined}
                  >
                    {item.amount ?? AMOUNT_MISSING}
                  </span>
                </div>
                <div className="pn-phone-meta f-num">
                  {[item.date ?? DATE_MISSING, item.kind, item.note].filter(Boolean).join(' · ')}
                </div>
                <button type="button" className="pn-view" onClick={() => onView(item.evidence)}>
                  View source
                </button>
              </div>
            ) : (
              <div role="row" key={item.key} className="pn-row">
                <span
                  role="cell"
                  className="pn-date f-num"
                  data-missing={item.date === null || undefined}
                >
                  {item.date ?? DATE_MISSING}
                </span>
                <span role="cell" className="pn-committee">
                  <CommitteeName row={item} />
                  {item.note && <span className="pn-note"> · {item.note}</span>}
                </span>
                <span
                  role="cell"
                  className="pn-amount f-num"
                  data-missing={item.amount === null || undefined}
                >
                  {item.amount ?? AMOUNT_MISSING}
                </span>
                <span role="cell" className="pn-kind">
                  {item.kind}
                </span>
                <span role="cell" className="pn-view-cell">
                  <button type="button" className="pn-view" onClick={() => onView(item.evidence)}>
                    View source
                  </button>
                </span>
              </div>
            ),
          )}
        </div>
      )}
      {rows.length > 0 && (
        <p className="f-section-note pn-section-note">{sectionOf(data!.role).note}</p>
      )}
      {data?.hasMore && (
        <div className="pn-more">
          <p className="pn-more-note">{CAP_NOTE}</p>
          {read.moreFailed && <p className="pn-more-error">{LOAD_MORE_ERROR}</p>}
          <button
            type="button"
            className="f-btn f-btn-secondary pn-more-btn"
            aria-disabled={read.loadingMore || undefined}
            onClick={() => {
              if (read.loadingMore) return;
              reveal.mark();
              read.more();
            }}
          >
            {read.loadingMore && <span className="f-spinner" aria-hidden="true" />}
            {CAP_NEXT_LABEL}
          </button>
        </div>
      )}
    </section>
  );
}

function CommitteeName({ row: item }: { row: PaymentRow }) {
  return item.href ? (
    <Link to={item.href} className="pn-committee-link">
      {item.committee}
    </Link>
  ) : (
    <span className="pn-committee-text">{item.committee}</span>
  );
}
