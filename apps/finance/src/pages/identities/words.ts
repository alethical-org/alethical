import { PAYMENT_FILE_LABELS } from '@alethical/shared/paymentCopyDates';
import { formatDay, formatMoney } from '@alethical/shared/moneyFormat';
import { formatCount } from '@alethical/shared/moneyLanding';
import type { Confirmation, Fields, IdentityKind, PrintedKind, QueueRow } from './types';

export const PRINTED_KINDS: PrintedKind[] = [
  'donor_name',
  'employer_name',
  'payee_name',
  'independent_payee_name',
];

export function isPrintedKind(value: string | null | undefined): value is PrintedKind {
  return PRINTED_KINDS.includes(value as PrintedKind);
}

/** The kinds a role word from another page's address may mean, in the order tried. */
export function kindsForRole(role: string | null | undefined): PrintedKind[] {
  if (isPrintedKind(role)) return [role];
  if (role === 'donor') return ['donor_name'];
  if (role === 'employer') return ['employer_name'];
  if (role === 'payee') return ['payee_name', 'independent_payee_name'];
  return PRINTED_KINDS;
}

export function kindWord(kind: PrintedKind): 'donor' | 'employer' | 'payee' {
  return kind === 'donor_name' ? 'donor' : kind === 'employer_name' ? 'employer' : 'payee';
}

/** "DONOR NAME AS PRINTED": the eyebrow over the spelling. */
export function eyebrow(kind: PrintedKind): string {
  return `${kindWord(kind).toUpperCase()} NAME AS PRINTED`;
}

/** The relation a confirmation records: the role the name was printed in. */
export function relationOf(kind: PrintedKind): string {
  const word = kindWord(kind);
  return `${word[0].toUpperCase()}${word.slice(1)} name as printed`;
}

/** Each payment file stays its own queue row, so the 2 payee files are told apart. */
export function queueKind(kind: PrintedKind): string {
  if (kind === 'donor_name') return 'Donor name';
  if (kind === 'employer_name') return 'Employer name';
  if (kind === 'independent_payee_name') return 'Payee name · Outside spending';
  return 'Payee name · Campaign payments';
}

export function fileLabel(kind: PrintedKind): string {
  if (kind === 'payee_name') return PAYMENT_FILE_LABELS.expenditures;
  if (kind === 'independent_payee_name') return PAYMENT_FILE_LABELS.independentExpenditures;
  return PAYMENT_FILE_LABELS.contributions;
}

export function evidenceSource(kind: PrintedKind): string {
  if (kind === 'payee_name') return 'cf_expenditure_row';
  if (kind === 'independent_payee_name') return 'cf_independent_expenditure_row';
  return 'cf_contribution_row';
}

export function plural(count: number, one: string, many: string): string {
  return `${formatCount(count)} ${count === 1 ? one : many}`;
}

export function day(value: string | null | undefined): string | null {
  return formatDay(value ?? null);
}

/** The shared money rule (grounded-answers rule 12): a total only when every amount
 * is held and every date or every filing year is held. */
export function queueAmount(row: QueueRow): string {
  if (row.amount_state === 'incomplete_amount') return 'Missing payment amount';
  if (row.amount_state === 'incomplete_period' || !row.period_basis)
    return 'Reporting period incomplete';
  return formatMoney(row.amount) ?? 'Missing payment amount';
}

/** The period a queue total covers, by its basis: dates, or "Filing year(s) …". */
export function queuePeriod(row: QueueRow): string | null {
  if (row.period_basis === 'dates') return period([row.first_date, row.last_date]);
  if (row.period_basis === 'years' && row.first_year !== null && row.last_year !== null)
    return row.first_year === row.last_year
      ? `Filing year ${row.first_year}`
      : `Filing years ${row.first_year}–${row.last_year}`;
  return null;
}

/** "Mar 3, 2022 to Oct 2, 2024", 1 date, or "dates not given". */
export function period(dates: ReadonlyArray<string | null | undefined>): string {
  const known = dates.filter((value): value is string => Boolean(value && formatDay(value))).sort();
  if (known.length === 0) return 'dates not given';
  const first = formatDay(known[0])!;
  const last = formatDay(known[known.length - 1])!;
  return first === last ? first : `${first} to ${last}`;
}

