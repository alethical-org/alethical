/**
 * "The Money Only Goes One Way", posted 20 Aug 2026.
 *
 * The prose is Eugene's, transcribed word for word. Rule 13's publishing order
 * is explicit that a report posts exactly as its author wrote it, so nothing
 * here is edited to fit a layout or to fit a check: the layout accommodates the
 * prose, and the figure check happens after posting, on the live page.
 *
 * The report is posted unlisted (`listed: false`). Listing it publicly is
 * Eugene's decision, made once the figure check has resolved.
 */
import type { MoneyReport, ReportBlock } from '../moneyReports';

const p = (text: string): ReportBlock => ({ kind: 'paragraph', runs: [{ kind: 'text', text }] });

export const MONEY_ONLY_GOES_ONE_WAY: MoneyReport = {
  slug: 'the-money-only-goes-one-way',
  listed: false,
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
      anchor: 'start-with-your-own-check',
      heading: 'Start with your own check',
      railLabel: 'Your own check',
      blocks: [
        p(
          'The middle-of-the-road donation to a Minnesota candidate is $200. The middle-of-the-road candidate for state office raises about $13,400 for the whole campaign.',
        ),
        p(
          "That's the scale most people picture when they think about political money: a neighbor running for the legislature, a few hundred donors, a yard sign budget.",
        ),
        p('Now the actual scale.'),
        p('Over eleven years, all 1,699 candidates for state office combined raised $108 million.'),
        p(
          'Over those same eleven years, six committees — the four legislative caucuses and the two state parties — took in $221 million.',
        ),
        p('Six organizations. Twice the money of every candidate in the state put together.'),
      ],
    },
    {
      anchor: 'the-one-way-valve',
      heading: 'The one-way valve',
      railLabel: 'The one-way valve',
      blocks: [
        p("Here's the part almost nobody knows."),
        p(
          "Candidate committees sent $13.9 million up to those six party and caucus committees. Dues, transfers, contributions — money leaving a candidate's account and landing in the machinery's account.",
        ),
        p('Those same six committees sent $730,338 back down to candidate committees.'),
        p('Nineteen dollars up for every one dollar down.'),
        p(
          'So where did the rest go? Of the $58.6 million the big six paid out in contributions, $52.9 million went to other party units — sideways and upward, into state central committees and federal accounts. 1.2% reached a candidate.',
        ),
        p('The money does not trickle down. It pools.'),
      ],
    },
    {
      anchor: 'but-the-party-spends-on-the-candidates-behalf',
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
      anchor: 'why-this-isnt-a-party-story',
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
    },
    {
      anchor: 'the-number-that-dwarfs-all-of-it',
      heading: 'The number that dwarfs all of it',
      railLabel: 'The biggest number',
      blocks: [
        p('Everything above is about elections. Elections are the small part.'),
        p(
          'Companies and organizations reported spending $886 million lobbying Minnesota government from 2015 through 2025.',
        ),
        p(
          'That is more than every candidate, every caucus, and both state parties combined — with room to spare.',
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
    },
    {
      anchor: 'what-the-shape-actually-looks-like',
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
      anchor: 'what-to-do-about-it',
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
  sources: [
    {
      text: 'Minnesota Campaign Finance Board bulk data downloads — itemized contributions (583,120 records), itemized expenditures, and itemized independent expenditures over $200 (41,130 records), 2015–2026.',
      note: 'Itemized data excludes contributions below the disclosure threshold; official filed report totals are the authoritative figures for any individual committee.',
    },
    { text: 'CFB lobbying principal expenditure reports, 2015–2025.' },
  ],
};
