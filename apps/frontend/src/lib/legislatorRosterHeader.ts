import type { Legislator } from '../data/types';

export type LegislatorPartyFilter = 'All' | 'DFL' | 'R' | 'I';
type LegislatorRosterChamber = 'All' | 'House' | 'Senate';

export const LEGISLATOR_SEAT_SOURCE_URL = 'https://www.leg.mn.gov/leg/faq/faq?id=15';
export const LEGISLATOR_SEAT_SOURCE_TEXT = 'Minnesota has 201 seats.';
export const LEGISLATOR_ROSTER_NOTE_TEXT = 'Vacant seats aren’t listed.';

type RosterOfficeholder = Pick<Legislator, 'chamber' | 'party'>;

type LegislatorRosterHeaderFilters = {
  chamber: LegislatorRosterChamber;
  party: LegislatorPartyFilter;
  query: string;
  queryInput: string;
  sessionSlug: string;
  currentSessionSlug: string | undefined;
  rosterLoaded: boolean;
};

export function deriveLegislatorRosterHeader<T extends RosterOfficeholder>(
  officeholders: readonly T[],
  filters: LegislatorRosterHeaderFilters,
) {
  const partyOfficeholders = officeholders.filter(
    (officeholder) => filters.party === 'All' || officeholder.party === filters.party,
  );
  const chamberCounts: Record<LegislatorRosterChamber, number> = {
    All: partyOfficeholders.length,
    House: partyOfficeholders.filter((officeholder) => officeholder.chamber === 'House').length,
    Senate: partyOfficeholders.filter((officeholder) => officeholder.chamber === 'Senate').length,
  };
  const displayedOfficeholders = partyOfficeholders.filter(
    (officeholder) => filters.chamber === 'All' || officeholder.chamber === filters.chamber,
  );
  const displayedCount = displayedOfficeholders.length;
  const unnarrowed =
    filters.rosterLoaded &&
    displayedCount > 0 &&
    filters.query.trim() === '' &&
    filters.queryInput.trim() === '' &&
    filters.chamber === 'All' &&
    filters.party === 'All' &&
    Boolean(filters.currentSessionSlug) &&
    filters.sessionSlug === filters.currentSessionSlug &&
    displayedCount === officeholders.length;

  return { chamberCounts, displayedOfficeholders, displayedCount, unnarrowed };
}
