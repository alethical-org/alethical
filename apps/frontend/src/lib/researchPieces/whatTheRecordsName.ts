/**
 * "What the records name, and what they leave out", posted 27 Aug 2026 — the
 * second piece in the set "How the Money Works", and the second carrying only
 * the **guide** trait.
 *
 * The prose is transcribed word for word from
 * `docs/reader-guides/what-the-records-name.md`, which is where it was written
 * and settled before any container existed for it. Nothing here is edited to fit
 * a layout or to fit a check: rule 13's publishing order is explicit that a piece
 * posts exactly as its author wrote it, and its point 2a is the one door — a
 * wording change the Alethical team directs is made in full.
 *
 * That draft carries a correction in its own header, and it is already applied to
 * the prose below rather than pending: its withdrawn item 4 argued that no
 * account may name a smaller giver voluntarily, and the measurement disproves it.
 * So the piece says "Some accounts name them anyway. The $200 is a floor on who a
 * committee **must** name, not a ceiling on who it may." Nothing in this file may
 * reinstate the absolute (`.claude/rules/grounded-answers.md` rule 12, and
 * [issue 1755](https://github.com/alethical-org/alethical/issues/1755)).
 *
 * A guide teaches 1 term, concludes nothing, adds nothing up across members and
 * defines no classification, so it sits under
 * `.claude/rules/grounded-answers.md` rules 1 to 12 like every other surface and
 * needs no part of rule 13's exception
 * (`docs/architecture/published-writing-decisions.md` §1). The draft's own header
 * records the cross-member share it refuses to carry for exactly that reason:
 * every figure below is a count of rows in the Board's published download, which
 * is a fact about the download, never an aggregate about a group of named people.
 *
 * Three things the markdown draft carries that a reader does not see here, and
 * all 3 are conversions rather than edits:
 *
 * - The italic lead-in "*Where this comes from.*" becomes the sources block's own
 *   mono-caps label, exactly as the research piece's block is labelled by the
 *   layout rather than by a sentence inside the prose.
 * - The set line under the title is stored as set membership rather than as a
 *   standfirst, so the set's name is a fact about the piece rather than a
 *   sentence that would also print on a card. The set's name is all a reader is
 *   told: no number, ever, anywhere (§2.12).
 * - The 2 relative markdown links to piece 1 become real inward links to its
 *   reader-facing address, which is what the draft's header instructs whoever
 *   builds the page to do. They resolve because that piece is posted; a forward
 *   link to piece 3 is still absent because piece 3 is not (issue 1752's linking
 *   rule 6).
 *
 * Every figure is pinned to the Board's itemized-contributions download as
 * Alethical loaded it on 12 Aug 2026, which the prose states at the figure.
 * `recordsThrough` records that release; a guide's masthead prints no second date.
 */
import type { ResearchPiece } from '../research';
import { WHO_HAS_TO_REPORT_THEIR_MONEY } from './whoHasToReportTheirMoney';

/**
 * Piece 1's own address, taken from the registry rather than typed, so the 2
 * inward links below move with it if it ever moves. Built here rather than
 * imported from `piecePath` to keep this module free of a cycle back through
 * `lib/research.ts`, which imports this file.
 */
const PIECE_ONE_PATH = `/read/guides/${WHO_HAS_TO_REPORT_THEIR_MONEY.slug}`;

