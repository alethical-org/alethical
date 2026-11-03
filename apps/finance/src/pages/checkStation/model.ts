import { connectionLabel, day, fieldLabel, fieldOfKind, serverKind } from '../media/shared';
import type { Connection, Fact, FileDetail, TargetPreview } from '../media/types';

export type Mode = 'fact' | 'connection';

export interface FactEntries {
  field: string;
  value: string;
  page: string;
  quote: string;
  evidence: string;
  confirmed: boolean;
  role: string;
  orgName: string;
  qualifier: string;
  agencyAddress: boolean;
  detailsOpen: boolean;
  /** The id of the fact this entry corrects. */
  correcting: string | null;
}

export interface TargetResult {
  id: string;
  name: string;
  line: string;
}

export interface ConnectionEntries {
  type: string;
  role: string;
  query: string;
  results: TargetResult[] | null;
  target: TargetResult | null;
  preview: TargetPreview | null;
  /** What the preview was read for: type, record, role, file and version. */
  previewKey: string;
  moneyChecked: boolean;
  page: string;
  quote: string;
  evidence: string;
  confirmed: boolean;
}

/** One draft per exact file and version; each mode keeps its own entries. */
export interface Draft {
  mode: Mode;
  fact: FactEntries;
  connection: ConnectionEntries;
}

export function blankFact(page = '1'): FactEntries {
  return {
    field: '',
    value: '',
    page,
    quote: '',
    evidence: '',
    confirmed: false,
    role: '',
    orgName: '',
    qualifier: '',
    agencyAddress: false,
    detailsOpen: false,
    correcting: null,
  };
}
export function blankConnection(page = '1'): ConnectionEntries {
  return {
    type: '',
    role: '',
    query: '',
    results: null,
    target: null,
    preview: null,
    previewKey: '',
    moneyChecked: false,
    page,
    quote: '',
    evidence: '',
    confirmed: false,
  };
}
export function blankDraft(page = '1'): Draft {
  return { mode: 'fact', fact: blankFact(page), connection: blankConnection(page) };
}

/** The drafts store's key: the exact station key and source file id, then the version. */
export function draftKey(fileKey: string, version: string): string {
  return `station-check:${fileKey}|${version}`;
}

/** Whether a draft holds anything the reader typed or chose. */
export function hasEntries(draft: Draft | null | undefined): boolean {
  if (!draft) return false;
  const f = draft.fact;
  const c = draft.connection;
  return !!(
    f.value ||
    f.quote ||
    f.evidence ||
    f.orgName ||
    f.correcting ||
    c.target ||
    c.query ||
    c.quote ||
    c.evidence
  );
}

/** Connection types this page can check today: each needs a way to find its record. */
export const SEARCHABLE_TYPES = ['committee', 'principal', 'issue', 'related_document'] as const;
export const ROLE_TYPES = ['committee', 'candidate', 'principal'];

export function previewKey(
  entries: Pick<ConnectionEntries, 'type' | 'role' | 'target'>,
  fileKey: string,
  version: string,
): string {
  return JSON.stringify([
    entries.type,
    entries.target?.id ?? '',
    entries.role.trim(),
    fileKey,
    version,
  ]);
}

/** Office and district are confirmed only for a record that names them (Round 44). */
export function hasMoneyContext(preview: TargetPreview | null): boolean {
  return !!preview?.fields.some((field) => field.label === 'Money context');
}

const letters = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, '');

function pageError(page: string, pages: number): string {
  const ok = /^\d+$/.test(page) && Number(page) >= 1 && Number(page) <= pages;
  if (ok) return '';
  return pages === 1 ? 'This version has 1 page' : `This version has ${pages} pages`;
}

/** The page's machine-read text, or null when that page has none. */
export function pageText(file: FileDetail, page: number): string | null {
  const text = file.pages.find((p) => p.number === page)?.text;
  return text && text.trim() ? text : null;
}

/** Field refusals before a save, in the drawing's order and words (Review 1.4;
 * Current decisions, 30 Oct 2026). The server checks every rule again. */
