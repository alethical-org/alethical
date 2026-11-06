import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { useLiveSearch } from '../search/useLiveSearch';

import { campaignMoneyHistoryYears } from '@alethical/shared/campaignMoneyYears';
import {
  registrationNumberFromSlug,
  UNNAMED_PAYMENT_PARTY,
} from '@alethical/shared/committeeMoneyShared';
import { formatDay } from '@alethical/shared/moneyFormat';
import { formatMoney } from '../ui/money';
import { centralDateLabel, formatCount } from '@alethical/shared/moneyLanding';
import { paymentFileCopyLine } from '@alethical/shared/paymentCopyDates';
import {
  CAP_NEXT_LABEL,
  filerRegistrationLabel,
  paymentsShowingLine,
  RECORDS_UNAVAILABLE_TITLE,
  RECORDS_UNAVAILABLE_WHY,
} from '@alethical/shared/paymentsUnderName';

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
  namePaymentsQuery,
  useNamePayments,
  useNameSpellings,
  type NameSpellings,
  type NamePayments,
  type NamePaymentsRead,
  type OutsideRow,
  type ReceivedRow,
  type RowFacts,
  type ServerRole,
  type SpentRow,
} from './payments/data';
import { quotedSpelling } from './payments/printedName';
import './payments.css';
import { SimilarNames, similarBack } from './payments/SimilarNames';

const BOARD = 'Minnesota Campaign Finance and Public Disclosure Board';
export const BOARD_FILES_URL =
  'https://cfb.mn.gov/reports-and-data/self-help/data-downloads/campaign-finance/';
const DATE_MISSING = 'Date not given in the public file';
const AMOUNT_MISSING = 'Amount not given';
/** A later page was asked for against a Board file that has since changed (409). */
export const RELEASE_CHANGED = 'The Board’s file changed. Reload the records.';

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
      note: 'Record counts may include more than one entry for the same donation. Our records may not include all giving.',
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
      { year: year === null ? null : String(year), tab, name },
    ),
    here,
  );
}

/** The saved source each section's rows come from, as the evidence drawer names it. */
const SAVED_SOURCE: Record<SectionSpec['file'], string> = {
  contributions: 'Contribution file',
  expenditures: 'Expenditure file',
  independentExpenditures: 'Independent expenditure file',
};

/** The server's dataset values, as the evidence drawer names their files. */
const DATASET_SOURCE: Record<string, string> = {
  contributions: SAVED_SOURCE.contributions,
  expenditures: SAVED_SOURCE.expenditures,
  independent_expenditures: SAVED_SOURCE.independentExpenditures,
};

const NOT_GIVEN = 'Not given';
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const STORED_DECIMAL = /^(-?\d+)\.(\d+)$/;

/** A stored decimal as the filing's amount: exactly 2 decimals ("1250.5000" reads
 * "1250.50"), more only where the value truly has them, never rounded below the
 * cent; no currency sign or grouping (settled wording row 32). */
export function excerptAmount(value: string): string {
  const parts = STORED_DECIMAL.exec(value);
  if (!parts) return value;
  const decimals = parts[2].replace(/0+$/, '');
  return `${parts[1]}.${decimals.length >= 2 ? decimals : decimals.padEnd(2, '0')}`;
}

/** The served excerpt as SOURCE TEXT: 1 "label: value" line per column, in the
 * order the server serves them (the file's own), a date as the page prints dates,
 * a stored decimal with 2 decimals and a blank cell as "Not given"; null when no
 * excerpt is held. */
export function excerptText(excerpt: RowFacts['excerpt']): string | null {
  if (!Array.isArray(excerpt) || excerpt.length === 0) return null;
  return excerpt
    .map(([label, value]) => {
      const shown =
        value === null || value === ''
          ? NOT_GIVEN
          : ISO_DAY.test(value)
            ? (formatDay(value) ?? value)
            : excerptAmount(value);
      return `${label}: ${shown}`;
    })
    .join('\n');
}

/** A held value of the excerpt by its column label. */
function excerptValue(excerpt: RowFacts['excerpt'], label: string): string | null {
  if (!Array.isArray(excerpt)) return null;
  return excerpt.find(([name]) => name.toLowerCase() === label.toLowerCase())?.[1] ?? null;
}

