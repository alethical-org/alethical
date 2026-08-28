/**
 * "Why nobody can follow a dollar", posted 27 Aug 2026 — the fifth piece in the
 * set "How the Money Works", and the fifth carrying only the **guide** trait.
 *
 * The prose is transcribed word for word from
 * `docs/reader-guides/why-nobody-can-follow-a-dollar.md`, which is where it was
 * written and settled before any container existed for it. Nothing here is edited
 * to fit a layout or to fit a check (rule 13's publishing order; point 2a is the
 * one door).
 *
 * It is `.claude/rules/grounded-answers.md` rule 12's "Separate transfers, never
 * a chain" written for a reader instead of for a builder. Nothing in it sums money
 * across accounts: every dollar figure is 1 line of 1 filing or 1 payment, and the
 * only counts are counts of distinct names in a published download.
 *
 * **It carries no closing hand-off, deliberately.** It is the last of the 5 pieces
 * [issue 1752](https://github.com/alethical-org/alethical/issues/1752) fixed, and
 * nothing commits anyone to a sixth, so naming one would be
 * `.claude/rules/grounded-answers.md` rule 2 pointed at our writing schedule. The
 * manuscript's header records where a hand-off sentence goes the day a sixth piece
 * is committed to.
 */

import type { ResearchPiece } from '../research';
import { WHO_HAS_TO_REPORT_THEIR_MONEY } from './whoHasToReportTheirMoney';
import { WHY_TWO_OFFICIAL_NUMBERS_CAN_BOTH_BE_RIGHT } from './whyTwoOfficialNumbersCanBothBeRight';

/**
 * The addresses of the 2 earlier pieces this one links back to, taken from the
 * registry rather than typed. Built here rather than with `piecePath` to keep this
 * module free of a cycle back through `lib/research.ts`.
 */
const PIECE_ONE_PATH = `/read/guides/${WHO_HAS_TO_REPORT_THEIR_MONEY.slug}`;

const PIECE_THREE_PATH = `/read/guides/${WHY_TWO_OFFICIAL_NUMBERS_CAN_BOTH_BE_RIGHT.slug}`;

