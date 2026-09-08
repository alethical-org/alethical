import { describe, expect, it } from 'vitest';

import { mapLegislator } from '../../data/api';
import { currentDistrictLine, legislatorDisplayName, servesNow } from '../legislatorProfile';
import { legislatorPageMetadata } from '../share';
import { partyFull } from '../billDetail';

/**
 * A member who has resigned, died or lost a seat has no current service period,
 * and the API omits `current_service` rather than emptying its fields. Nothing
 * in that record says which chamber the person sits in, for which district, for
 * which party, or on which committees — so nothing the app draws may say it.
 *
 * The mapper used to answer all 3 questions anyway: any chamber that was not
 * the word `house` became `Senate`, an absent party fell through to `DFL`, and
 * an absent district became the literal word `Unknown`. The loaded profile drew
 * `Sen. Joe Schomacker` above `Senate District Unknown` and
 * `Democratic-Farmer-Labor`, over 3 committees he had left, and rewrote the
 * browser tab to match — about a second after the served page had said only
 * `Joe Schomacker` (#2061, the loaded-screen half of #1461).
 *
 * Measured against production 8 Sep 2026: 206 stored legislators, 6 of them
 * with no current service period for `94-2025-regular` —
 * `bruce-douglas-anderson`, `justin-d-eichorn`, `kaohly-vang-her`,
 * `melissa-hortman`, `nicole-mitchell` and `joe-schomacker`, the last the only
 * one carrying committee rows (3). The other 200 are the sitting roster and
 * every one stores both a chamber (`house` or `senate`) and a party (`DFL` or
 * `R`), so no sitting member's page depended on any of the 3 guesses.
 *
 * `.claude/rules/grounded-answers.md` rule 12's missing-versus-zero rule,
 * applied to an office instead of an amount.
 */

/** A detail payload for a member with no current service period. */
const FORMER = {
  id: 'aa000000-0000-0000-0000-000000000001',
  slug: 'joe-schomacker',
  full_name: 'Joe Schomacker',
  current_service: null,
  // Assignments from the sitting he left arrive on their own key, outside
  // `current_service`, so they survive the seat unless something drops them.
  committees: [
    { name: 'Health Finance and Policy', role: null },
    { name: 'Human Services Finance and Policy', role: 'CO-CHAIR' },
    { name: 'Ways and Means', role: null },
  ],
  stats: { total_bill_count: 41, chief_bill_count: 12, committee_count: 3 },
  service_history: {
    term: 8,
    periods: [{ chamber: 'house', initial_year: 2011, reelection_years: [2012, 2014] }],
  },
};

/** A sitting member, chamber and party exactly as production stores them. */
function sitting(chamber: 'house' | 'senate', party: 'DFL' | 'R', district: string) {
  return {
    id: 'bb000000-0000-0000-0000-000000000002',
    slug: 'patty-acomb',
    full_name: 'Patty Acomb',
    current_service: {
      chamber,
      party,
      district: { code: district },
      email: 'rep.patty.acomb@house.mn.gov',
      phone: '651-296-9934',
      office_address: '509 State Office Building',
      represented_city: 'Minnetonka',
      profile_url: 'https://www.house.mn.gov/members/profile/15544',
      photo_url: 'https://www.house.mn.gov/members/photo/15544.jpg',
    },
    committees: [{ name: 'Climate and Energy Finance and Policy', role: 'CHAIR' }],
    stats: { total_bill_count: 30, chief_bill_count: 9, committee_count: 4 },
    service_history: {
      term: 4,
      periods: [{ chamber, initial_year: 2019, reelection_years: [2020, 2022] }],
    },
  };
}

