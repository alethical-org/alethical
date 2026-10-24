// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Dimensions } from 'react-native';
import { DonorPaymentList } from '../DonorPaymentList';
import {
  groupContributionPayments,
  groupExpenditurePayments,
} from '../../../lib/campaignMoneyDetails';

vi.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: vi.fn() }) }));
vi.mock('react-native-svg', () => ({
  default: ({ children }: { children?: React.ReactNode }) => <svg>{children}</svg>,
  Path: () => <path />,
}));
const dates = {
  contributions: '2026-10-24T18:00:00Z',
  expenditures: '2026-10-09T18:00:00Z',
  independentExpenditures: null,
};
const groups = [
  ...groupContributionPayments([
    {
      contributor: 'Fixture Donor',
      contributorRegistrationNumber: null,
      contributorType: 'Individual',
      employer: 'Retired',
      amount: '100.00',
      receivedOn: '2026-10-14',
      receiptType: 'Contribution',
      inKind: 'No',
    },
  ]),
  ...groupExpenditurePayments([
    {
      vendorName: 'Fixture Vendor',
      vendorCity: 'Duluth',
      vendorState: 'MN',
      affectedCommitteeName: null,
      affectedCommitteeRegistrationNumber: null,
      amount: '25.00',
      paidOn: '2026-09-30',
      expenditureType: 'Campaign Expenditure',
      purpose: 'Printing',
      inKind: 'No',
    },
  ]),
];

describe('each visible payment list carries its own file date', () => {
  it.each([390, 900, 1440])(
    'keeps the source date inside the matching list panel at %spx',
    (width) => {
      Object.defineProperty(document.documentElement, 'clientWidth', {
        configurable: true,
        value: width,
      });
      window.dispatchEvent(new Event('resize'));
      expect(Dimensions.get('window').width).toBe(width);
      for (const tab of ['individuals', 'expenditures'] as const) {
        const html = renderToStaticMarkup(
          <DonorPaymentList
            groups={groups}
            paymentCopiedAt={dates}
            year={2026}
            tab={tab}
            onSelectTab={vi.fn()}
            ready
            failed={false}
            onRetry={vi.fn()}
          />,
        );
        const dom = document.createElement('div');
        dom.innerHTML = html;
        const panel = dom.querySelector('[role="tabpanel"]')!;
        const expected =
          tab === 'individuals'
            ? 'Contributions file copied Oct 24,\u00a02026'
            : 'Spending file copied Oct 9,\u00a02026';
        const other = tab === 'individuals' ? 'Spending file copied' : 'Contributions file copied';
        expect(panel.textContent).toContain(expected);
        expect(panel.textContent).not.toContain(other);
        expect(panel.textContent!.indexOf(expected)).toBeLessThan(
          panel.textContent!.indexOf(tab === 'individuals' ? 'Fixture Donor' : 'Fixture Vendor'),
        );
      }
    },
  );
  it('keeps a missing list date unknown', () => {
    const html = renderToStaticMarkup(
      <DonorPaymentList
        groups={groups}
        year={2026}
        tab="expenditures"
        onSelectTab={vi.fn()}
        ready
        failed={false}
        onRetry={vi.fn()}
      />,
    );
    expect(html).toContain('Spending file copy date unavailable');
    expect(html).not.toContain('Oct 24');
  });
});
