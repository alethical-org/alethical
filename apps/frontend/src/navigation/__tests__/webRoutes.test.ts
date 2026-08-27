// Where a typed-in or bookmarked URL actually lands.
//
// Several paths in this app point at screens from the pre-redesign build. They
// still exist in the code, but none of them may render: a visitor who follows an
// old link has to arrive somewhere shipped, not on a page with no nav, no footer
// and no way back. `targetFromPathname` is the single place that decision is
// made, so the redirects below are pinned here rather than left to whoever next
// edits the routing switch.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { IA, NAV_BAR, mobileNavRoadmapLabels, navDropdownItems } from '../ia';
import { pathForRoute, stateFromPathname, targetFromPathname } from '../webRoutes';

const routeSource = readFileSync(join(__dirname, '..', 'webRoutes.ts'), 'utf8');

describe('the shared address reader stays safe for the server build', () => {
  it('does not import the browser navigation package', () => {
    expect(routeSource).not.toMatch(/from ['"]@react-navigation\//);
  });
});

describe('old-design URLs land on a shipped page', () => {
  it('sends a standalone vote link to that bill’s Votes tab', () => {
    // The Vote Detail screen was cut before v0 (#38) but its URL kept resolving to
    // it. Every recorded roll call lives on the bill's Votes tab now (#83), so the
    // link still lands on the vote it named — just in the shipped design.
    expect(
      targetFromPathname('/bills/94-2025-SF334/votes/3cacafdb-debc-48b9-b654-0faad04dc716'),
    ).toEqual({ kind: 'bill', billId: '94-2025-SF334', tab: 'votes' });
  });

  it('keeps the bill id readable when the URL escaped it', () => {
    expect(targetFromPathname('/bills/a%20b/votes/v%201')).toEqual({
      kind: 'bill',
      billId: 'a b',
      tab: 'votes',
    });
  });

  it.each([['/account'], ['/chat'], ['/chat/new'], ['/chat/sessions/abc-123']])(
    'sends %s to the home page',
    (path) => {
      expect(targetFromPathname(path)).toEqual({ kind: 'tab', screen: 'Home' });
    },
  );

  it('sends the old search page to the bill list', () => {
    expect(targetFromPathname('/search')).toEqual({ kind: 'bills', params: {} });
  });

  it('carries a bookmarked /search query + filters over to the bill list', () => {
    expect(targetFromPathname('/search?q=education&status=passed')).toEqual({
      kind: 'bills',
      params: { q: 'education', status: 'passed' },
    });
  });

  // Bill tracking ships, so the Track dropdown's live "Bills" row links to the
  // Tracked page; /tracked resolves to it instead of redirecting to Home. A
  // signed-out visitor still lands there and is prompted to sign in.
  it('resolves the tracked page instead of redirecting to Home', () => {
    expect(targetFromPathname('/tracked')).toEqual({ kind: 'tab', screen: 'Tracked' });
  });
});

describe('addresses with no page behind them', () => {
  it.each(['/foo', '/traffic', '/Home', '/BILLS/94-2025-HF719'])(
    'keeps %s out of the home page',
    (path) => {
      expect(targetFromPathname(path)).toEqual({ kind: 'notFound', path });
    },
  );

  it('keeps the mistyped address on the useful missing-page screen', () => {
    expect(stateFromPathname('/made-up/path')).toEqual({
      routes: [
        {
          name: 'Tabs',
          state: {
            routes: [{ name: 'Home' }, { name: 'Tracked' }, { name: 'Chat' }, { name: 'Account' }],
            index: 0,
          },
        },
        { name: 'NotFound', params: { path: '/made-up/path' } },
      ],
      index: 1,
    });
    expect(pathForRoute({ name: 'NotFound', params: { path: '/made-up/path' } })).toBe(
      '/made-up/path',
    );
  });
});

describe('live URLs still resolve to themselves', () => {
  it('round-trips the 2 private email-link pages without keeping their secrets in navigation', () => {
    expect(
      targetFromPathname('/confirm?token_hash=private-confirmation&type=signup&pending=opaque'),
    ).toEqual({ kind: 'confirmEmail' });
    expect(targetFromPathname('/reset?token_hash=private-reset&type=recovery')).toEqual({
      kind: 'resetPassword',
    });
    expect(pathForRoute({ name: 'ConfirmEmail' })).toBe('/confirm');
    expect(pathForRoute({ name: 'ResetPassword' })).toBe('/reset');
    expect(stateFromPathname('/confirm')).toMatchObject({
      routes: expect.arrayContaining([{ name: 'ConfirmEmail' }]),
    });
    expect(stateFromPathname('/reset')).toMatchObject({
      routes: expect.arrayContaining([{ name: 'ResetPassword' }]),
    });
  });

  it('keeps an answer question and its safe fallback parent through reload or sharing', () => {
    expect(targetFromPathname('/ask?q=Which+bills%3F&legislator=erin-murphy')).toEqual({
      kind: 'ask',
      params: {
        q: 'Which bills?',
        billId: undefined,
        legislatorId: 'erin-murphy',
      },
    });
    expect(
      pathForRoute({
        name: 'Ask',
        params: { q: 'What changed?', billId: '94-2025-HF719', suggestionIndex: 1 },
      }),
    ).toBe('/ask?q=What+changed%3F&bill=94-2025-HF719&suggestion=1');
    expect(targetFromPathname('/ask?q=What+changed%3F&bill=94-2025-HF719&suggestion=1')).toEqual({
      kind: 'ask',
      params: {
        q: 'What changed?',
        billId: '94-2025-HF719',
        legislatorId: undefined,
        suggestionIndex: 1,
      },
    });
  });

  it('leaves a plain bill link alone', () => {
    expect(targetFromPathname('/bills/94-2025-SF334')).toEqual({
      kind: 'bill',
      billId: '94-2025-SF334',
      tab: undefined,
      track: undefined,
    });
  });

  it('carries a tab the visitor asked for', () => {
    expect(targetFromPathname('/bills/94-2025-SF334?tab=text')).toMatchObject({
      kind: 'bill',
      tab: 'text',
    });
  });

  it('keeps a legislator profile plain when no tab is asked for', () => {
    expect(targetFromPathname('/legislators/aisha-gomez')).toMatchObject({
      kind: 'legislator',
      legislatorId: 'aisha-gomez',
      tab: undefined,
      year: undefined,
    });
    expect(
      pathForRoute({ name: 'LegislatorProfile', params: { legislatorId: 'aisha-gomez' } }),
    ).toBe('/legislators/aisha-gomez');
  });

  it('carries the campaign money tab and its year through reload or sharing', () => {
    // A figure someone sends to somebody else has to arrive showing the year they
    // were looking at (grounded-answers rule 5, #1329).
    expect(targetFromPathname('/legislators/aisha-gomez?tab=money&year=2025')).toMatchObject({
      kind: 'legislator',
      legislatorId: 'aisha-gomez',
      tab: 'money',
      year: '2025',
    });
    expect(
      pathForRoute({
        name: 'LegislatorProfile',
        params: { legislatorId: 'aisha-gomez', tab: 'money', year: '2025' },
      }),
    ).toBe('/legislators/aisha-gomez?tab=money&year=2025');
  });

  it('keeps homepage bill-group filters through reload or sharing', () => {
    expect(targetFromPathname('/bills?status=signed_into_law&sort=action')).toEqual({
      kind: 'bills',
      params: { status: 'signed_into_law', sort: 'action' },
    });
    expect(targetFromPathname('/bills?sort=introduced')).toEqual({
      kind: 'bills',
      params: { sort: 'introduced' },
    });
  });

  it('keeps an Ask Issue handoff through reload or sharing', () => {
    const path = '/bills?issue=Consumer+Protection&sort=action';
    expect(targetFromPathname(path)).toEqual({
      kind: 'bills',
      params: { issue: 'Consumer Protection', sort: 'action' },
    });
    expect(
      pathForRoute({
        name: 'Bills',
        params: { issue: 'Consumer Protection', sort: 'action' },
      }),
    ).toBe(path);
  });

  it('keeps an issue-answer sort through reload or sharing', () => {
    expect(targetFromPathname('/ask?q=housing+bills&sort=action')).toEqual({
      kind: 'ask',
      params: { q: 'housing bills', sort: 'action' },
    });
    expect(pathForRoute({ name: 'Ask', params: { q: 'housing bills', sort: 'action' } })).toBe(
      '/ask?q=housing+bills&sort=action',
    );
  });

  it('resolves the pages that have no redesigned replacement', () => {
    expect(targetFromPathname('/privacy')).toEqual({ kind: 'privacy' });
    expect(targetFromPathname('/site-metrics')).toEqual({ kind: 'siteMetrics' });
    expect(targetFromPathname('/terms')).toEqual({ kind: 'terms' });
    expect(pathForRoute({ name: 'SiteMetrics' })).toBe('/site-metrics');
  });

  it('round-trips the Contact us page through its public URL', () => {
    expect(targetFromPathname('/about/contact')).toEqual({ kind: 'contactUs' });
    expect(pathForRoute({ name: 'ContactUs' })).toBe('/about/contact');
  });

  it('round-trips the About us page through its public URL', () => {
    expect(targetFromPathname('/about')).toEqual({ kind: 'aboutUs' });
    expect(pathForRoute({ name: 'AboutUs' })).toBe('/about');
  });
});

// The campaign money section is public — no sign-in gate on any of it
// (campaign money IA §01).
describe('campaign money routes', () => {
  it('round-trips the landing through /money', () => {
    expect(targetFromPathname('/money')).toEqual({ kind: 'moneyLanding' });
    expect(pathForRoute({ name: 'MoneyLanding' })).toBe('/money');
  });

  // The /read page left the money section for the top level (#1698), left
  // /reports on the morning of 27 Aug 2026, when "report" went back to meaning
  // only the document a campaign files with the state, and left /reading that
  // evening for the single word the bar now shows
  // (docs/architecture/published-writing-decisions.md §2.1 and §2.6).
  it('round-trips the /read page through /read', () => {
    expect(targetFromPathname('/read')).toEqual({ kind: 'read' });
    expect(pathForRoute({ name: 'Read' })).toBe('/read');
  });

  // An unknown slug is a page that does not exist — NotFound, not an empty shell
  // (grounded-answers.md rule 13; the registry in lib/research.ts holds only
  // pieces that have actually posted).
  it('sends an unpublished research slug to NotFound', () => {
    expect(targetFromPathname('/read/research/outsider-pattern')).toEqual({
      kind: 'notFound',
      path: '/read/research/outsider-pattern',
    });
  });

  it('writes a research URL under /read/research', () => {
    expect(pathForRoute({ name: 'Research', params: { slug: 'outsider-pattern' } })).toBe(
      '/read/research/outsider-pattern',
    );
  });

  // The posted guide, at the folder its traits put it in
  // (published-writing-decisions.md §2.1).
  it('opens the posted guide under /read/guides', () => {
    expect(targetFromPathname('/read/guides/who-has-to-report-their-money')).toEqual({
      kind: 'guide',
      slug: 'who-has-to-report-their-money',
    });
    expect(pathForRoute({ name: 'Guide', params: { slug: 'who-has-to-report-their-money' } })).toBe(
      '/read/guides/who-has-to-report-their-money',
    );
  });

  // A piece has ONE address. Asking for a real piece under the other folder is an
  // absent page, not a second way in, or the same page would answer on 2
  // addresses and a reader could share the one we do not name as canonical.
  it('refuses a posted piece asked for under the wrong folder', () => {
    expect(targetFromPathname('/read/research/who-has-to-report-their-money')).toEqual({
      kind: 'notFound',
      path: '/read/research/who-has-to-report-their-money',
    });
    expect(targetFromPathname('/read/guides/the-money-only-goes-one-way')).toEqual({
      kind: 'notFound',
      path: '/read/guides/the-money-only-goes-one-way',
    });
  });

  it('sends an unpublished guide slug to NotFound', () => {
    expect(targetFromPathname('/read/guides/not-a-guide')).toEqual({
      kind: 'notFound',
      path: '/read/guides/not-a-guide',
    });
  });

  // A set has its address settled and nothing built behind it
  // (published-writing-decisions.md §2.1), so it is an absent page rather than an
  // empty shell promising one.
  it('does not serve a set address yet', () => {
    expect(targetFromPathname('/read/sets/where-the-money-comes-from')).toEqual({
      kind: 'notFound',
      path: '/read/sets/where-the-money-comes-from',
    });
  });

  // All 3 old addresses still land, so a link shared before any of the moves
  // works on any host — the production forwards in vercel.json never see the
  // app, but the dev server and a local static export have none.
  it('lands an old /reading, /reports or /money/reports link on the /read page', () => {
    expect(targetFromPathname('/reading')).toEqual({ kind: 'read' });
    expect(targetFromPathname('/reports')).toEqual({ kind: 'read' });
    expect(targetFromPathname('/money/reports')).toEqual({ kind: 'read' });
    expect(targetFromPathname('/money/reports/')).toEqual({ kind: 'read' });
    expect(targetFromPathname('/money/reports?utm_source=newsletter')).toEqual({
      kind: 'read',
    });
  });

  it('resolves an old piece link the same way as the new one', () => {
    // Unpublished either way, so all three are the same absent page rather than
    // one 404 and one shell.
    expect(targetFromPathname('/reports/outsider-pattern')).toEqual({
      kind: 'notFound',
      path: '/reports/outsider-pattern',
    });
    expect(targetFromPathname('/money/reports/outsider-pattern')).toEqual({
      kind: 'notFound',
      path: '/money/reports/outsider-pattern',
    });
  });

  // Only research ever answered on the 2 retired REPORT addresses, so honouring a
  // guide's slug there would invent an address it never had.
  it('never answers a guide at a retired piece address', () => {
    for (const path of [
      '/reports/who-has-to-report-their-money',
      '/money/reports/who-has-to-report-their-money',
    ]) {
      expect(targetFromPathname(path)).toEqual({ kind: 'notFound', path });
    }
  });

  // /reading/guides IS different: a guide genuinely answered there from the
  // evening of 27 Aug 2026, so that address keeps opening it.
  it('opens the posted guide at the /reading folder it did answer on', () => {
    expect(targetFromPathname('/reading/guides/who-has-to-report-their-money')).toEqual({
      kind: 'guide',
      slug: 'who-has-to-report-their-money',
    });
  });

  // The one posted piece resolves at all three of its addresses, so a link
  // shared under either old address still opens the piece on a host with no
  // forwards.
  it('opens the posted piece at its new address and at all 3 old ones', () => {
    const slug = 'the-money-only-goes-one-way';
    for (const path of [
      `/read/research/${slug}`,
      `/reading/research/${slug}`,
      `/reports/${slug}`,
      `/money/reports/${slug}`,
    ]) {
      expect(targetFromPathname(path)).toEqual({ kind: 'research', slug });
    }
  });

  // The retired greyed "Campaign Finance" tracking row pointed here; the old
  // address forwards rather than 404ing.
  it('forwards the old /track/campaign-finance address to the landing', () => {
    expect(targetFromPathname('/track/campaign-finance')).toEqual({ kind: 'moneyLanding' });
  });

  // Phase 3 (#1696). /money/committees used to forward to /money because no list
  // existed; it is the register's own list now, and its state is in the address so
  // a narrowed or scrolled list can be shared (grounded-answers.md rule 5).
  it('opens the committees list at /money/committees rather than forwarding', () => {
    expect(targetFromPathname('/money/committees')).toEqual({
      kind: 'moneyCommitteeList',
      params: {},
    });
    expect(pathForRoute({ name: 'CommitteeList' })).toBe('/money/committees');
  });

  it('round-trips the committees list’s name box, kind filter and row count', () => {
    expect(targetFromPathname('/money/committees?q=dfl&kind=party_unit&show=100')).toEqual({
      kind: 'moneyCommitteeList',
      params: { q: 'dfl', kind: 'party_unit', show: '100' },
    });
    expect(
      pathForRoute({
        name: 'CommitteeList',
        params: { q: 'dfl', kind: 'party_unit', show: '100' },
      }),
    ).toBe('/money/committees?q=dfl&kind=party_unit&show=100');
  });

  // A committee's own page still resolves by its trailing number, so the list
  // route may not swallow it.
  it('still opens one committee’s page under the same prefix', () => {
    expect(targetFromPathname('/money/committees/smith-andrew-house-committee-18833')).toEqual({
      kind: 'moneyCommittee',
      slug: 'smith-andrew-house-committee-18833',
      tab: undefined,
      year: undefined,
    });
  });

  it('round-trips a search through /money/search', () => {
    expect(targetFromPathname('/money/search?q=smith')).toEqual({
      kind: 'moneySearch',
      params: { q: 'smith' },
    });
    expect(pathForRoute({ name: 'MoneySearch', params: { q: 'smith' } })).toBe(
      '/money/search?q=smith',
    );
  });

  // An address with no query is the page's own "type a name" state, so the field
  // on it still has somewhere to live rather than bouncing to the landing.
  it('keeps /money/search with no query on the search page', () => {
    expect(targetFromPathname('/money/search')).toEqual({ kind: 'moneySearch', params: {} });
    expect(pathForRoute({ name: 'MoneySearch' })).toBe('/money/search');
  });

  it('escapes a typed name in the address rather than breaking the link', () => {
    expect(pathForRoute({ name: 'MoneySearch', params: { q: 'smith & co' } })).toBe(
      '/money/search?q=smith%20%26%20co',
    );
  });
});

describe('shared top navigation', () => {
  // Yours left the bar for the account menu and Read took second place (#1698;
  // labelled Reports, then Reading, until 27 Aug 2026). Both auth states carry
  // these same 3 entries.
  it('offers Search, Read and About without an active Ask entry', () => {
    expect(NAV_BAR.map((entry) => (entry.kind === 'menu' ? entry.key : entry.item.id))).toEqual([
      'search',
      'read',
      'about',
    ]);
    expect(
      NAV_BAR.map((entry) => (entry.kind === 'menu' ? entry.label : entry.item.label)),
    ).toEqual(['Search', 'Read', 'About']);
  });

  it('keeps no Yours group in the bar', () => {
    expect(NAV_BAR.map((entry) => (entry.kind === 'menu' ? entry.key : null))).not.toContain(
      'track',
    );
  });
});

// Read is 1 destination with no dropdown, not a group holding a single row: the
// bar drew a dropdown with 1 item in it and the phone drawer drew a heading over
// 1 row until 27 Aug 2026 (Design's nav drawing;
// docs/architecture/published-writing-decisions.md §2.1).
describe('the bar\u2019s Read item', () => {
  it('is a plain destination with no dropdown behind it', () => {
    const read = NAV_BAR.find((entry) => entry.kind === 'link');
    expect(read).toBeDefined();
    if (read?.kind !== 'link') throw new Error('Read is not a link entry');
    expect(read.item.id).toBe('read');
    expect(read.item.label).toBe('Read');
    expect(read.item.path).toBe('/read');
    expect(read.item.menu).toBeNull();
    expect(read.item.isNew).toBe(true);
    expect(read.item.authGated).toBe(false);
    // Nothing hangs off it, at either band.
    expect(IA.filter((item) => item.id !== 'read' && item.path.startsWith('/read'))).toEqual([]);
  });

  it('is the only bar entry that is a destination', () => {
    expect(NAV_BAR.filter((entry) => entry.kind === 'link')).toHaveLength(1);
  });
});

// Find My Legislator writes its own URL into the address bar, so that URL has to
// read back as the same screen — reloading, bookmarking or sharing it used to
// dump the visitor on Home instead (#764). The address the visitor typed rides
// in ?address= so the results are shareable too (grounded-answers.md rule 5).
describe('Find My Legislator round-trips through its URL', () => {
  it('resolves its own path instead of redirecting to Home', () => {
    expect(targetFromPathname('/find-my-legislator')).toEqual({
      kind: 'findMyLegislator',
      address: undefined,
    });
  });

  it('carries the address the visitor searched for', () => {
    expect(
      targetFromPathname('/find-my-legislator?address=350%20S%205th%20St%2C%20Minneapolis%2C%20MN'),
    ).toEqual({ kind: 'findMyLegislator', address: '350 S 5th St, Minneapolis, MN' });
  });

  it('writes back the same URL it reads', () => {
    const address = '350 S 5th St, Minneapolis, MN 55415';
    const path = pathForRoute({ name: 'FindMyLegislator', params: { address } });
    expect(path).toBe(
      '/find-my-legislator?address=350%20S%205th%20St%2C%20Minneapolis%2C%20MN%2055415',
    );
    expect(targetFromPathname(path)).toEqual({ kind: 'findMyLegislator', address });
  });

  it('leaves the address out when there is none to carry', () => {
    expect(pathForRoute({ name: 'FindMyLegislator' })).toBe('/find-my-legislator');
  });

  it('never puts a precise point or browser permission result in the URL', () => {
    expect(
      pathForRoute({
        name: 'FindMyLegislator',
        params: {
          address: ' 350 S 5th St ',
          coordinate: { latitude: 44.97683, longitude: -93.26579 },
          lookupAddress: true,
          locationFailure: 'permission-denied',
        },
      }),
    ).toBe('/find-my-legislator?address=%20350%20S%205th%20St%20');
  });

  // The nav used to grey it out as "on the roadmap" while the desktop rail sent
  // people straight to it — the product saying two different things about the
  // same screen (#764). Now it is a live Search row.
  it('is offered as a live Search row, not a greyed roadmap pill', () => {
    const { live, roadmap } = navDropdownItems('search');
    expect(live.map((item) => item.id)).toContain('search-find-my-legislator');
    expect(roadmap.map((item) => item.id)).not.toContain('search-find-my-legislator');
  });

  // Districts are drawn below city level and the lookup's geocoder only matches a
  // house number + street, so nothing user-facing may offer a city or an "area"
  // (grounded-answers.md rule 2, never advertise what you can't answer).
  it('does not offer a city or an area it cannot look up', () => {
    const item = IA.find((entry) => entry.id === 'search-find-my-legislator');
    expect(item?.description).toBe('Enter your street address to see who represents you');
    // The exact string above is the copy; these are the invariant it has to keep,
    // so a future rewrite that quietly widens the promise fails here rather than
    // passing because someone updated the expected string to match.
    expect(item?.description?.toLowerCase()).toContain('street address');
    for (const tooWide of ['city', 'zip', 'area', 'town', 'neighborhood']) {
      expect(item?.description?.toLowerCase()).not.toContain(tooWide);
    }
  });
});

// Free-form "Ask AI" is a roadmap capability, not the shipped grounded Ask, so it
// rides in the Search dropdown's greyed "ON THE ROADMAP" row, last. News moved
// into this group from the old Track menu (campaign money IA, Aug 2026).
describe('Search dropdown roadmap row', () => {
  it('reads Candidates, Claimed Profiles, News, then Ask AI', () => {
    const { roadmap } = navDropdownItems('search');
    expect(roadmap.map((item) => item.label)).toEqual([
      'Candidates',
      'Claimed Profiles',
      'News',
      'Ask AI',
    ]);
  });

  it('keeps Ask AI a greyed roadmap pill, never a live row', () => {
    const { live } = navDropdownItems('search');
    expect(live.map((item) => item.id)).not.toContain('search-ask-ai');
  });
});

// The Campaign money row is live, public, second in Search, and carries the
// green NEW chip (campaign money IA §01).
describe('Search dropdown Campaign money row', () => {
  it('sits second among the live rows, between Bills and Legislators', () => {
    const { live } = navDropdownItems('search');
    expect(live.map((item) => item.id)).toEqual([
      'search-bills',
      'search-campaign-money',
      'search-legislators',
      'search-find-my-legislator',
    ]);
  });

  it('is public and marked new', () => {
    const item = IA.find((entry) => entry.id === 'search-campaign-money');
    expect(item?.authGated).toBe(false);
    expect(item?.path).toBe('/money');
    expect(item?.isNew).toBe(true);
  });

  // This replaces the tripwire #1700 left here, which failed if the row named a
  // search before the search worked. Eugene retired that rule on 20 Aug 2026:
  // /money opens with its own under-development notice, so the row may say what
  // the section is for. What the tripwire was protecting still matters, so it is
  // re-pointed rather than deleted — the guard is now on the NOTICE, not on the
  // wording. If /money stops declaring itself unfinished while its search is
  // still a picture, this fails and the row goes back to describing the record.
  it('may name the search only while /money declares itself unfinished', () => {
    const item = IA.find((entry) => entry.id === 'search-campaign-money');
    expect(item?.description).toBe('Search any name to find people, committees, and who got paid');
    // The notice is what makes the claim honest, so the guard reads the real
    // component rather than trusting a comment. Its own file states that
    // deleting the element and the file is the whole removal, so a missing file
    // is exactly the condition this needs to catch.
    const notice = readFileSync(
      join(__dirname, '../../components/campaignMoney/UnderDevelopmentNotice.tsx'),
      'utf8',
    );
    expect(notice).toMatch(/under development/i);
  });
});

// Bill tracking ships, and since #1698 its row lives in the account menu behind
// the avatar rather than in a "Yours" group in the bar.
describe('tracking is behind the avatar, not in the bar', () => {
  // The row moved into the account menu (#1698). Its registry entry stays, so
  // the page keeps its declared path and the tracking roadmap is still recorded.
  it('still declares the tracked-bills row and its page', () => {
    const item = IA.find((entry) => entry.id === 'track-bills');
    expect(item?.availability).toBe('mvp');
    expect(item?.authGated).toBe(true);
  });

  // The registry path is decorative for this row: the real address comes from
  // the router, and the tracked page has always answered on /tracked.
  it('sends the account menu row to the tracked page', () => {
    expect(targetFromPathname('/tracked')).toEqual({ kind: 'tab', screen: 'Tracked' });
  });
});

describe('Mobile menu roadmap row', () => {
  // "More Tracking" was calculated from whatever the Yours menu still had on its
  // roadmap. With that menu gone from the bar the chip pointed at a group a
  // reader could no longer open, so it goes (#1698).
  it('shows four chips, News by name and Ask AI last', () => {
    expect(mobileNavRoadmapLabels()).toEqual(['Candidates', 'Claimed Profiles', 'News', 'Ask AI']);
  });

  it('offers no More Tracking chip', () => {
    expect(mobileNavRoadmapLabels()).not.toContain('More Tracking');
  });
});
