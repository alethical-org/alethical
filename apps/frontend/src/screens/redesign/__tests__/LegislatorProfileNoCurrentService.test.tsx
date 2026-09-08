// @vitest-environment jsdom

import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { __DEV__?: boolean }).__DEV__ = false;
  process.env.EXPO_PUBLIC_API_URL = 'http://records.test';
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
vi.mock('../../../providers/AuthProvider', () => ({
  useAuth: () => ({ accessToken: null, user: null, session: null }),
}));
vi.mock('../../../providers/signInModalContext', () => ({
  useSignInModal: () => ({ openSignIn: () => {} }),
}));
// The watchlist writer, which the bill cards' Track buttons ask for. A signed-out
// reader cannot track anything, and tracking says nothing about a person.
vi.mock('../../../providers/trackedBillWriteContext', () => ({
  useTrackedBillWrite: () => ({
    failures: [],
    setTrackedBill: () => {},
    retryFailedWrites: () => {},
  }),
}));
// Drawing only: the chrome's icons, in TypeScript this runner does not compile.
// Nothing here can change a word the page says about a person.
vi.mock('react-native-svg', () => {
  const nothing = () => null;
  return {
    default: nothing,
    Svg: nothing,
    Circle: nothing,
    ClipPath: nothing,
    Defs: nothing,
    Ellipse: nothing,
    G: nothing,
    Line: nothing,
    LinearGradient: nothing,
    Mask: nothing,
    Path: nothing,
    Polygon: nothing,
    Polyline: nothing,
    Rect: nothing,
    Stop: nothing,
    Text: nothing,
  };
});
// Native clipboard, reached through the share popover. It needs an Expo runtime
// this runner has no host for, and copying a link says nothing about a person.
vi.mock('expo-clipboard', () => ({
  setStringAsync: async () => true,
}));
// Which member's page is open. The tab title is written only for the address the
// browser is actually on, so the test drives both together.
const openAddress = vi.hoisted(() => ({ slug: 'joe-schomacker' }));
vi.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, push: () => {}, setParams: () => {} }),
  useRoute: () => ({ name: 'Legislator', params: { legislatorId: openAddress.slug } }),
  useIsFocused: () => true,
}));

import { createAppQueryClient } from '../../../lib/appQueryClient';
import { resetSeededPayloadsForTests } from '../../../lib/pageData';
import { LegislatorProfileWebScreen } from '../LegislatorProfileWebScreen';
import { LegislatorProfileMobileScreen } from '../LegislatorProfileMobileScreen';

/** Both layouts, because the guesses were drawn by both (#2061). */
const SCREENS = [
  ['web', LegislatorProfileWebScreen],
  ['mobile', LegislatorProfileMobileScreen],
] as const;

/**
 * What the LOADED page says, read off the page. The served first response for a
 * member with no current service period is already honest; the app then redrew
 * it a second later with an invented chamber, party and district, a committee
 * list the person had left, and a rewritten browser tab (#2061).
 *
 * `curl` cannot see this defect, and neither can a test of the served snapshot.
 * This mounts the real screen against a real detail payload and reads the words
 * on it.
 */

/** A detail payload with no current service period, and 3 left committees. */
const FORMER = {
  id: 'aa000000-0000-0000-0000-000000000001',
  slug: 'joe-schomacker',
  full_name: 'Joe Schomacker',
  current_service: null,
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
  biography: null,
  issue_areas: [],
};

/** The same person, sitting: the paired case, so nothing here can pass by
 *  hiding the seat from everybody. */
const SITTING = {
  ...FORMER,
  slug: 'patty-acomb',
  full_name: 'Patty Acomb',
  current_service: {
    chamber: 'house',
    party: 'DFL',
    district: { code: '45A' },
    email: 'rep.patty.acomb@house.mn.gov',
    phone: '651-296-9934',
    office_address: '509 State Office Building',
    represented_city: 'Minnetonka',
    profile_url: 'https://www.house.mn.gov/members/profile/15544',
    photo_url: null,
  },
};

const SITTING_SENATOR = {
  ...SITTING,
  slug: 'omar-fateh',
  full_name: 'Omar Fateh',
  current_service: {
    ...SITTING.current_service,
    chamber: 'senate',
    party: 'DFL',
    district: { code: '62' },
    profile_url: 'https://www.senate.mn/members/member_bio.php?leg_id=1234',
  },
};

