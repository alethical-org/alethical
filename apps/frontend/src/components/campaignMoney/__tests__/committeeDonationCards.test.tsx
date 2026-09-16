// @vitest-environment jsdom
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type {
  CampaignCommitteeMoney,
  CommitteeDonorStates,
  CommitteeReceivedPayment,
} from '../../../data/types';
import { CommitteeDonationCardsView, CONNECTION_COLORS } from '../CommitteeDonationCards';
import source from './fixtures/committee-donation-cards-17868-2025.json';

const responsive = vi.hoisted(() => ({ isMobile: false, isTablet: false }));
vi.mock('../../../hooks/useResponsive', () => ({ useResponsive: () => responsive }));

type CardCommittee = Pick<
  CampaignCommitteeMoney,
  'registrationNumber' | 'split' | 'statedByKind' | 'donorStates' | 'nameConnections'
>;

const realCommittee: CardCommittee = {
  registrationNumber: source.registration_number,
  split: {
    state: source.split.state as CardCommittee['split']['state'],
    reportedTotal: source.split.reported_total,
    reportedThrough: source.split.reported_through,
    namedTotal: source.split.named_total,
    namedPayments: source.split.named_payments,
    namedCashTotal: source.split.named_cash_total,
    namedInKindTotal: source.split.named_in_kind_total,
    unnamedTotal: source.split.unnamed_total,
    statedSplitState: source.split.stated_split_state,
    firstPaymentOn: source.split.first_payment_on,
    lastPaymentOn: source.split.last_payment_on,
  },
  statedByKind: source.stated_by_kind,
  donorStates: source.donor_states,
  nameConnections: source.name_connections,
};

const payment = (
  amount: string,
  overrides: Partial<CommitteeReceivedPayment> = {},
): CommitteeReceivedPayment => ({
  contributor: 'One closing committee',
  contributorRegistrationNumber: '99999',
  contributorType: 'Candidate Committee',
  employer: null,
  amount,
  receivedOn: '2025-06-01',
  receiptType: 'Contribution',
  inKind: 'No',
  ...overrides,
});

function committee(overrides: Partial<CardCommittee> = {}): CardCommittee {
  return { ...realCommittee, split: { ...realCommittee.split }, ...overrides };
}

function render(
  options: {
    committee?: CardCommittee;
    year?: number;
    registerKind?: string | null;
    payments?: CommitteeReceivedPayment[];
    loading?: boolean;
    failed?: boolean;
  } = {},
) {
  const container = document.createElement('div');
  container.innerHTML = renderToStaticMarkup(
    <CommitteeDonationCardsView
      committee={options.committee ?? committee()}
      year={options.year ?? 2025}
      registerKind={options.registerKind ?? 'candidate_committee'}
      payments={options.payments ?? []}
      loading={options.loading}
      failed={options.failed}
    />,
  );
  return container;
}

function cards(container: HTMLElement) {
  return [...container.querySelectorAll<HTMLElement>('[data-testid*="-donation-card-"]')];
}

function cells(table: HTMLTableElement) {
  return [...table.querySelectorAll<HTMLTableRowElement>('tbody tr')]
    .filter((row) => row.querySelector('th[scope="row"]'))
    .map((row) => [...row.cells].map((cell) => cell.textContent));
}

function tableWithCaption(card: HTMLElement, caption: string) {
  const table = [...card.querySelectorAll('table')].find(
    (candidate) => candidate.querySelector('caption')?.textContent === caption,
  );
  expect(table).not.toBeUndefined();
  return table!;
}

const singleClosingPayment = [
  payment('500.0000'),
  payment('9000', { inKind: 'Yes' }),
  payment('8000', { receiptType: 'Loan' }),
  payment('7000', { receivedOn: '2026-01-01' }),
];

