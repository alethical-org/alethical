// A legislator with no biography must map to NO biography (#872 follow-up).
//
// The mapper used to substitute the sentence "Live legislator profile loaded from
// the backend." whenever `biography` was absent. It maps both payload shapes, and
// the LIST payload has no `biography` key at all — so that sentence became the
// biography of every legislator built from a list item, and the old-design Find My
// Legislator results card printed it verbatim to real users at
// alethical.com/find-my-legislator. The two redesigned profile screens fetch the
// detail payload (which does carry real prose for ~24 of every 25 members) and
// escaped the sentence only by comparing against the literal string, so it had to
// stay spelled identically in three files to keep working.
//
// So the invariant is: absent biography → `undefined`, never prose. Any surface can
// then decide what to render with a plain truthiness check.

import { describe, expect, it } from 'vitest';

import { mapLegislator } from '../api';

// Patty Acomb's real production payload (GET /api/v1/legislators?limit=1, Jul 31
// 2026), trimmed to the fields the mapper reads. `biography` is absent because the
// list endpoint genuinely omits the key — not because it was trimmed here. Her
// detail payload does carry one ("B.S., natural resources, University of
// Minnesota. Married, spouse Craig, 2 children.").
const REAL_PAYLOAD = {
  id: 'db54134f-67d5-4365-a28a-e6921bf91db6',
  slug: 'patty-acomb',
  full_name: 'Patty Acomb',
  current_service: {
    chamber: 'house',
    party: 'DFL',
    district: { id: 'fd58eeed-b8d6-4a70-b007-adf1095aa64f', code: '45B', label: 'District 45B' },
    email: 'rep.patty.acomb@house.mn.gov',
    phone: '651-296-9934',
    profile_url: 'https://www.house.mn.gov/members/profile/15513',
  },
  committees: [{ name: 'Ways and Means' }],
  stats: { chief_bill_count: 28, total_bill_count: 116, vote_record_count: 0, committee_count: 3 },
};

describe('mapLegislator biography', () => {
  it('leaves bio undefined when the record has no biography', () => {
    expect(mapLegislator(REAL_PAYLOAD as never).bio).toBeUndefined();
  });

  it('never substitutes prose for a missing biography', () => {
    // Pinning the specific regression: any non-empty string here is a stand-in
    // sentence that would reach a results card as though a person wrote it.
    const { bio } = mapLegislator(REAL_PAYLOAD as never);
    expect(typeof bio === 'string' && bio.length > 0).toBe(false);
  });

  it('passes a real biography straight through', () => {
    const withBio = { ...REAL_PAYLOAD, biography: 'Represents Plymouth and Minnetonka.' };
    expect(mapLegislator(withBio as never).bio).toBe('Represents Plymouth and Minnetonka.');
  });

  it('treats an explicitly null biography as absent', () => {
    // The detail payload types `biography` as `string | null`, so null is a real
    // wire value, not a hypothetical.
    const nullBio = { ...REAL_PAYLOAD, biography: null };
    expect(mapLegislator(nullBio as never).bio).toBeUndefined();
  });
});

describe('mapLegislator slug', () => {
  it('carries the slug through for the readable /legislators/{slug} URL', () => {
    // The API has always served `slug`; the mapper used to drop it, so every
    // profile link fell back to the UUID. It must reach the domain object now.
    expect(mapLegislator(REAL_PAYLOAD as never).slug).toBe('patty-acomb');
  });
});

describe('mapLegislator Find My Legislator facts', () => {
  it('carries residence, authored totals, committee roles, and issues without stand-ins', () => {
    const mapped = mapLegislator({
      ...REAL_PAYLOAD,
      current_service: {
        ...REAL_PAYLOAD.current_service,
        represented_city: 'Plymouth',
        email: 'mailto:rep.patty.acomb@house.mn.gov',
      },
      committees: [{ name: 'Ways and Means', role: 'Chair' }],
      issue_areas: ['Education', 'Health care'],
      service_history: {
        term: 3,
        periods: [{ chamber: 'house', initial_year: 2020, reelection_years: [2022, 2024] }],
      },
    } as never);

    expect(mapped.representedCity).toBe('Plymouth');
    expect(mapped.email).toBe('rep.patty.acomb@house.mn.gov');
    expect(mapped.committeeAssignments).toEqual([{ name: 'Ways and Means', role: 'Chair' }]);
    expect(mapped.issueAreas).toEqual(['Education', 'Health care']);
    expect(mapped.totalAuthoredBills).toBe(116);
    expect(mapped.chiefAuthoredBills).toBe(28);
    expect(mapped.legislativeService?.lines[0].elected).toContain('re-elected 2022, 2024');
  });

  it('uses the current Senate profile address in the mapped card data', () => {
    const mapped = mapLegislator({
      ...REAL_PAYLOAD,
      current_service: {
        ...REAL_PAYLOAD.current_service,
        chamber: 'senate',
        profile_url: 'http://www.senate.leg.state.mn.us/members/member_bio.php?leg_id=15245',
      },
    } as never);

    expect(mapped.profileUrl).toBe('https://www.senate.mn/members/member_bio.html?leg_id=15245');
  });
});