/** Answers the profile read with `detail`; every other read answers empty. */
function serve(detail: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const path = new URL(String(url), 'http://records.test').pathname;
      const body = /\/legislators\/[^/]+$/.test(path)
        ? { data: detail }
        : { data: [], meta: { total: 0, limit: 2, offset: 0 } };
      return new Response(JSON.stringify(body), {
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
}

function openProfile(Screen: (typeof SCREENS)[number][1], slug: string) {
  openAddress.slug = slug;
  window.history.replaceState({}, '', `/legislators/${slug}`);
  const host = document.createElement('div');
  document.body.append(host);
  const client = createAppQueryClient();
  act(() => {
    createRoot(host).render(
      (
        <QueryClientProvider client={client}>
          <Screen />
        </QueryClientProvider>
      ) as ReactNode,
    );
  });
  return { words: () => host.textContent ?? '' };
}

async function settle() {
  for (let pass = 0; pass < 5; pass += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

afterEach(() => {
  document.body.innerHTML = '';
  document.title = '';
  resetSeededPayloadsForTests();
  vi.unstubAllGlobals();
});

describe('the loaded profile of a member with no current service period', () => {
  it.each(SCREENS)(
    'says the stored name and none of the 3 facts the record does not hold on %s',
    async (_name, Screen) => {
      serve(FORMER);
      const page = openProfile(Screen, 'joe-schomacker');
      await settle();
      const words = page.words();

      expect(words).toContain('Joe Schomacker');
      expect(words).not.toContain('Sen. Joe Schomacker');
      expect(words).not.toContain('Rep. Joe Schomacker');
      expect(words).not.toContain('Senate');
      expect(words).not.toContain('District');
      expect(words).not.toContain('Unknown');
      expect(words).not.toContain('Democratic-Farmer-Labor');
      expect(words).not.toContain('Republican');
      expect(words).not.toContain('Independent');
    },
  );

  it.each(SCREENS)(
    'lists no committee the person has left, and no empty-committee note either on %s',
    async (_name, Screen) => {
      serve(FORMER);
      const page = openProfile(Screen, 'joe-schomacker');
      await settle();
      const words = page.words();

      expect(words).not.toContain('Health Finance and Policy');
      expect(words).not.toContain('Human Services Finance and Policy');
      expect(words).not.toContain('Ways and Means');
      expect(words).not.toContain('CO-CHAIR');
      expect(words).not.toContain('Committees');
      // Saying there are none is itself a claim that the person holds a seat.
      expect(words).not.toContain('No current committee assignments on record');
    },
  );

  it.each(SCREENS)('shows no contact rows on %s', async (_name, Screen) => {
    serve(FORMER);
    const page = openProfile(Screen, 'joe-schomacker');
    await settle();
    const words = page.words();

    expect(words).not.toContain('CAPITOL OFFICE');
    expect(words).not.toContain('PHONE');
    expect(words).not.toContain('LEADERSHIP');
    expect(words).not.toContain('Official');
    // "No contact details are on record yet" is a claim about a member who holds
    // an office, so the whole card goes with the seat.
    expect(words).not.toContain('No contact details are on record yet');
  });

  it.each(SCREENS)(
    'leaves the browser tab title free of an invented chamber or district on %s',
    async (_name, Screen) => {
      serve(FORMER);
      openProfile(Screen, 'joe-schomacker');
      await settle();

      expect(document.title).toBe('Joe Schomacker | Alethical');
    },
  );

  it.each(SCREENS)('still shows what the person did on %s', async (_name, Screen) => {
    serve(FORMER);
    const page = openProfile(Screen, 'joe-schomacker');
    await settle();

    expect(page.words()).toContain('Elected to the House');
    expect(page.words()).toContain('8th');
  });
});

describe('the loaded profile of a sitting member is unchanged', () => {
  it.each(SCREENS)(
    'keeps a House member’s honorific, seat, party, committees and contact on %s',
    async (_name, Screen) => {
      serve(SITTING);
      const page = openProfile(Screen, 'patty-acomb');
      await settle();
      const words = page.words();

      expect(words).toContain('Rep. Patty Acomb');
      expect(words).toContain('House District 45A');
      expect(words).toContain('Democratic-Farmer-Labor');
      expect(words).toContain('Committees');
      expect(words).toContain('Health Finance and Policy');
      expect(words).toContain('CO-CHAIR');
      expect(words).toContain('CAPITOL OFFICE');
      expect(words).toContain('509 State Office Building');
      expect(words).toContain('PHONE');
      expect(words).toContain('651-296-9934');
      expect(words).toContain('Official House profile');
      expect(document.title).toBe('Rep. Patty Acomb, Minnesota House District 45A | Alethical');
    },
  );

  it.each(SCREENS)(
    'keeps a Senate member’s honorific, seat and party on %s',
    async (_name, Screen) => {
      serve(SITTING_SENATOR);
      const page = openProfile(Screen, 'omar-fateh');
      await settle();
      const words = page.words();

      expect(words).toContain('Sen. Omar Fateh');
      expect(words).toContain('Senate District 62');
      expect(words).toContain('Democratic-Farmer-Labor');
      expect(words).toContain('Official Senate profile');
      expect(document.title).toBe('Sen. Omar Fateh, Minnesota Senate District 62 | Alethical');
    },
  );
});