describe('drawn donation cards from committee 17868 in 2025', () => {
  it('prints all approved figures, labels, notes and exact-spelling limits', () => {
    const page = render({ payments: singleClosingPayment });
    const [filing, locations, connections] = cards(page);
    expect(cards(page)).toHaveLength(3);
    expect(cards(page).map((card) => card.querySelector('h2')?.textContent)).toEqual([
      'What the committee’s own report says',
      'Where itemized individual donations came from',
      'Names that also gave to other candidates',
    ]);

    expect(filing.textContent).toContain(
      'Contributions reported by the committee, beside itemized contributions in the state’s list',
    );
    expect([...filing.querySelectorAll('thead th')].map((heading) => heading.textContent)).toEqual([
      '',
      'Reported in the filing',
      'Itemized in the state’s list',
      'Difference',
    ]);
    expect(cells(filing.querySelector('table')!)).toEqual([
      ['Individuals contributions', '$66,203', '$39,950', '$26,253'],
      ['Lobbyist contributions', '$4,300', '$1,400', '$2,900'],
      ['Committee/fund contributions', '$17,300', '$16,050', '$1,250'],
      ['Party unit contributions', '$9,900', '$9,700', '$200'],
      ['Other contributions', '$0', '$0', '$0'],
      ['All five added up', '$97,703', '$67,100', '$30,603'],
    ]);
    expect(filing.textContent).toContain(
      '$500 of this line is 1 payment from a closing candidate committee passing on its balance, which Who gave counts under Committees & Funds instead',
    );
    expect(filing.textContent).toContain(
      'The differences add up to total non-itemized contributions',
    );
    expect(filing.textContent?.match(/Who gave/g)).toHaveLength(1);

    expect(cells(locations.querySelector('table')!)).toEqual([
      ['Minnesota', '71', '$38,700'],
      ['Other states', '0', '$0'],
      ['Unknown', '3', '$1,250'],
    ]);
    expect(
      [...locations.querySelectorAll('thead th')].map((heading) => heading.textContent),
    ).toEqual(['', 'Names', 'Amount']);
    expect(locations.textContent).toContain('Counts individual donors only');
    expect(locations.textContent).toContain(
      'Unknown means the state’s file carries no usable postcode for that donation. It never means the money came from outside Minnesota',
    );

    expect(connections.textContent).toContain('19 of 74 names');
    expect(connections.textContent).toContain(
      'Matched on the exact spelling in the state’s file. The same spelling is not proof of the same person, and 2 spellings of one person stay separate',
    );
    const distribution = tableWithCaption(connections, 'How many other candidates');
    const highest = tableWithCaption(connections, 'The five highest');
    expect(
      [...distribution.querySelectorAll('thead th')].map((heading) => heading.textContent),
    ).toEqual(['How many other candidates', 'Names']);
    expect(cells(distribution)).toEqual([
      ['no other candidate', '55'],
      ['one', '11'],
      ['two', '5'],
      ['three', '1'],
      ['four or more', '2'],
    ]);
    expect([...highest.querySelectorAll('thead th')].map((heading) => heading.textContent)).toEqual(
      ['The five highest', 'Other candidates'],
    );
    expect(cells(highest)).toEqual([
      ['Kratsch, Charles', '11'],
      ['Lindau, Philip', '6'],
      ['Nystrom, Brian', '3'],
      ['Cullen, Mark', '2'],
      ['Haselow, RE', '2'],
    ]);
  });

  it('never renders postcode values, including from unexpected source fields', () => {
    const donorStates = {
      ...source.donor_states,
      rows: source.donor_states.rows.map((row) => ({ ...row, forbidden_zip_code: '55401' })),
      reference: { ...source.donor_states.reference, forbidden_postcode: '90210' },
    } as CommitteeDonorStates;
    const html = render({ committee: committee({ donorStates }) }).outerHTML;
    expect(html).not.toContain('55401');
    expect(html).not.toContain('90210');
  });

  it('uses the neutral five-step ramp in both the bar and its square swatches', () => {
    const connections = cards(render())[2];
    expect(CONNECTION_COLORS).toEqual(['#8a918b', '#6b736c', '#4d574f', '#2f3a31', '#11150f']);
    const color = (value: string) => {
      const probe = document.createElement('div');
      probe.style.background = value;
      return probe.style.background;
    };
    const ramp = [...connections.querySelectorAll<HTMLElement>('[aria-hidden="true"]')].find(
      (element) => element.style.height === '22px',
    )!;
    expect([...ramp.children].map((segment) => (segment as HTMLElement).style.background)).toEqual(
      CONNECTION_COLORS.map(color),
    );
    const swatches = [...connections.querySelectorAll<HTMLElement>('span')].filter(
      (element) => element.style.width === '14px' && element.style.height === '14px',
    );
    expect(swatches.map((swatch) => swatch.style.background)).toEqual(CONNECTION_COLORS.map(color));
  });

  it('counts several payments from one closing committee as payments', () => {
    const sameCommittee = ['500', '1000', '2000', '245000'].map((amount) => payment(amount));
    const filing = cards(render({ payments: sameCommittee }))[0];
    expect(filing.textContent).toContain(
      '$248,500 of this line is 4 payments from closing candidate committees passing on their balances, which Who gave counts under Committees & Funds instead',
    );
    expect(filing.textContent).not.toContain('4 closing candidate committees');
    const noMatch = cards(render({ payments: singleClosingPayment.slice(1) }))[0];
    expect(noMatch.textContent).not.toContain('passing on its balance');
    expect(noMatch.textContent).not.toContain('Who gave');
  });
});