export const WHY_NOBODY_CAN_FOLLOW_A_DOLLAR: ResearchPiece = {
  slug: 'why-nobody-can-follow-a-dollar',
  traits: { research: false, guide: true },
  set: { name: 'How the Money Works', position: 5 },
  indexed: true,
  title: 'Why nobody can follow a dollar',
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
          text: 'Minnesota’s records tell you what one political account paid another, on which day, down to the cent. They cannot tell you where any particular dollar ended up.',
        },
      ],
    },
    {
      kind: 'paragraph',
      runs: [
        {
          kind: 'text',
          text: 'That is not a gap somebody forgot to fill. It is what happens to money when it goes into a bank account, and no filing rule could undo it.',
        },
      ],
    },
    {
      kind: 'paragraph',
      runs: [
        {
          kind: 'text',
          text: 'Nobody is hiding it, either. The payments in this piece were all disclosed, on time and in full. What is missing is the link between them, and that was never recorded because there was never a moment at which anyone could have recorded it.',
        },
      ],
    },
  ],
  sections: [
    {
      heading: 'Two filings in a row are not a route',
      railLabel: 'Two filings in a row are not a route',
      blocks: [
        {
          kind: 'paragraph',
          runs: [
            {
              kind: 'text',
              text: 'Political accounts give to each other constantly. A fund gives to a ',
            },
            { kind: 'internalLink', text: 'caucus', href: PIECE_ONE_PATH },
            {
              kind: 'text',
              text: ', a caucus gives to a party, a party gives to a candidate. Every one of those payments is filed, dated and public.',
            },
          ],
        },
        {
          kind: 'paragraph',
          runs: [{ kind: 'text', text: 'Here are 2 of them, both real, both from the same year:' }],
        },
        {
          kind: 'bullets',
          items: [
            [
              {
                kind: 'text',
                text: '20 September 2024. The PAC for Minnesota’s Future gave $875,000.00 to the DFL House Caucus.',
              },
            ],
            [
              {
                kind: 'text',
                text: '30 October 2024. The DFL House Caucus gave $3,000.00 to Wolgamott, Dan House Committee.',
              },
            ],
          ],
        },
        {
          kind: 'paragraph',
          runs: [
            {
              kind: 'text',
              text: 'Read together they look like a route: money arrives, money leaves, so the first paid for the second. That reading is not in either record, and no record anywhere supports it. Pick any 2 accounts on any side and the answer is the same.',
            },
          ],
        },
      ],
    },
    {
      heading: 'The reason is a bank account',
      railLabel: 'The reason is a bank account',
      blocks: [
        {
          kind: 'paragraph',
          runs: [
            {
              kind: 'text',
              text: 'Money is fungible. Once a payment clears, it stops being that payment. It is a balance, and a balance has no labels on it.',
            },
          ],
        },
        {
          kind: 'paragraph',
          runs: [
            { kind: 'text', text: 'The caucus in that example began 2024 with ' },
            { kind: 'bold', text: '$1,226,555.63 already in the account' },
            {
              kind: 'text',
              text: ', raised in earlier years. So the $3,000.00 that went out in October could have come from September’s $875,000.00, or from money raised in 2023, or from any of the rest. Every one of those is possible and none of them is recorded, because there is no field in any filing that ties an incoming payment to an outgoing one.',
            },
          ],
        },
        {
          kind: 'paragraph',
          runs: [
            {
              kind: 'text',
              text: 'The other House caucus is in the same position and always was. The HRCC began 2024 with $704,630.59 of its own.',
            },
          ],
        },
        {
          kind: 'paragraph',
          runs: [
            {
              kind: 'text',
              text: 'Nor is this a matter of the account being crowded. In 2024 the Board’s published file lists 699 different names giving to the DFL House Caucus and 551 giving to the HRCC. Even if a committee took in exactly one payment and paid out exactly one, the record still would not say the second was made of the first. Fewer sources would make guessing easier, not the record fuller.',
            },
          ],
        },
      ],
    },
    {
      heading: 'What a filing does say about its own payments',
      railLabel: 'What a filing does say about its own payments',
      blocks: [
        {
          kind: 'paragraph',
          runs: [{ kind: 'text', text: 'Plenty, and it is worth knowing how much.' }],
        },
        {
          kind: 'paragraph',
          runs: [
            { kind: 'text', text: 'That same caucus’s 2024 report, which ' },
            {
              kind: 'internalLink',
              text: 'covers the year from 1 January',
              href: PIECE_THREE_PATH,
            },
            {
              kind: 'text',
              text: ', puts every cash payment it made to a candidate’s committee on one line: $9,457.38 for the whole year. The Board’s published file lists the payments behind that line, and they add to $9,457.38 to the cent. The $3,000.00 above is one of them.',
            },
          ],
        },
        {
          kind: 'paragraph',
          runs: [
            {
              kind: 'text',
              text: 'So the record is exact about what left the account and where it went. It is silent, and permanently silent, about which money that was.',
            },
          ],
        },
      ],
    },
    {
      heading: 'What a picture of the flows can and cannot mean',
      railLabel: 'What a picture of the flows can and cannot mean',
      blocks: [
        {
          kind: 'paragraph',
          runs: [
            {
              kind: 'text',
              text: 'Draw every filed transfer as an arrow and you get something true and useful: who paid whom, how much, and when. Each arrow is a filed payment standing on its own, and each one is worth drawing, because seeing which accounts deal with which others is real information.',
            },
          ],
        },
        {
          kind: 'paragraph',
          runs: [{ kind: 'text', text: 'Two things that picture must not be allowed to say.' }],
        },
        {
          kind: 'bullets',
          items: [
            [
              { kind: 'bold', text: 'That an arrow continues.' },
              {
                kind: 'text',
                text: ' Money entering an account is not the money leaving it. Two arrows meeting at the same box are 2 separate facts, not one longer arrow.',
              },
            ],
            [
              { kind: 'bold', text: 'That the shape has a meaning.' },
              {
                kind: 'text',
                text: ' A short phrase naming what the pattern proves is doing something no record does. The arrows are filings. The meaning would be ours, and we would be putting our word in the reader’s mouth on the strength of a diagram.',
              },
            ],
          ],
        },
      ],
    },
    {
      heading: 'What the records will and will not support',
      railLabel: 'What the records will and will not support',
      blocks: [
        {
          kind: 'paragraph',
          runs: [
            { kind: 'text', text: 'Sort any sentence about political money into one of 2 piles.' },
          ],
        },
        {
          kind: 'paragraph',
          runs: [
            {
              kind: 'text',
              text: 'In the record: this account gave that account this amount on this date. Its own report says so, and its own report is where you can check it.',
            },
          ],
        },
        {
          kind: 'paragraph',
          runs: [
            {
              kind: 'text',
              text: 'Not in the record, and not obtainable: whose money paid for what. That one is not waiting on better disclosure or a longer file. It stopped existing the moment the money hit an account, and every account works that way, everywhere, for everyone.',
            },
          ],
        },
        {
          kind: 'paragraph',
          runs: [
            { kind: 'text', text: 'The sentence most people want to write is some version of ' },
            { kind: 'italic', text: 'this money paid for that' },
            {
              kind: 'text',
              text: '. It is the one sentence these records cannot carry, and the moment to notice that is before writing it rather than after.',
            },
          ],
        },
        {
          kind: 'paragraph',
          runs: [
            {
              kind: 'text',
              text: 'Knowing which pile a sentence belongs in is most of what these records are good for.',
            },
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
        text: 'The 1 January 2024 cash balances, and the year’s contributions to candidate committees: the DFL House Caucus’s and the HRCC’s own 2024 year-end reports to Minnesota’s Campaign Finance Board, registration numbers 20006 and 20010, read on 27 August 2026.',
      },
    ],
    [
      {
        kind: 'text',
        text: 'Both accounts, and the reports every registered account files, are on the Board’s register of ',
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
        text: 'The 2 transfers, the payments behind the $9,457.38, and the counts of names: the Board’s ',
      },
      {
        kind: 'externalLink',
        text: 'itemized downloads of contributions received and of expenditures and contributions made',
        href: 'https://cfb.mn.gov/reports-and-data/self-help/data-downloads/campaign-finance/',
      },
      { kind: 'text', text: ', counted as they were served on 27 August 2026.' },
    ],
    [
      {
        kind: 'text',
        text: 'Every figure here that comes from a filing is stated identically in all 5 versions of that filing, which matters because a report can be filed again with corrections.',
      },
    ],
  ],
};
