/**
 * "Who has to report their money", posted 27 Aug 2026 — the first piece
 * Alethical publishes carrying only the **guide** trait.
 *
 * The prose is transcribed word for word from
 * `docs/reader-guides/who-has-to-report-their-money.md`, which is where it was
 * written and settled before any container existed for it. Nothing here is
 * edited to fit a layout or to fit a check: rule 13's publishing order is
 * explicit that a piece posts exactly as its author wrote it, and its point 2a
 * is the one door — a wording change the Alethical team directs is made in full.
 *
 * A guide teaches 1 term, concludes nothing, adds nothing up across members and
 * defines no classification, so it sits under
 * `.claude/rules/grounded-answers.md` rules 1 to 12 like every other surface and
 * needs no part of rule 13's exception
 * (`docs/architecture/published-writing-decisions.md` §1).
 *
 * Two things the markdown draft carries that a reader does not see here, and
 * both are conversions rather than edits:
 *
 * - The italic lead-in "*Where this comes from.*" becomes the sources block's own
 *   mono-caps label, exactly as the research piece's block is labelled by the
 *   layout rather than by a sentence inside the prose.
 * - The set line under the title is stored as set membership rather than as a
 *   standfirst, so the set's name is a fact about the piece rather than a
 *   sentence that would also print on a card. The set's name is all a reader is
 *   told: no number, ever, anywhere (§2.12).
 *
 * The 2 caucus figures ($66,750 and $56,750) and the 1,732 committees are pinned
 * to the Board's itemized-contributions download as Alethical loaded it on
 * 12 Aug 2026, which the prose states at each figure. `recordsThrough` records
 * that release; a guide's masthead prints no second date.
 *
 * No link runs out of the body. The forward links this piece will carry — the
 * $200 naming rule, and running your own ads about a race — go in when their
 * destinations post, not before (issue 1752's linking rule 6, and §2.6: a person
 * authors every term link). The set's own page does not exist either, so the
 * foot of the piece carries no link to it.
 */
import type { ResearchPiece } from '../research';

