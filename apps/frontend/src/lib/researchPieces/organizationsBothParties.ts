import type { ResearchPiece, ResearchInline } from '../research';
import { ORGANIZATIONS_BOTH_PARTIES_INDEX_ENTRY } from '../researchIndex';
import { ARTICLE_AI_NOTE } from '../articleDisclosure';
import { chartDescription } from '../shortPostCalculations';
import type { ShortPostGraphic } from '../shortPosts';

const boardDownloadUrl =
  'https://cfb.mn.gov/reports-and-data/self-help/data-downloads/campaign-finance/';
const dflHouseUrl =
  'https://cfb.mn.gov/reports-and-data/viewers/campaign-finance/party-unit/20006/';
const dflSenateUrl =
  'https://cfb.mn.gov/reports-and-data/viewers/campaign-finance/party-unit/20011/';
const republicanHouseUrl =
  'https://cfb.mn.gov/reports-and-data/viewers/campaign-finance/party-unit/20010/';
const republicanSenateUrl =
  'https://cfb.mn.gov/reports-and-data/viewers/campaign-finance/party-unit/20013/';
const handbookUrl = 'https://cfb.mn.gov/pdf/publications/handbooks/PTU_handbook.pdf';

const period = {
  from: '2015-01-01',
  through: '2025-12-31',
  label: 'Selected caucus contribution records',
} as const;

const overlapInput = {
  kind: 'overlap',
  left: { value: 265, unit: 'donor registrations', period },
  right: { value: 211, unit: 'donor registrations', period },
  both: { value: 188, unit: 'donor registrations', period },
  leftLabel: 'DFL caucus funds',
  rightLabel: 'Republican caucus funds',
  proportional: false,
} as const;

const overlapGraphic: ShortPostGraphic = {
  id: 'both-parties',
  claimIds: ['overlap-count', 'same-year-split'],
  input: overlapInput,
  altDescription: chartDescription(overlapInput),
};

const text = (value: string): ResearchInline => ({ kind: 'text', text: value });
const external = (value: string, href: string): ResearchInline => ({
  kind: 'externalLink',
  text: value,
  href,
});
const paragraph = (value: string) => ({ kind: 'paragraph' as const, runs: [text(value)] });