/** "Confirmed as {identity}" from the row's own fingerprint (Design Round 39). */
export function rowIdentityNote(facts: RowFacts): string | null {
  const identity = facts.identity;
  return identity ? `Confirmed as ${identity.name}` : null;
}

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
    facts: RowFacts;
  },
): PaymentRow {
  const date = formatDay(fields.date);
  const amount = formatMoney(fields.amount);
  const committee = fields.committee ?? UNNAMED_PAYMENT_PARTY;
  const kind = fields.kind ?? '';
  return {
    key: `${fields.facts.evidence?.dataset ?? context.spec.file}:${fields.facts.evidence?.snapshot_id ?? 'current'}:${fields.recordNumber}`,
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
    evidence: rowEvidence(context, fields, { committee, date, amount, kind }),
  };
}

/** The held locators (Design Round 37): the saved source, the copy it was read from
 * and the row in it, then the row's fields as filed and its excerpt. The Board's
 * file is linked only when no excerpt is held. */
function rowEvidence(
  context: RowContext,
  fields: {
    recordNumber: number;
    employer?: string | null;
    zip?: string | null;
    facts: RowFacts;
  },
  shown: {
    committee: string;
    date: string | null;
    amount: string | null;
    kind: string;
  },
): Evidence {
  const held = fields.facts.evidence ?? null;
  const copied = held?.copied_at ?? context.fetchedAt;
  const quote = excerptText(fields.facts.excerpt);
  const zip =
    fields.zip ??
    excerptValue(
      fields.facts.excerpt,
      context.spec.file === 'contributions' ? 'Contrib zip' : 'Vendor zip',
    );
  return {
    title: `${quotedSpelling(context.name)} · ${shown.amount ?? AMOUNT_MISSING}`,
    authority: BOARD,
    rows: [
      {
        label: 'Saved source',
        value: (held?.dataset && DATASET_SOURCE[held.dataset]) || SAVED_SOURCE[context.spec.file],
      },
      ...(copied
        ? [
            {
              label: 'Source version',
              value: `Copy of ${centralDateLabel(copied)}`,
            },
          ]
        : []),
      {
        label: 'Row',
        value: String(held?.record_number ?? fields.recordNumber),
      },
      { label: 'Filer', value: shown.committee },
      { label: 'Date', value: shown.date ?? DATE_MISSING },
      { label: 'Amount', value: shown.amount ?? AMOUNT_MISSING },
      ...(shown.kind ? [{ label: 'Type', value: shown.kind }] : []),
      ...(fields.employer
        ? [
            {
              label: 'Employer as filed',
              value: quotedSpelling(fields.employer),
              ...(isBuilt('employer')
                ? {
                    href: withFrom(hrefFor('employer', { name: fields.employer }), context.here),
                  }
                : {}),
            },
          ]
        : []),
      ...(zip ? [{ label: 'ZIP as filed', value: zip }] : []),
    ],
    quote: quote ?? 'No saved source excerpt held',
    quoteLabel: 'SOURCE TEXT',
    checked: 'Not checked',
    ...(quote
      ? {}
      : {
          sourceHref: held?.source_url ?? context.sourceUrl ?? BOARD_FILES_URL,
          sourceLabel: 'View the Board’s payment file',
        }),
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
    facts: payment,
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
    facts: payment,
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
      context.role === 'employer' && payment.contributor
        ? `Donor: ${quotedSpelling(payment.contributor)}`
        : context.role === 'donor' && payment.employer
          ? `Employer as filed: ${payment.employer}`
          : null,
    tab: tabOfKind(payment.contributor_type),
    filterName: donor ?? '',
    employer: payment.employer,
    zip: payment.contributor_zip ?? null,
    facts: payment,
  });
}

/** The section's count: the server's own count of every row the scope matches,
 * else exact while every row is loaded, else only what is shown (rule 11). */
export function countLine(shown: number, hasMore: boolean, total: number | null = null): string {
  const count = total ?? (hasMore ? null : shown);
  if (count === null) return paymentsShowingLine(shown, null, true);
  return `${formatCount(count)} ${count === 1 ? 'record' : 'records'}`;
}

/** " under “{name}”[ in {year}]", naming the view kept results belong to. */
export function keptLabel(name: string, year: number | null): string {
  return ` under “${name}”${year === null ? '' : ` in ${year}`}`;
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
  /** Served after the identity reference lands; printed in place of nothing else. */
  reference: string | null;
  /** Records of this spelling in the read's scope (year, filer) this identity's
   * confirmations cover, over every file in scope. */
  confirmed: number;
}

