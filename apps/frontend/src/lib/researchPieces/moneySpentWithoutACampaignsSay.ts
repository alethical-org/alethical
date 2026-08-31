/**
 * "Money spent without a campaign's say", posted 27 Aug 2026 — the fourth piece
 * in the set "How the Money Works", and the fourth carrying only the **guide**
 * trait.
 *
 * The prose is transcribed word for word from
 * `docs/reader-guides/money-spent-without-a-campaigns-say.md`, which is where it
 * was written and settled before any container existed for it. Nothing here is
 * edited to fit a layout or to fit a check (rule 13's publishing order; point 2a
 * is the one door).
 *
 * A guide sits under `.claude/rules/grounded-answers.md` rules 1 to 12 and needs
 * no part of rule 13's exception. **The row counts below are counts of rows in a
 * published download**, which is a fact about the download, names nobody and sums
 * no member's money — the same ground the second guide prints 583,152 and 337,888
 * on. The dollar split those rows also support is NOT here, because summing
 * amounts across every spender and every affected committee is rule 13's first
 * special permission; `docs/architecture/published-writing-decisions.md` §2.8
 * records that classification and the measurement behind it.
 *
 * **The lobbying half carries no spending figure beyond the 2 statutory
 * thresholds**, and that is unchanged by #1862: since 31 Aug 2026 Alethical does
 * hold the Board's yearly principal-expenditure file, so this piece says so, but
 * holding it adds nothing this piece needed a figure for. The 2 halves' sourcing
 * stays visibly apart, because they are 2 different filings on 2 different
 * cycles.
 */

import type { ResearchPiece } from '../research';
import { WHO_HAS_TO_REPORT_THEIR_MONEY } from './whoHasToReportTheirMoney';

/**
 * The first piece's address, taken from the registry rather than typed, so this
 * link moves if that piece ever moves. Built here rather than with `piecePath` to
 * keep this module free of a cycle back through `lib/research.ts`.
 */
const PIECE_ONE_PATH = `/read/guides/${WHO_HAS_TO_REPORT_THEIR_MONEY.slug}`;

/**
 * The next piece's address as a literal, for the same reason the guide before
 * this one holds its forward link as a literal: importing the destination would
 * make a module-scope cycle the day it links back. A test asserts this equals its
 * real path.
 */
const PIECE_FIVE_PATH = '/read/guides/why-nobody-can-follow-a-dollar';

