import { describe, expect, it, vi } from 'vitest';

import * as routes from '../routes';
import {
  billSession,
  searchHref,
  suggestionGroups,
  type SuggestionsAnswer,
} from '../search/suggestions';

const ANSWER: SuggestionsAnswer = {
  request_id: 'sg1',
  q: 'hortman',
  money: {
    groups: [
      {
        kind: 'people',
        state: 'reported',
        results: [
          {
            kind: 'person',
            id: 'leg-1',
            full_name: 'Melissa Hortman',
            chamber: 'house',
            district_code: '34B',
          },
        ],
      },
      {
        kind: 'committees',
        state: 'reported',
        results: [
          {
            kind: 'committee',
            filer_kind: 'candidate_committee',
            registration_number: '15677',
            name: 'Hortman, Melissa A House Committee',
          },
        ],
      },
      {
        kind: 'gave',
        state: 'reported',
        results: [
          { kind: 'payment_name', name: 'Hortman Melissa A House Committee', role: 'contributor' },
          { kind: 'payment_name', name: 'Hortman Melissa A House Committee', role: 'contributor' },
        ],
      },
      {
        kind: 'got_paid',
        state: 'reported',
        results: [
          { kind: 'payment_name', name: 'Hortman Melissa A House Committee', role: 'vendor' },
        ],
      },
      {
        kind: 'lobbyists',
        state: 'not_reported',
        results: [{ kind: 'lobbyist', name: 'Hidden', registration_number: 1 }],
      },
      {
        kind: 'principals',
        state: 'reported',
        results: [
          {
            kind: 'principal',
            name: 'Example Association',
            entity_id: 77,
            registration_number: '4400',
          },
        ],
      },
    ],
  },
  bills: [
    {
      id: '94-2026-SF4138',
      file_type: 'SF',
      file_number: 4138,
      ai_analysis: { short_title: 'Insulin Safety Net Definition' },
    },
  ],
};

function withEveryRouteBuilt() {
  return vi.spyOn(routes, 'isBuilt').mockReturnValue(true);
}

describe('suggestionGroups', () => {
  it('maps the server groups to the drawing’s 5 groups, in order, with Finance links', () => {
    const spy = withEveryRouteBuilt();
    const groups = suggestionGroups(ANSWER);
    spy.mockRestore();
    expect(groups.map((group) => group.title)).toEqual([
      'People',
      'Organizations',
      'Committees',
      'Bills',
      'Payments under a name',
    ]);
    expect(groups[0].rows[0]).toEqual({
      name: 'Melissa Hortman',
      context: 'Legislator · House District 34B',
      href: '/legislators/leg-1',
    });
    expect(groups[1].rows[0]).toEqual({
      name: 'Example Association',
      context: 'Principal · Registration 4400',
      href: '/lobbying/principals/77',
    });
    expect(groups[2].rows[0]).toEqual({
      name: 'Hortman, Melissa A House Committee',
      context: 'Candidate committee · Registration 15677',
      href: '/money/committees/15677',
    });
    expect(groups[3].rows[0]).toEqual({
      name: 'Insulin Safety Net Definition',
      context: '2025–26 · Senate',
      code: 'SF 4138',
      href: '/bills/94-2026-SF4138',
    });
  });

  it('keeps a printed spelling once per role, and never merges donor and payee', () => {
    const spy = withEveryRouteBuilt();
    const printed = suggestionGroups(ANSWER).find((group) => group.id === 'printed')!;
    spy.mockRestore();
    expect(printed.rows).toEqual([
      {
        name: 'Hortman Melissa A House Committee',
        context: 'Printed donor name',
        href: '/money/names/Hortman%20Melissa%20A%20House%20Committee?role=donor',
      },
      {
        name: 'Hortman Melissa A House Committee',
        context: 'Printed payee name',
        href: '/money/names/Hortman%20Melissa%20A%20House%20Committee?role=payee',
      },
    ]);
  });

  it('leaves out a group the server could not report', () => {
    const spy = withEveryRouteBuilt();
    const names = suggestionGroups(ANSWER).flatMap((group) => group.rows.map((row) => row.name));
    spy.mockRestore();
    expect(names).not.toContain('Hidden');
  });

  it('never links to a page that is not built', () => {
    const groups = suggestionGroups(ANSWER);
    for (const row of groups.flatMap((group) => group.rows)) {
      const match = routes.matchRoute(row.href.split('?')[0]);
      expect(match && routes.isBuilt(match.route.name)).toBe(true);
    }
  });
});

describe('billSession', () => {
  it.each([
    ['94-2026-SF4138', '2025–26'],
    ['94-2025-HF1', '2025–26'],
    ['93-2024-HF2', '2023–24'],
    ['nonsense', null],
  ])('reads %s as %s', (id, session) => {
    expect(billSession(id)).toBe(session);
  });
});

describe('searchHref', () => {
  it('carries the typed words, trimmed, and nothing when empty', () => {
    expect(searchHref('  Hortman  ')).toBe('/search?q=Hortman');
    expect(searchHref('   ')).toBe('/search');
  });
});
