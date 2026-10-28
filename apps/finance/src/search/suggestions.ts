import { registerKindLabel } from '@alethical/shared/committeeMoneyShared';

import { hrefFor, isBuilt, type RouteName } from '../routes';

/** 1 row in the suggestion panel (Search Suggestions drawing). */
export interface Suggestion {
  name: string;
  context: string;
  href: string;
  /** A bill's number, drawn as the amber code tag. */
  code?: string;
}

export type SuggestionKind = 'people' | 'orgs' | 'committees' | 'bills' | 'printed';

export interface SuggestionGroup {
  id: SuggestionKind;
  title: string;
  rows: Suggestion[];
}

const TITLES: Record<SuggestionKind, string> = {
  people: 'People',
  orgs: 'Organizations',
  committees: 'Committees',
  bills: 'Bills',
  printed: 'Payments under a name',
};

const ORDER: SuggestionKind[] = ['people', 'orgs', 'committees', 'bills', 'printed'];

interface MoneyResult {
  kind: string;
  id?: string;
  full_name?: string;
  chamber?: string | null;
  district_code?: string | null;
  name?: string;
  role?: string;
  registration_number?: string | number | null;
  entity_id?: string | number | null;
  filer_kind?: string | null;
}

interface MoneyGroup {
  kind: string;
  state: string;
  results: MoneyResult[];
}

interface BillRow {
  id: string;
  file_type?: string | null;
  file_number?: number | null;
  title?: string | null;
  ai_analysis?: { short_title?: string | null } | null;
  current_status?: string | null;
}

export interface SuggestionsAnswer {
  request_id: string;
  q: string;
  money: { groups?: MoneyGroup[] } | null;
  bills: BillRow[];
}

function seat(chamber: string | null | undefined, district: string | null | undefined): string {
  const name = chamber === 'house' ? 'House' : chamber === 'senate' ? 'Senate' : null;
  if (name && district) return `${name} District ${district}`;
  return name ?? (district ? `District ${district}` : '');
}

function join(...parts: Array<string | null | undefined>): string {
  return parts.filter(Boolean).join(' · ');
}

const ROLE_PARAM: Record<string, string> = { contributor: 'donor', vendor: 'payee' };
const ROLE_CONTEXT: Record<string, string> = {
  contributor: 'Printed donor name',
  vendor: 'Printed payee name',
};

/** "2025–26" from a bill id such as `94-2026-SF4138`: the 2-year Legislature
 * whose session year the id carries. */
export function billSession(id: string): string | null {
  const year = Number(id.split('-')[1]);
  if (!Number.isInteger(year) || year < 1900) return null;
  const first = year % 2 === 1 ? year : year - 1;
  return `${first}–${String(first + 1).slice(-2)}`;
}

const CHAMBERS: Record<string, string> = { HF: 'House', SF: 'Senate' };

function linked(
  route: RouteName,
  params: Record<string, string>,
  query: Record<string, string> = {},
): string | null {
  return isBuilt(route) ? hrefFor(route, params, query) : null;
}

/**
 * Turns the server's grouped answer into the drawing's 5 groups. A result
 * whose page is not built yet is left out rather than linked to a page that
 * answers "not found".
 */
export function suggestionGroups(answer: SuggestionsAnswer): SuggestionGroup[] {
  const rows: Record<SuggestionKind, Suggestion[]> = {
    people: [],
    orgs: [],
    committees: [],
    bills: [],
    printed: [],
  };
  const add = (kind: SuggestionKind, row: Omit<Suggestion, 'href'>, href: string | null) => {
    if (href) rows[kind].push({ ...row, href });
  };
  for (const group of answer.money?.groups ?? []) {
    if (group.state !== 'reported') continue;
    for (const result of group.results) {
      const reg = result.registration_number != null ? String(result.registration_number) : null;
      if (result.kind === 'person' && result.id) {
        add(
          'people',
          {
            name: result.full_name ?? '',
            context: join('Legislator', seat(result.chamber, result.district_code)),
          },
          linked('legislator', { id: result.id }),
        );
      } else if (result.kind === 'lobbyist' && reg) {
        add(
          'people',
          { name: result.name ?? '', context: `Lobbyist · Registration ${reg}` },
          linked('lobbyist', { id: reg }),
        );
      } else if (result.kind === 'principal' && result.entity_id != null) {
        add(
          'orgs',
          { name: result.name ?? '', context: join('Principal', reg && `Registration ${reg}`) },
          linked('principal', { id: String(result.entity_id) }),
        );
      } else if (result.kind === 'committee' && reg) {
        add(
          'committees',
          {
            name: result.name ?? '',
            context: join(registerKindLabel(result.filer_kind), `Registration ${reg}`),
          },
          linked('committee', { id: reg }),
        );
      } else if (result.kind === 'payment_name' && result.name && result.role) {
        const role = ROLE_PARAM[result.role];
        if (!role || !ROLE_CONTEXT[result.role]) continue;
        add(
          'printed',
          { name: result.name, context: ROLE_CONTEXT[result.role] },
          linked('payments-under-name', { query: result.name }, { role }),
        );
      }
    }
  }
  for (const bill of answer.bills ?? []) {
    const code =
      bill.file_type && bill.file_number != null
        ? `${bill.file_type} ${bill.file_number}`
        : undefined;
    add(
      'bills',
      {
        name: bill.ai_analysis?.short_title || code || bill.id,
        context: join(billSession(bill.id), bill.file_type ? CHAMBERS[bill.file_type] : null),
        code,
      },
      linked('bill', { id: bill.id }),
    );
  }
  // 1 printed spelling can be filed as both donor and payee; keep each once per role.
  const seen = new Set<string>();
  rows.printed = rows.printed.filter((row) => {
    const key = row.href;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return ORDER.filter((kind) => rows[kind].length > 0).map((kind) => ({
    id: kind,
    title: TITLES[kind],
    rows: rows[kind].slice(0, 3),
  }));
}

/** Suggestions start at 2 typed characters, as the drawing's field does. */
export const MIN_SUGGEST_LENGTH = 2;

export function searchHref(query: string): string {
  return hrefFor('search', {}, { q: query.trim() });
}
