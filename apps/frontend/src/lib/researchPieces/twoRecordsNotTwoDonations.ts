import type { ResearchPiece, ResearchInline } from '../research';
import { TWO_RECORDS_NOT_TWO_DONATIONS_INDEX_ENTRY } from '../researchIndex';
import { chartDescription } from '../shortPostCalculations';
import { calculatedRun, type ShortPostGraphic } from '../shortPosts';

const input = {
  kind: 'comparison',
  baseline: {
    value: 1000,
    unit: 'USD',
    period: { from: '2023-01-01', through: '2023-12-20', label: 'Cited filings' },
  },
  compared: {
    value: 500,
    unit: 'USD',
    period: { from: '2023-01-01', through: '2023-12-20', label: 'Cited filings' },
  },
  baselineLabel: 'Sum of 2 matching download entries',
  comparedLabel: 'Amount of the matching entry in each filing',
  showPercentChange: false,
} as const;
const graphic: ShortPostGraphic = {
  id: 'matching-records',
  claimIds: ['download-entries', 'filing-entry', 'conclusion'],
  input,
  altDescription: chartDescription(input),
};
const amount = () => calculatedRun(graphic, 'compared-value', 'usd');
const paragraph = (text: string): { kind: 'paragraph'; runs: ResearchInline[] } => ({
  kind: 'paragraph',
  runs: text
    .split('$500')
    .flatMap((part, i) =>
      i
        ? [amount(), { kind: 'text' as const, text: part }]
        : [{ kind: 'text' as const, text: part }],
    ),
});
// Release approval is recorded in docs/operations/first-short-post-preparation.md.
export const TWO_RECORDS_NOT_TWO_DONATIONS: ResearchPiece = {
  ...TWO_RECORDS_NOT_TWO_DONATIONS_INDEX_ENTRY,
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
        text: 'Amended special-election filing, pages 1 and 5',
        href: 'https://cfb.mn.gov/rptViewer/Main.php?do=viewPDF&searchType=Candidate&downloadpdf=true&year=23&type=pcc&period=YE&se=1&regnum=19013&amend=1&show=0',
      },
    ],
    [
      {
        kind: 'externalLink',
        text: 'Later filing, pages 1 and 5',
        href: 'https://cfb.mn.gov/rptViewer/Main.php?do=viewPDF&searchType=Candidate&downloadpdf=true&year=23&type=pcc&period=YE&se=0&regnum=19013&amend=0&show=0',
      },
    ],
    [
      {
        kind: 'externalLink',
        text: 'Board contribution download page',
        href: 'https://register.cfb.mn.gov/reports-and-data/self-help/data-downloads/campaign-finance/',
      },
    ],
  ],
  shortPost: {
    origin: 'social-adaptation',
    coverageBasis: 'held-records',
    recordsScope: 'cited-filings',
    aiAssisted: true,
    evidence: [
      {
        id: 'amended-filing',
        title: 'Amended special-election filing, pages 1 and 5',
        url: 'https://cfb.mn.gov/rptViewer/Main.php?do=viewPDF&searchType=Candidate&downloadpdf=true&year=23&type=pcc&period=YE&se=1&regnum=19013&amend=1&show=0',
        kind: 'held-records',
        period: {
          from: '2023-01-01',
          through: '2023-12-20',
          label: 'Cited filings',
        },
        method:
          'Read the reporting-period cover and count the Carlson entry on Schedule A1-LOB, page 5.',
        limitations: 'The 2 download entries do not establish 2 separate donations.',
        version: 'sha256:668bed513a4a11ceaad500bfbc9270d5a15d52acb836f4585389e798a3dc205f',
      },
      {
        id: 'later-filing',
        title: 'Later filing, pages 1 and 5',
        url: 'https://cfb.mn.gov/rptViewer/Main.php?do=viewPDF&searchType=Candidate&downloadpdf=true&year=23&type=pcc&period=YE&se=0&regnum=19013&amend=0&show=0',
        kind: 'held-records',
        period: {
          from: '2023-01-01',
          through: '2023-12-20',
          label: 'Cited filings',
        },
        method:
          'Read the reporting-period cover and count the Carlson entry on Schedule A1-LOB, page 5.',
        limitations: 'The 2 download entries do not establish 2 separate donations.',
        version: 'sha256:25b84bb01c1b3bbb375e0b2ea2c8632746ca65bc90d4d869bc39763881750fcd',
      },
      {
        id: 'download',
        title: 'Board contribution download page',
        url: 'https://register.cfb.mn.gov/reports-and-data/self-help/data-downloads/campaign-finance/',
        kind: 'held-records',
        downloadSnapshot: {
          copiedOn: '2026-09-25',
          selectedRecords:
            'Recipient registration 19013; contributor registration 8692; contributor type Lobbyist; receipt type Contribution',
        },
        method:
          'Filter all source rows by the 4 stated fields; compare all 15 columns and sum Amount using decimal arithmetic.',
        limitations:
          'The overall reporting-period end of the download is unknown. This article compares only the 2 selected records with the cited filings.',
        version: 'sha256:7828aca1248607377ee9bf4f67777e422e31184f859693fac4af71bd071f70e1',
      },
    ],
    claims: [
      {
        id: 'download-entries',
        claim:
          'The Minnesota Campaign Finance Board’s download, copied September 25, 2026, contains 2 identical entries for lobbyist Joel Carlson’s reported $500 contribution to Cynthia Callais’s campaign committee on September 7, 2023.',
        evidenceIds: ['download'],
        checkedScope:
          'Only the 2 selected download records and 2 cited filings; no Carlson-wide or all-lobbyist totals.',
        method:
          'Filter all rows using the 4 stated fields, compare all 15 columns, and sum Amount.',
        finding:
          'Exactly 2 rows at parsed positions 78422 and 549053 including header; all 15 fields identical, each $500, sum $1,000. Source names Carlson, Joel, registration 8692, and Callais, Cynthia, registration 19013; date 2023-09-07.',
        status: 'supported',
        checkedBy: 'Codex preparation and independent evidence review',
        checkedAt: '2026-09-26T16:39:17.917217Z',
      },
      {
        id: 'filing-entry',
        claim:
          'The committee’s amended special-election filing lists 1 $500 Carlson entry. A later filing lists that entry again and marks its cover “No Change Since Last Report.”',
        evidenceIds: ['amended-filing', 'later-filing'],
        checkedScope:
          'Only the 2 selected download records and 2 cited filings; no Carlson-wide or all-lobbyist totals.',
        method:
          'Inspect cover and page 5 of each retained PDF; search the full 9-page text for Carlson.',
        finding:
          'Each filing contains 1 $500 Carlson entry dated 09/07/2023. Amendment received 01/03/2024; later filing received 01/31/2024, with No Change Since Last Report checked.',
        status: 'supported',
        checkedBy: 'Codex preparation and independent evidence review',
        checkedAt: '2026-09-26T16:39:17.917217Z',
      },
      {
        id: 'conclusion',
        claim:
          'The filings support 1 reported $500 contribution appearing in repeated records. The 2 download entries do not establish 2 separate donations.',
        evidenceIds: ['download', 'amended-filing', 'later-filing'],
        checkedScope:
          'Only the 2 selected download records and 2 cited filings; no Carlson-wide or all-lobbyist totals.',
        method:
          'Compare matching source fields with both filing entries and the later filing cover.',
        finding:
          'The filings support 1 reported $500 contribution appearing in repeated records. The download alone does not establish distinct donations or explain exporter behavior.',
        status: 'supported',
        checkedBy: 'Codex preparation and independent evidence review',
        checkedAt: '2026-09-26T16:39:17.917217Z',
      },
      {
        id: 'filing-period',
        claim: 'Records in cited filings through December 20, 2023',
        evidenceIds: ['amended-filing', 'later-filing'],
        checkedScope:
          'Only the 2 selected download records and 2 cited filings; no Carlson-wide or all-lobbyist totals.',
        method: 'Read both filing covers.',
        finding:
          'Both cited filings cover January 1 through December 20, 2023. This does not establish overall download coverage.',
        status: 'supported',
        checkedBy: 'Codex preparation and independent evidence review',
        checkedAt: '2026-09-26T16:39:17.917217Z',
      },
    ],
    graphics: [],
    charts: [
      {
        graphicId: 'matching-records',
        title: 'The download repeats an entry shown in the filings',
        conclusion:
          'The filings support 1 reported $500 contribution appearing in repeated records.',
        sourceEvidenceId: 'amended-filing',
        sourcePlacement: 'sources',
        limitation: 'The 2 download entries do not establish 2 separate donations.',
      },
    ],
    body: [],
    coverageNote: '',
    limitations: 'This example does not establish corrected totals for Carlson or all lobbyists',
    disclosures: [
      'AI helped prepare this article and can make mistakes. We report what the cited public sources support and identify known gaps and uncertainty. Contact us to report a possible error so we can review it and make corrections.',
    ],
    history: [],
    relatedSlugs: ['lobbyist-giving', 'organizations-both-parties'],
    review: {
      editorialApprovedBy: 'Codex, accepted by parent task social posts seo',
      editorialApprovedAt: '2026-09-26T17:19:42Z',
      eugeneApprovedFingerprint: '758077a2',
      eugeneReviewedAt: '2026-09-26T20:28:06Z',
      publicationInstructionAt: '2026-09-26T20:28:06Z',
      navigationRevision: {
        reviewedBy: 'Codex',
        reviewedOn: '2026-09-30',
        approvedNavigationFingerprint: 'e0d227d8',
        approvedOn: '2026-09-30',
        releaseInstructionOn: '2026-09-30',
      },
    },
  },
};
TWO_RECORDS_NOT_TWO_DONATIONS.shortPost!.graphics = [graphic];
TWO_RECORDS_NOT_TWO_DONATIONS.shortPost!.body = [
  paragraph(
    'The Minnesota Campaign Finance Board’s download, copied September 25, 2026, contains 2 identical entries for lobbyist Joel Carlson’s reported $500 contribution to Cynthia Callais’s campaign committee on September 7, 2023.',
  ),
  paragraph(
    'The committee’s amended special-election filing lists 1 $500 Carlson entry. A later filing lists that entry again and marks its cover “No Change Since Last Report.”',
  ),
  { kind: 'chart', graphicId: 'matching-records' },
  {
    kind: 'paragraph',
    runs: [
      { kind: 'text', text: 'Matching entries must be ' },
      {
        kind: 'internalLink',
        text: 'checked against filings',
        href: '/blog/guides/why-2-official-numbers-can-both-be-right',
      },
      {
        kind: 'text',
        text: ' before counting them as separate donations or removing them as duplicates.',
      },
    ],
  },
  {
    kind: 'method',
    essential:
      'We matched the donor, recipient, receipt date and amount in the download against page 5 of each filing',
    full: 'In the Board’s “All” contribution download, select recipient registration 19013, contributor registration 8692, contributor type Lobbyist and receipt type Contribution. The result is 2 rows, identical in all 15 source columns. Compare them with the amended special-election filing received January 3, 2024 and the later filing received January 31, 2024. Page 5 of each contains 1 matching entry.',
  },
];
