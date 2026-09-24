// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: vi.fn() }) }));
vi.mock('react-native-svg', () => ({
  default: ({ children, ...props }: React.SVGProps<SVGSVGElement>) => (
    <svg {...props}>{children}</svg>
  ),
  Circle: (props: React.SVGProps<SVGCircleElement>) => <circle {...props} />,
  Path: (props: React.SVGProps<SVGPathElement>) => <path {...props} />,
}));

const reads = vi.hoisted(() => ({
  notices: vi.fn(),
  statement: vi.fn(),
  unlinked: vi.fn(),
  focus: vi.fn(),
}));
vi.mock('../../../data/committeeNotices', () => ({ getCommitteeNotices: reads.notices }));
vi.mock('../../../data/disclosureStatements', () => ({
  getDisclosureStatement: reads.statement,
  getUnlinkedStatements: reads.unlinked,
}));
vi.mock('../../../lib/paymentFocusRequest', async (original) => ({
  ...(await original<typeof import('../../../lib/paymentFocusRequest')>()),
  requestPaymentFocus: reads.focus,
}));

import { committeeNoticesFromPayload } from '../../../lib/committeeNotices';
import {
  groupContributionPayments,
  type DetailedReceivedPayment,
} from '../../../lib/campaignMoneyDetails';
import {
  statementDetailFromPayload,
  unlinkedStatementsFromPayload,
} from '../../../lib/disclosureStatementCopy';
import { CommitteeNoticesCard } from '../CommitteeNoticesCard';
import { DonorPaymentList } from '../DonorPaymentList';
import { UnlinkedStatementsCard } from '../UnlinkedStatementsCard';

/**
 * The 2 record kinds on a committee's Campaign money tab (#2347), drawn from Restore
 * Sanity's real 2026 records. Each case is a state build-facts §2 and §3 draw, or a way
 * the page could say something false.
 */

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  reads.notices.mockReset();
  reads.statement.mockReset();
  reads.unlinked.mockReset();
  reads.focus.mockReset();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

let client: QueryClient;
async function draw(node: React.ReactNode, keepClient = false) {
  if (!keepClient) client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
  });
  await settle();
}

