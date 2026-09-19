import { FILE_COPY_MEANING, MONEY_SOURCE_COVERAGE } from './moneyRecordTrust';

/** The landing's source disclosure, shared by the app and its first response. */
export const MONEY_SOURCES_HEADING = 'Sources and copy dates';
export const MONEY_SOURCES_ATTRIBUTION =
  'Records from the Minnesota Campaign Finance and Public Disclosure Board';
export const MONEY_SOURCES_PERIOD_NOTE = `${FILE_COPY_MEANING} ${MONEY_SOURCE_COVERAGE}`;

type SourcePart = { text: string; href?: string };
export const MONEY_SOURCE_GROUPS: { title: string; paragraphs: SourcePart[][] }[] = [
  {
    title: 'Legislators, Candidate committees and Money by race',
    paragraphs: [
      [
        {
          text: 'Candidate reports',
          href: 'https://cfb.mn.gov/reports-and-data/viewers/campaign-finance/candidates/',
        },
        { text: ' provide candidates’ campaign figures and filings' },
      ],
      [
        { text: 'Find ' },
        {
          text: 'candidate committees',
          href: 'https://cfb.mn.gov/reports-and-data/viewers/campaign-finance/candidates/',
        },
        { text: ' included in our Committees section through the same Board search' },
      ],
    ],
  },
  {
    title: 'Committees and Party units',
    paragraphs: [
      [
        { text: 'Reports for ' },
        {
          text: 'committees and funds',
          href: 'https://cfb.mn.gov/reports-and-data/viewers/campaign-finance/political-committee-fund/',
        },
        { text: ', and ' },
        {
          text: 'party units',
          href: 'https://cfb.mn.gov/reports-and-data/viewers/campaign-finance/party-unit/',
        },
      ],
    ],
  },
  {
    title: 'Incoming payments, Who got paid and Outside spending',
    paragraphs: [
      [
        {
          text: 'Campaign finance downloads',
          href: 'https://cfb.mn.gov/reports-and-data/self-help/data-downloads/campaign-finance/',
        },
        { text: ' provide incoming payment, spending, and independent-spending records' },
      ],
    ],
  },
  {
    title: 'Lobbying',
    paragraphs: [
      [
        {
          text: 'Lobbying downloads',
          href: 'https://cfb.mn.gov/reports-and-data/self-help/data-downloads/lobbying/',
        },
        {
          text: ' provide registered lobbyists, who they represent, and organisations’ reported lobbying spending',
        },
      ],
    ],
  },
];
