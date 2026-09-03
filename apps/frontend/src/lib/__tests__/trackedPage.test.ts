/**
 * The Tracked page's words and its committee-card rules (#1943). Each fixed string
 * is pinned so the screen cannot retype it, and the 2 rules each cover one way the
 * card could say something the record does not.
 */
import { describe, expect, it } from 'vitest';

import {
  COMMITTEES_HEADING,
  KIND_LABEL_BILL,
  KIND_LABEL_COMMITTEE,
  LOADING_TRACKED,
  NOTHING_TRACKED_YET,
  TRACKED_SUBHEAD,
  TRACKED_TITLE,
  TRACKED_UNAVAILABLE,
  hasNothingTracked,
  trackedCommitteeName,
  trackedCommitteePath,
  trackedCommitteeSlug,
  trackedCommitteeSubtitle,
} from '../trackedPage';

const registered = {
  registrationNumber: '18466',
  committeeName: 'PORT, LINDSEY SENATE COMMITTEE',
  entityType: 'PCC',
  entitySubType: null,
  register: {
    kind: 'candidate_committee',
    name: 'Port, Lindsey Senate Committee',
    office: 'Senate',
    district: '55',
  },
};

describe('the fixed words', () => {
  it('names the page for both kinds and promises presence, never watching', () => {
    expect(TRACKED_TITLE).toBe('Tracked');
    expect(TRACKED_SUBHEAD).toBe('What you are following');
    expect(COMMITTEES_HEADING).toBe('COMMITTEES YOU FOLLOW');
    expect(NOTHING_TRACKED_YET).toBe(
      'Nothing tracked yet. Track a bill or a committee and it stays on this list.',
    );
    expect(KIND_LABEL_BILL).toBe('BILL');
    expect(KIND_LABEL_COMMITTEE).toBe('COMMITTEE');
    expect(LOADING_TRACKED).toBe('Loading what you are following');
    expect(TRACKED_UNAVAILABLE).toBe(
      'We couldn’t load your tracked list right now. Please try again in a moment.',
    );
  });

  it('never says anything will show up, move, or be reported', () => {
    for (const sentence of [TRACKED_SUBHEAD, NOTHING_TRACKED_YET, COMMITTEES_HEADING]) {
      expect(sentence.toLowerCase()).not.toMatch(/shows up|notify|alert|moves|watch/);
    }
  });

  it('standalone lines carry no closing dot, body sentences keep theirs', () => {
    expect(TRACKED_SUBHEAD.endsWith('.')).toBe(false);
    expect(COMMITTEES_HEADING.endsWith('.')).toBe(false);
    expect(NOTHING_TRACKED_YET.endsWith('.')).toBe(true);
  });
});

describe('trackedCommitteeName', () => {
  it('prefers the register, then the download, then the number itself', () => {
    expect(trackedCommitteeName(registered)).toBe('Port, Lindsey Senate Committee');
    expect(
      trackedCommitteeName({ ...registered, register: { ...registered.register, name: null } }),
    ).toBe('PORT, LINDSEY SENATE COMMITTEE');
    expect(
      trackedCommitteeName({
        ...registered,
        committeeName: null,
        register: { ...registered.register, name: null },
      }),
    ).toBe('Committee 18466');
  });
});

describe('trackedCommitteeSubtitle', () => {
  it('joins the kind and the registered seat with a middle dot', () => {
    expect(trackedCommitteeSubtitle(registered)).toBe('Candidate committee · Senate District 55');
  });

  it('prints only the kind for a party unit or a fund, because the register states no seat', () => {
    expect(
      trackedCommitteeSubtitle({
        registrationNumber: '20010',
        committeeName: null,
        entityType: 'PTU',
        entitySubType: 'CAU',
        register: { kind: 'party_unit', name: 'HRCC', office: null, district: null },
      }),
    ).toBe('Legislative caucus');
    expect(
      trackedCommitteeSubtitle({
        registrationNumber: '41363',
        committeeName: null,
        entityType: null,
        entitySubType: null,
        register: {
          kind: 'political_committee_or_fund',
          name: '100 Percent Future Fund',
          office: null,
          district: null,
        },
      }),
    ).toBe('Political committee or fund');
  });

  it('falls back to the download kind when the register cannot speak', () => {
    expect(
      trackedCommitteeSubtitle({
        ...registered,
        register: { kind: null, name: null, office: null, district: null },
      }),
    ).toBe('Candidate committee');
  });

  it('prints a statewide office without inventing a district', () => {
    expect(
      trackedCommitteeSubtitle({
        ...registered,
        register: { ...registered.register, office: 'Governor', district: null },
      }),
    ).toBe('Candidate committee · Governor');
  });

  it('is null when nothing names a kind, rather than a guess', () => {
    expect(
      trackedCommitteeSubtitle({
        registrationNumber: '-12',
        committeeName: 'A local candidate',
        entityType: null,
        entitySubType: null,
        register: { kind: null, name: null, office: null, district: null },
      }),
    ).toBeNull();
  });
});

describe('trackedCommitteePath', () => {
  it('points at the committee money page by name and number', () => {
    expect(trackedCommitteeSlug(registered)).toBe('port-lindsey-senate-committee-18466');
    expect(trackedCommitteePath(registered)).toBe(
      '/money/committees/port-lindsey-senate-committee-18466',
    );
  });
});

describe('hasNothingTracked', () => {
  it('is empty only when both lists are', () => {
    expect(hasNothingTracked(0, 0)).toBe(true);
    expect(hasNothingTracked(1, 0)).toBe(false);
    expect(hasNothingTracked(0, 1)).toBe(false);
  });
});