export function validate(draft: Draft, file: FileDetail, fileKey: string): Record<string, string> {
  const errors: Record<string, string> = {};
  const fact = draft.mode === 'fact';
  const entries = fact ? draft.fact : draft.connection;
  if (fact && !draft.fact.field) errors.kind = 'Choose the fact this value shows';
  if (!fact && !draft.connection.type) errors.type = 'Choose the connection this page shows';
  if (fact && !draft.fact.value.trim()) errors.value = 'Enter the value as printed';
  const page = entries.page.trim();
  const pages = Math.max(1, file.page_count);
  const badPage = pageError(page, pages);
  if (badPage) errors.page = badPage;
  const quote = entries.quote.trim();
  if (!quote) errors.quote = 'Copy the line from the page that shows this value';
  else if (!badPage) {
    const text = pageText(file, Number(page));
    if (!text)
      errors.page =
        'Machine-read text is not available for this page. Your draft is kept; choose a page with text before saving.';
    else if (!text.includes(quote))
      errors.quote = `This line isn’t in page ${page}’s machine-read text`;
  }
  const quoteOk = !!quote && !errors.quote && !errors.page;
  if (fact) {
    const f = draft.fact;
    if (
      quoteOk &&
      f.value.trim() &&
      !/\d/.test(f.value) &&
      !letters(quote).includes(letters(f.value))
    )
      errors.value = 'The quote doesn’t show this value';
    const needRole = f.field === 'organization_address' || f.field === 'officer_name';
    if (needRole && !f.role.trim()) errors.role = 'Enter the role as printed';
    else if (f.role.trim() && quoteOk && !letters(quote).includes(letters(f.role)))
      errors.role = 'The quote doesn’t show this role';
    if (f.field === 'organization_address') {
      if (!f.orgName.trim()) errors.org = 'Enter the organization name as printed';
      else if (quoteOk && !letters(quote).includes(letters(f.orgName)))
        errors.org = 'The quote doesn’t show this name';
    }
  } else {
    const c = draft.connection;
    if (!c.target || !c.preview || c.previewKey !== previewKey(c, fileKey, file.version_id))
      errors.target = 'Preview a record before saving';
    else if (hasMoneyContext(c.preview) && !c.moneyChecked)
      errors.money = 'Check the office and district first';
  }
  if (!entries.evidence.trim()) errors.evidence = 'Say what on the page supports this';
  if (!entries.confirmed) errors.confirm = 'Check the page image first';
  return errors;
}

/** The field a server refusal belongs to, with the drawing's words for it, or
 * null when no field's words fit (the save shows "Not saved" instead). */
export function refusalField(
  detail: string,
  draft: Draft,
  pages: number,
): { field: string; message: string } | 'stale' | 'changed' | null {
  const page = (draft.mode === 'fact' ? draft.fact : draft.connection).page.trim();
  if (detail === 'Unsupported checked field')
    return { field: 'kind', message: 'Choose the fact this value shows' };
  if (detail.startsWith('Value must be nonblank'))
    return { field: 'value', message: 'Enter the value as printed' };
  if (detail === 'Choose an exact source page')
    return {
      field: 'page',
      message: pages === 1 ? 'This version has 1 page' : `This version has ${pages} pages`,
    };
  if (detail.startsWith('Quotation must appear'))
    return { field: 'quote', message: `This line isn’t in page ${page}’s machine-read text` };
  if (detail.startsWith('Source quotation'))
    return { field: 'quote', message: 'Copy the line from the page that shows this value' };
  if (
    detail === 'Value must be explicitly supported by the quotation' ||
    detail === 'Amount must be explicitly printed in the quotation' ||
    detail === 'Use the amount printed in the quotation'
  )
    return { field: 'value', message: 'The quote doesn’t show this value' };
  if (detail === 'Role must be printed in the quotation')
    return {
      field: draft.mode === 'fact' ? 'role' : 'connRole',
      message: 'The quote doesn’t show this role',
    };
  if (detail === 'This field needs its printed organizational role')
    return { field: 'role', message: 'Enter the role as printed' };
  if (detail === 'Organization name must be printed in the quotation')
    return { field: 'org', message: 'The quote doesn’t show this name' };
  if (detail === 'Organization address needs its exact printed organization name')
    return { field: 'org', message: 'Enter the organization name as printed' };
  if (detail.startsWith('Review evidence'))
    return { field: 'evidence', message: 'Say what on the page supports this' };
  if (detail === 'An explicit correctness review is required')
    return { field: 'confirm', message: 'Check the page image first' };
  if (detail === 'Review the exact campaign-money office and district')
    return { field: 'money', message: 'Check the office and district first' };
  if (detail.startsWith('Correction must replace')) return 'stale';
  if (detail.startsWith('Target changed or was not previewed')) return 'changed';
  return null;
}

const same = (a: string | null | undefined, b: string | null | undefined) =>
  (a ?? '').replace(/\s+/g, ' ').trim() === (b ?? '').replace(/\s+/g, ' ').trim();

/** A current check on this version that says exactly what the form says; the
 * check being corrected is never its own duplicate (Round 22; Round 35 wording). */
export function findDuplicate(draft: Draft, file: FileDetail): Fact | Connection | null {
  if (draft.mode === 'fact') {
    const f = draft.fact;
    return (
      currentFacts(file).find(
        (fact) =>
          fact.id !== f.correcting &&
          fact.kind === serverKind(f.field) &&
          same(fact.value, f.value) &&
          String(fact.page ?? '') === f.page.trim() &&
          same(fact.quote, f.quote) &&
          same(fact.role, f.role) &&
          same(fact.qualifier, f.qualifier),
      ) ?? null
    );
  }
  const c = draft.connection;
  return (
    currentConnections(file).find(
      (connection) =>
        connection.kind === c.type &&
        (connection.target
          ? connection.target.id === c.target?.id
          : same(connection.label, c.preview?.label)) &&
        String(connection.page ?? '') === c.page.trim() &&
        same(connection.quote, c.quote),
    ) ?? null
  );
}

