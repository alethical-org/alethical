import type { ResearchPiece, ResearchInline } from '../research';
import { LOBBYIST_GIVING_INDEX_ENTRY } from '../researchIndex';
import { ARTICLE_AI_NOTE } from '../articleDisclosure';

const downloadUrl =
  'https://register.cfb.mn.gov/reports-and-data/self-help/data-downloads/campaign-finance/';
const candidatesUrl = 'https://cfb.mn.gov/reports-and-data/viewers/campaign-finance/candidates/';
const dflHouseUrl =
  'https://cfb.mn.gov/rptViewer/Main.php?do=viewPDF&searchType=Candidate&downloadpdf=true&year=25&type=ptu&period=YE&se=0&regnum=20006&amend=1&show=0#page=8';
const hrccUrl =
  'https://cfb.mn.gov/rptViewer/Main.php?do=viewPDF&searchType=Candidate&downloadpdf=true&year=25&type=ptu&period=YE&se=0&regnum=20010&amend=2&show=0#page=9';
const dflSenateUrl =
  'https://cfb.mn.gov/rptViewer/Main.php?do=viewPDF&searchType=Candidate&downloadpdf=true&year=25&type=ptu&period=YE&se=0&regnum=20011&amend=2&show=0#page=10';
const senateVictoryUrl =
  'https://cfb.mn.gov/rptViewer/Main.php?do=viewPDF&searchType=Candidate&downloadpdf=true&year=25&type=ptu&period=YE&se=0&regnum=20013&amend=3&show=0#page=6';
const availabilityUrl = 'https://cfb.mn.gov/reports-and-data/campaign-finance/';

const text = (value: string): ResearchInline => ({ kind: 'text', text: value });
const paragraph = (value: string) => ({
  kind: 'paragraph' as const,
  runs: [text(value)],
});
const filingPeriod = {
  from: '2025-01-01',
  through: '2025-12-31',
  label: '2025 annual filings',
} as const;
const checkTime = '2026-09-26T16:09:52.762583Z';
const checkedBy = 'Codex and independent peer evidence review';

