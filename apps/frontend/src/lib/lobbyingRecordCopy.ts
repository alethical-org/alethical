import type {
  LobbyingContributionYear,
  LobbyingPrincipalLobbyist,
  LobbyingSpendingRow,
} from './lobbyingTypes';
import { registrationNumberFromSlug } from './committeeMoneyShared';

export { lobbyingNoSpendingRows } from './lobbyingDirectoryCopy';

export const PRINCIPAL_SOURCE_URL =
  'https://cfb.mn.gov/reports-and-data/viewers/lobbying/lobbying-organizations/';
export const LOBBYIST_SOURCE_URL =
  'https://cfb.mn.gov/reports-and-data/viewers/lobbying/lobbyists/';

export const lobbyingPrincipalCopy = {
  gloss:
    'A principal is a person or organisation that funds lobbying and must report its spending under Minnesota law.',
  spendingHeading: 'Lobbying spending reported to the Board, by year',
  spendingIntroduction:
    'Each row shows this principal’s reported lobbying spending for one calendar year. Reports are due the following March. Every figure, including the total, comes from the Board.',
  spendingZeroNote:
    'A shown $0 is a filed value. “Not reported” means the Board’s file leaves the value blank.',
  spendingCaption: 'Reported lobbying spending by year',
  oldKindsWide: 'Not broken out by these kinds before 2024',
  oldKindsPhone:
    'Not broken out by legislative, administrative or metropolitan lobbying before 2024',
  kindsNote:
    "PUC is the Public Utilities Commission; metropolitan is lobbying of a metropolitan governmental unit, the Board's own category",
  lobbyistsHeading: 'Lobbyists listed for this principal',
  lobbyistsIntroduction:
    'The lobbyist list shows who was registered for this principal on the copy date. It does not show earlier registrations.',
  noLobbyists: 'The lobbyist list names no lobbyist for this principal on the copy date.',
  sourceLabel: "View the Board's Lobbying Organizations Search Tool",
} as const;

export const lobbyingLobbyistCopy = {
  principalsHeading: 'Organisations represented',
  principalsIntroduction:
    'The lobbyist list shows which organisations this lobbyist represented on the copy date. It does not show past clients.',
  noPrincipals: 'The lobbyist list names no organisation for this lobbyist on the copy date.',
  donationsHeading: 'Campaign donations filed under this registration number',
  donationsIntroduction:
    "Campaign donations are separate from lobbying spending and from the organisations represented above. They are found by registration number, never by name. Each row is the receiving committee's own filing, and committees file on different calendars, so no total is drawn across them.",
  noDonations: "The state's contribution file names no donation under this registration number.",
  sourceLabel: "View the Board's Lobbyist Search Tool",
} as const;

export const LOBBYING_RECORD_REVEAL_STEP = 5;
export const LOBBYING_NO_SPENDING_PAGE = 'No spending page available';
export const LOBBYING_RECORD_LOADING = 'Loading lobbying record';
export const LOBBYING_RECORD_UNAVAILABLE =
  "We couldn't load the Board's lobbying record just now. This says nothing about what was reported.";
export const PRINCIPAL_LOBBYISTS_UNAVAILABLE =
  "We couldn't load the Board's lobbyist list. This does not mean nobody was listed for this principal.";
export const LOBBYIST_PRINCIPALS_UNAVAILABLE =
  "We couldn't load the Board's lobbyist list. This does not mean no organisation was listed for this lobbyist.";
export const LOBBYIST_DONATIONS_UNAVAILABLE =
  "We couldn't load the state's campaign contribution file. This does not mean no donation was filed under this registration number.";
export const PRINCIPAL_SPENDING_UNAVAILABLE =
  "We couldn't load this principal's spending rows. This says nothing about what was reported.";
export const CAMPAIGN_CONTRIBUTION_COPY_LABEL = 'Campaign contribution file copied';
export const CAMPAIGN_CONTRIBUTION_SOURCE_LABEL = "View the Board's campaign contribution file";