export function currentFacts(file: FileDetail): Fact[] {
  return [...file.facts, ...file.dates].filter(
    (fact) => fact.status === 'checked' && fact.version_id === file.version_id,
  );
}
export function currentConnections(file: FileDetail): Connection[] {
  return file.connections.filter(
    (connection) => connection.status === 'checked' && connection.version_id === file.version_id,
  );
}

export interface CheckRow {
  id: string;
  kind: 'fact' | 'connection';
  label: string;
  value: string;
  meta: string;
  item: Fact | Connection;
}
export function checkRows(file: FileDetail): CheckRow[] {
  return [
    ...currentFacts(file).map((fact) => ({
      id: fact.id,
      kind: 'fact' as const,
      label: fact.kind,
      value: fact.value ?? '',
      meta: `Page ${fact.page ?? 'Unavailable'} · Checked on ${day(fact.checked_at)}${fact.role ? ` · Role: ${fact.role}` : ''}`,
      item: fact,
    })),
    ...currentConnections(file).map((connection) => ({
      id: connection.id,
      kind: 'connection' as const,
      label: connectionLabel(connection.kind),
      value: connection.label ?? '',
      meta: `Page ${connection.page ?? 'Unavailable'} · Checked on ${day(connection.checked_at)}${connection.role ? ` · Role: ${connection.role}` : ''}`,
      item: connection,
    })),
  ];
}

/** Earlier checks on this version: corrected values and withdrawn checks. A fact
 * replaced by a correction is listed once, as corrected. */
export function historyRows(
  file: FileDetail,
): { key: string; label: string; value: string; meta: string }[] {
  const facts = [...file.facts, ...file.dates].filter(
    (fact) => fact.version_id === file.version_id,
  );
  const current = facts.filter((fact) => fact.status === 'checked');
  const corrections = current.flatMap((fact) =>
    (fact.history ?? []).map((old) => ({ kind: fact.kind, old })),
  );
  const rows = corrections.map(({ kind, old }, index) => ({
    key: `c${index}`,
    label: kind,
    value: old.value,
    meta: `Corrected · ${day(old.corrected_at)}`,
  }));
  for (const fact of facts) {
    if (fact.status !== 'withdrawn') continue;
    if (
      corrections.some(
        ({ kind, old }) => kind === fact.kind && old.corrected_at === fact.withdrawn_at,
      )
    )
      continue;
    rows.push({
      key: fact.id,
      label: fact.kind,
      value: '',
      meta: `Withdrawn · ${day(fact.withdrawn_at)}`,
    });
  }
  for (const connection of file.connections) {
    if (connection.version_id !== file.version_id || connection.status !== 'withdrawn') continue;
    rows.push({
      key: connection.id,
      label: connectionLabel(connection.kind),
      value: '',
      meta: `Withdrawn · ${day(connection.withdrawn_at)}`,
    });
  }
  return rows;
}

/** A correction's starting entries: the fact's field, page, quote and role, an
 * empty value (Review 1.5). */
export function correctionOf(fact: Fact): FactEntries {
  return {
    ...blankFact(String(fact.page ?? 1)),
    field: fieldOfKind(fact.kind),
    quote: fact.quote ?? '',
    role: fact.role ?? '',
    correcting: fact.id,
  };
}

/** The save's request body: only what the reader entered, never a flag the
 * server reads as published. */
export function factBody(f: FactEntries) {
  const text = (value: string) => (value.trim() ? value.trim() : undefined);
  return {
    field: f.field,
    value: f.value.trim(),
    page: Number(f.page.trim()),
    quote: f.quote.trim(),
    evidence: f.evidence.trim(),
    correctness_reviewed: true,
    role: text(f.role),
    qualifier: text(f.qualifier),
    organization_name: f.field === 'organization_address' ? text(f.orgName) : undefined,
    agency_address_reviewed: f.field === 'organization_address' ? f.agencyAddress : undefined,
    supersedes_id: f.correcting ?? undefined,
  };
}
export function connectionBody(c: ConnectionEntries) {
  return {
    kind: c.type,
    target_id: c.target?.id ?? '',
    page: Number(c.page.trim()),
    quote: c.quote.trim(),
    evidence: c.evidence.trim(),
    correctness_reviewed: true,
    expected_target_fingerprint: c.preview?.target_fingerprint,
    role: ROLE_TYPES.includes(c.type) && c.role.trim() ? c.role.trim() : undefined,
    money_context_reviewed: hasMoneyContext(c.preview) ? c.moneyChecked : undefined,
  };
}

export { fieldLabel };
