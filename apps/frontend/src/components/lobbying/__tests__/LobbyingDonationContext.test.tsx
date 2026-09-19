// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
const lookup = vi.hoisted(() => vi.fn());
vi.mock('../../../hooks/useLobbying', () => ({ useLobbyingLobbyist: lookup }));
vi.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: vi.fn() }) }));
vi.mock('react-native-svg', () => ({
  default: ({ children, ...props }: React.SVGProps<SVGSVGElement>) => (
    <svg {...props}>{children}</svg>
  ),
  Path: (props: React.SVGProps<SVGPathElement>) => <path {...props} />,
}));

import { committeePaymentsReceivedFromPayload } from '../../../data/api';
import fixture from '../../../lib/__tests__/fixtures/campaign-money-17868-2025.json';
import {
  groupContributionPayments,
  type DetailedReceivedPayment,
  type MoneyDetailsGroup,
} from '../../../lib/campaignMoneyDetails';
import { DonorPaymentList } from '../../campaignMoney/DonorPaymentList';
import { LobbyingDonationContext } from '../LobbyingDonationContext';

const realPayments = committeePaymentsReceivedFromPayload(fixture.data).payments;
const kozakPayments = realPayments.filter((row) => row.contributorRegistrationNumber === '141');
const kozak = groupContributionPayments(kozakPayments)[0];
let root: Root | undefined;
function mount(content: React.ReactNode) {
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => root!.render(content));
  return container;
}
function click(element: Element | null) {
  expect(element).not.toBeNull();
  act(() => element!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
}
function answer(name = 'Kozak, Andrew', state = 'reported') {
  return { data: { state, name }, isPending: false, isError: false, refetch: vi.fn() };
}
function list(group: MoneyDetailsGroup) {
  return (
    <DonorPaymentList
      groups={[group]}
      year={2025}
      tab={group.tab}
      ready
      failed={false}
      onSelectTab={vi.fn()}
      onRetry={vi.fn()}
    />
  );
}
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = '';
  lookup.mockReset();
});