export function lobbyingRevealLabel(remaining: number, one: string, many: string): string {
  const next = Math.min(LOBBYING_RECORD_REVEAL_STEP, remaining);
  return `Show ${next.toLocaleString('en-US')} more ${next === 1 ? one : many}`;
}

export function lobbyingMissingSpendingPagesNote(year: number | null): string {
  const through = year == null ? '' : ` through ${year}`;
  return `Some organisations have no spending page because the Board's spending file has no rows for them${through}.`;
}

export function lobbyingRecordNotFound(identifier?: string | null): string {
  return identifier
    ? `No lobbying record was found for ${identifier}.`
    : 'That lobbying record address is incomplete.';
}

/** Only the final run of numerals identifies a lobbying record. */
export function lobbyingRecordNumberFromSlug(slug: string): string | null {
  const value = registrationNumberFromSlug(slug);
  return value && Number.isSafeInteger(Number(value)) && Number(value) > 0 ? value : null;
}

/** A readable address with the stable state identifier at its end. */
export function lobbyingRecordSlug(
  name: string | null | undefined,
  identifier: string | number,
): string {
  const namePart = (name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return namePart ? `${namePart}-${identifier}` : String(identifier);
}

export function boardFilesCopiedLine(copiedAt: string | null, dateLabel: (date: string) => string) {
  return copiedAt ? `Lobbying records copied ${dateLabel(copiedAt)}` : null;
}

export function campaignContributionCopiedLine(
  copiedAt: string | null,
  dateLabel: (date: string) => string,
): string | null {
  return copiedAt ? `${CAMPAIGN_CONTRIBUTION_COPY_LABEL} ${dateLabel(copiedAt)}` : null;
}

export function principalSpellingLines(rows: readonly LobbyingPrincipalLobbyist[]): string[] {
  return [
    ...new Set(
      rows
        .filter((row) => row.principal_name_differs)
        .map((row) => row.principal_name_as_listed.trim())
        .filter(Boolean),
    ),
  ].map((name) => `Registered as ${name} in the lobbyist list`);
}

export function recordCountLine(total: number, shown: number, one: string, many: string): string {
  const totalLabel = total.toLocaleString('en-US');
  const unit = total === 1 ? one : many;
  return shown < total
    ? `${totalLabel} ${unit} · showing ${shown.toLocaleString('en-US')}`
    : `${totalLabel} ${unit}`;
}

export function spendingRowIsBlank(row: LobbyingSpendingRow): boolean {
  return [
    row.total_spent,
    row.puc_lobbying_amount,
    row.general_lobbying_amount,
    row.legislative_lobbying_amount,
    row.administrative_lobbying_amount,
    row.mgu_lobbying_amount,
  ].every((value) => value === null);
}

/** A filed zero is a value and therefore reveals the full five-kind breakdown. */
export function spendingRowHasFullKinds(row: LobbyingSpendingRow): boolean {
  return (
    (row.year !== null && row.year >= 2024) ||
    [
      row.legislative_lobbying_amount,
      row.administrative_lobbying_amount,
      row.mgu_lobbying_amount,
    ].some((value) => value !== null)
  );
}

/** Keep the year and committee groups while revealing at most `limit` payment rows. */
export function visibleLobbyingDonationYears(
  years: readonly LobbyingContributionYear[],
  limit: number,
): LobbyingContributionYear[] {
  let remaining = limit;
  const visible: LobbyingContributionYear[] = [];
  for (const year of years) {
    if (remaining <= 0) break;
    const committees = [];
    for (const committee of year.committees) {
      if (remaining <= 0) break;
      const payments = committee.payments.slice(0, remaining);
      if (payments.length > 0) {
        committees.push({ ...committee, payments, payment_count: payments.length });
        remaining -= payments.length;
      }
    }
    if (committees.length > 0) {
      visible.push({
        ...year,
        committees,
        payment_count: committees.reduce((sum, committee) => sum + committee.payments.length, 0),
        committee_count: committees.length,
      });
    }
  }
  return visible;
}
