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
  gloss: "The Board's word for an organisation that pays for lobbying is principal",
  spendingHeading: 'Lobbying spending reported to the Board, by year',
  spendingIntroduction:
    "Each row is one calendar year as this principal reported it, with reports due the following March. Every figure is the Board's own, including the total",
  spendingCaption: 'Reported lobbying spending by year',
  oldKindsWide: 'Not broken out by these kinds before 2024',
  oldKindsPhone:
    'Not broken out by legislative, administrative or metropolitan lobbying before 2024',
  kindsNote:
    "PUC is the Public Utilities Commission; metropolitan is lobbying of a metropolitan governmental unit, the Board's own category",
  lobbyistsHeading: 'Registered to lobby for this principal today',
  lobbyistsIntroduction:
    "The Board's list of active lobbyists is current only. It names who is registered today, not who was registered in the years above.",
  noLobbyists: "The Board's current list names no lobbyist for this principal.",
  sourceLabel: "The Board's Lobbying Organizations Search Tool",
} as const;

export const lobbyingLobbyistCopy = {
  principalsHeading: 'Represents today',
  principalsIntroduction:
    "The Board's list of active lobbyists is current only. It names who this lobbyist is registered for today and holds no past clients.",
  noPrincipals: "The Board's current list names no principal for this lobbyist.",
  donationsHeading: 'Donations filed under this registration number',
  donationsIntroduction:
    "Found by registration number, never by name. Each row is the receiving committee's own filing, and committees file on different calendars, so no total is drawn across them.",
  noDonations: "The state's contribution file names no donation under this registration number.",
  sourceLabel: "The Board's Lobbyist Search Tool",
} as const;

export const SHOW_NEXT_30 = 'Show the next 30';
export const LOBBYING_RECORD_LOADING = 'Loading lobbying record';
export const LOBBYING_RECORD_UNAVAILABLE =
  "We couldn't load the Board's lobbying record just now. This says nothing about what was reported.";
export const PRINCIPAL_LOBBYISTS_UNAVAILABLE =
  "We couldn't load the Board's current lobbyist list. This does not mean nobody is registered for this principal.";
export const LOBBYIST_PRINCIPALS_UNAVAILABLE =
  "We couldn't load the Board's current principal list. This does not mean this lobbyist represents nobody today.";
export const LOBBYIST_DONATIONS_UNAVAILABLE =
  "We couldn't load the state's campaign contribution file. This does not mean no donation was filed under this registration number.";
export const PRINCIPAL_SPENDING_UNAVAILABLE =
  "We couldn't load this principal's spending rows. This says nothing about what was reported.";
export const CAMPAIGN_CONTRIBUTION_COPY_LABEL = 'Campaign contribution file copied';
export const CAMPAIGN_CONTRIBUTION_SOURCE_LABEL = "The Board's campaign contribution file";

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
  return copiedAt ? `Board files copied ${dateLabel(copiedAt)}` : null;
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