export const WHAT_THE_RECORDS_NAME: ResearchPiece = {
  slug: 'what-the-records-name',
  traits: { research: false, guide: true },
  set: { name: 'How the Money Works', position: 2 },
  indexed: true,
  // Rule 13 point 7a: the corrected wording replaces the wrong wording and this dated
  // banner is its only trace. Eugene approved the cut on 27 Aug 2026.
  correction: {
    datedLabel: 'CORRECTED AUG 27 2026',
    note: 'Two quotations from the Board\u2019s Political Party Unit Handbook were removed. The Board replaced that handbook the day this piece posted, and the served copy no longer contains them.',
  },
  title: 'What the records name, and what they leave out',
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
          text: 'Look up a Minnesota campaign account and you get a list of names. The list is real. It is not everyone who gave.',
        },
      ],
    },
    {
      kind: 'paragraph',
      runs: [
        {
          kind: 'text',
          text: 'A single number decides who lands on it. This piece is about that number, and about the money that sits on the other side of it.',
        },
      ],
    },
  ],
  sections: [
    {
      heading: 'The line is a year, not a gift',
      railLabel: 'The line is a year, not a gift',
      blocks: [
        {
          kind: 'paragraph',
          runs: [
            {
              kind: 'text',
              text: 'The rule sits in the law that says what a filing has to disclose. An account has to name a giver once that person’s contributions, “in aggregate within the year”, pass $200.',
            },
          ],
        },
        {
          kind: 'paragraph',
          runs: [
            {
              kind: 'text',
              text: 'Read that twice. It is a test on one giver’s total for the calendar year. It is not a test on the size of any single payment.',
            },
          ],
        },
        {
          kind: 'paragraph',
          runs: [
            {
              kind: 'text',
              text: 'Minnesota’s Campaign Finance Board publishes a handbook for whoever keeps an account’s books, and it says what the test means in practice. If one donor’s gifts add up to more than $200, “you must itemize them all, listing each contribution separately on the report under the donor’s name.” The handbooks for ',
            },
            {
              kind: 'internalLink',
              text: 'all 3 kinds of account',
              href: PIECE_ONE_PATH,
            },
            { kind: 'text', text: ' carry that sentence word for word.' },
          ],
        },
        {
          kind: 'paragraph',
          runs: [
            {
              kind: 'text',
              text: 'So a $25 gift can carry a name. Not because $25 is a lot. Because the person who gave it reached $200 with that account by the end of the year.',
            },
          ],
        },
        {
          kind: 'paragraph',
          runs: [
            {
              kind: 'text',
              text: 'The law says the total has to exceed $200. So a giver whose total for the year is exactly $200 does not have to be named.',
            },
          ],
        },
      ],
    },
    {
      heading: 'More than half the named payments are small',
      railLabel: 'More than half the named payments are small',
      blocks: [
        {
          kind: 'paragraph',
          runs: [{ kind: 'text', text: 'You can watch the rule work in the Board’s own file.' }],
        },
        {
          kind: 'paragraph',
          runs: [
            {
              kind: 'text',
              text: 'Every named payment is published as one download, under a heading reading “Itemized contributions received of over $200”. Counting that file as Alethical loaded it on 12 August 2026, it holds 583,152 named payments. Of those, 337,888 are $200 or less, and 14 are for 1 cent.',
            },
          ],
        },
        {
          kind: 'paragraph',
          runs: [
            {
              kind: 'text',
              text: 'Almost all of those small payments, 334,234 of the 337,888, come from a giver whose payments to that same account in that same year add up to more than $200. That is the itemize-them-all instruction, 334,234 times over.',
            },
          ],
        },
        {
          kind: 'paragraph',
          runs: [
            {
              kind: 'text',
              text: 'It is tempting to read the $200 as a rule about small gifts. It is not. More than half of every named payment Minnesota publishes is a gift of $200 or less.',
            },
          ],
        },
      ],
    },
    {
      heading: 'What the line leaves out',
      railLabel: 'What the line leaves out',
      blocks: [
        { kind: 'paragraph', runs: [{ kind: 'text', text: 'Now the other side of it.' }] },
        {
          kind: 'paragraph',
          runs: [
            {
              kind: 'text',
              text: 'Somebody who gives $50 once and never gives again never reaches $200. The money is still reported. The name does not have to be.',
            },
          ],
        },
        {
          // The correction in the draft's header, applied: the absolute this
          // paragraph replaced ("are never named") is false and is queued for the
          // same fix on 4 other pages (issue 1755). Never reinstate it.
          kind: 'paragraph',
          runs: [
            {
              kind: 'text',
              text: 'Some accounts name them anyway. The $200 is a floor on who a committee ',
            },
            { kind: 'bold', text: 'must' },
            {
              kind: 'text',
              text: ' name, not a ceiling on who it may. So a reader who finds a $50 giver named in a filing is not looking at a mistake.',
            },
          ],
        },
        {
          kind: 'paragraph',
          runs: [
            {
              kind: 'text',
              text: 'The handbooks are plain about where it goes. Gifts from donors who gave $200 or less in total “should be added together and listed as a lump sum”.',
            },
          ],
        },
        {
          kind: 'paragraph',
          runs: [
            {
              kind: 'text',
              text: 'So a filing can carry a figure with no names behind it. It is real money, correctly reported, and nobody was required to name it. It is not a mistake, and it is not something Alethical failed to collect.',
            },
          ],
        },
        {
          kind: 'paragraph',
          runs: [
            {
              kind: 'text',
              text: 'That leaves one thing worth carrying around. Add up the payments in a list of names and you have not added up the money. You have added up the named part of it.',
            },
          ],
        },
      ],
    },
    {
      heading: 'What one line cannot tell you',
      railLabel: 'What one line cannot tell you',
      blocks: [
        {
          kind: 'paragraph',
          runs: [{ kind: 'text', text: 'The lump sum gives up more than names.' }],
        },
        {
          kind: 'paragraph',
          runs: [
            {
              kind: 'text',
              text: 'A named payment says who, how much, and when. Money below the line arrives as a single total. Nobody outside the campaign can split it by how many people gave, or where they live, or what they do for work, because none of that reaches the filing. The account keeps its own private record, and the public file never gets it.',
            },
          ],
        },
        {
          kind: 'paragraph',
          runs: [
            {
              kind: 'text',
              text: 'So “how many people gave to this campaign?” is a question these records cannot answer. Not because the answer is hidden. Because it was never written down anywhere a member of the public can read.',
            },
          ],
        },
      ],
    },
    {
      heading: 'One kind of account this does not cover',
      railLabel: 'One kind of account this does not cover',
      blocks: [
        {
          kind: 'paragraph',
          runs: [
            { kind: 'text', text: 'Minnesota also registers ' },
            { kind: 'internalLink', text: 'committees and funds', href: PIECE_ONE_PATH },
            {
              kind: 'text',
              // No figure for a ballot-question filer, either the statute's $500
              // or the handbooks' $200: rule 12 forbids printing one while our 2
              // sources disagree, so the piece names only that a different figure
              // applies and links both.
              text: ' set up to campaign on a ballot question, which is a vote on a proposal rather than on a person. A different figure applies to money given to those, so nothing above describes them. The law and the Board’s own handbook for those accounts are both linked below.',
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
              text: 'The lump sum with no names is why 2 official figures about the same account can both be right. Add up the payments a filing lists, compare that against the total the same filing reports, and the 2 numbers will not match. Neither one is wrong.',
            },
          ],
        },
        {
          kind: 'paragraph',
          runs: [
            {
              // Piece 3's address as a literal, not computed from its slug: piece 3
              // imports this file to build its own back link, so importing it back
              // would be a cycle resolved at module scope. A test in
              // research.test.ts asserts this literal equals piece 3's real path, so
              // a slug change fails loudly rather than dangling.
              //
              // This paragraph used to end "This paragraph gains a link to it the day
              // that piece posts". Piece 3 posted, so the link went in and that
              // sentence came out with it, because it becomes false the moment the
              // link exists. Not an edit on our own initiative, which rule 13 point 2
              // forbids: the piece's own text instructed it.
              kind: 'internalLink',
              text: 'Why 2 official numbers can both be right',
              href: '/read/guides/why-2-official-numbers-can-both-be-right',
            },
            { kind: 'text', text: ' is the next piece in this set.' },
          ],
        },
      ],
    },
  ],
  // Every source sentence here carries more than 1 link, so the block is stored
  // as runs. See `sourceRuns` in lib/research.ts for why both shapes exist.
  sources: [],
  sourceRuns: [
    [
      {
        kind: 'text',
        text: 'The $200 test, the calendar year, the word exceed, and the lump sum: ',
      },
      {
        kind: 'externalLink',
        text: 'Minnesota Statutes 10A.20',
        href: 'https://www.revisor.mn.gov/statutes/cite/10A.20',
      },
      {
        kind: 'text',
        text: ' subdivision 3, paragraphs (c) and (p), with the reporting periods in subdivision 2.',
      },
    ],
    [
      {
        kind: 'text',
        text: 'What the test means for whoever keeps the books, in the same words in all 3: the Board’s ',
      },
      {
        kind: 'externalLink',
        text: 'Legislative and Constitutional Office Candidate Handbook',
        href: 'https://cfb.mn.gov/pdf/publications/handbooks/candidate_handbook.pdf',
      },
      { kind: 'text', text: ' (last revised 30 April 2026), its ' },
      {
        kind: 'externalLink',
        text: 'Political Party Unit Handbook',
        href: 'https://cfb.mn.gov/pdf/publications/handbooks/PTU_handbook.pdf',
      },
      { kind: 'text', text: ' (last revised 7 March 2022) and its ' },
      {
        kind: 'externalLink',
        text: 'Political Committee and Political Fund Handbook',
        href: 'https://cfb.mn.gov/pdf/publications/handbooks/PCF_handbook.pdf',
      },
      { kind: 'text', text: ' (last revised 15 June 2026).' },
    ],
    [
      {
        kind: 'text',
        text: 'The reporting form’s own line for the lump sum, and the instruction not to list its donors: the Political Party Unit Handbook, in its walkthrough of a contributions schedule.',
      },
    ],
    [
      { kind: 'text', text: 'The heading on the download, and the file itself: the Board’s ' },
      {
        kind: 'externalLink',
        text: 'campaign finance data downloads',
        href: 'https://cfb.mn.gov/reports-and-data/self-help/data-downloads/campaign-finance/',
      },
      {
        kind: 'text',
        text: ' page. The counts of payments in it, as Alethical loaded that file on 12 August 2026.',
      },
    ],
    [
      {
        kind: 'text',
        text: 'Ballot question committees and funds: Minnesota Statutes 10A.20 subdivision 3 again, and the Board’s ',
      },
      {
        kind: 'externalLink',
        text: 'Independent Expenditure and Ballot Question Political Committee and Fund Handbook',
        href: 'https://cfb.mn.gov/pdf/publications/handbooks/IE_BQ_handbook.pdf',
      },
      {
        kind: 'text',
        text: ' (last revised 11 July 2023); who is registered as one today is on the Board’s register of ',
      },
      {
        kind: 'externalLink',
        text: 'committees and funds',
        href: 'https://cfb.mn.gov/reports-and-data/viewers/campaign-finance/committee-fund/',
      },
      { kind: 'text', text: '.' },
    ],
  ],
};
