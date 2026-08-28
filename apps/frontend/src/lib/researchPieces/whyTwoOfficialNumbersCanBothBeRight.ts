/**
 * "Why 2 official numbers can both be right", posted 27 Aug 2026 — the third
 * piece in the set "How the Money Works", and the third carrying only the
 * **guide** trait.
 *
 * The prose is transcribed word for word from
 * `docs/reader-guides/why-2-official-numbers-can-both-be-right.md`, which is
 * where it was written and settled before any container existed for it. Nothing
 * here is edited to fit a layout or to fit a check: rule 13's publishing order is
 * explicit that a piece posts exactly as its author wrote it, and its point 2a is
 * the one door — a wording change the Alethical team directs is made in full.
 *
 * A guide teaches 1 part of how the system works, concludes nothing, adds nothing
 * up across members and defines no classification, so it sits under
 * `.claude/rules/grounded-answers.md` rules 1 to 12 like every other surface and
 * needs no part of rule 13's exception.
 *
 * **Every figure below is read off one committee's own filings at the Board**, so
 * no sentence compares the Board's records with ours. That is deliberate:
 * [#1647](https://github.com/alethical-org/alethical/issues/1647) forbids
 * publishing a mid-year difference as Minnesota contradicting itself, and
 * [PR #1646](https://github.com/alethical-org/alethical/pull/1646) found a shipped
 * sentence naming a direction that was false on 33 of the 76 disagreeing
 * committee-years. The manuscript's own header records which report supplied each
 * figure and why the 2026 1st Quarter Report's money figures are absent: that
 * report has 2 versions stating different totals, and the piece prints only
 * figures a reader will see whichever version they open.
 *
 * The 3 conversions from the markdown are the same 3 the earlier guides make: the
 * italic "*Where this comes from.*" lead-in becomes the sources block's own label,
 * the set line under the title is stored as set membership, and the relative
 * markdown links become real inward links to reader-facing addresses.
 */

import type { ResearchPiece } from '../research';
import { WHAT_THE_RECORDS_NAME } from './whatTheRecordsName';
import { WHO_HAS_TO_REPORT_THEIR_MONEY } from './whoHasToReportTheirMoney';

/**
 * The addresses of the 2 earlier pieces this one links back to, taken from the
 * registry rather than typed, so the links move if either piece ever moves. Built
 * here rather than with `piecePath` to keep this module free of a cycle back
 * through `lib/research.ts`, which imports this file.
 */
const PIECE_ONE_PATH = `/read/guides/${WHO_HAS_TO_REPORT_THEIR_MONEY.slug}`;

const PIECE_TWO_PATH = `/read/guides/${WHAT_THE_RECORDS_NAME.slug}`;

/**
 * The next piece's address as a literal, not computed from its slug: this file
 * cannot import it without the pair becoming a module-scope cycle once that piece
 * links back here. A test in research.test.ts asserts this literal equals its real
 * path, so a slug change fails loudly rather than dangling.
 */
const PIECE_FOUR_PATH = '/read/guides/money-spent-without-a-campaigns-say';

