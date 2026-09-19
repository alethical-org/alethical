import { describe, expect, it } from 'vitest';
import live from '../../data/__tests__/fixtures/lobbying-live.json';
import {
  lobbyingDirectorySnapshot,
  lobbyingLandingSnapshot,
  lobbyingPrincipalSnapshot,
  lobbyingLobbyistSnapshot,
} from '../lobbyingPageSnapshot';
import { renderPageSnapshot } from '../pageSnapshot';
import { lobbyingRecordNumberFromSlug } from '../lobbyingRecordCopy';
import type {
  LobbyingSummary,
  LobbyingPrincipalsPage,
  LobbyingLobbyistsPage,
  LobbyingPrincipal,
  LobbyingLobbyist,
} from '../lobbyingTypes';

describe('lobbying before the app starts', () => {
  it('rejects non-positive and unsafe record numbers before starting a read', () => {
    expect(lobbyingRecordNumberFromSlug('kozak-andrew-141')).toBe('141');
    expect(lobbyingRecordNumberFromSlug('unlisted-0')).toBeNull();
    expect(lobbyingRecordNumberFromSlug('unlisted-999999999999999999999')).toBeNull();
  });

  it('keeps table captions, year headers, and labels every blank amount', () => {
    const data = structuredClone(live.principal) as LobbyingPrincipal;
    const row = data.spending.rows[0];
    for (const key of [
      'total_spent',
      'puc_lobbying_amount',
      'general_lobbying_amount',
      'legislative_lobbying_amount',
      'administrative_lobbying_amount',
      'mgu_lobbying_amount',
    ] as const)
      row[key] = null;
    const html = renderPageSnapshot(lobbyingPrincipalSnapshot(data));
    expect(html).toContain('<caption>Reported lobbying spending by year</caption>');
    expect(html).toContain(
      '<th scope="row">2025</th><td>Not reported</td><td>Not reported</td><td>Not reported</td>',
    );
    expect(html).toContain('“Not reported” means the file leaves the value blank.');
  });

  it('shows the first 5 donations with their own copy date and no employer column', () => {
    const data = live.kozak as LobbyingLobbyist;
    const page = lobbyingLobbyistSnapshot(data);
    const html = renderPageSnapshot(page);
    expect(html).toContain('240 contribution records · showing 5');
    expect(html).toContain('Campaign contribution file copied Sep 1, 2026');
    expect(html).toContain('Filed as Kozak, Andrew V');
    expect(html).not.toContain('Employer as filed');
    expect(html).not.toContain('href=""');
  });
  it('lists both real directory destinations and source-scoped years', () => {
    const snapshot = lobbyingLandingSnapshot(live.summary as LobbyingSummary);
    expect(snapshot.links).toEqual([
      {
        label: 'View Minnesota’s lobbying source files',
        href: 'https://cfb.mn.gov/reports-and-data/self-help/data-downloads/lobbying/',
      },
      { label: 'Money in politics', href: '/money' },
    ]);
    const html = renderPageSnapshot(snapshot);
    expect(html).toContain('/money/lobbying/lobbyists');
    expect(html).toContain('/money/lobbying/principals');
    expect(html).toContain('1,665 LOBBYISTS LISTED');
    expect(html).toContain('1,748 ORGANISATIONS REPORTED SPENDING FOR 2025');
    expect(html).toContain('The spending records shown here begin in 2014.');
    expect(html).not.toContain('filed by 15 March');
  });

  it('keeps real page 2 counts and ordinary links to adjacent pages', () => {
    const page = lobbyingDirectorySnapshot(
      live.lobbyists_page_2 as LobbyingLobbyistsPage,
      'lobbyists',
      2,
    );
    expect(page.body).toContain('Showing 51–100 of 1,665 registered lobbyists');
    expect(page.links).toContainEqual({ label: 'Previous', href: '/money/lobbying/lobbyists' });
    expect(page.links).toContainEqual({ label: 'Next', href: '/money/lobbying/lobbyists?page=3' });
    expect(page.sections?.[0].items).toHaveLength(50);
  });

  it('gives the first response the card’s own reading order for the amounts', () => {
    const page = lobbyingDirectorySnapshot(
      {
        ...(live.lobbyists_page_2 as LobbyingLobbyistsPage),
        donations: {
          state: 'reported',
          year: 2025,
          available_years: [2025, 2024],
          eligible_count: 136,
          copied_at: '2026-09-01T12:00:00Z',
          release_id: 'cf-2026-09-01',
          source_url: 'https://cfb.mn.gov/source.csv',
        },
      },
      'lobbyists',
      2,
    );
    const at = (text: string) => page.body.findIndex((line) => line.startsWith(text));
    expect(at('Lobbyist registration list copied')).toBeGreaterThan(-1);
    expect(at('Each amount totals campaign contributions')).toBeGreaterThan(
      at('Showing 51–100 of 1,665 registered lobbyists'),
    );
    expect(at('Campaign contribution file copied Sep 1, 2026')).toBeGreaterThan(
      at('Each amount totals campaign contributions'),
    );
    expect(page.body).toContain(
      '2025 campaign contribution amounts are available for 136 of the 1,665 lobbyists in these results',
    );
  });

  it('keeps a real active-list-only principal plain, with no invented destination', () => {
    const data = live.principals_page_2 as LobbyingPrincipalsPage;
    const row = data.principals.find((candidate) => !candidate.linkable)!;
    expect(row).toBeDefined();
    const page = lobbyingDirectorySnapshot(data, 'principals', 2);
    const item = page.sections?.[0].items?.find((candidate) => candidate.label === row.name);
    expect(item?.href).toBeUndefined();
    expect(item?.detail).toBe(
      "No spending rows in the Board's file through 2025, so no page to open",
    );
  });

  it('prints only official yearly spending, preserving a filed zero', () => {
    const snapshot = lobbyingPrincipalSnapshot(live.principal as LobbyingPrincipal);
    const html = renderPageSnapshot(snapshot);
    expect(html).toContain('American Express');
    expect(html).toContain('$0');
    expect(html).toContain('LOBBYING PRINCIPAL · ENTITY ID 2263');
    expect(html).toContain('Reported amounts may be rounded. $0 is the value in the Board’s file.');
    expect(snapshot.links).toContainEqual({
      label: "View the Board's Lobbying Organizations Search Tool",
      href: 'https://cfb.mn.gov/reports-and-data/viewers/lobbying/lobbying-organizations/',
    });
    expect(snapshot.links).toContainEqual({
      label: "View the Board's Lobbyist Search Tool",
      href: 'https://cfb.mn.gov/reports-and-data/viewers/lobbying/lobbyists/',
    });
    expect(html).not.toContain('Not broken out by these kinds before 2024');
    expect(html).toContain('/money/lobbying/lobbyists/kozak-andrew-141');
    expect(html).not.toMatch(/street|telephone|email_address|zip_code/i);
  });

  it('does not turn an absent current registration into a failed donation read', () => {
    const data = live.absent as LobbyingLobbyist;
    const html = renderPageSnapshot(lobbyingLobbyistSnapshot(data));
    expect(html).toContain('not listed on the copy date');
    expect(html).toContain('No contribution records match this registration number');
    expect(html).not.toContain('Total contributed');
  });
});