export const LOBBYIST_GIVING: ResearchPiece = {
  ...LOBBYIST_GIVING_INDEX_ENTRY,
  dek: '',
  authorLine: 'ALETHICAL',
  filingBodies: ['Minnesota Campaign Finance and Public Disclosure Board'],
  shortVersion: [],
  intro: [],
  sections: [],
  sources: [],
  sourceRuns: [
    [
      {
        kind: 'externalLink',
        text: 'Minnesota Campaign Finance Board contribution download',
        href: 'https://register.cfb.mn.gov/reports-and-data/self-help/data-downloads/campaign-finance/',
      },
      text(', saved September 26, 2026'),
    ],
    [
      {
        kind: 'externalLink',
        text: 'Board candidate records',
        href: 'https://cfb.mn.gov/reports-and-data/viewers/campaign-finance/candidates/',
      },
      text(', historical election-cycle party labels'),
    ],
    [
      {
        kind: 'externalLink',
        text: 'DFL House Caucus, 2025 annual filing, page 8',
        href: 'https://cfb.mn.gov/rptViewer/Main.php?do=viewPDF&searchType=Candidate&downloadpdf=true&year=25&type=ptu&period=YE&se=0&regnum=20006&amend=1&show=0#page=8',
      },
    ],
    [
      {
        kind: 'externalLink',
        text: 'HRCC, 2025 annual filing, page 9',
        href: 'https://cfb.mn.gov/rptViewer/Main.php?do=viewPDF&searchType=Candidate&downloadpdf=true&year=25&type=ptu&period=YE&se=0&regnum=20010&amend=2&show=0#page=9',
      },
    ],
    [
      {
        kind: 'externalLink',
        text: 'DFL Senate Caucus, 2025 annual filing, page 10',
        href: 'https://cfb.mn.gov/rptViewer/Main.php?do=viewPDF&searchType=Candidate&downloadpdf=true&year=25&type=ptu&period=YE&se=0&regnum=20011&amend=2&show=0#page=10',
      },
    ],
    [
      {
        kind: 'externalLink',
        text: 'Senate Victory Fund, 2025 annual filing, page 6',
        href: 'https://cfb.mn.gov/rptViewer/Main.php?do=viewPDF&searchType=Candidate&downloadpdf=true&year=25&type=ptu&period=YE&se=0&regnum=20013&amend=3&show=0#page=6',
      },
    ],
    [
      {
        kind: 'externalLink',
        text: 'Board filing-availability notice',
        href: 'https://cfb.mn.gov/reports-and-data/campaign-finance/',
      },
    ],
  ],
  shortPost: {
    origin: 'social-adaptation',
    coverageBasis: 'held-records',
    coveragePlacement: 'metadata',
    limitationsPlacement: 'body',
    aiAssisted: true,
    evidence: [
      {
        id: 'contribution-download',
        title: 'Board contribution download',
        url: downloadUrl,
        kind: 'held-records',
        downloadSnapshot: {
          copiedOn: '2026-09-26',
          selectedRecords:
            'Contribution rows marked Lobbyist with contributor registration 580 or 8692; candidate-committee recipients, plus Carlson registration 8692 at caucus registrations 20006, 20010, 20011 and 20013',
        },
        method:
          'Read all 15 source columns; select by receipt and contributor type and registration number; count distinct candidate-committee registrations per lobbyist without deduplicating source rows or equating registrations with payments.',
        limitations:
          'The download has no filing identifier and its complete reporting-period coverage is unresolved. Repeated entries and conflicting contributor names prevent full-period giving totals.',
        version: 'sha256:7b75e3783d11f846662f317fe7d596b6d8a0549d87f8ca26105773d4cd120838',
      },
      {
        id: 'historical-candidates',
        title: 'Board candidate records',
        url: candidatesUrl,
        kind: 'held-records',
        sourceSnapshot: {
          copiedOn: '2026-09-26',
          selectedRecords:
            'Historical candidate election-cycle responses for the distinct recipient registrations linked to lobbyist registrations 580 and 8692',
        },
        method:
          'Match every selected candidate-committee registration to the Board election-cycle response covering each receipt date; assign a committee to unresolved when any needed cycle is unavailable.',
        limitations:
          'The 2016 cycle for Anne Neu’s committee is unavailable. Court committee records have N/A party labels. A committee label does not establish party on every contribution date.',
        version: 'analysis-sha256:8c916a7dfa2a2887fc24840b2088082e35231b5dd802260bf20405b72fecd5b7',
      },
      {
        id: 'dfl-house-2025',
        title: 'DFL House Caucus, 2025 annual filing, page 8',
        url: dflHouseUrl,
        kind: 'held-records',
        period: filingPeriod,
        method:
          'Read latest catalogue-listed 2025 annual filing and sum Carlson registration 8692 cash entries on page 8.',
        limitations: 'This is the fund’s reported 2025 cash, not Carlson’s full-period total.',
        version: 'sha256:6f7798edc060e8386c93622ff228b3e5c27a3d2d4b319735f782bc81daa17858',
      },
      {
        id: 'hrcc-2025',
        title: 'HRCC, 2025 annual filing, page 9',
        url: hrccUrl,
        kind: 'held-records',
        period: filingPeriod,
        method:
          'Read latest catalogue-listed 2025 annual filing and sum Carlson registration 8692 cash entries on page 9.',
        limitations: 'This is the fund’s reported 2025 cash, not Carlson’s full-period total.',
        version: 'sha256:53ca228f1246d9cd78920f2d7054f4789c5e4333507ccc35b48bcee7a60eca55',
      },
      {
        id: 'dfl-senate-2025',
        title: 'DFL Senate Caucus, 2025 annual filing, page 10',
        url: dflSenateUrl,
        kind: 'held-records',
        period: filingPeriod,
        method:
          'Read latest catalogue-listed 2025 annual filing and sum Carlson registration 8692 cash entries on page 10.',
        limitations: 'This is the fund’s reported 2025 cash, not Carlson’s full-period total.',
        version: 'sha256:e350626aab82fe78b154cd09966ca9ae674ef72539c250524b62b5269565fd3d',
      },
      {
        id: 'senate-victory-2025',
        title: 'Senate Victory Fund, 2025 annual filing, page 6',
        url: senateVictoryUrl,
        kind: 'held-records',
        period: filingPeriod,
        method:
          'Read latest catalogue-listed 2025 annual filing and sum Carlson registration 8692 cash entries on page 6.',
        limitations: 'This is the fund’s reported 2025 cash, not Carlson’s full-period total.',
        version: 'sha256:a0b9084b2410902d8f46967a0fabaa10d14562d7fa1c3bbc9ca1645377d4cf1d',
      },
      {
        id: 'filing-availability',
        title: 'Board filing-availability notice',
        url: availabilityUrl,
        kind: 'held-records',
        sourceSnapshot: {
          copiedOn: '2026-09-26',
          selectedRecords:
            'Saved Board notice and responses from 4 specifically requested older filing routes',
        },
        method:
          'Read the Board notice and inspect the 4 specific older filing responses retained with the evidence.',
        limitations:
          'The notice does not mean every older filing is unavailable; only the requested routes were unavailable when checked.',
        version: 'sha256:0279c2a7056810ac2f2193b1da0f40ab9cfe60396628e6d347b00cb96a8ddc96',
      },
    ],
    claims: [
      {
        id: 'candidate-counts',
        claim:
          'Einess has 189 and Carlson has 259 distinct candidate-committee registration numbers in the selected records.',
        evidenceIds: ['contribution-download', 'historical-candidates'],
        checkedScope:
          'Contribution rows for lobbyist registrations 580 and 8692, 2015–2026, with candidate-committee recipients.',
        method:
          'Count distinct recipient registration numbers per lobbyist and verify recipient type.',
        finding:
          'Einess 189 distinct candidate-committee registrations; Carlson 259. These count committees, not payments or individual candidates.',
        status: 'supported',
        checkedBy,
        checkedAt: checkTime,
      },
      {
        id: 'party-partition',
        claim:
          'The Einess candidate committees partition into 140 Republican, 48 DFL and 1 unresolved; Carlson’s into 85 Republican, 169 DFL, 4 court committees without a party label and 1 unresolved.',
        evidenceIds: ['contribution-download', 'historical-candidates'],
        checkedScope:
          'Distinct candidate-committee registrations for lobbyist IDs 580 and 8692, matched to historical election-cycle responses.',
        method:
          'Match each receipt date to the candidate record for its cycle, then classify each recipient registration once per lobbyist.',
        finding:
          '140+48+0+1=189 and 85+169+4+1=259. Anne Neu committee 18123 lacks the December 2016 cycle; 4 Carlson court committees are Gildea, Hudson, Procaccini and Thissen.',
        status: 'qualified',
        qualification:
          'Board party labels are cycle records and do not establish party on every contribution date; Anne Neu’s 2016 period remains unresolved.',
        checkedBy,
        checkedAt: checkTime,
      },
      {
        id: 'caucus-cash-2025',
        claim:
          'Latest catalogue-listed 2025 annual filings report Carlson cash contributions of $3,000, $3,000, $4,100 and $4,000 at the 4 named legislative caucus funds.',
        evidenceIds: [
          'dfl-house-2025',
          'hrcc-2025',
          'dfl-senate-2025',
          'senate-victory-2025',
          'contribution-download',
        ],
        checkedScope:
          'The 4 cited 2025 annual filing schedules, January 1–December 31, and matching selected source rows.',
        method:
          'Identify Carlson by registration 8692, read 19 cash entries, sum by filing, and compare those entries to the saved download.',
        finding:
          'DFL House $3,000; HRCC $3,000; DFL Senate $4,100; Senate Victory Fund $4,000. The 19 filing entries agree with the saved download.',
        status: 'supported',
        checkedBy,
        checkedAt: checkTime,
      },
      {
        id: 'full-period-gap',
        claim:
          'The full-period lobbyist giving total, caucus share and Einess and Carlson full-period amounts cannot be established from the retained material.',
        evidenceIds: ['contribution-download', 'filing-availability'],
        checkedScope:
          'The selected 2015–2026 download, candidate and caucus research, and specifically requested older reports.',
        method:
          'Inspect repeated entries, contributor-name/registration conflicts, missing filing IDs and responses from needed older filing routes.',
        finding:
          'Some rows repeat, some names conflict with IDs, source rows lack filing IDs, and specific older filings return the Board’s removal notice. No full-period total or share is published.',
        status: 'qualified',
        qualification:
          'This is an evidence gap for the retained sources, not a claim that any full-period total is impossible to establish.',
        checkedBy,
        checkedAt: checkTime,
      },
      {
        id: 'coverage-boundaries',
        claim:
          'The selected download contains receipt dates January 1, 2015 through September 15, 2026; the cited caucus filings cover January 1 through December 31, 2025.',
        evidenceIds: [
          'contribution-download',
          'dfl-house-2025',
          'hrcc-2025',
          'dfl-senate-2025',
          'senate-victory-2025',
        ],
        checkedScope:
          'Receipt date range in the retained contribution download and reporting covers of the 4 cited filings.',
        method:
          'Find minimum and maximum receipt dates, separately read filing covers, and avoid treating the download’s last receipt as complete reporting coverage.',
        finding:
          'Selected receipt dates span 2015-01-01 to 2026-09-15; the 4 annual filing covers span 2025-01-01 to 2025-12-31.',
        status: 'qualified',
        qualification:
          'The last download receipt date is not a verified end of the download’s full reporting-period coverage.',
        checkedBy,
        checkedAt: checkTime,
      },
    ],
    graphics: [],
    charts: [],
    body: [
      {
        kind: 'paragraph',
        runs: [
          text(
            'Ward Einess and Joel Carlson appear in Minnesota’s campaign-finance records alongside ',
          ),
          {
            kind: 'internalLink',
            text: 'candidate committees',
            href: '/read/guides/who-has-to-report-their-money',
          },
          text(
            ' from both major parties. Our comparison follows their lobbyist registration numbers through the state’s 2015–2026 contribution download and examines contributions to the 4 legislative caucus funds.',
          ),
        ],
      },
      { kind: 'heading', text: 'Candidate committees in the records' },
      paragraph(
        'The counts below identify distinct candidate-committee registration numbers linked to each lobbyist registration. They count committees, not payments or individual candidates. Party labels come from the Board’s records for the election cycle containing each receipt date.',
      ),
      {
        kind: 'table',
        columns: ['Recorded party label', 'Ward Einess', 'Joel Carlson'],
        rows: [
          ['Republican', '140', '85'],
          ['DFL', '48', '169'],
          ['Supreme Court committees without a party label', '0', '4'],
          ['Unresolved for at least 1 receipt period', '1', '1'],
          ['Total committee registrations', '189', '259'],
        ],
      },
      paragraph(
        'Anne Neu’s House committee is the unresolved entry in each column: later records label it Republican, but the available records do not cover the December 2016 receipts. The 4 court committees are those for Lorie Gildea, Natalie Hudson, Karl Procaccini and Paul Thissen. Each committee registration is counted once per lobbyist; these labels do not establish its party on every contribution date.',
      ),
      {
        kind: 'heading',
        text: 'Carlson’s reported contributions to the 4 caucus funds in 2025',
      },
      paragraph(
        'Caucus funds support a party’s campaigns for the House or Senate. The latest 2025 annual filings available in the saved Board catalogue list the following cash contributions from Joel Carlson, covering January 1 through December 31:',
      ),
      {
        kind: 'table',
        columns: ['Fund', 'Reported cash contributions'],
        rows: [
          ['DFL House Caucus', '$3,000'],
          ['HRCC, the House Republican caucus fund', '$3,000'],
          ['DFL Senate Caucus', '$4,100'],
          ['Senate Victory Fund, the Senate Republican fund', '$4,000'],
        ],
      },
      {
        kind: 'paragraph',
        role: 'conclusion',
        runs: [
          {
            kind: 'bold',
            text: 'Conclusion: The 2025 filings list Carlson contributions to all 4 legislative caucus funds.',
          },
          text(' This annual example does not establish total giving across 2015–2026.'),
        ],
      },
      { kind: 'heading', text: 'What remains unresolved' },
      {
        kind: 'paragraph',
        runs: [
          text(
            'We cannot establish the full-period lobbyist giving total, the caucus funds’ share, or Einess’s and Carlson’s full-period amounts. ',
          ),
          {
            kind: 'internalLink',
            text: 'Some download entries repeat reported information',
            href: '/read/research/2-records-not-always-2-donations',
          },
          text(
            ', and some contributor names conflict with their registration numbers. The file does not identify the filing behind each entry, and some older filings needed to resolve these questions are unavailable.',
          ),
        ],
      },
      {
        kind: 'method',
        essential:
          'We matched lobbyist and candidate-committee registration numbers, compared historical party records, and read the 4 caucus funds’ filed 2025 contribution schedules',
        full: 'Use the saved contribution download copied September 26, 2026. Keep rows marked “Contribution” and “Lobbyist” with a contributor registration number. Select registration 580 for Einess and 8692 for Carlson, then count distinct recipient registrations marked as candidate committees. Retain cash and donated goods or services. Do not merge people by name or count repeated rows as separate payments.\n\nFor each candidate committee, match the receipt’s election cycle to the Board’s historical candidate records. Keep a committee unresolved if a needed period is missing. Retain the court committees’ recorded “N/A” party labels as a separate group.\n\nFor the annual cash comparison, use the latest 2025 filing version listed in each retained caucus catalogue and match Carlson’s registration 8692, dates and amounts to the filed schedules. The 19 listed entries agree with the saved download.\n\nThe full download contains receipt dates from January 1, 2015 through September 15, 2026. Its full reporting-period coverage is unresolved, so that last receipt date is not a claim of complete records through September 15. The 2025 annual filings have the separate full-year coverage stated above.',
      },
    ],
    coverageNote: 'Candidate records: 2015–2026 · Caucus amounts: 2025',
    limitations:
      'We cannot establish the full-period lobbyist giving total, the caucus funds’ share, or Einess’s and Carlson’s full-period amounts.',
    disclosures: [ARTICLE_AI_NOTE],
    history: [],
    relatedSlugs: ['organizations-both-parties', 'why-2-official-numbers-can-both-be-right'],
    review: {
      editorialApprovedBy: 'Codex with independent copy acceptance',
      editorialApprovedAt: '2026-09-26T16:47:25.940Z',
      eugeneApprovedFingerprint: '16440cdd',
      eugeneReviewedAt: '2026-09-26T20:45:24.598Z',
      publicationInstructionAt: '2026-09-26T20:45:24.598Z',
      navigationRevision: {
        reviewedBy: 'Codex',
        reviewedOn: '2026-09-27',
        approvedNavigationFingerprint: '267ca371',
        approvedOn: '2026-09-27',
        releaseInstructionOn: '2026-09-27',
      },
    },
  },
};