export const WHY_TWO_OFFICIAL_NUMBERS_CAN_BOTH_BE_RIGHT: ResearchPiece = {
  slug: 'why-2-official-numbers-can-both-be-right',
  traits: { research: false, guide: true },
  set: { name: 'How the Money Works', position: 3 },
  indexed: true,
  title: 'Why 2 official numbers can both be right',
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
          text: 'Ask a Minnesota campaign account how much money it has taken in this year, and its own filings hand you several different answers. None of them is a mistake.',
        },
      ],
    },
    {
      kind: 'paragraph',
      runs: [
        {
          kind: 'text',
          text: 'A filing answers a narrower question than the one most people are asking. Once you can see which narrower question a number belongs to, the numbers stop fighting each other.',
        },
      ],
    },
  ],
  sections: [
    {
      heading: 'Every filing carries 2 totals for the same money',
      railLabel: 'Every filing carries 2 totals for the same money',
      blocks: [
        {
          kind: 'paragraph',
          runs: [
            {
              kind: 'text',
              text: 'An account has to name a giver only once that person passes $200 for the calendar year, and everything under that line is reported as a single figure with no names behind it. That is ',
            },
            {
              kind: 'internalLink',
              text: 'the rule, and what it leaves out',
              href: PIECE_TWO_PATH,
            },
            { kind: 'text', text: '.' },
          ],
        },
        {
          kind: 'paragraph',
          runs: [
            {
              kind: 'text',
              text: 'So every filing ends up with 2 figures for the money that came in: the payments it lists by name, and all of it.',
            },
          ],
        },
        {
          kind: 'paragraph',
          runs: [
            {
              kind: 'text',
              text: 'The Republican Party of Minn is Minnesota’s state Republican party, registered with the Board as a ',
            },
            { kind: 'internalLink', text: 'party unit', href: PIECE_ONE_PATH },
            {
              kind: 'text',
              text: '. Its 2026 report covering 1 January to 20 July prints both figures in the same block, in the form’s own words:',
            },
          ],
        },
        {
          kind: 'bullets',
          items: [
            [{ kind: 'text', text: 'Total of itemized: $381,289.00' }],
            [{ kind: 'text', text: 'Total of non-itemized: $480,925.83' }],
            [{ kind: 'text', text: 'Totals: $862,214.83' }],
          ],
        },
        {
          kind: 'paragraph',
          runs: [
            {
              kind: 'text',
              text: '“How much had this account raised by 20 July?” is $862,214.83. “How much of that came from people the records name?” is $381,289.00. Both are correct, and more than half of the money has nobody’s name on it.',
            },
          ],
        },
      ],
    },
    {
      heading: 'A later report is not more money',
      railLabel: 'A later report is not more money',
      blocks: [
        {
          kind: 'paragraph',
          runs: [
            {
              kind: 'text',
              text: 'An account that reports more than once a year ends up with several filings covering that same year. Adding them together is the natural thing to do, and it is wrong.',
            },
          ],
        },
        {
          kind: 'paragraph',
          runs: [
            {
              kind: 'text',
              text: 'The law is short about it. A report “must cover the period from January 1 of the reporting year to seven days before the filing date”.',
            },
          ],
        },
        {
          kind: 'paragraph',
          runs: [
            {
              kind: 'text',
              text: 'The Board says the same thing to the people who keep the books, in the handbooks for all 3 kinds of account: “Each reporting period includes all contributions received during the year, not just the contributions received since the last report.”',
            },
          ],
        },
        {
          kind: 'paragraph',
          runs: [
            {
              kind: 'text',
              text: 'So a year’s reports are not consecutive slices of it. Each one is the whole year so far, drawn again, ending later than the last.',
            },
          ],
        },
        {
          kind: 'paragraph',
          runs: [
            {
              kind: 'text',
              text: 'That party unit’s first 3 reports for 2026 all start on 1 January. They stop on 31 March, 31 May and 20 July.',
            },
          ],
        },
        {
          kind: 'paragraph',
          runs: [
            {
              kind: 'text',
              text: 'Through 31 May it reported $793,775.83 of contributions. Through 20 July, $862,214.83. Two official numbers, one account, one year, both right. The second one contains the first. Add them together and you have counted most of the money twice.',
            },
          ],
        },
      ],
    },
    {
      heading: 'The line is drawn on the year, and a report stops in the middle of one',
      railLabel: 'The line is drawn on the year, and a report stops in the middle of one',
      blocks: [
        {
          kind: 'paragraph',
          runs: [
            {
              kind: 'text',
              text: 'The $200 test runs on a giver’s total for the whole calendar year. A report that closes on 31 March can only apply that test to the money that has arrived by 31 March.',
            },
          ],
        },
        {
          kind: 'paragraph',
          runs: [
            {
              kind: 'text',
              text: 'So the same person can be unnamed on one report and named on the next, without anything about their money having changed.',
            },
          ],
        },
        {
          kind: 'paragraph',
          runs: [
            {
              kind: 'text',
              text: 'It happens on the reports above. One giver sent that party unit $200.00 on 26 February. On the report closing 31 March, their total for the year stood at exactly $200.00, and a name is required only once a giver goes past $200. So no name was required, and the money sat inside the figure with no names behind it.',
            },
          ],
        },
        {
          kind: 'paragraph',
          runs: [
            {
              kind: 'text',
              text: 'The same person sent another $200.00 on 23 April. On the report closing 31 May, they are listed by name, and both payments are printed under it, February’s included.',
            },
          ],
        },
        {
          kind: 'paragraph',
          runs: [
            {
              kind: 'text',
              text: 'February’s $200.00 did not move and did not change. What changed is the question the later report had to answer.',
            },
          ],
        },
      ],
    },
    {
      heading: 'What to check before you trust a figure',
      railLabel: 'What to check before you trust a figure',
      blocks: [
        {
          kind: 'paragraph',
          runs: [{ kind: 'text', text: 'Three things, and the filing prints all 3 itself.' }],
        },
        {
          kind: 'bullets',
          items: [
            [
              { kind: 'bold', text: 'The dates.' },
              {
                kind: 'text',
                text: ' Every report says at the top what period it covers. A money figure without its dates is not finished.',
              },
            ],
            [
              { kind: 'bold', text: 'Which of the 2 numbers it is.' },
              { kind: 'text', text: ' The payments with names on them, or all of the money.' },
            ],
            [
              { kind: 'bold', text: 'Which version.' },
              {
                kind: 'text',
                text: ' A report can be filed again with corrections, and the newest version is the one that counts. The cover of an amended one says so: “This report amends a previously filed report for the same period.”',
              },
            ],
          ],
        },
        {
          kind: 'paragraph',
          runs: [
            {
              kind: 'text',
              text: 'Check those 3 and the contradiction goes away. What is left is 2 answers to 2 different questions.',
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
              text: 'Every figure above is money that arrived in a registered account and was reported by that account. Some political money never goes near one. A group can pay for its own advertising about a race without the campaign being involved, and none of that money passes through the campaign’s books.',
            },
          ],
        },
        {
          kind: 'paragraph',
          runs: [
            {
              kind: 'internalLink',
              text: 'Money spent without a campaign’s say',
              href: PIECE_FOUR_PATH,
            },
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
        text: 'The 2 figures on a filing, the 3 reports and the dates they cover, and the giver’s 2 payments: the Republican Party of Minn’s own 2026 reports to Minnesota’s Campaign Finance Board, filed under registration number 20008 and read at the Board on 27 August 2026.',
      },
    ],
    [
      {
        kind: 'text',
        text: 'They are its 1st Quarter Report covering 1 January to 31 March, its June Report covering 1 January to 31 May, and its Pre-Primary Report covering 1 January to 20 July.',
      },
    ],
    [
      {
        kind: 'text',
        text: 'Every registered account’s filed reports are reachable from the Board’s own register, in this case its register of ',
      },
      {
        kind: 'externalLink',
        text: 'party units',
        href: 'https://cfb.mn.gov/reports-and-data/viewers/campaign-finance/party-unit/',
      },
      { kind: 'text', text: '.' },
    ],
    [
      {
        kind: 'text',
        text: 'That every report starts on 1 January, and the words quoted for it: ',
      },
      {
        kind: 'externalLink',
        text: 'Minnesota Statutes 10A.20',
        href: 'https://www.revisor.mn.gov/statutes/cite/10A.20',
      },
      { kind: 'text', text: ' subdivision 4.' },
    ],
    [
      {
        kind: 'text',
        text: 'The same rule in the Board’s own words to whoever keeps an account’s books, in the same words in all 3: its ',
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
      { kind: 'text', text: ' (last revised 22 August 2026) and its ' },
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
        text: 'The $200 naming rule, and that the law draws it at more than $200: Minnesota Statutes 10A.20 subdivision 3, paragraphs (c) and (p).',
      },
    ],
  ],
};