export const MONEY_SPENT_WITHOUT_A_CAMPAIGNS_SAY: ResearchPiece = {
  slug: 'money-spent-without-a-campaigns-say',
  traits: { research: false, guide: true },
  set: { name: 'How the Money Works', position: 4 },
  indexed: true,
  title: 'Money spent without a campaign’s say',
  // No standfirst: the manuscript's second line is the set's name, which is
  // stored as set membership above. Inventing a sentence to fill this slot
  // would be writing prose the author did not write.
  dek: '',
  authorLine: 'ALETHICAL',
  publishedOn: '2026-08-27',
  recordsThrough: '2026-08-27',
  filingBodies: ['Minnesota Campaign Finance Board'],
  // A guide states rules rather than findings, so there is nothing to summarise
  // above it and no SHORT VERSION box is drawn.
  shortVersion: [],
  intro: [
    {
      kind: 'paragraph',
      runs: [
        {
          kind: 'text',
          text: 'Everything in this set so far has been money that went into a campaign’s account and out of it again. Plenty of the money aimed at Minnesota government never touches one.',
        },
      ],
    },
    {
      kind: 'paragraph',
      runs: [
        {
          kind: 'text',
          text: 'Two kinds of it are reported, and they are reported in different places, by different people, on different clocks. Neither one is the campaign’s to control.',
        },
      ],
    },
  ],
  sections: [
    {
      heading: 'Spending about a race with the campaign kept out of it',
      railLabel: 'Spending about a race with the campaign kept out of it',
      blocks: [
        {
          kind: 'paragraph',
          runs: [
            {
              kind: 'text',
              text: 'A group can pay for advertising about a candidate without the candidate having anything to do with it. Doing it on any scale means registering with the Campaign Finance Board first, the same as ',
            },
            {
              kind: 'internalLink',
              text: 'every other kind of political account',
              href: PIECE_ONE_PATH,
            },
            { kind: 'text', text: '.' },
          ],
        },
        {
          kind: 'paragraph',
          runs: [
            { kind: 'text', text: 'The word doing the work is ' },
            { kind: 'bold', text: 'independent' },
            {
              kind: 'text',
              text: '. The law defines an independent expenditure as one “expressly advocating the election or defeat of a clearly identified candidate”, made “without the express or implied consent, authorization, or cooperation of, and not in concert with or at the request or suggestion of, any candidate”.',
            },
          ],
        },
        {
          kind: 'paragraph',
          runs: [
            {
              kind: 'text',
              text: 'Count the ways of being involved that one sentence rules out. Consent, authorization, cooperation, concert, request, suggestion. All 6.',
            },
          ],
        },
        {
          kind: 'paragraph',
          runs: [
            { kind: 'text', text: 'The same money spent ' },
            { kind: 'bold', text: 'with' },
            {
              kind: 'text',
              text: ' the candidate’s involvement is not the same thing. The law calls that an approved expenditure and defines it with the same list turned around: made “with the authorization or expressed or implied consent of, or in cooperation or in concert with, or at the request or suggestion of” the candidate.',
            },
          ],
        },
        {
          kind: 'paragraph',
          runs: [
            {
              kind: 'text',
              text: 'Then the 2 definitions end 1 word apart. “An independent expenditure is ',
            },
            { kind: 'bold', text: 'not' },
            { kind: 'text', text: ' a contribution to that candidate.” “An approved expenditure ' },
            { kind: 'bold', text: 'is' },
            {
              kind: 'text',
              text: ' a contribution to that candidate.” Identical advertising, bought from the same company on the same day, is 2 different things in the records, and what decides which is who was in the room.',
            },
          ],
        },
      ],
    },
    {
      heading: 'What these records show that a contribution record cannot',
      railLabel: 'What these records show that a contribution record cannot',
      blocks: [
        {
          kind: 'paragraph',
          runs: [
            {
              kind: 'text',
              text: 'Minnesota publishes these in one file, headed “Itemized independent expenditures of over $200”. Counted as the Board served it on 27 August 2026, it holds 41,130 payments going back to 2015.',
            },
          ],
        },
        {
          kind: 'paragraph',
          runs: [
            {
              kind: 'text',
              text: 'Every one of them carries something no contribution record has: a direction. ',
            },
            { kind: 'bold', text: '31,718 payments are marked For, and 9,412 are marked Against.' },
          ],
        },
        {
          kind: 'paragraph',
          runs: [
            {
              kind: 'text',
              text: 'That is a count of payments, not a count of money. One payment in that file can be a hundred times the size of another, so counting them and adding them up are 2 different questions, and the amounts are in the same file for anyone who wants the second answer.',
            },
          ],
        },
        {
          kind: 'paragraph',
          runs: [
            {
              kind: 'text',
              text: 'Each row also names what the money bought and who was paid. One group, 2 payments, the same year:',
            },
          ],
        },
        {
          kind: 'bullets',
          items: [
            [
              { kind: 'text', text: '19 March 2026, $61,687.00, marked ' },
              { kind: 'bold', text: 'For' },
              {
                kind: 'text',
                text: ', about Dippel, Tom Senate Committee, for “Advertising - general: Ad Placement”, paid to Arena LLC of Salt Lake City.',
              },
            ],
            [
              { kind: 'text', text: '7 July 2026, $63,940.00, marked ' },
              { kind: 'bold', text: 'Against' },
              {
                kind: 'text',
                text: ', about Janigo, Kristy Senate Committee, same wording, same company.',
              },
            ],
          ],
        },
        {
          kind: 'paragraph',
          runs: [
            {
              kind: 'text',
              text: 'Both were filed by Renew Minnesota, registration 41337. Neither payment went through either campaign’s books.',
            },
          ],
        },
        {
          kind: 'paragraph',
          runs: [
            {
              kind: 'text',
              text: 'Every payment in that file came from a party unit or a political committee or fund. None came from a candidate’s own committee, which is what the word independent is there to mean.',
            },
          ],
        },
      ],
    },
    {
      heading: 'What they do not show',
      railLabel: 'What they do not show',
      blocks: [
        {
          kind: 'paragraph',
          runs: [{ kind: 'text', text: '3 things, and the last is the one people assume.' }],
        },
        {
          kind: 'bullets',
          items: [
            [
              { kind: 'bold', text: 'A row names a committee, not a person.' },
              {
                kind: 'text',
                text: ' It says which campaign account the money was about, and an account is not a person.',
              },
            ],
            [
              { kind: 'bold', text: 'The direction is what the spender filed.' },
              {
                kind: 'text',
                text: ' No record can show what 2 people said to each other, so “independent” on a form is a claim being made, not a thing anyone watched.',
              },
            ],
            [
              { kind: 'bold', text: 'Nothing says it worked.' },
              {
                kind: 'text',
                text: ' The file has the amount, the date, the purpose and the company paid. It does not carry the advertisement, who saw it, or what happened next.',
              },
            ],
          ],
        },
      ],
    },
    {
      heading: 'Lobbying is a different set of records',
      railLabel: 'Lobbying is a different set of records',
      blocks: [
        {
          kind: 'paragraph',
          runs: [
            {
              kind: 'text',
              text: 'None of the above is about lobbying, and lobbying is not about an election.',
            },
          ],
        },
        {
          kind: 'paragraph',
          runs: [
            {
              kind: 'text',
              text: 'The Board’s own handbook puts the test in one question: “Are you asking for something?” A person paid more than $3,000 in a year to ask Minnesota government for things has to register as a lobbyist. Whoever is paying for that is called a principal, and a principal has to report as well.',
            },
          ],
        },
        {
          kind: 'paragraph',
          runs: [
            {
              kind: 'text',
              text: 'What a principal files is one report a year, due 15 March, covering the year before. It gives “the amount spent by the principal in the preceding calendar year on the four types of lobbying”. A yearly total, in other words, and not a list of payments.',
            },
          ],
        },
        {
          kind: 'paragraph',
          runs: [
            {
              kind: 'text',
              text: 'So you can see how much an organization reported spending. You cannot see which bill, which official, or which day, because none of that reaches the report.',
            },
          ],
        },
        {
          kind: 'paragraph',
          runs: [
            { kind: 'bold', text: 'Alethical holds these yearly totals now.' },
            {
              kind: 'text',
              text: ' Since 31 August 2026 we keep our own dated copy of the Board’s principal spending file, alongside the campaign-money files this set is built from, so a principal’s yearly total is something we can show and recheck rather than only link to. Holding it adds nothing the report leaves out.',
            },
          ],
        },
      ],
    },
    {
      heading: 'Next',
      railLabel: 'Next',
      blocks: [
        {
          kind: 'paragraph',
          runs: [
            {
              kind: 'text',
              text: 'Money that has been reported honestly can still be impossible to follow. Once a payment lands in an account it stops being that payment and becomes part of a balance, and the next thing paid out of that account is not traceable back to it.',
            },
          ],
        },
        {
          kind: 'paragraph',
          runs: [
            { kind: 'internalLink', text: 'Why nobody can follow a dollar', href: PIECE_FIVE_PATH },
            { kind: 'text', text: ' is the next piece in this set.' },
          ],
        },
      ],
    },
  ],
  // Every source sentence carries more than 1 link, so the block is stored as
  // runs. See `sourceRuns` in lib/research.ts for why both shapes exist.
  sources: [],
  sourceRuns: [
    [
      {
        kind: 'text',
        text: 'Independent expenditure and approved expenditure, and the sentences saying which one counts as a contribution: ',
      },
      {
        kind: 'externalLink',
        text: 'Minnesota Statutes 10A.01',
        href: 'https://www.revisor.mn.gov/statutes/cite/10A.01',
      },
      { kind: 'text', text: ' subdivisions 18 and 4.' },
    ],
    [
      {
        kind: 'text',
        text: 'The 41,130 payments, the For and Against counts, and Renew Minnesota’s 2 payments: the Board’s ',
      },
      {
        kind: 'externalLink',
        text: 'itemized independent expenditures download',
        href: 'https://cfb.mn.gov/reports-and-data/self-help/data-downloads/campaign-finance/',
      },
      {
        kind: 'text',
        text: ', counted as it was served on 27 August 2026, where the same page also shows that this dataset is published for every kind of political account except candidates, and where the heading quoted above can be read.',
      },
    ],
    [
      {
        kind: 'text',
        text: 'Who has to register as a lobbyist, and what a principal is: Minnesota Statutes 10A.01 subdivisions 21 and 33.',
      },
    ],
    [
      {
        kind: 'text',
        text: 'What a principal reports and when, and the plain question at the top of it: the Board’s ',
      },
      {
        kind: 'externalLink',
        text: 'Lobbying Handbook',
        href: 'https://cfb.mn.gov/pdf/publications/handbooks/lobbyist_handbook.pdf',
      },
      { kind: 'text', text: ' (issued January 2026).' },
    ],
    [
      {
        kind: 'text',
        text: 'Minnesota’s lobbying registration records, which Alethical does not hold, are at the Board’s ',
      },
      {
        kind: 'externalLink',
        text: 'Lobbying Organizations Search Tool',
        href: 'https://cfb.mn.gov/reports-and-data/viewers/lobbying/lobbying-organizations/',
      },
      { kind: 'text', text: ' and its ' },
      {
        kind: 'externalLink',
        text: 'Lobbyist Search Tool',
        href: 'https://cfb.mn.gov/reports-and-data/viewers/lobbying/lobbyists/',
      },
      { kind: 'text', text: '.' },
    ],
  ],
};
