import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { homeHeroBillFacts } from '../homeBillFacts';
import type { Bill } from '../../data/types';

const source = readFileSync(
  resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../screens/redesign/HomeSignedOutScreen.tsx',
  ),
  'utf8',
);

function bill(overrides: Partial<Bill> = {}): Bill {
  return {
    id: 'test-bill',
    identifier: 'HF 99',
    title: 'Test bill',
    chamber: 'House',
    status: 'Signed into Law',
    effectiveDate: 'July 1, 2030',
    updatedAt: '2030-05-26',
    sessionLabel: 'Test session',
    topics: [],
    chiefSponsorIds: ['author-id'],
    actionCount: 0,
    versionCount: 0,
    rollCallCount: 0,
    briefing: {
      what: '',
      why: '',
      keyChanges: [],
      whoAffected: [],
      supportersMaySay: [],
      concernsMayRaise: [],
    },
    aiAnalysis: {
      shortTitle: 'A test bill',
      summary: 'The saved summary changes with the bill record.',
      keyPoints: [],
      policyAreas: [],
    },
    questionPrompts: [],
    actions: [],
    versions: [],
    votes: [],
    citations: [],
    officialLinks: [],
    sponsors: [{ name: 'Rep. Test Author', role: 'chief_author', legislatorId: 'author-id' }],
    ...overrides,
  };
}

describe('signed-out Home hero bill facts', () => {
  it('takes every displayed bill fact from the supplied saved record', () => {
    const facts = homeHeroBillFacts(
      bill({
        identifier: 'SF 100',
        status: 'Passed both chambers',
        effectiveDate: 'August 1, 2031',
        sponsors: [{ name: 'Sen. New Author', role: 'chief_author', legislatorId: 'new-author' }],
        aiAnalysis: {
          ...bill().aiAnalysis!,
          summary: 'A changed saved summary.',
        },
      }),
    );

    expect(facts).toEqual({
      identifier: 'SF 100',
      status: 'Passed both chambers',
      effectiveDate: 'August 1, 2031',
      author: { name: 'Sen. New Author', id: 'new-author' },
      summary: 'A changed saved summary.',
    });
  });

  it('does not leave the former Home record facts in the screen source', () => {
    expect(source).toContain('homeHeroBillFacts');
    expect(source).not.toContain('House 132–2 · Senate 66–0');
    expect(source).not.toContain('May 26, 2026');
    expect(source).not.toContain('July 1, 2027');
    expect(source).not.toContain('A covered social media platform may not');
    expect(source).not.toContain("effectiveDate: 'Aug 1, 2026'");
  });
});