describe('all donation-card states', () => {
  it.each([
    ['a check that has not passed', 'not_checked', 2024],
    ['a year with no filed report', 'not_run', 2023],
  ])('holds all 3 cards for %s and names the viewed year', (_case, state, year) => {
    const held = committee({ split: { ...realCommittee.split, statedSplitState: state } });
    const page = render({ committee: held, year });
    expect(cards(page).map((card) => card.textContent)).toEqual([
      `What the committee’s own report saysThis card needs a filed report for ${year} and our own figures checked against it. We do not yet have both, so no figures are drawn here.`,
      `Where itemized individual donations came fromWe draw this only from a year whose donations we have checked against a filed report. ${year} is not yet one of them, so there is nothing here.`,
      `Names that also gave to other candidatesNo names are matched for ${year}. We match only from a year whose donations we have checked against a filed report, and that is not yet the case here.`,
    ]);
  });

  it('keeps each heading visible while its figures load', () => {
    const page = render({ loading: true });
    expect(cards(page)).toHaveLength(3);
    expect(page.querySelectorAll('[role="status"][aria-busy="true"]')).toHaveLength(3);
    expect(
      [...page.querySelectorAll('[role="status"]')].map(
        (state) => state.querySelector('span')?.textContent,
      ),
    ).toEqual(['Loading', 'Loading', 'Loading']);
  });

  it('gives each failed card its own alert and one retry sentence', () => {
    const page = render({ failed: true });
    expect([...page.querySelectorAll('[role="alert"]')].map((alert) => alert.textContent)).toEqual([
      'We couldn’t load this comparison right now. Please try again in a moment.',
      'We couldn’t load where these donations came from right now. Please try again in a moment.',
      'We couldn’t load these matches right now. Please try again in a moment.',
    ]);
  });

  it('uses the viewed year when checked data has no individual donations', () => {
    const year = 2022;
    const donorStates: CommitteeDonorStates = {
      ...source.donor_states,
      year,
      rows: [],
      summary: {
        minnesota: { names: 0, cash_total: '0' },
        other_states: { names: 0, cash_total: '0' },
        unknown: { names: 0, cash_total: '0' },
      },
    };
    const empty = committee({
      donorStates,
      nameConnections: {
        ...source.name_connections,
        state: 'not_reported',
        year,
        numerator: null,
        denominator: null,
        distribution: [],
        top_names: [],
      },
    });
    const page = render({ committee: empty, year });
    expect(cards(page)[1].textContent).toBe(
      'Where itemized individual donations came fromThe state’s list names no individual donations for this committee in 2022',
    );
    expect(cards(page)[2].textContent).toBe(
      'Names that also gave to other candidatesWith no itemized individual donations in 2022, there is no name to match against other candidates',
    );
  });

  it.each([
    [
      'nameless positive cash',
      payment('500.0000', { contributor: null, contributorType: 'Individual' }),
    ],
    [
      'a zero-dollar individual row',
      payment('0', { contributor: null, contributorType: 'Individual' }),
    ],
    [
      'an in-kind individual row',
      payment('100.0000', { contributor: null, contributorType: 'Individual', inKind: 'Yes' }),
    ],
  ])('does not claim there were no individual donations for %s', (_case, individualPayment) => {
    const cash = individualPayment.inKind === 'No' ? individualPayment.amount! : '0';
    const noUsableNames = committee({
      donorStates: {
        ...source.donor_states,
        rows: [{ state: 'unknown', names: 0, cash_total: cash }],
        summary: {
          minnesota: { names: 0, cash_total: '0' },
          other_states: { names: 0, cash_total: '0' },
          unknown: { names: 0, cash_total: cash },
        },
      },
      nameConnections: {
        ...source.name_connections,
        state: 'not_reported',
        numerator: null,
        denominator: null,
        distribution: [],
        top_names: [],
      },
    });
    const [, locations, connections] = cards(
      render({ committee: noUsableNames, payments: [individualPayment] }),
    );
    expect(locations.textContent).not.toContain('list names no individual donations');
    if (cash === '0') expect(locations.querySelector('[role="alert"]')).not.toBeNull();
    else expect(locations.textContent).toContain('$500');

    expect(connections.querySelector('[role="alert"]')?.textContent).toBe(
      'We couldn’t load these matches right now. Please try again in a moment.',
    );
    expect(connections.textContent).not.toContain('With no itemized individual donations');
  });

  it('keeps cash visible when an individual donation has no usable donor name', () => {
    const donorStates: CommitteeDonorStates = {
      ...source.donor_states,
      rows: [{ state: 'unknown', names: 0, cash_total: '500.0000' }],
      summary: {
        minnesota: { names: 0, cash_total: '0' },
        other_states: { names: 0, cash_total: '0' },
        unknown: { names: 0, cash_total: '500.0000' },
      },
    };
    const locations = cards(render({ committee: committee({ donorStates }) }))[1];
    expect(locations.textContent).not.toContain(
      'The state’s list names no individual donations for this committee in 2025',
    );
    expect(cells(locations.querySelector('table')!)).toEqual([
      ['Minnesota', '0', '$0'],
      ['Other states', '0', '$0'],
      ['Unknown', '0', '$500'],
    ]);
  });

  it.each(['political_fund', 'party_unit'])('removes only card 2 on a %s page', (kind) => {
    const page = render({ registerKind: kind });
    expect(cards(page).map((card) => card.querySelector('h2')?.textContent)).toEqual([
      'What the committee’s own report says',
      'Names that also gave to other candidates',
    ]);
    expect(page.textContent).not.toContain('Where itemized individual donations came from');
  });
});