describe('the registration context inside an open payment row', () => {
  it('keeps Kozak’s real employer and 3 payment records and reads the registration only after expansion', () => {
    lookup.mockReturnValue(answer());
    // A lobbyist number that also occurs in the committee link list must not become a committee link.
    const group = groupContributionPayments(kozakPayments, ['141'])[0];
    const view = mount(list(group));
    expect(kozakPayments).toHaveLength(3);
    expect(view.textContent).toContain('North State Advisors · 3 payment records');
    expect(view.textContent).toContain('1 name · 3 payment records');
    expect(view.querySelector('a')).toBeNull();
    expect(lookup).not.toHaveBeenCalled();
    click(view.querySelector('[aria-label="Show the 3 payment records from Kozak, Andrew"]'));
    expect(lookup).toHaveBeenCalledWith('141');
    expect(view.textContent).toContain('Registration 141');
    expect(view.textContent).toContain('See who Kozak, Andrew represents');
    expect(view.querySelector('a')?.getAttribute('href')).toBe(
      '/money/lobbying/lobbyists/kozak-andrew-141',
    );
    expect(getComputedStyle(view.querySelector('a')!).minHeight).toBe('44px');
    for (const day of ['Nov 26, 2025', 'Nov 8, 2025', 'Aug 21, 2025'])
      expect(view.textContent).toContain(day);
    expect(
      view
        .querySelector('a')!
        .compareDocumentPosition(
          [...view.querySelectorAll('*')].find((node) => node.textContent === 'Nov 26, 2025')!,
        ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('names a different current spelling without changing the name on the donation', () => {
    lookup.mockReturnValue(answer());
    const group = groupContributionPayments(
      kozakPayments.map((row) => ({ ...row, contributor: 'Kozak, Andrew V' })),
    )[0];
    const view = mount(<LobbyingDonationContext group={group} year={2025} />);
    expect(view.textContent).toContain('Registration 141 · registered as Kozak, Andrew');
    expect(view.querySelector('a')?.textContent).toBe('See who Kozak, Andrew represents');
    expect(group.name).toBe('Kozak, Andrew V');
  });

  it('prints absence from the copied list only after a completed lookup says so', () => {
    lookup.mockReturnValue(answer('', 'not_registered_today'));
    const view = mount(<LobbyingDonationContext group={kozak} year={2025} />);
    expect(view.textContent).toBe('Registration 141 · not listed on the copy date');
    expect(view.querySelector('a')).toBeNull();
  });

  it.each(['unavailable', 'error', 'stale absence'])(
    'keeps %s separate from current-registration absence',
    (kind) => {
      lookup.mockReturnValue({
        data:
          kind === 'unavailable'
            ? { state: 'unavailable', name: null }
            : kind === 'stale absence'
              ? { state: 'not_registered_today', name: null }
              : undefined,
        isPending: false,
        isError: kind !== 'unavailable',
        refetch: vi.fn(),
      });
      const view = mount(<LobbyingDonationContext group={kozak} year={2025} />);
      expect(view.textContent).toContain(
        "Could not load this registration from the Board's lobbyist list.",
      );
      expect(view.textContent).not.toContain('not listed on the copy date');
      expect(view.querySelector('a')).toBeNull();
      click(view.querySelector('[role="button"]'));
      expect(lookup.mock.results[0].value.refetch).toHaveBeenCalled();
    },
  );

  it('shows a loading message without claiming the number is absent', () => {
    lookup.mockReturnValue({ data: undefined, isPending: true, isError: false, refetch: vi.fn() });
    const view = mount(<LobbyingDonationContext group={kozak} year={2025} />);
    expect(view.textContent).toContain("Loading the Board's lobbyist list");
    expect(view.textContent).not.toContain('not listed on the copy date');
  });

  it('gives each distinct held number its own context while preserving the name group', () => {
    lookup.mockImplementation((number: string) =>
      answer(number === '141' ? 'Kozak, Andrew' : 'Another printed name'),
    );
    const group = groupContributionPayments([
      ...kozakPayments,
      { ...kozakPayments[0], contributorRegistrationNumber: '9865' },
    ])[0];
    const view = mount(<LobbyingDonationContext group={group} year={2025} />);
    expect(group.payments).toHaveLength(4);
    expect(view.querySelectorAll('a')).toHaveLength(2);
    expect(view.textContent).toContain('Registration 141');
    expect(view.textContent).toContain('Registration 9865 · registered as Another printed name');
  });

  it.each([null, '0', 'not given'])(
    'makes no absence claim for a missing or invalid number %s',
    (number) => {
      const group = groupContributionPayments([
        { ...kozakPayments[0], contributorRegistrationNumber: number },
      ])[0];
      const view = mount(<LobbyingDonationContext group={group} year={2025} />);
      expect(lookup).not.toHaveBeenCalled();
      expect(view.querySelector('a')).toBeNull();
      expect(view.textContent).not.toContain('not listed on the copy date');
    },
  );

  it('preserves each known committee destination inside a name with several numbers', () => {
    const row: DetailedReceivedPayment = {
      ...kozakPayments[0],
      contributor: 'Filed committee name',
      contributorType: 'Political Committee/Fund',
    };
    const group = groupContributionPayments(
      [
        { ...row, contributorRegistrationNumber: '41363' },
        { ...row, contributorRegistrationNumber: '20003' },
        { ...row, contributorRegistrationNumber: '99999' },
      ],
      ['41363', '20003'],
    )[0];
    expect(group.linkableRegistrationNumber).toBeNull();
    expect(group.linkableRegistrationNumbers).toEqual(['41363', '20003']);
    const view = mount(<LobbyingDonationContext group={group} year={2025} />);
    expect([...view.querySelectorAll('a')].map((link) => link.getAttribute('href'))).toEqual([
      '/money/committees/filed-committee-name-41363?year=2025',
      '/money/committees/filed-committee-name-20003?year=2025',
    ]);
    expect(view.textContent).toContain('Registration 99999');
    expect(lookup).not.toHaveBeenCalled();
  });
});
