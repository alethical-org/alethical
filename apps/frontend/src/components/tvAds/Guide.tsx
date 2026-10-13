import type { ResearchBlock, ResearchPiece } from '../../lib/research';
import type { RootScreenProps } from '../../navigation/types';
import { ResearchScreen } from '../../screens/redesign/ResearchScreen';

const paragraph = (text: string): ResearchBlock => ({
  kind: 'paragraph',
  runs: [{ kind: 'text', text }],
});
/** Private guide: never register in the public article index, search or sitemap. */
export const TV_AD_GUIDE: ResearchPiece = {
  slug: 'how-to-read-tv-ad-records',
  traits: { guide: true, research: false },
  indexed: false,
  aiAssisted: true,
  title: 'How to read TV ad records',
  publishedOn: '2026-10-13',
  recordsThrough: '2026-10-13',
  dek: 'What the station files say, what each check covers, and what the records leave unanswered.',
  authorLine: 'Alethical',
  filingBodies: ['Federal Communications Commission'],
  shortVersion: [],
  intro: [
    paragraph(
      'An order, an invoice, and a payment record answer different questions. Read each as its own record. A file title alone does not show that an ad aired or a bill was paid.',
    ),
  ],
  sections: [
    {
      heading: 'Start with the document',
      railLabel: 'The document',
      blocks: [
        paragraph(
          'Open the saved image and read the quoted line beside a checked fact. The page link takes you to the evidence for that fact. Machine-read text can help you search, but it is not a checked account of what the image says.',
        ),
        paragraph(
          'A station category describes where the station put a file. It does not establish the advertiser’s identity or the election the document concerns. A folder checked as relating to a committee does not give that relationship to every file inside it.',
        ),
      ],
    },
    {
      heading: 'Keep the amounts separate',
      railLabel: 'Amounts',
      blocks: [
        paragraph(
          'Gross amount, net amount, commission, credit, and reported payment are separate entries. Alethical shows an amount only when its meaning and printed value have been checked against the saved copy. These pages do not add orders, invoices, credits, or versions together.',
        ),
        paragraph(
          'Dollar figures omit cents without rounding. The quotation keeps the precision printed in the source. A reported campaign expense is shown only after its connection to the station file has been checked. Its source link opens the exact row in Alethical’s saved copy of the Campaign Finance Board records. A difference between amounts is not proof of commission or profit.',
        ),
      ],
    },
    {
      heading: 'Read names as printed',
      railLabel: 'Names',
      blocks: [
        paragraph(
          'An agency name is the spelling printed in the agency role on a checked file. Similar spellings are kept separate. The same name on a station file and a payment record is a search clue, not proof that they describe the same organization or transaction.',
        ),
        paragraph(
          'A checked connection names its role and carries its own quoted evidence. A candidate merely named on a document is kept separate from a candidate checked as the advertiser or payer. An election connection covers the particular contest and stage it names.',
        ),
      ],
    },
    {
      heading: 'Keep dates and saved versions distinct',
      railLabel: 'Dates and versions',
      blocks: [
        paragraph(
          'The station’s upload date, the date Alethical first saved particular contents, the invoice date, and scheduled airing dates describe different events. An unavailable upload date stays unavailable. Several checked airing periods stay separate; the site does not turn them into a continuous span.',
        ),
        paragraph(
          'Saved versions are ordered by when their contents were first saved, in Central time. A check belongs to the exact contents and approved copy it covered. A newer source file does not inherit an older check. If a station or campaign source changes, the earlier evidence stays identified as earlier evidence.',
        ),
        paragraph(
          'A withdrawn copy cannot be opened through an old link. A checked fact may have a correction history when the earlier value is safe to show. A privacy withdrawal removes the value and quotation.',
        ),
      ],
    },
    {
      heading: 'Know what is missing',
      railLabel: 'Limits',
      blocks: [
        paragraph(
          'This collection covers KSTP-TV, KARE, and KMSP-TV. It does not cover other stations, cable, radio, streaming, or online advertising. The FCC requires political files to be retained for 2 years; older records may no longer be available there.',
        ),
        paragraph(
          'Station files, distinct contents, approved copies, text-reading failures, and download failures count different things. The counts can overlap. None is a count of ads, purchases, viewers, or votes.',
        ),
        paragraph(
          'Safe labels may be available before an approved image is ready. Personal contact details are withheld from approved copies. A missing file or unreadable page is a gap in the records available here, not evidence that an event did not happen.',
        ),
      ],
    },
  ],
  sources: [
    {
      text: 'Federal Communications Commission public inspection files',
      note: 'The FCC describes political-file contents and retention requirements.',
      noteLink: { text: 'Read the FCC’s explanation', href: 'https://publicfiles.fcc.gov/about' },
    },
  ],
};

export function TVGuide({ navigation }: Pick<RootScreenProps<'TVAdRecords'>, 'navigation'>) {
  return (
    <ResearchScreen
      privatePiece={TV_AD_GUIDE}
      navigation={navigation as unknown as RootScreenProps<'Guide'>['navigation']}
      route={{ key: 'tv-ad-guide', name: 'Guide', params: { slug: TV_AD_GUIDE.slug } }}
    />
  );
}
