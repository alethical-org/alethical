import { COMMITTEE_OFFICERS_INDEX_ENTRY } from '../researchIndex';
import { ARTICLE_AI_NOTE } from '../articleDisclosure';
import type { ResearchPiece } from '../research';
const p = (text: string) => ({
  kind: 'paragraph' as const,
  runs: [{ kind: 'text' as const, text }],
});
const board = 'https://cfb.mn.gov/pdf/bdactions/1628_Conciliation_Agreement.pdf';
const bulk =
  'https://register.cfb.mn.gov/reports-and-data/self-help/data-downloads/campaign-finance/';
const bold =
  'https://cfb.mn.gov/reports-and-data/viewers/campaign-finance/political-committee-fund/41380/2026/';
export const COMMITTEE_OFFICERS: ResearchPiece = {
  ...COMMITTEE_OFFICERS_INDEX_ENTRY,
  dek: 'Public records name committee officers and service providers. Connecting their roles takes more than a payment list.',
  authorLine: 'ALETHICAL',
  filingBodies: [
    'Minnesota Campaign Finance and Public Disclosure Board',
    'Federal Election Commission',
  ],
  shortVersion: [],
  intro: [],
  sections: [],
  sources: [],
  sourceRuns: [
    [
      {
        kind: 'externalLink',
        text: 'Scott Gryder for Congress: June 2, 2025 registration',
        href: 'https://docquery.fec.gov/pdf/727/202506029761729727/202506029761729727.pdf',
      },
      {
        kind: 'text',
        text: '. Names the treasurer; the public business contact supports the company identity match.',
      },
    ],
    [
      {
        kind: 'externalLink',
        text: 'Scott Gryder for Congress: original July–September 2026 electronic filing',
        href: 'https://docquery.fec.gov/dcdev/posted/2016457.fec',
      },
      { kind: 'text', text: '. Signed October 2, 2026; Schedule B lists the August 7 payment.' },
    ],
    [
      {
        kind: 'externalLink',
        text: 'AxCapital: leadership and company history',
        href: 'https://www.axcapteam.com/',
      },
      { kind: 'text', text: '. Undated company statements, read October 8, 2026.' },
    ],
    [
      { kind: 'externalLink', text: 'Rescue Minnesota: final Board agreement', href: board },
      { kind: 'text', text: '. March 2023, paragraphs 2–8 and footnote 2.' },
    ],
    [
      {
        kind: 'externalLink',
        text: 'Bold North Conservatives PAC: officers',
        href: 'https://cfb.mn.gov/reports-and-data/viewers/campaign-finance/political-committee-fund/41380/2026/',
      },
      { kind: 'text', text: ' and ' },
      {
        kind: 'externalLink',
        text: '2025 termination report',
        href: 'https://cfb.mn.gov/rptViewer/Main.php?do=viewPDF&year=25&type=pcf&period=YE&se=0&regnum=41380&amend=0&downloadpdf=false',
      },
      { kind: 'text', text: '. Payments on page 4; report received August 19, 2025.' },
    ],
    [
      { kind: 'externalLink', text: 'Minnesota itemized campaign-finance downloads', href: bulk },
      { kind: 'text', text: '. Expenditure-file columns inspected October 8, 2026.' },
    ],
  ],
  shortPost: {
    origin: 'social-adaptation',
    coverageBasis: 'held-records',
    recordsScope: 'cited-filings',
    aiAssisted: true,
    coveragePlacement: 'metadata',
    coverageNote:
      'Minnesota ads: 2022 · Minnesota filing: 2025 · Federal filing: July–September 2026',
    limitations:
      'A shared address can be a lead to investigate. It is not proof of common ownership, control or wrongdoing.',
    limitationsPlacement: 'body',
    disclosures: [ARTICLE_AI_NOTE],
    history: [],
    graphics: [],
    charts: [],
    relatedSlugs: [],
    evidence: [
      {
        id: 'gryder-identity',
        title: 'Scott Gryder for Congress registration, June 2, 2025',
        url: 'https://docquery.fec.gov/pdf/727/202506029761729727/202506029761729727.pdf',
        kind: 'held-records',
        sourceSnapshot: {
          copiedOn: '2026-10-08',
          selectedRecords: 'Named treasurer and public business contact',
        },
        method:
          'Compare the filed name and public business contact with the company leadership page.',
        limitations:
          'Corroborates identity; does not date the company role or establish ownership.',
        version: 'sha256:ad9dca309e0ea8eb94fc4f8cdb65b61415012361fc4fce99c16284745b3f883e',
      },
      {
        id: 'gryder',
        title: 'Scott Gryder for Congress, July–September 2026 report',
        url: 'https://docquery.fec.gov/dcdev/posted/2016457.fec',
        kind: 'held-records',
        period: {
          from: '2026-07-01',
          through: '2026-09-30',
          label: 'Period printed on report 2016457',
        },
        method:
          'Read the original FEC electronic report, its signing treasurer and Schedule B payment entry.',
        limitations:
          'This is what the named report says; a current company role is not a dated ownership history.',
        version: 'sha256:8bb37adb848b9d919ef3a1b46b93b0e03ae4add5c6c6899de7cf0a6ad676ee25',
      },
      {
        id: 'bold-payment',
        title: 'Bold North Conservatives PAC, 2025 termination report, page 4',
        url: 'https://cfb.mn.gov/rptViewer/Main.php?do=viewPDF&year=25&type=pcf&period=YE&se=0&regnum=41380&amend=0&downloadpdf=false',
        kind: 'held-records',
        sourceDatedOn: '2025-08-19',
        sourceSnapshot: {
          copiedOn: '2026-10-08',
          selectedRecords: 'Named termination report received August 19, 2025',
        },
        method: 'Read the received date, termination box and Schedule B1.',
        limitations:
          'The source prints a calendar-year period but was received in August; do not imply future transactions.',
        version: 'sha256:816fa19ed6ed46abffd290c9c8c796972b85cc6e6191d8052ad5862dd5ad5af3',
      },
      {
        id: 'rescue',
        title: 'Rescue Minnesota agreement, paragraphs 2–8 and footnote 2',
        url: board,
        kind: 'held-records',
        sourceDatedOn: '2023-03-08',
        sourceSnapshot: {
          copiedOn: '2026-10-08',
          selectedRecords: 'Final agreement about the named 2022 advertisements',
        },
        method: 'Read the final agreement, including its findings and qualifications.',
        limitations:
          'Legal coordination under the shared-treasurer provision is not evidence that private information was shared.',
        version: 'sha256:5159120c781bf1795930563edd5acefa9d9d6c33b0f01d13ca25d217dd42f5fd',
      },
      {
        id: 'axcapital',
        title: 'AxCapital leadership and company history',
        url: 'https://www.axcapteam.com/',
        kind: 'held-records',
        sourceSnapshot: {
          copiedOn: '2026-10-08',
          selectedRecords: 'Company leadership and history statements',
        },
        method:
          'Read company statements identifying Thomas Datwyler as CEO and describing the combination of 9Seven Consulting and HenryAlan.',
        limitations:
          'A company leadership role does not establish ownership of every similarly addressed firm.',
        version: 'sha256:ec2da8ebaa450fc427b89b3c302fae20103446df7611dfc08a9cf78d38a17625',
      },
      {
        id: 'bold',
        title: 'Bold North Conservatives PAC, 2025 filing and officer listing',
        url: bold,
        kind: 'held-records',
        sourceSnapshot: {
          copiedOn: '2026-10-08',
          selectedRecords: 'Bold North officer listing and final report received August 19, 2025',
        },
        method:
          'Read the officer listing and pages 1–4 of the termination filing received August 19, 2025.',
        limitations:
          'The report prints a calendar-year period but was received when the committee terminated in August. It does not identify a candidate in its general-expenditure descriptions.',
        version: 'sha256:909e09bfc80c4328b867caf171cd62928eb259735ae6a3ea3109fbf593eaa365',
      },
      {
        id: 'bulk',
        title: 'Minnesota itemized spending download',
        url: bulk,
        kind: 'held-records',
        downloadSnapshot: {
          copiedOn: '2026-10-08',
          selectedRecords: 'Column headings of the all-entities expenditure download',
        },
        method: 'Inspect all 18 column names in the retained CSV.',
        limitations:
          'This describes the transaction download, not every Minnesota disclosure or registration record.',
        version: 'sha256:2e7036062d04cf54d985367b88eb08efeeaf1e4ac6b6dcb5060ac16285feb9bc',
      },
    ],
    claims: [
      {
        id: 'reported-business-connection',
        claim:
          'A report signed by Thomas Datwyler lists $255 paid to AxCapital, whose website currently names him as CEO.',
        evidenceIds: ['gryder', 'axcapital'],
        checkedScope: 'Named quarterly report and undated company page retrieved October 8, 2026.',
        method: 'Read electronic report F3N and SB17 records and company role label.',
        finding: 'Report signed October 2 lists August 7 payment; current website names CEO.',
        status: 'qualified',
        checkedBy: 'Codex primary-source review',
        checkedAt: '2026-10-08T08:32:15.873684+00:00',
        qualification:
          'Does not establish his business role at payment date, ownership or wrongdoing.',
      },
      {
        id: 'rescue',
        claim:
          'The Board classified $39,950 as coordinated spending under the common-treasurer rule and imposed a $1,000 Rescue penalty.',
        evidenceIds: ['rescue'],
        checkedScope: '2023 final agreement about 2022 events.',
        method: 'Read paragraphs 2–8 and footnote 2.',
        finding:
          'Agreement supports legal finding and says evidence indicates no nonpublic information sharing.',
        status: 'qualified',
        checkedBy: 'Codex primary-source review',
        checkedAt: '2026-10-08T08:32:15.873684+00:00',
        qualification:
          'No finding that Datwyler passed private information; penalty against Rescue, not a personal fine.',
      },
      {
        id: 'bold-payments',
        claim:
          'Bold North named the Datwyler officers and reported media, digital consulting and accounting payments.',
        evidenceIds: ['bold', 'bold-payment'],
        checkedScope:
          'Registration retrieved October 8, 2026 and final report received August 19, 2025.',
        method: 'Read registration response and report cover and page 4.',
        finding: 'Chair Timothy, treasurer Thomas; 7600.00 + 900.00 + 374.70 + 125.30 = 9000.00.',
        status: 'qualified',
        checkedBy: 'Codex primary-source review',
        checkedAt: '2026-10-08T08:32:15.873684+00:00',
        qualification:
          'No named candidate for the media buy and no established ownership of Same Day Processing.',
      },
      {
        id: 'download-fields',
        claim:
          'Minnesota’s itemized spending download has no officer-name or officer-business relationship columns.',
        evidenceIds: ['bulk'],
        checkedScope: '18 columns in October 8, 2026 expenditure CSV.',
        method: 'Inspect header and distinguish transaction data from public registration.',
        finding: 'Officer names are separate public records, not undisclosed identities.',
        status: 'supported',
        checkedBy: 'Codex primary-source review',
        checkedAt: '2026-10-08T08:32:15.873684+00:00',
      },
    ],
    body: [
      p(
        'When a political committee pays a company connected to its officers, readers should be able to understand both sides of the relationship: the person responsible for the committee’s money and the business receiving it. Thomas Datwyler’s work provides a concrete example of why those are separate questions.',
      ),
      p(
        'AxCapital’s website identifies Datwyler as its chief executive and says he has served as treasurer for state and federal campaigns and committees. The company describes AxCapital as bringing together 9Seven Consulting and HenryAlan. The company page is undated; these are the roles and history it described on October 8, 2026.',
      ),
      p(
        'Scott Gryder for Congress’s July–September 2026 report, signed by Thomas Datwyler on October 2, lists a $255 payment to AxCapital on August 7 for compliance consulting. The report and company website show a committee officer and a business connection worth making easy to follow. They do not establish personal ownership, his company title on the payment date, or an improper payment.',
      ),
      { kind: 'heading', text: 'The Minnesota case turns on a shared treasurer' },
      p(
        'Thomas Datwyler was treasurer of Doug Wardlow’s campaign from December 2021 until July 2022, and of Rescue Minnesota during June 2022. Rescue Minnesota spent $39,950 on radio and Facebook advertisements supporting Wardlow.',
      ),
      p(
        'The Campaign Finance Board classified those advertisements as coordinated spending under Minnesota’s shared-treasurer provision. Its March 2023 agreement imposed a $1,000 civil penalty on Rescue Minnesota.',
      ),
      p(
        'The same agreement says the evidence indicated that Datwyler did not share nonpublic information between the committees. The legal finding rested on his serving as treasurer of both during the election year. It was not a finding that he passed campaign secrets.',
      ),
      { kind: 'heading', text: 'What Bold North reported paying' },
      p(
        'Bold North Conservatives PAC’s officer listing names Timothy Datwyler as chair and Thomas Datwyler as treasurer. Its 2025 termination report lists these payments:',
      ),
      {
        kind: 'table',
        columns: ['Reported service', 'Payee', 'Paid'],
        rows: [
          ['Media buy', 'Strategic Media Placement', '$7,600'],
          ['Digital consulting', 'Strategic Media Placement', '$900'],
          ['Accounting consulting', 'Same Day Processing', '$374'],
        ],
      },
      p(
        'The media buy is dated April 10, 2025. The consulting payments are dated April 14. The filing also reports $125 in spending without named payees. Dollar displays omit cents; the filed total is $9,000.',
      ),
      p(
        'Those entries show who was paid and the reported service. They do not identify which candidate, if any, the media buy supported or opposed. This example shows what the filing reports; it does not establish a business relationship between the officers and these payees.',
      ),
      { kind: 'heading', text: 'What the public download leaves separate' },
      p(
        'Minnesota’s itemized spending download includes committee identifiers, vendor names, amounts, dates and purposes. Its columns do not include committee chair or treasurer names, or a field linking a payee to an officer’s business interests. Officers are publicly named elsewhere in the Board’s records.',
      ),
      p(
        'A payment list therefore cannot, by itself, answer who makes a committee’s decisions or whether a vendor is tied to an officer. A shared address can be a lead to investigate. It is not proof of common ownership, control or wrongdoing.',
      ),
      { kind: 'heading', text: 'Make the relationships easier to follow' },
      p(
        'Public officer histories with start and end dates would help readers connect each payment to the people serving at the time. Consistent identifiers, with a way to correct mistaken matches, would reduce confusion between names. A dedicated field for payments to businesses owned by committee officers would make those relationships easier to see.',
      ),
      p(
        'These are proposals for clearer records. The cases described here do not establish that every payment to an officer-linked business is improper, or that a treasurer controls every decision made by a committee.',
      ),
      {
        kind: 'paragraph',
        role: 'conclusion',
        runs: [
          {
            kind: 'bold',
            text: 'Conclusion: Public payments and officer listings reveal different parts of the same relationship. ',
          },
          {
            kind: 'text',
            text: 'The records support following those connections carefully. They do not support treating a shared address or job title as proof of secret coordination.',
          },
        ],
      },
      {
        kind: 'method',
        essential:
          'Read the final Minnesota agreement, the company’s own description, the Board’s officer listing and the filed payment schedule together.',
        full: 'The original social post and its 11-point graphic are retained separately with a claim-by-claim review. Broad historical totals and committee counts are excluded from this article unless the source dates, amendment handling and identity matches support them. The Bold North table transcribes Schedule B1, page 4, of the report received August 19, 2025. Exact amounts are retained in the private calculation inputs. Each dollar amount is displayed by dropping cents, after calculating totals from the exact amounts; displayed parts can therefore add to less than the displayed total. The headline and conclusion make no claim that a donation caused a payment or that a disclosed officer controlled every committee action.',
      },
    ],
    review: {
      editorialApprovedBy: 'Codex, source and independent acceptance review',
      editorialApprovedAt: '2026-10-08T08:47:59Z',
      eugeneApprovedFingerprint: '61702d71',
      eugeneReviewedAt: '2026-10-08T09:04:06.325Z',
      publicationInstructionAt: '2026-10-08T09:04:06.325Z',
    },
  },
};