export const ORGANIZATIONS_BOTH_PARTIES: ResearchPiece = {
  ...ORGANIZATIONS_BOTH_PARTIES_INDEX_ENTRY,
  dek: '',
  authorLine: 'ALETHICAL',
  filingBodies: ['Minnesota Campaign Finance and Public Disclosure Board'],
  shortVersion: [],
  intro: [],
  sections: [],
  sources: [],
  sourceRuns: [
    [
      external('Minnesota Campaign Finance Board contribution download', boardDownloadUrl),
      text(', saved September 24, 2026'),
    ],
    [
      external('DFL House Caucus', dflHouseUrl),
      text(' and '),
      external('DFL Senate Caucus', dflSenateUrl),
      text(', recipient identities and filings'),
    ],
    [
      external('House Republican Campaign Committee', republicanHouseUrl),
      text(' and '),
      external('Senate Victory Fund', republicanSenateUrl),
      text(', recipient identities and filings'),
    ],
    [
      external('Board party-unit handbook', handbookUrl),
      text(', contribution and returned-contribution reporting'),
    ],
  ],
  shortPost: {
    origin: 'social-adaptation',
    coverageBasis: 'held-records',
    aiAssisted: true,
    evidence: [
      {
        id: 'download-snapshot',
        title: 'Minnesota Campaign Finance Board contribution download',
        url: boardDownloadUrl,
        kind: 'held-records',
        downloadSnapshot: {
          copiedOn: '2026-09-24',
          selectedRecords:
            'Contribution entries dated 2015–2025 for recipients 20006, 20011, 20010 and 20013, grouped by qualifying nonblank donor registration number',
        },
        method:
          'Preserve all 614,422 source entries and filter the 15 source columns with integer-cent arithmetic.',
        limitations:
          'Copy date is not the download’s reporting-period end. The file has no payment ID or amendment version, so identical entries cannot be classified as separate payments.',
        version: 'sha256:9c3004b4a841ee60a863f7ce633a10aef38c98ec3ca0471f9f2b062db20e3301',
      },
      {
        id: 'selected-caucus-records',
        title: 'Minnesota Campaign Finance Board contribution download, selected caucus entries',
        url: boardDownloadUrl,
        kind: 'held-records',
        period,
        method:
          'Qualify donor registration numbers with at least 1 Political Committee/Fund contribution entry; retain all Contribution entries for each qualifying number to the 4 caucuses, including entries with other donor-type labels. Require a positive entry to each party for overlap.',
        limitations:
          'Of the registrations in both groups, 181 appear on both sides within at least 1 calendar year; 7 appear on the 2 sides in different years.',
        version:
          'sha256:9c3004b4a841ee60a863f7ce633a10aef38c98ec3ca0471f9f2b062db20e3301; method:donor-level-v2',
      },
      {
        id: 'dfl-house',
        title: 'DFL House Caucus registration and 2025 year-end summary',
        url: dflHouseUrl,
        kind: 'official-source',
        period: {
          from: '2024-01-01',
          through: '2025-12-31',
          label: 'Retained 2025 year-end summary',
        },
        method:
          'Read the Board party-unit identity and retained 2025 financial summary for registration 20006.',
        limitations:
          'This 2025 summary establishes the reporting end, not the article’s 2015–2025 contribution totals.',
        version:
          'viewer-sha256:bddaf1e524394d3938de605fc694aade468597c9c016095dc7e1d9799d62ced2; summary-sha256:db84f63244ffe91f4b701ea6f64cee6f3a8f74cbfc4b347c8c89d2dee3602921',
      },
      {
        id: 'dfl-senate',
        title: 'DFL Senate Caucus registration and 2025 year-end summary',
        url: dflSenateUrl,
        kind: 'official-source',
        period: {
          from: '2024-01-01',
          through: '2025-12-31',
          label: 'Retained 2025 year-end summary',
        },
        method:
          'Read the Board party-unit identity and retained 2025 financial summary for registration 20011.',
        limitations:
          'This 2025 summary establishes the reporting end, not the article’s 2015–2025 contribution totals.',
        version:
          'viewer-sha256:114f2dc86d6da7874c7f93461183f14aa129827488d17515a3ead6a5408f73ea; summary-sha256:1650b974847326087a40a8ac9d1c7b9ea6c4b479f21617a59df5ba59e83096b2',
      },
      {
        id: 'republican-house',
        title: 'House Republican Campaign Committee registration and 2025 year-end summary',
        url: republicanHouseUrl,
        kind: 'official-source',
        period: {
          from: '2024-01-01',
          through: '2025-12-31',
          label: 'Retained 2025 year-end summary',
        },
        method:
          'Read the Board party-unit identity and retained 2025 financial summary for registration 20010.',
        limitations:
          'This 2025 summary establishes the reporting end, not the article’s 2015–2025 contribution totals.',
        version:
          'viewer-sha256:7c6bead80b5a4e751e0f1c03a1c839e8df24f79376d23099233e4af6fee0bfe4; summary-sha256:e6ffbad62dd1c1b32d19b1b8f595695aeb85c5ed36f6c539e9cbf77b0e6b6145',
      },
      {
        id: 'republican-senate',
        title: 'Senate Victory Fund registration and 2025 year-end summary',
        url: republicanSenateUrl,
        kind: 'official-source',
        period: {
          from: '2024-01-01',
          through: '2025-12-31',
          label: 'Retained 2025 year-end summary',
        },
        method:
          'Read the Board party-unit identity and retained 2025 financial summary for registration 20013.',
        limitations:
          'This 2025 summary establishes the reporting end, not the article’s 2015–2025 contribution totals.',
        version:
          'viewer-sha256:770f98b932591178d20101c3099bca1dca9d07a4fbc635ef288dfced737d84c8; summary-sha256:095a05a647f43bc506b9e5181e37129a32f482213ae62b5dd8b45508efa31d4d',
      },
    ],
    claims: [
      {
        id: 'recipient-scope',
        claim:
          'The comparison covers DFL House Caucus, DFL Senate Caucus, House Republican Campaign Committee and Senate Victory Fund.',
        evidenceIds: ['dfl-house', 'dfl-senate', 'republican-house', 'republican-senate'],
        checkedScope: 'The 4 named Minnesota legislative caucus funds only.',
        method:
          'Match each Board party-unit registration number to its name and party affiliation.',
        finding:
          'Registrations 20006 and 20011 are the 2 DFL caucus funds; 20010 and 20013 are the House and Senate Republican caucus funds.',
        status: 'supported',
        checkedBy: 'Codex and independent peer evidence review',
        checkedAt: '2026-09-26T16:11:55.245Z',
      },
      {
        id: 'overlap-count',
        claim:
          '188 donor registration numbers appear in contributions to both parties’ caucus funds during 2015–2025.',
        evidenceIds: ['selected-caucus-records'],
        checkedScope:
          'Qualifying donor registrations in Contribution entries to the 4 named caucuses, 2015–2025.',
        method:
          'Group selected rows by nonblank contributor registration number and require at least 1 positive entry to each party.',
        finding:
          '265 qualifying registrations appear on the DFL side, 211 on the Republican side, 188 on both, and 288 in the union. Independent SQLite grouping reproduces the result.',
        status: 'supported',
        checkedBy: 'Codex and independent peer evidence review',
        checkedAt: '2026-09-26T16:11:55.245Z',
      },
      {
        id: 'same-year-split',
        claim:
          'Of the 188 overlapping registrations, 181 appear on both sides within at least 1 calendar year; 7 appear on the 2 sides in different years.',
        evidenceIds: ['selected-caucus-records'],
        checkedScope: 'The 188 qualifying overlapping registrations only.',
        method: 'Group each qualifying registration’s selected entries by calendar year and party.',
        finding:
          '181 registrations have at least 1 same-year cross-party match; the remaining 7 match across different years.',
        status: 'supported',
        checkedBy: 'Codex and independent peer evidence review',
        checkedAt: '2026-09-26T16:11:55.245Z',
      },
      {
        id: 'listed-values',
        claim:
          'The selected entries for overlapping registrations list $26,837,090.78 to DFL caucuses and $13,904,932.99 to Republican caucuses, totaling $40,742,023.77 before whole-dollar display truncation.',
        evidenceIds: ['selected-caucus-records'],
        checkedScope:
          'All 9,882 selected contribution entries for the 188 overlapping registrations.',
        method:
          'Sum source amounts in integer cents by party; add exact party totals, then drop cents for display without rounding.',
        finding:
          'Exact source-row values are $26,837,090.78, $13,904,932.99 and $40,742,023.77; displayed values are $26,837,090, $13,904,932 and $40,742,023.',
        status: 'qualified',
        qualification:
          'Listed source-entry values are not verified distinct payments or net amounts after returns and amendments.',
        checkedBy: 'Codex and independent peer evidence review',
        checkedAt: '2026-09-26T16:11:55.245Z',
      },
      {
        id: 'repeat-entries',
        claim:
          '185 extra entries exactly repeat another entry’s fields and represent $420,800 of listed combined value; counting each identical entry once leaves the overlap count unchanged.',
        evidenceIds: ['selected-caucus-records'],
        checkedScope:
          'All 9,882 selected contribution entries for the 188 overlapping registrations.',
        method:
          'Group across all 15 source fields, count extra identical entries, and recalculate the overlap after collapsing exact copies as a diagnostic.',
        finding:
          '185 extra entries, $420,800.00 listed value; the 188-registration overlap is unchanged. The source cannot identify whether copies represent separate payments.',
        status: 'qualified',
        qualification: 'A repeated source row is not proof of a duplicate payment.',
        checkedBy: 'Codex and independent peer evidence review',
        checkedAt: '2026-09-26T16:11:55.245Z',
      },
      {
        id: 'coverage-end',
        claim:
          'The 4 retained caucus year-end summaries cover through December 31, 2025; the contribution download was copied September 24, 2026.',
        evidenceIds: [
          'download-snapshot',
          'dfl-house',
          'dfl-senate',
          'republican-house',
          'republican-senate',
        ],
        checkedScope:
          'The retained 2025 summaries for the 4 named recipients and the held download copy date.',
        method:
          'Read all 4 retained summary response end dates and the stored download snapshot metadata.',
        finding:
          'Each 2025 summary ends 2025-12-31. The download was copied 2026-09-24. The copy date is separate from the covered reporting period.',
        status: 'supported',
        checkedBy: 'Codex and independent peer evidence review',
        checkedAt: '2026-09-26T16:11:55.245Z',
      },
    ],
    graphics: [overlapGraphic],
    charts: [
      {
        graphicId: 'both-parties',
        omitRepeatedUnit: true,
        title: 'Donor registrations appearing in both parties’ caucus records',
        conclusion: 'The same donor registrations appear in both parties’ caucus records.',
        sourceEvidenceId: 'selected-caucus-records',
        sourcePlacement: 'sources',
        limitation:
          'Of the registrations in both groups, 181 appear on both sides within at least 1 calendar year; 7 appear on the 2 sides in different years.',
      },
    ],
    body: [
      paragraph(
        'Minnesota’s legislative caucus funds support DFL and Republican campaigns for the House and Senate. We examined political committee and fund entries in the Minnesota Campaign Finance Board’s contribution records for 2015–2025.',
      ),
      paragraph(
        'The comparison covers 4 recipients: DFL House Caucus, DFL Senate Caucus, House Republican Campaign Committee (HRCC) and Senate Victory Fund. It counts donors by their recorded registration numbers, which do not establish the companies or parent organizations behind them.',
      ),
      { kind: 'chart', graphicId: 'both-parties' },
      { kind: 'heading', text: 'What their contribution records list' },
      paragraph(
        'The entries for those registrations include cash and the reported value of donated goods or services. The amounts retain repeated entries and do not subtract returned contributions, so they are not confirmed totals of separate payments.',
      ),
      {
        kind: 'table',
        columns: ['Recipient group', 'Listed value, 2015–2025'],
        rows: [
          ['DFL caucus funds', '$26,837,090'],
          ['Republican caucus funds', '$13,904,932'],
          ['Combined', '$40,742,023'],
        ],
      },
      paragraph(
        'There are 185 extra entries that exactly repeat another entry’s fields, representing $420,800 of the combined value. The download does not establish whether these are separate payments or repeated reporting. Counting each identical entry once would leave the overlap count unchanged.',
      ),
      {
        kind: 'method',
        essential:
          'We matched donor registration numbers across contributions to the 4 caucus funds, using Alethical’s September 24, 2026 copy of the Board’s download',
        full: 'Keep entries dated in 2015–2025 with receipt type “Contribution” and recipient registration 20006, 20011, 20010 or 20013. A donor registration qualifies if at least 1 of its entries to those recipients is labelled “Political Committee/Fund.” Include all contribution entries for that registration to the 4 recipients during the period, including entries with other donor-type labels. No qualifying registration has an Individual or Lobbyist label in these entries.\n\nA registration must have a positive contribution entry to each party during the period to enter the overlap count. Loans and other income are excluded. Retain cash and reported goods or services without removing repeated entries. Exclude the 2 otherwise eligible entries, worth $3,500, with no donor registration number.\n\nThe qualifying records contain 265 registrations on the DFL side and 211 on the Republican side. Of the 288 registrations across both sides, 77 appear only on the DFL side and 23 only on the Republican side. These groups describe the selected committee-and-fund registrations, not all donors to either party.\n\nThe 188 overlapping registrations account for 9,882 entries. The calculation does not reconcile every source amendment. The 4 retained caucus year-end summaries cover through December 31, 2025; the download copy date is separate from that reporting period.',
      },
    ],
    // The approved preview prints this in its masthead. The integrating change must
    // move it there and avoid repeating it below the source links.
    coveragePlacement: 'metadata',
    limitationsPlacement: 'body',
    coverageNote: 'Contribution records: 2015–2025 · Download copied September 24, 2026',
    // This approved sentence already appears before the table. The integrating
    // change must avoid printing it a second time below the source links.
    limitations:
      'The amounts retain repeated entries and do not subtract returned contributions, so they are not confirmed totals of separate payments.',
    disclosures: [ARTICLE_AI_NOTE],
    history: [],
    relatedSlugs: [],
    review: {
      editorialApprovedBy: 'Codex with independent copy acceptance',
      editorialApprovedAt: '2026-09-26T16:47:25.940Z',
      eugeneApprovedFingerprint: '046f2062',
      eugeneReviewedAt: '2026-09-26T20:39:49.138Z',
      publicationInstructionAt: '2026-09-26T20:39:49.138Z',
    },
  },
};