export const WHO_HAS_TO_REPORT_THEIR_MONEY: ResearchPiece = {
  slug: 'who-has-to-report-their-money',
  traits: { research: false, guide: true },
  set: { name: 'How the Money Works', position: 1 },
  indexed: true,
  title: 'Who has to report their money',
  // No standfirst: the draft's second line is the set's name, which is stored as
  // set membership above. Inventing a sentence to fill this slot would be writing
  // prose the author did not write.
  dek: '',
  authorLine: 'ALETHICAL',
  publishedOn: '2026-08-27',
  recordsThrough: '2026-08-12',
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
          text: 'Look up a Minnesota politician’s money and you will not find a person. You will find an account.',
        },
      ],
    },
    {
      kind: 'paragraph',
      runs: [
        {
          kind: 'text',
          text: 'Minnesota keeps 3 kinds of political account, and which kind you are looking at changes what the records will tell you. Telling them apart is the whole of this piece.',
        },
      ],
    },
  ],
  sections: [
    {
      heading: 'Nobody registers because they have opinions',
      railLabel: 'Nobody registers because they have opinions',
      blocks: [
        {
          kind: 'paragraph',
          runs: [
            {
              kind: 'text',
              text: 'You register with the Minnesota Campaign Finance Board when the money crosses a line the law sets, and not before. A candidate who raises or spends $750 or less in a year does not have to form a committee at all. Groups have their own lines: $1,500 for a group set up only to run its own ads about a race, $5,000 for one working on a ballot question.',
            },
          ],
        },
        {
          kind: 'paragraph',
          runs: [
            {
              kind: 'text',
              text: 'Below the line, nothing is filed. Above it, everything the account takes in and pays out becomes public.',
            },
          ],
        },
      ],
    },
    {
      heading: '1. A candidate’s own campaign committee',
      railLabel: '1. A candidate’s own campaign committee',
      blocks: [
        {
          kind: 'paragraph',
          runs: [
            {
              kind: 'text',
              text: 'All of a candidate’s campaign money moves through one account, and only that account. The Board’s handbook says it plainly: a candidate can have only one campaign committee for each office sought. The candidate cannot take in or spend campaign money outside it.',
            },
          ],
        },
      ],
    },
    {
      heading: '2. A party unit',
      railLabel: '2. A party unit',
      blocks: [
        {
          kind: 'paragraph',
          runs: [
            {
              kind: 'text',
              text: 'A party unit is an official arm of a recognized party. Minnesota recognizes them at 7 levels: the state committee, a legislative caucus, a congressional district, a county, a legislative district, a city, and a precinct. A county party organization and the state party are both party units.',
            },
          ],
        },
        {
          kind: 'paragraph',
          runs: [
            {
              kind: 'text',
              text: 'Six of them work across the whole state rather than inside one county or district. The 2 state parties:',
            },
          ],
        },
        {
          kind: 'bullets',
          items: [
            [
              {
                kind: 'text',
                text: 'the state DFL (registered as “MN DFL State Central Committee”)',
              },
            ],
            [
              {
                kind: 'text',
                text: 'the state Republican party (registered as “Republican Party of Minn”)',
              },
            ],
          ],
        },
        { kind: 'paragraph', runs: [{ kind: 'text', text: 'And the 4 legislative caucuses:' }] },
        {
          kind: 'bullets',
          items: [
            [{ kind: 'text', text: 'the House DFL caucus (“DFL House Caucus”)' }],
            [{ kind: 'text', text: 'the House Republican caucus (“HRCC”)' }],
            [{ kind: 'text', text: 'the Senate DFL caucus (“DFL Senate Caucus”)' }],
            [{ kind: 'text', text: 'the Senate Republican caucus (“Senate Victory Fund (SVF)”)' }],
          ],
        },
        {
          kind: 'paragraph',
          runs: [
            { kind: 'bold', text: 'A caucus is not a party.' },
            {
              kind: 'text',
              text: ' The word does 2 jobs. It means the legislators of one party in one chamber, and it means the registered account that raises money for that chamber’s races. Each of the 4 above is its own account, with its own bank balance and its own filings. Money sitting in the DFL House Caucus account is not money sitting in the state DFL’s account.',
            },
          ],
        },
      ],
    },
    {
      heading: '3. A political committee or fund',
      railLabel: '3. A political committee or fund',
      blocks: [
        {
          kind: 'paragraph',
          runs: [{ kind: 'text', text: 'This is the one most people call a PAC.' }],
        },
        {
          kind: 'paragraph',
          runs: [
            { kind: 'text', text: 'A political ' },
            { kind: 'bold', text: 'committee' },
            { kind: 'text', text: ' is a group whose main purpose is politics. A political ' },
            { kind: 'bold', text: 'fund' },
            {
              kind: 'text',
              text: ' is a separate pot of political money kept by an organization that exists to do something else, like a trade association or a union. Same records either way. What differs is what the organization is for.',
            },
          ],
        },
        {
          kind: 'paragraph',
          runs: [
            {
              kind: 'text',
              text: 'Minnesota’s optometrists keep one, registered as “Optometry PAC”. Counting from 2015, and counting the Board’s itemized contributions download as Alethical loaded it on 12 August 2026, it sent $66,750 to the 2 DFL legislative caucuses and $56,750 to the 2 Republican legislative caucuses.',
            },
          ],
        },
        {
          kind: 'paragraph',
          runs: [
            {
              kind: 'text',
              text: 'Both figures count only payments to those 4 accounts, and only the payments Minnesota requires a name for. Neither one is everything it gave.',
            },
          ],
        },
        {
          kind: 'paragraph',
          runs: [
            {
              kind: 'text',
              text: 'And why it gave to both sides is not in the records. A filing says who, how much, and when. It does not say why, and neither will we.',
            },
          ],
        },
      ],
    },
    {
      heading: 'The kind decides what you can see',
      railLabel: 'The kind decides what you can see',
      blocks: [
        {
          kind: 'paragraph',
          runs: [
            {
              kind: 'text',
              text: 'Look up a candidate’s committee on the Board’s own site and you get 17 lines for the year. Five of them split the incoming money by who it came from: individuals, lobbyists, other committees and funds, party units, and everything else.',
            },
          ],
        },
        {
          kind: 'paragraph',
          runs: [
            {
              kind: 'text',
              text: 'Look up a party unit or a political committee or fund and you get 16 lines. The 5 are replaced by 1, reading “Contributions received”.',
            },
          ],
        },
        {
          kind: 'paragraph',
          runs: [
            {
              kind: 'text',
              text: 'So “where did this money come from?” is a question the records answer for a candidate and do not answer for a caucus. Same Board, same year, different form.',
            },
          ],
        },
      ],
    },
    {
      heading: 'An account is not a person',
      railLabel: 'An account is not a person',
      blocks: [
        {
          kind: 'paragraph',
          runs: [
            {
              kind: 'text',
              text: 'One committee per office sought has a consequence. Somebody who serves in the House and later runs for the Senate has 2 accounts, not 1.',
            },
          ],
        },
        {
          kind: 'paragraph',
          runs: [
            {
              kind: 'text',
              text: 'From 2015 onward, 1,732 candidate committees received a named donation. That is 1,732 accounts. The number of people behind them is smaller, and nothing in those records says by how much.',
            },
          ],
        },
        {
          kind: 'paragraph',
          runs: [
            {
              kind: 'text',
              text: 'Most of those 1,732 cannot be looked up on the Board’s register at all. The register lists who is registered right now, and an account drops off it once it closes.',
            },
          ],
        },
        {
          kind: 'paragraph',
          runs: [{ kind: 'text', text: 'So counting committees is not counting candidates.' }],
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
              text: 'Minnesota requires an account to name a donor once that person’s giving passes $200 in total for the calendar year, and lets it name smaller donors too. Every figure above sits on one side of that line.',
            },
          ],
        },
        {
          kind: 'paragraph',
          runs: [
            {
              // Guide 2's address as a literal, not computed from its slug: guide 2
              // already imports this file to build its own back link, so importing it
              // back would be a cycle resolved at module scope. A test in
              // research.test.ts asserts this literal equals guide 2's real path, so a
              // slug change fails loudly rather than dangling.
              kind: 'internalLink',
              text: 'What the records name, and what they leave out',
              href: '/read/guides/what-the-records-name',
            },
            { kind: 'text', text: ' is the other side.' },
          ],
        },
      ],
    },
  ],
  // The closing block's sentences carry more than 1 link each, so they are stored
  // as runs. See `sourceRuns` in lib/research.ts for why both shapes exist.
  sources: [],
  sourceRuns: [
    [
      { kind: 'text', text: 'Who must register, and at what amount: the Board’s ' },
      {
        kind: 'externalLink',
        text: 'campaign finance program overview',
        href: 'https://cfb.mn.gov/citizen-resources/board-programs/overview/campaign-finance/',
      },
      { kind: 'text', text: '.' },
    ],
    [
      { kind: 'text', text: 'One committee per office sought: the Board’s ' },
      {
        kind: 'externalLink',
        text: 'Legislative and Constitutional Office Candidate Handbook',
        href: 'https://cfb.mn.gov/pdf/publications/handbooks/candidate_handbook.pdf',
      },
      { kind: 'text', text: ' (last revised 30 April 2026) and ' },
      {
        kind: 'externalLink',
        text: 'Minnesota Statutes 10A.105',
        href: 'https://www.revisor.mn.gov/statutes/cite/10A.105',
      },
      { kind: 'text', text: '.' },
    ],
    [
      { kind: 'text', text: 'What a party unit is: the Board’s ' },
      {
        kind: 'externalLink',
        text: 'Political Party Unit Handbook',
        href: 'https://cfb.mn.gov/pdf/publications/handbooks/PTU_handbook.pdf',
      },
      { kind: 'text', text: ' and ' },
      {
        kind: 'externalLink',
        text: 'Minnesota Statutes 10A.01',
        href: 'https://www.revisor.mn.gov/statutes/cite/10A.01',
      },
      { kind: 'text', text: ' subdivision 30.' },
    ],
    [
      { kind: 'text', text: 'What a political committee or fund is: the Board’s ' },
      {
        kind: 'externalLink',
        text: 'Political Committee and Political Fund Handbook',
        href: 'https://cfb.mn.gov/pdf/publications/handbooks/PCF_handbook.pdf',
      },
      { kind: 'text', text: ' and Minnesota Statutes 10A.01 subdivisions 27 and 28.' },
    ],
    [
      { kind: 'text', text: 'Naming a donor at $200: ' },
      {
        kind: 'externalLink',
        text: 'Minnesota Statutes 10A.20',
        href: 'https://www.revisor.mn.gov/statutes/cite/10A.20',
      },
      { kind: 'text', text: ' subdivision 3.' },
    ],
    [
      {
        kind: 'text',
        text: 'The 6 party units named above, and who is registered today: the Board’s own registers of ',
      },
      {
        kind: 'externalLink',
        text: 'candidates',
        href: 'https://cfb.mn.gov/reports-and-data/viewers/campaign-finance/candidates/',
      },
      { kind: 'text', text: ', ' },
      {
        kind: 'externalLink',
        text: 'party units',
        href: 'https://cfb.mn.gov/reports-and-data/viewers/campaign-finance/party-unit/',
      },
      { kind: 'text', text: ' and ' },
      {
        kind: 'externalLink',
        text: 'committees and funds',
        href: 'https://cfb.mn.gov/reports-and-data/viewers/campaign-finance/political-committee-fund/',
      },
      { kind: 'text', text: ', where the reporting forms for each kind can also be read.' },
    ],
    [
      { kind: 'text', text: 'The optometrists’ figures and the 1,732 committees: the Board’s ' },
      {
        kind: 'externalLink',
        text: 'itemized contributions bulk download',
        href: 'https://cfb.mn.gov/reports-and-data/self-help/data-downloads/campaign-finance/',
      },
      { kind: 'text', text: ', as Alethical loaded it on 12 August 2026.' },
    ],
  ],
};