describe('a legislator with no current service period', () => {
  it('reaches the mapped record with no chamber, district or party', () => {
    const mapped = mapLegislator(FORMER as never);

    expect(mapped.chamber).toBeUndefined();
    expect(mapped.district).toBeUndefined();
    expect(mapped.party).toBeUndefined();
    // The exact 3 strings the guesses used to produce.
    expect(mapped.chamber).not.toBe('Senate');
    expect(mapped.district).not.toBe('Unknown');
    expect(mapped.party).not.toBe('DFL');
  });

  it('reaches the mapped record with no committee list and no contact details', () => {
    const mapped = mapLegislator(FORMER as never);

    expect(mapped.committees).toEqual([]);
    expect(mapped.committeeAssignments).toEqual([]);
    expect(mapped.email).toBeUndefined();
    expect(mapped.phone).toBeUndefined();
    expect(mapped.officeAddress).toBeUndefined();
    expect(mapped.profileUrl).toBeUndefined();
    expect(mapped.representedCity).toBeUndefined();
    // A count of seats held now is the same claim as the list of them.
    expect(mapped.focusAreas).not.toContain('3 committees');
    expect(mapped.focusAreas).toEqual(['41 authored bills']);
  });

  it('keeps the stored name with no Sen. or Rep. in front of it', () => {
    const mapped = mapLegislator(FORMER as never);

    expect(mapped.name).toBe('Joe Schomacker');
    expect(legislatorDisplayName(mapped.name, mapped.chamber)).toBe('Joe Schomacker');
    expect(legislatorDisplayName(mapped.name, mapped.chamber)).not.toContain('Sen.');
    expect(legislatorDisplayName(mapped.name, mapped.chamber)).not.toContain('Rep.');
    expect(servesNow(mapped.chamber)).toBe(false);
  });

  it('draws no seat line, so nothing says Senate District Unknown', () => {
    const mapped = mapLegislator(FORMER as never);

    expect(currentDistrictLine(mapped)).toBe('');
  });

  it('leaves the browser tab title and the share text free of a guessed seat', () => {
    const mapped = mapLegislator(FORMER as never);
    const meta = legislatorPageMetadata({
      slug: mapped.slug ?? mapped.id,
      displayName: legislatorDisplayName(mapped.name, mapped.chamber),
      districtLine: currentDistrictLine(mapped),
    });

    expect(meta.title).toBe('Joe Schomacker | Alethical');
    expect(meta.socialTitle).toBe('Joe Schomacker');
    expect(meta.title).not.toContain('Senate');
    expect(meta.title).not.toContain('District');
    expect(meta.title).not.toContain('Unknown');
    expect(meta.socialTitle).not.toContain('Sen.');
  });

  it('keeps what the person DID, because those records are not current claims', () => {
    const mapped = mapLegislator(FORMER as never);

    expect(mapped.totalAuthoredBills).toBe(41);
    expect(mapped.chiefAuthoredBills).toBe(12);
    expect(mapped.legislativeService?.lines[0]?.label).toBe('Elected to the House');
    expect(mapped.legislativeService?.term).toBe('8th');
  });
});

describe('a sitting member whose record names no party', () => {
  it('gets no party rather than the DFL the mapper used to fall through to', () => {
    // Production stores `DFL` or `R` on all 200 sitting members, so this is the
    // second line of defence rather than a live case: the party column is
    // nullable, and the mapper's catch-all would have labelled a blank one DFL.
    const noParty = sitting('house', 'R', '21B');
    const mapped = mapLegislator({
      ...noParty,
      current_service: { ...noParty.current_service, party: null },
    } as never);

    expect(mapped.chamber).toBe('House');
    expect(mapped.district).toBe('21B');
    expect(mapped.party).toBeUndefined();
  });
});

describe('a sitting member keeps every one of those facts', () => {
  it.each([
    ['House', 'house', 'R', '21B'],
    ['Senate', 'senate', 'DFL', '61'],
  ] as const)('a sitting %s member', (chamberWord, chamberSlug, party, district) => {
    const mapped = mapLegislator(sitting(chamberSlug, party, district) as never);

    expect(mapped.chamber).toBe(chamberWord);
    expect(mapped.district).toBe(district);
    expect(mapped.party).toBe(party);
    expect(servesNow(mapped.chamber)).toBe(true);
    expect(currentDistrictLine(mapped)).toBe(`${chamberWord} District ${district}`);
    expect(partyFull(mapped.party)).toBe(party === 'R' ? 'Republican' : 'Democratic-Farmer-Labor');
    expect(legislatorDisplayName(mapped.name, mapped.chamber)).toBe(
      `${chamberWord === 'Senate' ? 'Sen.' : 'Rep.'} Patty Acomb`,
    );
    expect(mapped.committees).toEqual(['Climate and Energy Finance and Policy (CHAIR)']);
    expect(mapped.committeeAssignments).toEqual([
      { name: 'Climate and Energy Finance and Policy', role: 'CHAIR' },
    ]);
    expect(mapped.phone).toBe('651-296-9934');
    expect(mapped.officeAddress).toBe('509 State Office Building');
    expect(mapped.profileUrl).toBe('https://www.house.mn.gov/members/profile/15544');
    expect(mapped.focusAreas).toEqual(['30 authored bills', '4 committees']);

    const meta = legislatorPageMetadata({
      slug: mapped.slug ?? mapped.id,
      displayName: legislatorDisplayName(mapped.name, mapped.chamber),
      districtLine: currentDistrictLine(mapped),
    });
    expect(meta.title).toBe(
      `${chamberWord === 'Senate' ? 'Sen.' : 'Rep.'} Patty Acomb, Minnesota ${chamberWord} District ${district} | Alethical`,
    );
  });
});
