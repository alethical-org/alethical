import { describe, expect, it } from 'vitest';
import { committeePaymentsReceivedFromPayload } from '../../data/api';
import fixture from './fixtures/campaign-money-17868-2025.json';
import {
  contributionChartSafety,
  contributionKindSlices,
  groupContributionPayments,
  groupExpenditurePayments,
  prepareContributionChart,
  sortMoneyGroups,
  sumMoneyAmounts,
  tabDetails,
  type DetailedReceivedPayment,
} from '../campaignMoneyDetails';

const real = committeePaymentsReceivedFromPayload(fixture.data).payments;
const gift = (patch: Partial<DetailedReceivedPayment> = {}): DetailedReceivedPayment => ({
  contributor: 'Smith, Amy',
  contributorRegistrationNumber: null,
  contributorType: 'Individual',
  employer: 'Retired',
  amount: '0.10',
  receivedOn: '2025-01-01',
  receiptType: 'Contribution',
  inKind: 'No',
  ...patch,
});

describe('one committee’s complete donation record', () => {
  it('reproduces the live sample without merging names or duplicate-looking payments', () => {
    const groups = groupContributionPayments(real, fixture.data.linkable_registration_numbers);
    expect(real).toHaveLength(134);
    expect(groups).toHaveLength(115);
    expect(sumMoneyAmounts(groups.map((group) => group.amount))).toBe('67100.00');
    expect(tabDetails(groups, 'individuals').paymentCount).toBe(82);
    expect(tabDetails(groups, 'individuals').amount).toBe('39950.00');
    expect(tabDetails(groups, 'committees').paymentCount).toBe(44);
    expect(tabDetails(groups, 'committees').amount).toBe('16550.00');
    expect(groups.find((group) => group.types.includes('Candidate Committee'))?.tab).toBe(
      'committees',
    );
    expect(
      contributionKindSlices(real).find((slice) => slice.kind === 'Committees & Funds'),
    ).toMatchObject({ tab: 'committees', amount: '16550.00', nameCount: 35 });
    expect(contributionKindSlices(real).map((slice) => slice.kind)).toEqual([
      'Individuals',
      'Lobbyists',
      'Committees & Funds',
      'Party Units',
    ]);
  });

  it('keeps exact spelling, duplicate payments and free-text descriptions; excludes other receipts', () => {
    const groups = groupContributionPayments([
      gift(),
      gift(),
      gift({ contributor: 'Smith, Amy R', employer: 'Lawyer' }),
      gift({ receiptType: 'Miscellaneous', amount: '9000' }),
      gift({ receiptType: 'Loan Payable', amount: '9000' }),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0].payments).toHaveLength(2);
    expect(groups[0].amount).toBe('0.20');
    expect(groups[1].employers).toEqual(['Lawyer']);
  });

  it('keeps unnamed rows accessible without counting them as printed names', () => {
    const groups = groupContributionPayments([
      gift({ contributor: null }),
      gift({ contributor: '' }),
    ]);
    expect(tabDetails(groups, 'individuals')).toMatchObject({
      nameCount: 0,
      paymentCount: 2,
      groupCount: 1,
      unnamedNameGroups: 1,
      amount: '0.20',
    });
    expect(groups[0].name).toBe('Name not given in the filing');
  });

  it('keeps Candidate Committee under committees and unusual kinds under other', () => {
    const groups = groupContributionPayments([
      gift({ contributorType: 'Candidate Committee' }),
      gift({ contributorType: 'Unknown' }),
      gift({ contributorType: 'Self' }),
      gift({ contributorType: null }),
    ]);
    expect(groups.map((group) => group.tab)).toEqual(['committees', 'other']);
    expect(groups[1].types).toEqual(['Unknown', 'Self', null]);
  });

  it('does not choose a link when one name carries conflicting registered identities', () => {
    const rows = [
      gift({ contributorRegistrationNumber: '1' }),
      gift({ contributorRegistrationNumber: '2' }),
    ];
    expect(groupContributionPayments(rows, ['1', '2'])[0].linkableRegistrationNumber).toBeNull();
    expect(groupContributionPayments(rows.slice(0, 1), ['1'])[0].linkableRegistrationNumber).toBe(
      '1',
    );
  });

  it('counts and totals the whole tab independently of search and sort', () => {
    const groups = groupContributionPayments([
      gift({ contributor: 'Alpha', amount: '2', receivedOn: '2025-01-01' }),
      gift({ contributor: 'Alpha', amount: '3', receivedOn: '2025-05-01' }),
      gift({ contributor: 'Beta', amount: '2', receivedOn: '2025-02-01' }),
      gift({ contributor: 'Gamma', amount: null, receivedOn: null }),
    ]);
    expect(sortMoneyGroups(groups, 'largest').map((g) => g.name)).toEqual([
      'Alpha',
      'Beta',
      'Gamma',
    ]);
    expect(sortMoneyGroups(groups, 'smallest').map((g) => g.name)).toEqual([
      'Beta',
      'Alpha',
      'Gamma',
    ]);
    expect(sortMoneyGroups(groups, 'newest').map((g) => g.name)).toEqual([
      'Alpha',
      'Beta',
      'Gamma',
    ]);
    expect(sortMoneyGroups(groups, 'oldest').map((g) => g.name)).toEqual([
      'Alpha',
      'Beta',
      'Gamma',
    ]);
    expect(sortMoneyGroups(groups, 'name', 'ALP').map((g) => g.name)).toEqual(['Alpha']);
    expect(tabDetails(groups, 'individuals')).toMatchObject({
      nameCount: 3,
      paymentCount: 4,
      amount: null,
    });
  });

  it('preserves decimal precision and refuses to turn missing money into zero', () => {
    expect(sumMoneyAmounts(['90071992547409.1234', '0.0001'])).toBe('90071992547409.1235');
    expect(sumMoneyAmounts(['-1.01', '0.10'])).toBe('-0.91');
    expect(sumMoneyAmounts([null, '1'])).toBeNull();
    expect(sumMoneyAmounts(['1e2'])).toBeNull();
  });

  it('keeps each vendor payment’s purpose and goods amount', () => {
    const groups = groupExpenditurePayments([
      {
        vendorName: 'Printer',
        vendorCity: 'Anoka',
        vendorState: 'MN',
        affectedCommitteeName: null,
        affectedCommitteeRegistrationNumber: null,
        amount: '10.25',
        paidOn: '2025-01-01',
        expenditureType: 'Campaign Expenditure',
        purpose: 'Signs',
        inKind: 'Yes',
      },
    ]);
    expect(groups[0]).toMatchObject({
      tab: 'expenditures',
      amount: '10.25',
      inKindAmount: '10.25',
    });
    expect(groups[0].payments[0]).toHaveProperty('purpose', 'Signs');
  });
});

