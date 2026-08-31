/**
 * "The Money Only Goes One Way", posted 20 Aug 2026.
 *
 * The prose is Eugene's, transcribed word for word. Rule 13's publishing order
 * is explicit that a report posts exactly as its author wrote it, so nothing
 * here is edited to fit a layout or to fit a check: the layout accommodates the
 * prose, and the figure check happens after posting, on the live page. Point 2a
 * is the one door: a wording change the Alethical team directs is made in full,
 * which is a different act from us softening a line to pass a check.
 *
 * Live on the site from the day it posted, and visible to search engines from
 * that day too (`indexed: true`, set in #1767). The figure check runs on the
 * live page rather than gating it: rule 13's publishing order, points 3 to 5.
 */
import type { ResearchPiece, ResearchBlock } from '../research';

const p = (text: string): ResearchBlock => ({ kind: 'paragraph', runs: [{ kind: 'text', text }] });

export const MONEY_ONLY_GOES_ONE_WAY: ResearchPiece = {
  slug: 'the-money-only-goes-one-way',
  // Research only: it concludes, and it adds figures up across members, which is
  // rule 13's exception. It teaches nothing as its purpose, so it carries no guide
  // trait, and the label a reader sees derives from that
  // (docs/architecture/published-writing-decisions.md §2.7 and §2.8).
  traits: { research: true, guide: false },
  indexed: true,
  title: 'The Money Only Goes One Way',
  dek: "If you've ever given $50 to a candidate, this is where it went.",
  authorLine: 'ALETHICAL',
  publishedOn: '2026-08-20',
  recordsThrough: '2026-07-20',
  filingBodies: ['Minnesota Campaign Finance Board'],
  undatedRecordsNote:
    'The lobbying figures come from records Alethical does not hold, so they carry no records-through date.',
  shortVersion: [
    p(
      'Every number below comes from public Minnesota Campaign Finance Board records, 2015 through 2026. You can look up every one of them yourself. Nothing here is an opinion about a party.',
    ),
  ],
  sections: [
    {
      heading: 'Start with your own check',
      railLabel: 'Your own check',
      blocks: [
        p(
          'The middle-of-the-road donation to a Minnesota candidate is $200. The middle-of-the-road candidate for state office raises about $13,000 for the whole campaign.',
        ),
        p(
          "That's the scale most people picture when they think about political money: a neighbor running for the legislature, a few hundred donors, a yard sign budget.",
        ),
        p('Now the actual scale.'),
        p(
          'Over eleven years, 1,732 campaign accounts for state office took in $108 million between them. That is accounts rather than people: someone who serves in the House and later runs for the Senate has 2.',
        ),
        p(
          'Over those same eleven years, six committees — the four legislative caucuses and the two state parties — took in $221 million.',
        ),
        p(
          'Six organizations. Twice the money of every campaign account in the state put together, counting only the donations with a name attached. Counting every dollar they each reported taking in, unnamed donors included, it is about 1.4 times.',
        ),
        p(
          'One caution before the rest. Minnesota only requires a committee to name a donor once that person has given more than $200 in total during a calendar year, so a large share of all political money is reported as a lump figure with no names. Across the campaign accounts of sitting legislators, that unnamed share was 36.5% of the money in 2024 and 41.3% in 2025. Everything that follows below counts only the named donations.',
        ),
      ],
    },
    {
      heading: 'The one-way valve',
      railLabel: 'The one-way valve',
      blocks: [
        p("Here's the part almost nobody knows."),
        p(
          "Candidate committees sent $13.9 million up to those six party and caucus committees. Dues, transfers, contributions — money leaving a candidate's account and landing in the machinery's account.",
        ),
        p('Those same six committees sent $730,338 back down to candidate committees.'),
        p('Nineteen dollars up for every one dollar down.'),
        {
          kind: 'note',
          text: "One note on that ratio: the up and the down come from 2 different state filings, and the 2 don't fully agree. Counted from either filing alone, the ratio lands between 14.5 to 1 and 19 to 1. The direction never changes.",
        },
        p(
          'So where did the rest go? Of the $58.6 million the big six paid out in contributions, $52.9 million went to other party units — sideways and upward, into state central committees and federal accounts. 1.2% reached a candidate.',
        ),
        p(
          'The last slice, $4.9 million, went to political committees and funds — most of it to 3 groups that run their own independent ads.',
        ),
        p('The money does not trickle down. It pools.'),
      ],
    },
    {
      heading: '"But the party spends on the candidate’s behalf"',
      railLabel: 'The counterargument',
      blocks: [
        p('True, and worth being precise about, because this is the honest counterargument.'),
        p(
          "Those six committees also spent $54.7 million on independent expenditures — ads and mail about specific races. That money is spent on campaigns. It just isn't spent by them.",
        ),
        p(
          "By law it can't be coordinated with the candidate. The candidate doesn't see the script, doesn't approve the mailer, can't stop it, and often finds out the same day you do.",
        ),
        p("And here's what it buys: 60% of it was spent attacking someone, not supporting anyone."),
        p(
          'Statewide the picture is the same. All independent spending since 2015: $178.6 million, of which $96.5 million — 54% — was against a candidate rather than for one.',
        ),
        p(
          'So when money "comes back down," it usually arrives as an attack ad the candidate on the receiving end never asked for and can’t control.',
        ),
      ],
    },
    {
      heading: "Why this isn't a party story",
      railLabel: 'Not a party story',
      blocks: [
        p(
          "If the machinery were really two opposed teams, the money would sort itself into two piles. It doesn't.",
        ),
        p(
          "191 PACs gave to both parties' caucus committees. Not to one side heavily and the other by accident — to both, on purpose, year after year.",
        ),
        p(
          'Those 191 both-sides PACs account for $36.4 million of the $64.5 million in PAC money the four caucuses received. More than half of all PAC money going to legislative caucuses comes from donors funding both parties.',
        ),
        p(
          'One small example, because the small ones are the clearest. The Optometry PAC has given $226,600 since 2015. The split:',
        ),
        {
          kind: 'table',
          columns: ['Recipient', 'Amount'],
          rows: [
            ['House Republican caucus (HRCC)', '$38,200'],
            ['DFL House Caucus', '$35,250'],
            ['DFL Senate Caucus', '$31,500'],
            ['Senate Victory Fund (R)', '$18,550'],
          ],
        },
        p(
          "That is not a PAC picking a side. That's a PAC buying access to whoever wins — and it's a rounding error next to the ones doing the same thing with real money.",
        ),
      ],
      methodologyInset: {
        title: 'How we counted the 191',
        body:
          'An organization counts as giving to both sides if the Board\u2019s itemized ' +
          'contributions download records at least one payment of any size to a DFL ' +
          'legislative caucus and at least one to a Republican legislative caucus, across ' +
          '2015 to 2026. Each organization is identified by the name exactly as it appears ' +
          'on the filing. The rule changes the answer: identifying organizations by ' +
          'registration number instead gives 187 and $39.8 million, and requiring each side ' +
          'to be at least 5% of what an organization gave gives 170 and $25.9 million. ' +
          '\u201cBoth-sides PAC\u201d is our term, not the Board\u2019s. Counted from the ' +
          'download as Alethical loaded it on 12 August 2026.',
      },
    },
    {
      heading: 'The number that dwarfs all of it',
      railLabel: 'The biggest number',
      blocks: [
        p('Everything above is about elections. Elections are the small part.'),
        p(
          'Companies and organizations reported spending $886 million lobbying Minnesota government from 2015 through 2025.',
        ),
        // The comparison's own half was unstated until 29 Aug 2026: a reader could check
        // the $886 million against the method box and the linked download, and had
        // nothing at all for the side it is being compared with. Eugene directed the
        // figure and the ratio into the sentence. $329,576,005.47 is every candidate
        // committee, party unit and political committee or fund's receipts for the same
        // report years, recomputed from the Board's itemized contributions download that
        // this piece's sources already name.
        p(
          'That is more than every candidate, every caucus, and both state parties combined — with room to spare. All of them together took in $329.6 million over the same years, so lobbying is 2.69 times as much.',
        ),
        p('The biggest spenders:'),
        {
          kind: 'table',
          columns: ['Principal', 'Reported lobbying'],
          rows: [
            ['Enbridge Energy', '$25.9M'],
            ['MN Chamber of Commerce', '$24.4M'],
            ['Xcel Energy', '$21.7M'],
            ['Education Minnesota', '$11.3M'],
            ['MN Business Partnership', '$10.5M'],
          ],
        },
        p(
          "Note that this list isn't ideological either. Energy companies, a business chamber, and a teachers' union are on the same page of the same ledger.",
        ),
        p(
          "Campaign money is what gets spent before the vote. Lobbying is what gets spent after — every day of every year, whether or not there's an election on.",
        ),
      ],
      // WHY THE IDENTITY RULE IS SAFE HERE AND NOT IN THE BOX ABOVE, so nobody reasons
      // from that one to this one. "How we counted the 191" has to publish its identity
      // rule because the rule moves its answer: by registration number instead of filed
      // name it becomes 187 and $39.8 million. That file carries a contributor name the
      // FILER typed, so 1 organization drifts across spellings. This file carries 1 name
      // attached to 1 entity the BOARD registered, and it shows: across all 3,184
      // principals and all 12 years, 0 registration numbers carry more than 1 filed name,
      // 0 names carry more than 1 number, and normalizing case and whitespace merges 0
      // groups. So filed name, registration number and normalized name give the same
      // 3,056 organizations and the same 5 largest, to the cent. Measured 28 Aug 2026.
      //
      // Rule 13 lets a research piece add figures up across members, and conditions
      // that on the figure recomputing from a pinned release of OUR loaded data. We
      // hold no lobbying records, so that safeguard cannot reach these totals and
      // this box is what stands in for it: where the rows came from, what column was
      // summed, the one counting choice that could have moved the answer, and how far
      // the records run. Verified against the Board's own file and its Lobbying
      // Handbook on 28 Aug 2026 (#1802).
      methodologyInset: {
        title: 'How we counted the lobbying total',
        body:
          'The Board publishes 1 row per principal per report year, and no multi-year ' +
          'or all-principals total across those rows, so the 11-year figures here are ' +
          'our own addition of them, from its Total spent column, taking each ' +
          'organization as the Board\u2019s own registered entity. Two choices in that ' +
          'counting could have moved these figures, and neither does. A report year is a ' +
          'calendar year of spending rather than of filing: the Board\u2019s Lobbying ' +
          'Handbook has each principal filing by 15 March for \u201cthe amount spent by ' +
          'the principal in the preceding calendar year\u201d, so nothing straddles 2 ' +
          'years. And no registration number in the file carries 2 filed names and no ' +
          'name carries 2 numbers, so identifying an organization by its filed name, by ' +
          'its registration number, or by name with case and spacing normalized gives ' +
          'the same 3,056 organizations and the same 5 largest, to the cent. What the ' +
          'records cannot do is separate the 4 kinds of lobbying before 2024; everything ' +
          'earlier sits in a single general column. The rows run through the report due ' +
          '16 March 2026, and are published at ' +
          'cfb.mn.gov/reports-and-data/self-help/data-downloads/lobbying/.',
      },
    },
    {
      heading: 'What the shape actually looks like',
      railLabel: 'The shape',
      blocks: [
        p('Money enters at the bottom, from people like you, in $200 pieces.'),
        p(
          'It moves up — from candidates to caucuses, from caucuses to state parties, from state parties to federal accounts.',
        ),
        p(
          'Along the way it meets much larger money from PACs and lobbyists, most of which is funding both parties at once.',
        ),
        p(
          'What comes back down is a fraction of what went up, and it mostly arrives as advertising nobody in the race controls, more than half of it negative.',
        ),
        p('And the largest flow of all never touches an election.'),
        p("Your $200 didn't buy a seat at the table. It bought a ticket to watch the table."),
      ],
    },
    {
      heading: 'What to do about it',
      railLabel: 'What to do',
      blocks: [
        p('Nothing here requires trusting us. It requires looking.'),
        p('Pick one thing and look it up:'),
        {
          kind: 'bullets',
          items: [
            [
              {
                kind: 'text',
                text: 'Your own legislator. Who gave them money, and how much of it came from inside your district?',
              },
            ],
            [
              {
                kind: 'text',
                text: "One PAC name you don't recognize on their report. Search it. See who else it funds — including on the other side.",
              },
            ],
            [
              {
                kind: 'text',
                text: "One company you know operates in your area. Check what it's reported spending on lobbying.",
              },
            ],
          ],
        },
        p(
          "You'll find something within twenty minutes. Everyone does. That's not because Minnesota is unusually corrupt — it's because this information has always been public, and almost nobody has ever gone and read it.",
        ),
        p(
          "We're building the tools to make that easier. Until then, the records are open, they're free, and they don't care who you voted for.",
        ),
      ],
    },
  ],
  // Both entries are runs rather than `sources` entries, because the lobbying one
  // carries 2 links and that shape holds 1, and a piece sets exactly 1 of the 2
  // shapes (pinned by research.test.ts). Rule 13 requires the records behind a
  // cross-member figure computed from records we do not hold to be named AND
  // LINKED, and the download is the only address from which the $886 million
  // reproduces: the list beside it lets a reader look up 1 organisation and can
  // never produce the total. Measured on the live page 28 Aug 2026 before this
  // changed: that address appeared exactly once, as text inside the method box,
  // inside 0 anchors. The contributions sentence is carried over word for word,
  // CORRECTED 28 AUG 2026: 583,120 became 583,152. The file holds 583,152 rows, which
  // is what our own loaded snapshot carries and what guide 2 has printed since it
  // posted, so 2 live pages were giving different counts of one file and this one
  // matched neither our data nor the Board's. Eugene directed the correction under
  // rule 13 point 2a. No dated note: the piece already carries the 27 Aug note about
  // the 2 quotations the Board's handbook replacement removed, and a reader does not
  // need 2 notices for a row count that describes nobody and moves no money figure.
  //
  // Not to be confused with a gap that is NOT an error, since 2 sessions nearly filed
  // it as one: rule 12's "327,759 of the 583,152 published rows are individually under
  // $200" and guide 2's "337,888 of $200 or less" differ by exactly the 10,129 rows at
  // $200.00. Both are right; "under" excludes the threshold and "or less" includes it.
  sources: [],
  sourceRuns: [
    [
      {
        kind: 'text',
        text:
          'Minnesota Campaign Finance Board bulk data downloads \u2014 itemized ' +
          'contributions (583,152 records), itemized expenditures, and itemized ' +
          'independent expenditures over $200 (41,130 records), 2015\u20132026. ' +
          'Minnesota requires a committee to name a donor once that person has given ' +
          'more than $200 in total during a calendar year, and permits it to name ' +
          'smaller donors as well. Money from donors who are not named is reported as ' +
          'a single figure with no names attached, and this report counts only named ' +
          'payments. Official filed report totals are the authoritative figures for ' +
          'any individual committee. ',
      },
      {
        kind: 'externalLink',
        text: 'Download the same files from the Board',
        href: 'https://cfb.mn.gov/reports-and-data/self-help/data-downloads/campaign-finance/',
      },
      { kind: 'text', text: '.' },
    ],
    [
      {
        kind: 'text',
        text:
          'CFB lobbying principal expenditure reports, 2015\u20132025. Alethical holds ' +
          'no lobbying records, so every lobbying figure in this report is read from ' +
          'the Board\u2019s own reports rather than reproduced from our own data. ',
      },
      {
        // The Board moved this list and left the old address answering 200 with a page
        // reading "not available", so a reader checking our largest figure found nothing
        // (#1802). Verified live on 28 Aug 2026: this address renders "Historical
        // spending by principals on lobbying activities", covering 2007 through the
        // report due 16 Mar 2026, with a Total spent column per principal per year.
        kind: 'externalLink',
        text: 'Look up a lobbying principal at the Board',
        href: 'https://cfb.mn.gov/reports-and-data/searches-and-lists/other-reports-and-lists/current-lists/#/principal-historical-spending/all/',
      },
      { kind: 'text', text: ', or ' },
      {
        kind: 'externalLink',
        text: 'download the rows these totals are added up from',
        href: 'https://cfb.mn.gov/reports-and-data/self-help/data-downloads/lobbying/',
      },
      { kind: 'text', text: '.' },
    ],
  ],
};