export function recordDate(fields: Fields | null | undefined): string | null {
  const value = fields?.receipt_date ?? fields?.transaction_date ?? null;
  return value === null || value === undefined ? null : String(value);
}

export function recordAmount(fields: Fields | null | undefined): string {
  const value = fields?.amount;
  return (value === null || value === undefined ? null : formatMoney(String(value))) ?? 'Amount not given';
}

export function registrationOf(fields: Fields | null | undefined): string {
  const value = fields?.recipient_reg_num ?? fields?.committee_reg_num ?? fields?.spender_reg_num;
  return value === null || value === undefined ? '' : String(value);
}

/** The source line of a confirmation: the saved file and row, or the official page. */
export function sourceOf(confirmation: Confirmation): string {
  const evidence = confirmation.evidence;
  if (!evidence) return 'Source not recorded';
  if (evidence.url) return evidence.url;
  if (isPrintedKind(confirmation.record_kind)) {
    const file = fileLabel(confirmation.record_kind);
    return evidence.locator ? `${file} · Row ${evidence.locator}` : file;
  }
  return evidence.locator ?? evidence.source;
}

/** The rows a confirmation covers in the Board's current file, and their dates. */
export function coveredRows(confirmation: Confirmation): number {
  return (confirmation.records ?? []).reduce((sum, record) => sum + (record.rows ?? 0), 0);
}

export function coveredDates(confirmation: Confirmation): string[] {
  return (confirmation.records ?? [])
    .map((record) => recordDate(record.fields))
    .filter((value): value is string => value !== null);
}

export const ROLE_LABELS: Record<string, string> = {
  committee: 'Campaign accounts',
  lobbyist: 'Lobbying registration',
  principal: 'Principal registration',
  legislator: 'Legislative service',
  public_person: 'Official IDs',
};

/**
 * The drawn check that evidence names something besides the shared name: the note
 * with the names and filler words removed must keep at least 8 characters.
 */
export function beyondName(note: string, names: ReadonlyArray<string | null | undefined>): boolean {
  let text = note.toLowerCase();
  for (const name of names) {
    if (name) text = text.split(name.toLowerCase()).join(' ');
  }
  const stripped = text
    .replace(
      /\b(same|name|names|named|match|matches|matching|spelling|spelled|printed|as|is|are|the|a|an|and|it|its|of|both|records?)\b/g,
      ' ',
    )
    .replace(/[^a-z0-9]/g, '');
  return stripped.length >= 8;
}

export type Mode = 'confirm' | 'create' | 'withdraw' | 'merge' | 'split';

export interface DraftFields {
  mode: Mode;
  target: string | null;
  newKind: IdentityKind | null;
  ident: string | null;
  pick: string | null;
  newName: string;
  note: string;
  /** Selected fingerprints (confirm, create) or confirmation ids (split). */
  recs: string[];
  /** Selected identifier confirmations moving in a split. */
  roles: string[];
  /** A quick selection: every unconfirmed record, for 1 year or all. */
  quick: { year: number | null } | null;
}

/** 1 draft per spelling | role | action | target | new kind | shown identity | merge target. */
export function draftKey(
  kind: PrintedKind,
  key: string,
  fields: Pick<DraftFields, 'mode' | 'target' | 'newKind' | 'ident' | 'pick'>,
): string {
  return [
    'identities',
    kind,
    key,
    fields.mode,
    fields.target ?? '',
    fields.newKind ?? '',
    fields.ident ?? '',
    fields.pick ?? '',
  ].join('|');
}

export function draftPrefix(kind: PrintedKind, key: string): string {
  return ['identities', kind, key, ''].join('|');
}

export function hasEntries(fields: DraftFields): boolean {
  return Boolean(
    fields.note.trim() ||
      fields.newName.trim() ||
      fields.recs.length ||
      fields.roles.length ||
      fields.quick ||
      fields.pick,
  );
}