describe('several other states', () => {
  it.each([
    ['computer', false, null],
    ['phone', true, '3'],
  ])('keeps each state named and its figures aligned on %s', (_band, mobile, colSpan) => {
    responsive.isMobile = mobile;
    responsive.isTablet = false;
    const donorStates: CommitteeDonorStates = {
      ...source.donor_states,
      rows: [
        source.donor_states.rows[0],
        { state: 'CA', names: 2, cash_total: '200.0000' },
        { state: 'WI', names: 3, cash_total: '300.0000' },
        source.donor_states.rows[1],
      ],
      summary: {
        ...source.donor_states.summary,
        other_states: { names: 5, cash_total: '500.0000' },
      },
    };
    const locations = cards(render({ committee: committee({ donorStates }) }))[1];
    for (const state of ['California', 'Wisconsin']) {
      const heading = [...locations.querySelectorAll('th[scope="row"]')].find(
        (candidate) => candidate.textContent === state,
      )!;
      expect(heading).not.toBeUndefined();
      expect(heading.getAttribute('colspan')).toBe(colSpan);
    }
    expect(locations.textContent).toContain('California2$200');
    expect(locations.textContent).toContain('Wisconsin3$300');
  });
});

it('holds the filing card when the server explicitly withholds its five lines', () => {
  const page = render({
    registerKind: 'political_fund',
    committee: committee({ statedByKind: null }),
  });
  const [filing, connections] = cards(page);
  expect(cards(page)).toHaveLength(2);
  expect(filing.textContent).toContain(
    'This card needs a filed report for 2025 and our own figures checked against it. We do not yet have both, so no figures are drawn here.',
  );
  expect(filing.querySelector('table')).toBeNull();
  expect(filing.querySelector('[role="alert"]')).toBeNull();
  expect(connections.textContent).toContain('19 of 74 names');
});