it('scopes the unresolved all-years notice to the affected registration and source copy', () => {
  const data = structuredClone(live.kozak) as LobbyingLobbyist;
  data.registration_number = '8692';
  data.contributions.release_id = 'af236cca-a4f8-4efe-9a3a-025259ea380e';
  let html = renderPageSnapshot(lobbyingLobbyistSnapshot(data));
  expect(html).toContain('All-years count under review');
  expect(html).toContain('1,194 records matched to registration 8692 across all years');
  expect(html).toContain('contains 1,203');
  // A selected year must not turn the all-years comparison into a year-specific claim.
  html = renderPageSnapshot(lobbyingLobbyistSnapshot(data, 2025));
  expect(html).toContain('All-years count under review');
  data.contributions.release_id = 'another-source';
  expect(renderPageSnapshot(lobbyingLobbyistSnapshot(data))).not.toContain('count under review');
  data.contributions.release_id = 'af236cca-a4f8-4efe-9a3a-025259ea380e';
  data.registration_number = '141';
  expect(renderPageSnapshot(lobbyingLobbyistSnapshot(data))).not.toContain('count under review');
  data.registration_number = '8692';
  data.contributions.state = 'unavailable';
  expect(renderPageSnapshot(lobbyingLobbyistSnapshot(data))).not.toContain('count under review');
});