export interface IdentityCoverage {
  /** Every record of this spelling in the read's scope, over every file in scope. */
  records: number;
  identities: ConfirmedIdentity[];
}

/** Every identity holding records of exactly this spelling, each with its own
 * count over the read's scope, never 1 union under 1 name (Design Round 39). Null
 * until every file in scope has answered with a count, so a count is never over
 * part of the role. Nothing is inferred from a matching name. */
export function identityCoverage(
  reads: Array<NamePayments<unknown> | null>,
): IdentityCoverage | null {
  if (reads.some((read) => read === null || read.state === 'unavailable')) return null;
  const found = new Map<string, ConfirmedIdentity>();
  let records = 0;
  for (const read of reads as NamePayments<unknown>[]) {
    if (read.state === 'reported') {
      if (read.total === null) return null;
      records += read.total;
    }
    for (const identity of read.identities) {
      if (!(identity.confirmed_records > 0)) continue;
      const entry = found.get(identity.id) ?? {
        id: identity.id,
        kind: identity.kind,
        name: identity.name,
        reference: identity.reference ?? null,
        confirmed: 0,
      };
      entry.confirmed += identity.confirmed_records;
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
 * does not read has no matching sections; it never broadens to unrelated files. */
export function scopedSections(role: Role, dataset: string): SectionSpec[] {
  const all = sectionsFor(role);
  const file = DATASET_FILE[dataset];
  return file ? all.filter((spec) => spec.file === file) : all;
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
  if (!bits.length) return null;
  // "filed by {committee}, {file}" with a filer; "from the {file}" with a file alone.
  return filerName ? `Showing records ${bits.join(', ')}` : `Showing records from the ${bits[0]}`;
}

/** The filer an address names, as a registration number (a committee slug ends in one). */
export function filerFromParam(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  return registrationNumberFromSlug(value) ?? value;
}

/** Nothing carries this spelling: a fact about the spelling and our records. */
export function emptyLine(data: NamePayments<unknown>, filerName: string | null = null): string {
  const title = sectionOf(data.role).title.toLowerCase();
  const year = data.year === null ? '' : ` in ${data.year}`;
  // Under a filer scope the read cannot say no payments exist at all, only none
  // for that committee.
  if (filerName) return `No ${title} under “${data.name}” are recorded for ${filerName}${year}`;
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
  const back = similarBack(location.search) ??
    returnTarget(location.search) ?? {
      to: hrefFor('campaign-money'),
      name: 'Campaign money',
    };
  const band = useBand();
  // The printed spelling exactly as the address carries it: " Schmidt, Steven" and
  // "Schmidt, Steven" are 2 spellings (settled wording row 63).
  const raw = match.params.query ?? location.searchParams.get('q') ?? '';
  const name = raw.trim() ? raw : '';
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
  const datasetFile = DATASET_FILE[address.dataset] ?? null;

  const [draft, setDraft, applySearch] = useLiveSearch(name, here, (next) => {
    const params = new URLSearchParams(window.location.search);
    // These identify a selected result or spelling comparison, not a search filter.
    for (const key of ['section', 'similarStart', 'exclude', 'page', 'q']) params.delete(key);
    // Browsers resolve dot-only path segments as directory navigation.
    const dotOnly = next === '.' || next === '..';
    if (dotOnly) params.set('q', next);
    const path =
      next && !dotOnly
        ? hrefFor('payments-under-name', { query: next })
        : hrefFor('payments-name-search');
    navigate(path + (params.size ? `?${params}` : ''), {
      replace: true,
      preserveFocus: true,
    });
  });
  const [evidence, setEvidence] = useState<Evidence | null>(null);
  useEffect(() => setEvidence(null), [name, role, year]);

  // The server narrows rows and every count to the filer.
  const campaign = useNamePayments<ReceivedRow | SpentRow>(
    name && keeps(all[0]) ? namePaymentsQuery(name, all[0].serverRole, year, filer) : null,
  );
  const outside = useNamePayments<OutsideRow>(
    name && keeps(all[1]) ? namePaymentsQuery(name, all[1].serverRole, year, filer) : null,
  );
  const reads: NamePaymentsRead<unknown>[] = sections.map((spec) =>
    spec.id === all[0].id ? campaign : outside,
  );

  // Pin spelling discovery and each group to the exact rows' published copy.
  // During a changed search the prior copy keeps its own scope until replacement.
  const basis = reads.find((read) => read.data)?.data ?? null;
  const spellings = useNameSpellings(
    basis
      ? {
          name: basis.name,
          role: roleOf(basis.role),
          year: basis.year,
          filer: basis.filer,
          dataset: address.dataset || null,
          release_id: basis.releaseId,
        }
      : null,
  );
  const variantData =
    basis &&
    spellings.data?.release_id === basis.releaseId &&
    spellings.data.role === role &&
    spellings.data.name === basis.name &&
    (spellings.data.year ?? null) === basis.year &&
    (spellings.data.filer ?? null) === basis.filer &&
    (spellings.data.dataset ?? null) === (address.dataset || null)
      ? spellings.data
      : null;
  const variantNames = [...new Set(variantData?.names ?? [])].filter(
    (item) => item !== basis?.name,
  );
  const displayScope = JSON.stringify([
    basis?.name,
    role,
    basis?.year,
    basis?.filer,
    address.dataset,
    basis?.releaseId,
  ]);
  const [displayedGroups, setDisplayedGroups] = useState<Record<string, boolean>>({});
  const onGroupDisplay = useCallback((key: string, shown: boolean) => {
    setDisplayedGroups((current) => {
      if (Boolean(current[key]) === shown) return current;
      const next = { ...current };
      if (shown) next[key] = true;
      else delete next[key];
      return next;
    });
  }, []);
  const displayedVariants = variantNames.filter((spelling) =>
    sections.every((spec) => displayedGroups[JSON.stringify([displayScope, spec.id, spelling])]),
  );
  const currentBasis = basis?.name === name && basis.year === year && basis.filer === filer;
  const refreshSource = () => {
    reads.forEach((read) => read.retry());
    spellings.retry();
  };
  const filerName = filer
    ? (reads
        .flatMap((read) => (read.data?.state === 'reported' ? rowsFor(read.data, here) : []))
        .find((item) => item.registration === filer)?.committee ?? filerRegistrationLabel(filer))
    : null;
  const scope = scopeLine(filerName, datasetFile);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    applySearch();
  }

  const allLoading = reads.length > 0 && reads.every((read) => read.loading);
  const allFailed = reads.length > 0 && reads.every((read) => read.failed && !read.data);
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

  const loaded = sections.map((spec, index) => ({
    spec,
    data: reads[index].data,
  }));
  const copies = copyLines(
    loaded
      .filter((item) => item.data !== null && item.data.state !== 'unavailable')
      .map((item) => ({
        file: item.spec.file,
        fetchedAt: item.data!.fetchedAt,
      })),
  );
  return (
    <main id="main" className="f-page pn-page">
      <div className="f-content">
        {back && <BackLink to={back.to} name={back.name} />}
        <header className="pn-header">
          <h1 tabIndex={-1} className="f-page-title pn-title">
            Payments under this name
          </h1>
        </header>
        <div className="pn-similar-layout">
          <div className="pn-name-controls">
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
                    ...years.map((value) => ({
                      value: String(value),
                      label: String(value),
                    })),
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
          </div>
          <div className="pn-payment-results">
            {!name && <p className="f-empty-box pn-gap">Enter a name as reported</p>}
            {sections.length === 0 && (
              <p className="f-empty-box pn-gap">
                This file does not contain records for the selected record type
              </p>
            )}
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
                  We couldn’t load these results. This is a problem on our side and says nothing
                  about what was filed under this name.
                </Refused>
              </div>
            )}
            {!!name &&
              !allLoading &&
              !allFailed &&
              sections.map((spec, index) => (
                <section key={spec.id} aria-labelledby={`pn-${spec.id}`} className="pn-section">
                  <h2 id={`pn-${spec.id}`} tabIndex={-1} className="f-section-title">
                    {spec.title}
                  </h2>
                  <div className="pn-spelling-groups">
                    {band !== 'phone' && (
                      <div aria-hidden="true" className="pn-row pn-head">
                        <span>DATE</span>
                        <span>COMMITTEE</span>
                        <span className="pn-amount">AMOUNT</span>
                        <span>TYPE</span>
                        <span />
                      </div>
                    )}
                    <Section
                      spec={spec}
                      read={reads[index]}
                      phone={band === 'phone'}
                      here={here}
                      filerName={filerName}
                      view={{ name, year, filer }}
                      onView={setEvidence}
                      spelling={reads[index].data?.name ?? name}
                      showEmpty={
                        variantNames.length === 0 && !spellings.loading && !spellings.updating
                      }
                    />
                    {variantData &&
                      reads[index].data?.releaseId === variantData.release_id &&
                      variantNames.map((spelling) => (
                        <VariantPayments
                          key={`${spec.id}|${spelling}`}
                          spelling={spelling}
                          variants={variantData}
                          spec={spec}
                          phone={band === 'phone'}
                          here={here}
                          filerName={filerName}
                          requested={{ name, year, filer }}
                          onView={setEvidence}
                          displayKey={JSON.stringify([displayScope, spec.id, spelling])}
                          onDisplay={onGroupDisplay}
                          onRefreshSource={refreshSource}
                        />
                      ))}
                    {(spellings.loading || spellings.updating) && (
                      <div role="status" aria-busy="true" className="pn-variant-status">
                        Loading payments for similar spellings…
                      </div>
                    )}
                    {variantData &&
                      variantNames.length > 0 &&
                      reads[index].data &&
                      reads[index].data!.releaseId !== variantData.release_id && (
                        <div className="pn-variant-status">
                          <Refused
                            onRetry={() => {
                              reads[index].retry();
                              spellings.retry();
                            }}
                            retrying={reads[index].pending || spellings.pending}
                          >
                            {RELEASE_CHANGED}
                          </Refused>
                        </div>
                      )}
                    {(spellings.failed || spellings.notFound) && (
                      <div className="pn-variant-status">
                        <Refused onRetry={refreshSource} retrying={spellings.pending}>
                          We couldn’t load payments for similar spellings
                        </Refused>
                      </div>
                    )}
                  </div>
                  {reads[index].data?.state !== 'unavailable' && (
                    <p className="f-section-note pn-section-note">{spec.note}</p>
                  )}
                </section>
              ))}
          </div>
          <aside className="pn-similar-aside">
            {name && (
              <SimilarNames
                name={name}
                excludedNames={currentBasis ? [name, ...displayedVariants] : []}
                sourceReleaseId={currentBasis ? basis?.releaseId : null}
                onRefreshSource={refreshSource}
                role={role}
                year={year}
                here={here}
                filer={filer}
                dataset={datasetFile === 'independentExpenditures' ? 'independent' : datasetFile}
                copyDates={Object.fromEntries(
                  loaded.map(({ spec, data }) => [
                    spec.file === 'independentExpenditures'
                      ? 'independent_expenditures'
                      : spec.file,
                    data?.fetchedAt ?? null,
                  ]),
                )}
              />
            )}
          </aside>
        </div>
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

function VariantPayments({
  spelling,
  variants,
  spec,
  phone,
  here,
  filerName,
  requested,
  onView,
  displayKey,
  onDisplay,
  onRefreshSource,
}: {
  spelling: string;
  variants: NameSpellings;
  spec: SectionSpec;
  phone: boolean;
  requested: { name: string; year: number | null; filer: string | null };
  here: string;
  filerName: string | null;
  onView: (evidence: Evidence) => void;
  displayKey: string;
  onDisplay: (key: string, shown: boolean) => void;
  onRefreshSource: () => void;
}) {
  const read = useNamePayments<unknown>({
    ...namePaymentsQuery(spelling, spec.serverRole, variants.year, variants.filer),
    release_id: variants.release_id,
  });
  const displayed = Boolean(
    read.data &&
    read.data.state !== 'unavailable' &&
    read.data.name === spelling &&
    read.data.releaseId === variants.release_id &&
    read.data.role === spec.serverRole &&
    read.data.year === variants.year &&
    read.data.filer === variants.filer,
  );
  useEffect(() => {
    onDisplay(displayKey, displayed);
    return () => onDisplay(displayKey, false);
  }, [displayKey, displayed, onDisplay]);
  return (
    <Section
      spec={spec}
      read={{
        ...read,
        retry: () => {
          read.retry();
          onRefreshSource();
        },
      }}
      phone={phone}
      here={here}
      filerName={filerName}
      view={{ name: spelling, year: requested.year, filer: requested.filer }}
      onView={onView}
      spelling={spelling}
      variant
      forcedEarlier={variants.name !== requested.name}
    />
  );
}

function Section({
  spec,
  read,
  phone,
  here,
  filerName,
  view,
  onView,
  spelling,
  variant = false,
  showEmpty = true,
  forcedEarlier = false,
}: {
  spelling: string;
  variant?: boolean;
  showEmpty?: boolean;
  forcedEarlier?: boolean;
  spec: SectionSpec;
  read: NamePaymentsRead<unknown>;
  phone: boolean;
  here: string;
  /** The filer as its rows print it, else its registration, for the empty line. */
  filerName: string | null;
  /** The view the address asks for, so earlier results are never read as it. */
  view: { name: string; year: number | null; filer: string | null };
  onView: (evidence: Evidence) => void;
}) {
  const data = read.data;
  // The server has already narrowed the rows to the scope, the filer included.
  const rows = data && data.state === 'reported' ? rowsFor(data, here) : [];
  // Results kept from an earlier view (while the new one loads, or after it fails)
  // say whose they are (settled wording row 60).
  const earlier =
    data !== null &&
    (forcedEarlier ||
      data.name !== view.name ||
      data.year !== view.year ||
      data.filer !== view.filer ||
      data.role !== spec.serverRole);
  const count =
    data && data.state !== 'unavailable'
      ? countLine(rows.length, data.hasMore, data.total) +
        (earlier ? keptLabel(data.name, data.year) : '')
      : null;
  const headingId = useId();
  const reveal = useRevealFocus<HTMLElement>();
  return (
    <section aria-labelledby={headingId} className="pn-spelling-group" ref={reveal.list}>
      <div className="pn-section-head">
        <h3 id={headingId} tabIndex={-1} className="pn-spelling-title">
          {spelling}
        </h3>
        {count && <span className="pn-count f-num">{count}</span>}
      </div>
      {read.loading && (
        <div role="status" aria-busy="true" className="pn-loading pn-loading-section">
          <span className="f-spinner" aria-hidden="true" />
          {variant ? 'Loading payments for similar spellings…' : 'Loading…'}
        </div>
      )}
      {read.failed && (
        <div className="pn-gap pn-narrow">
          <Refused onRetry={read.retry} retrying={read.pending}>
            {variant
              ? 'We couldn’t load payments for similar spellings'
              : 'We couldn’t load these results. This is a problem on our side and says nothing about what was filed under this name.'}
          </Refused>
        </div>
      )}
      {data && data.state === 'unavailable' && (
        <div className="f-empty-box pn-empty" style={{ whiteSpace: 'pre-wrap' }}>
          {RECORDS_UNAVAILABLE_TITLE}
          <div className="f-empty-next">{RECORDS_UNAVAILABLE_WHY}</div>
        </div>
      )}
      {data && data.state !== 'unavailable' && rows.length === 0 && !variant && showEmpty && (
        // Pre-wrap keeps a spelling's stray spaces visible inside its quotes.
        <div className="f-empty-box pn-empty" style={{ whiteSpace: 'pre-wrap' }}>
          {emptyLine(data, filerName)}
        </div>
      )}
      {rows.length > 0 && (
        <div role="table" aria-label={`${spec.title}: ${spelling}`} className="pn-table">
          {!phone && (
            <div role="row" className="f-visually-hidden">
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
      {data?.hasMore && read.changed && (
        <div role="alert" className="f-alert pn-gap">
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="12" r="9" stroke="#c0392b" strokeWidth="2" />
            <path
              d="M12 7.5 V13 M12 16 V16.5"
              stroke="#c0392b"
              strokeWidth="2.2"
              strokeLinecap="round"
            />
          </svg>
          <div>
            {RELEASE_CHANGED}
            <div className="f-alert-action">
              <button
                type="button"
                className="f-btn f-btn-secondary f-btn-small"
                aria-disabled={read.pending || undefined}
                onClick={() => !read.pending && read.retry()}
              >
                {read.pending && <span className="f-spinner" aria-hidden="true" />}
                Reload the records
              </button>
            </div>
          </div>
        </div>
      )}
      {data?.hasMore && !read.changed && (
        <div className="pn-more">
          {read.moreFailed ? (
            <Refused onRetry={read.more} retrying={read.loadingMore}>
              We couldn’t load more payments
            </Refused>
          ) : (
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
          )}
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