describe('contribution chart boundaries', () => {
  it('counts an exact name once across committee kinds while retaining both payment types', () => {
    const rows = [
      gift({ contributorType: 'Candidate Committee', amount: '3' }),
      gift({ contributorType: 'Political Committee/Fund', amount: '7' }),
      gift({ contributorType: 'Candidate Committee', amount: '5', inKind: 'Yes' }),
    ];
    expect(contributionKindSlices(rows)).toEqual([
      {
        kind: 'Committees & Funds',
        tab: 'committees',
        amount: '10.00',
        nameCount: 1,
        safeForChart: true,
      },
    ]);
    expect(groupContributionPayments(rows)[0]).toMatchObject({
      amount: '15.00',
      types: ['Candidate Committee', 'Political Committee/Fund'],
    });
  });

  it('reconciles the real 2025 named cash and unnamed slice to the official total', () => {
    const chart = prepareContributionChart(real, {
      state: 'shown',
      reportedTotal: '97703.75',
      namedCashTotal: '67100',
      unnamedTotal: '30603.75',
    });
    expect(chart.state).toBe('ready');
    expect(chart.slices.at(-1)).toMatchObject({ tab: null, amount: '30603.75' });
    expect(chart.slices.at(-1)).not.toHaveProperty('nameCount');
    expect(chart.slices.reduce((sum, slice) => sum + slice.share, 0)).toBeCloseTo(1, 7);
  });

  it('excludes goods from cash slices but retains them in list totals', () => {
    const rows = [gift({ amount: '2' }), gift({ amount: '8', inKind: 'Yes' })];
    expect(contributionKindSlices(rows)[0].amount).toBe('2.00');
    expect(groupContributionPayments(rows)[0]).toMatchObject({
      amount: '10.00',
      inKindAmount: '8.00',
    });
    const chart = prepareContributionChart(rows, {
      state: 'no_reported_total',
      namedCashTotal: '2',
      reportedTotal: null,
      unnamedTotal: null,
    });
    expect(chart).toMatchObject({ state: 'ready', base: '2.00' });
    expect(chart.slices).toHaveLength(1);
  });

  it('withholds unsafe arithmetic and disagreement, instead of drawing a plausible circle', () => {
    const split = { state: 'shown', reportedTotal: '10', namedCashTotal: '2', unnamedTotal: '8' };
    expect(prepareContributionChart([gift({ amount: '3' })], split).reason).toBe(
      'totals_do_not_match',
    );
    expect(prepareContributionChart([gift({ amount: '-1' })], split).reason).toBe(
      'negative_amount',
    );
    expect(prepareContributionChart([gift({ amount: null })], split).reason).toBe('missing_amount');
    expect(contributionChartSafety([gift({ inKind: null })])).toBe('unknown_in_kind');
    expect(prepareContributionChart([gift()], { ...split, state: 'sources_disagree' }).state).toBe(
      'withheld',
    );
    expect(prepareContributionChart([], split).state).toBe('no_rows');
    expect(prepareContributionChart([gift({ amount: '0' })], split).reason).toBe(
      'totals_do_not_match',
    );
  });

  it('uses complete named cash when no official or named total was served', () => {
    const split = {
      state: 'no_reported_total',
      reportedTotal: null,
      namedCashTotal: null,
      unnamedTotal: null,
    };
    expect(
      prepareContributionChart(
        [gift({ amount: '2' }), gift({ amount: '8', inKind: 'Yes' })],
        split,
      ),
    ).toMatchObject({ state: 'ready', base: '2.00' });
    expect(
      prepareContributionChart([gift({ amount: '2' })], { ...split, namedCashTotal: '3' }).reason,
    ).toBe('totals_do_not_match');
  });

  it('does not supply a zero unnamed slice to the circle', () => {
    const chart = prepareContributionChart([gift({ amount: '2' })], {
      state: 'shown',
      reportedTotal: '2',
      namedCashTotal: '2',
      unnamedTotal: '0',
    });
    expect(chart.state).toBe('ready');
    expect(chart.slices).toHaveLength(1);
    expect(chart.slices.every((slice) => slice.tab !== null)).toBe(true);
  });

  it('can show fully unnamed official cash beside named donated goods', () => {
    const chart = prepareContributionChart([gift({ amount: '25', inKind: 'Yes' })], {
      state: 'shown',
      reportedTotal: '10',
      namedCashTotal: '0',
      unnamedTotal: '10',
    });
    expect(chart.state).toBe('ready');
    expect(chart.slices).toEqual([
      { kind: 'Non-itemized contributions', tab: null, amount: '10.00', share: 1 },
    ]);
  });
});