/** Let every resolved read reach the screen. */
async function settle() {
  for (let turn = 0; turn < 5; turn += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

const PDF = (id: string) =>
  `https://cfb.mn.gov/rptViewer/Main.php?do=viewPDF&year=26&type=notice&period=PrePrimary&se=0&regnum=41412&date=${id}`;
const row = (patch: Record<string, unknown>) => ({
  employer: null,
  in_kind: false,
  in_kind_description: null,
  loan: false,
  amended: false,
  earlier_contributor: null,
  earlier_contribution_date: null,
  earlier_amount: null,
  matched_payment: null,
  ...patch,
});
const restoreSanity = (windows?: unknown[]) =>
  committeeNoticesFromPayload({
    state: 'listed',
    registration_number: '41412',
    year: 2026,
    threshold: 'more_than_1000',
    copied_on: '2026-09-23',
    source_url:
      'https://cfb.mn.gov/reports-and-data/viewers/campaign-finance/large-contribution-notices/',
    any_amended: false,
    windows: windows ?? [
      {
        key: 'pre_primary',
        label: 'Before the primary',
        start: '2026-07-21',
        end: '2026-08-10',
        notices: [
          row({
            id: 'head',
            contributor: 'HEAD, MARTHA M',
            amount: '50000.00',
            contribution_date: '2026-08-06',
            received_on: '2026-08-07',
            employer: 'INVESTOR',
            status: 'matched',
            matched_payment: {
              contributor: 'Head, Martha M',
              contributor_type: 'Individual',
              received_on: '2026-08-06',
              amount: '50000.0000',
              record_number: 11,
            },
            pdf_url: PDF('260806_140546'),
          }),
          row({
            id: 'roa',
            contributor: 'RESTORATION OF AMERICA PAC',
            amount: '1000000.00',
            contribution_date: '2026-07-21',
            received_on: '2026-07-21',
            status: 'matched',
            matched_payment: {
              contributor: 'RESTORATION OF AMERICA PAC',
              contributor_type: 'Other',
              received_on: '2026-07-21',
              amount: '1000000.0000',
              record_number: 5,
            },
            pdf_url: PDF('260721_144729'),
          }),
        ],
      },
      {
        key: 'pre_general',
        label: 'Before the general election',
        start: '2026-10-20',
        end: '2026-11-02',
        notices: [],
      },
    ],
  });

describe('the large-contribution notices card', () => {
  it('draws Restore Sanity’s notices under their window, the October chip, and both copy dates', async () => {
    reads.notices.mockResolvedValue(restoreSanity());
    await draw(<CommitteeNoticesCard registrationNumber="41412" year={2026} today="2026-09-23" />);
    const text = host.textContent ?? '';
    expect(text).toContain('Large-contribution notices');
    expect(text).toContain('Before the primaryJul 21 – Aug 10, 2026');
    expect(text).toContain('Before the general electionOct 20 – Nov 2, 2026');
    expect(text).toContain('Not open yet');
    // A window not yet open carries its chip and no empty line.
    expect(text).not.toContain('The Board’s list held no notice');
    expect(text).toContain('HEAD, MARTHA M');
    expect(text).toContain('Received by the Board: Aug 7, 2026');
    expect(text).toContain('Also a payment in the list above, under Individuals');
    expect(text).toContain('Also a payment in the list above, under Other kinds');
    expect(text).toContain('Minnesota’s list of large-contribution notices copied Sep 23, 2026');
    const pdfs = [...host.querySelectorAll('a[href*="type=notice"]')];
    expect(pdfs.map((link) => link.getAttribute('aria-label'))).toEqual([
      'View notice PDF, HEAD, MARTHA M, Aug 6, 2026',
      'View notice PDF, RESTORATION OF AMERICA PAC, Jul 21, 2026',
    ]);
    expect(pdfs[0].textContent).toBe('View notice PDF');
    const region = host.querySelector('[aria-labelledby]');
    expect(region?.getAttribute('role') ?? region?.tagName.toLowerCase()).toMatch(/region|section/);
  });

  it('asks the payment list to open the matched payment', async () => {
    reads.notices.mockResolvedValue(restoreSanity());
    await draw(<CommitteeNoticesCard registrationNumber="41412" year={2026} today="2026-09-23" />);
    const link = [...host.querySelectorAll('[role="link"]')].find((node) =>
      node.getAttribute('aria-label')?.startsWith('Show the Aug 6, 2026 payment from HEAD'),
    ) as HTMLElement;
    await act(async () => link.click());
    expect(reads.focus).toHaveBeenCalledWith({
      tab: 'individuals',
      groupKey: JSON.stringify(['individuals', 'Head, Martha M']),
      recordNumber: 11,
    });
  });

  it('says the list holds none for an open or past window, and marks the open one', async () => {
    reads.notices.mockResolvedValue(
      restoreSanity([
        {
          key: 'pre_primary',
          label: 'Before the primary',
          start: '2026-07-21',
          end: '2026-08-10',
          notices: [],
        },
        {
          key: 'pre_general',
          label: 'Before the general election',
          start: '2026-10-20',
          end: '2026-11-02',
          notices: [],
        },
      ]),
    );
    await draw(<CommitteeNoticesCard registrationNumber="41412" year={2026} today="2026-10-27" />);
    const text = host.textContent ?? '';
    expect(text.match(/The Board’s list held no notice from this committee/g)).toHaveLength(2);
    expect(text).toContain('Open now, so more may arrive');
    expect(text).not.toContain('Not open yet');
  });

  it('draws nothing for a filer the answer gives no window, never an empty card', async () => {
    reads.notices.mockResolvedValue(
      committeeNoticesFromPayload({
        state: 'no_windows',
        registration_number: '20003',
        year: 2026,
        windows: [],
      }),
    );
    await draw(<CommitteeNoticesCard registrationNumber="20003" year={2026} today="2026-09-23" />);
    expect(host.textContent).toBe('');
  });

  it('loads with its heading, lead and a spoken status', async () => {
    reads.notices.mockReturnValue(new Promise(() => {}));
    await draw(
      <CommitteeNoticesCard
        registrationNumber="41412"
        year={2026}
        today="2026-09-23"
        thresholdHint="more_than_1000"
      />,
    );
    const status = host.querySelector('[role="status"]');
    expect(status?.getAttribute('aria-busy')).toBe('true');
    expect(status?.textContent).toContain('Loading the large-contribution notices…');
    expect(host.textContent).toContain('more than $1,000');
    expect(host.textContent).not.toContain('Before the primary');
  });

  it('fails on our side with Try again, and no windows and no zero', async () => {
    reads.notices.mockRejectedValue(new Error('offline'));
    await draw(<CommitteeNoticesCard registrationNumber="41412" year={2026} today="2026-09-23" />);
    const alert = host.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain(
      'We couldn’t load these notices. This is a problem on our side and says nothing about the committee.',
    );
    expect(alert?.textContent).toContain('Try again');
    expect(host.textContent).not.toContain('Before the primary');
    expect(host.textContent).not.toContain('$0');
  });

  it('draws nothing while a past year loads, so an uncovered year never flashes a card', async () => {
    reads.notices.mockReturnValue(new Promise(() => {}));
    await draw(<CommitteeNoticesCard registrationNumber="41412" year={2025} today="2026-09-23" />);
    expect(host.textContent).toBe('');
  });
});

const gift = (patch: Partial<DetailedReceivedPayment>): DetailedReceivedPayment => ({
  contributor: 'RESTORATION OF AMERICA PAC',
  contributorRegistrationNumber: null,
  contributorType: 'Other',
  employer: null,
  amount: '5000000.0000',
  receivedOn: '2026-08-27',
  receiptType: 'Contribution',
  inKind: 'No',
  ...patch,
});
const STATEMENT_PDF = (n: number) =>
  `https://cfb.mn.gov/rptViewer/Main.php?do=viewPDF&year=26&type=disclosure&period=D&regnum=41412&disc=${n}`;
const roaPayments = [
  gift({
    receivedOn: '2026-09-15',
    recordNumber: 1,
    disclosureStatement: { id: 's3', state: 'read', pdfUrl: STATEMENT_PDF(3) },
  }),
  gift({
    receivedOn: '2026-08-27',
    recordNumber: 2,
    disclosureStatement: { id: 's2', state: 'read', pdfUrl: STATEMENT_PDF(2) },
  }),
  gift({
    receivedOn: '2026-07-21',
    amount: '1000000.0000',
    recordNumber: 3,
    disclosureStatement: { id: 's4', state: 'read', pdfUrl: STATEMENT_PDF(4) },
  }),
  gift({ receivedOn: '2026-06-17', amount: '1000000.0000', recordNumber: 4 }),
  gift({ receivedOn: '2026-03-17', amount: '1095000.0000', recordNumber: 5 }),
  gift({
    contributor: 'Republican State Leadership Committee',
    amount: '50000.0000',
    receivedOn: '2026-08-28',
    recordNumber: 6,
    disclosureStatement: { id: 's1', state: 'gift_identified', pdfUrl: STATEMENT_PDF(1) },
  }),
];
const uihlein = (id: string, amount: string) =>
  statementDetailFromPayload({
    id,
    state: 'read',
    donor_name: 'Restoration of America PAC',
    gift_date: '2026-08-27',
    gift_amount: amount,
    pdf_url: STATEMENT_PDF(2),
    box: 3,
    sources: [{ name: 'Uihlein, Richard, E.', city: 'Lake Bluff', state: 'IL', amount }],
    line_a: amount,
    line_b: null,
    line_c: null,
    signed_on: '2026-09-20',
    received_on: '2026-09-21',
  });

function list(showStatements = true) {
  return (
    <DonorPaymentList
      groups={groupContributionPayments(roaPayments)}
      year={2026}
      tab="other"
      onSelectTab={() => {}}
      ready
      failed={false}
      onRetry={() => {}}
      showStatements={showStatements}
    />
  );
}
function open(name: string) {
  const button = [...host.querySelectorAll('[aria-expanded]')].find((node) =>
    node.getAttribute('aria-label')?.includes(name),
  ) as HTMLElement;
  act(() => button.click());
}

describe('disclosure statements inside their payments', () => {
  it('counts the statements on the collapsed row, so the total never reads as attributed', async () => {
    reads.statement.mockReturnValue(new Promise(() => {}));
    await draw(list());
    expect(host.textContent).toContain('5 payment records · 3 with a disclosure statement');
    expect(host.textContent).toContain('1 payment record · with a disclosure statement');
  });

  it('opens each statement inside the gift it names, and prints nothing on gifts without one', async () => {
    reads.statement.mockImplementation(async (id: string) =>
      uihlein(id, id === 's4' ? '1000000.00' : '5000000.00'),
    );
    await draw(list());
    open('RESTORATION OF AMERICA PAC');
    await settle();
    const panels = [...host.querySelectorAll('[aria-label="Disclosure statement"]')];
    expect(panels).toHaveLength(3);
    expect(reads.statement).toHaveBeenCalledTimes(3);
    const first = panels[0].textContent ?? '';
    expect(first).toContain('DISCLOSURE STATEMENT');
    expect(first).toContain('This statement names the sources below for this contribution');
    expect(first).toContain('Uihlein, Richard, E.');
    expect(first).toContain('Lake Bluff, IL');
    expect(first).not.toContain('60044');
    expect(first).toContain('Line B · Amount from sources not required to be itemized');
    expect(first.match(/Not reported/g)).toHaveLength(2);
    expect(first).toContain('Signed: Sep 20, 2026 · Received by the Board: Sep 21, 2026');
    // The 2 gifts with no statement print no absence line of any kind.
    expect(host.textContent).not.toMatch(/no (disclosure )?statement/i);
  });

  it('shows the held-but-unread statement without asking for a reading', async () => {
    await draw(list());
    open('Republican State Leadership Committee');
    const panel = host.querySelector('[aria-label="Disclosure statement"]');
    expect(panel?.textContent).toContain(
      'We have this statement, but have not yet read its details',
    );
    expect(panel?.querySelector('a')?.getAttribute('href')).toBe(STATEMENT_PDF(1));
    expect(reads.statement).not.toHaveBeenCalled();
  });

  it('fails one statement on its own, keeping its PDF and the others', async () => {
    reads.statement.mockImplementation(async (id: string) => {
      if (id === 's4') throw new Error('offline');
      return uihlein(id, '5000000.00');
    });
    await draw(list());
    open('RESTORATION OF AMERICA PAC');
    await settle();
    const alerts = [...host.querySelectorAll('[role="alert"]')];
    expect(alerts).toHaveLength(1);
    expect(alerts[0].textContent).toContain(
      'We couldn’t load this statement’s details. You can still open its PDF.',
    );
    expect(alerts[0].textContent).toContain('Try again');
    expect(alerts[0].querySelector('a')?.getAttribute('href')).toBe(STATEMENT_PDF(4));
    expect(host.textContent?.match(/Uihlein, Richard, E\./g)).toHaveLength(2);
  });

  it('draws no statement on a page that does not show them', async () => {
    await draw(list(false));
    expect(host.textContent).not.toContain('with a disclosure statement');
    open('RESTORATION OF AMERICA PAC');
    expect(host.querySelector('[aria-label="Disclosure statement"]')).toBeNull();
  });
});

const NORTH_METRO_PDF =
  'https://cfb.mn.gov/rptViewer/Main.php?do=viewPDF&year=26&type=disclosure&period=B&regnum=41412&disc=2';
const unlinkedAnswer = (year = 2026, statements?: unknown[]) =>
  unlinkedStatementsFromPayload({
    state: 'listed',
    registration_number: '41412',
    year,
    copied_on: '2026-09-24',
    statements: statements ?? [
      {
        id: 'b2',
        state: 'read',
        report_name: '2026 June Report',
        report_period: 'B',
        statement_number: 2,
        donor_name: 'North Metro Harness Initiative, LLC',
        recipient_name: 'Restore Sanity',
        gift_date: '2026-06-09',
        gift_amount: '500000.00',
        pdf_url: NORTH_METRO_PDF,
      },
      {
        id: 'unread',
        state: 'not_read',
        report_name: '2026 1st Quarter Report',
        report_period: 'A',
        statement_number: 3,
        pdf_url:
          'https://cfb.mn.gov/rptViewer/Main.php?do=viewPDF&year=26&type=disclosure&period=A&regnum=41412&disc=3',
      },
    ],
  });
const northMetroDetail = () =>
  statementDetailFromPayload({
    id: 'b2',
    state: 'read',
    donor_name: 'North Metro Harness Initiative, LLC',
    recipient_name: 'Restore Sanity',
    gift_date: '2026-06-09',
    gift_amount: '500000.00',
    pdf_url: NORTH_METRO_PDF,
    box: 1,
    sources: [],
    line_a: null,
    line_b: null,
    line_c: null,
    signed_on: null,
    received_on: null,
  });

describe('statements not linked to a payment', () => {
  it('lists each with its 4 labelled fields, “Not yet read” where nobody has read it', async () => {
    reads.unlinked.mockResolvedValue(unlinkedAnswer());
    reads.statement.mockResolvedValue(northMetroDetail());
    await draw(<UnlinkedStatementsCard registrationNumber="41412" year={2026} />);
    const text = host.textContent ?? '';
    expect(text).toContain('Statements not linked to a payment');
    expect(text).toContain(
      'We have these statements, but have not linked them to individual payments in our copied records',
    );
    const [read, unread] = [...host.querySelectorAll('[aria-label="Disclosure statement"]')];
    expect(read.textContent).toContain('DonorNorth Metro Harness Initiative, LLC');
    expect(read.textContent).toContain('RecipientRestore Sanity');
    expect(read.textContent).toContain('Contribution dateJun 9, 2026');
    expect(read.textContent).toContain('Contribution amount$500,000');
    expect(read.textContent).toContain(
      'The donor reports using only business revenue for this contribution',
    );
    expect(read.querySelector('a')?.getAttribute('aria-label')).toBe(
      'View statement PDF, North Metro Harness Initiative, LLC, Jun 9, 2026',
    );
    expect(unread.textContent?.match(/Not yet read/g)).toHaveLength(4);
    expect(unread.textContent).toContain(
      'We have this statement, but have not yet read its details',
    );
    expect(unread.textContent).not.toContain('$0');
    // Only the read statement asks for its details.
    expect(reads.statement).toHaveBeenCalledTimes(1);
  });

  it('is absent only after a successful answer holds no statement', async () => {
    reads.unlinked.mockResolvedValue(unlinkedAnswer(2026, []));
    await draw(<UnlinkedStatementsCard registrationNumber="41412" year={2026} />);
    expect(host.textContent).toBe('');
  });

  it('loads and fails on its own, and a failure is never an empty list', async () => {
    reads.unlinked.mockReturnValue(new Promise(() => {}));
    await draw(<UnlinkedStatementsCard registrationNumber="41412" year={2026} />);
    expect(host.querySelector('[role="status"]')?.getAttribute('aria-busy')).toBe('true');
    expect(host.textContent).toContain('Loading these statements…');

    reads.unlinked.mockRejectedValueOnce(new Error('offline'));
    await draw(<UnlinkedStatementsCard registrationNumber="41412" year={2025} />);
    const alert = host.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain(
      'We couldn’t load these statements. This is a problem on our side',
    );
    reads.unlinked.mockResolvedValueOnce(unlinkedAnswer(2025));
    reads.statement.mockResolvedValue(northMetroDetail());
    const retry = [...host.querySelectorAll('[role="button"]')].find(
      (node) => node.textContent === 'Try again',
    ) as HTMLElement;
    await act(async () => retry.click());
    await settle();
    expect(host.textContent).toContain('North Metro Harness Initiative, LLC');
  });

  it('keeps a statement’s earlier details and its PDF when a refresh fails', async () => {
    reads.unlinked.mockResolvedValue(unlinkedAnswer());
    reads.statement.mockResolvedValueOnce(northMetroDetail());
    await draw(<UnlinkedStatementsCard registrationNumber="41412" year={2026} />);
    reads.statement.mockRejectedValueOnce(new Error('offline'));
    await act(async () => {
      await client.refetchQueries({ queryKey: ['disclosure-statement', 'b2'] });
    });
    await settle();
    const panel = host.querySelector('[aria-label="Disclosure statement"]')!;
    expect(panel.querySelector('[role="alert"]')?.textContent).toContain(
      'We couldn’t refresh this statement’s details. The details below were loaded earlier.',
    );
    expect(panel.textContent).toContain(
      'The donor reports using only business revenue for this contribution',
    );
    expect(panel.querySelector('a')?.getAttribute('href')).toBe(NORTH_METRO_PDF);
  });

  it('never lets an older year’s answer replace the year now selected', async () => {
    let finish2026: (value: unknown) => void = () => {};
    reads.unlinked.mockImplementation((_reg: string, year: number) =>
      year === 2026
        ? new Promise((resolve) => {
            finish2026 = resolve;
          })
        : Promise.resolve(unlinkedAnswer(2025, [])),
    );
    await draw(<UnlinkedStatementsCard registrationNumber="41412" year={2026} />);
    await draw(<UnlinkedStatementsCard registrationNumber="41412" year={2025} />, true);
    await act(async () => finish2026(unlinkedAnswer(2026)));
    await settle();
    // 2025 holds none, so nothing draws, however late 2026's answer arrives.
    expect(host.textContent).toBe('');
  });
});
