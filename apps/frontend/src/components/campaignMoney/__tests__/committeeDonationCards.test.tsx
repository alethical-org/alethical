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
      'Where itemized individual contributions came from',
      'Contributor names also listed for other candidates',
    ]);

    expect(filing.textContent).toContain(
      'Contributions reported by the committee, beside itemized contributions in the state’s list',
    );
    expect([...filing.querySelectorAll('thead th')].map((heading) => heading.textContent)).toEqual([
      '',
      'Total contributions in report',
      'Itemized contributions in state’s list',
      'Non-itemized contributions (calculated)',
    ]);
    expect(cells(filing.querySelector('table')!)).toEqual([
      ['Individuals contributions', '$66,203', '$39,950', '$26,253'],
      ['Lobbyist contributions', '$4,300', '$1,400', '$2,900'],
      ['Committee/fund contributions', '$17,300', '$16,050', '$1,250'],
      ['Party unit contributions', '$9,900', '$9,700', '$200'],
      ['Other contributions', '$0', '$0', '$0'],
      ['Total', '$97,703', '$67,100', '$30,603'],
    ]);
    expect(filing.textContent).toContain(
      '$500 of this line is 1 payment from a closing candidate committee passing on its balance, which Who gave counts under Committees & Funds instead',
    );
    expect(filing.textContent).toContain(
      'Non-itemized contributions = total contributions − itemized contributions',
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
    expect(locations.textContent).not.toContain('Counts individual donors only');
    expect(locations.textContent).toContain(
      'Unknown means the state’s file has no usable ZIP code to identify the donor’s state',
    );

    expect(connections.textContent).toContain('19 of 74 names');
    expect(connections.textContent).toContain(
      'Matched by exact spelling in the state’s file. A match does not prove it is the same person; different spellings count separately.',
    );
    const distribution = tableWithCaption(connections, 'Other candidate committees');
    const highest = tableWithCaption(connections, 'Names with the most matches');
    expect(
      [...distribution.querySelectorAll('thead th')].map((heading) => heading.textContent),
    ).toEqual(['Other candidate committees', 'Names']);
    expect(cells(distribution)).toEqual([
      ['0', '55'],
      ['1', '11'],
      ['2', '5'],
      ['3', '1'],
      ['4 or more', '2'],
    ]);
    expect([...highest.querySelectorAll('thead th')].map((heading) => heading.textContent)).toEqual(
      ['Names with the most matches', 'Other candidate committees'],
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
    const ramp = [...connections.querySelectorAll<HTMLElement>('[role="img"]')].find(
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
      '$248,500 of this line is 4 payments in the closing candidate committee category, which Who gave counts under Committees & Funds instead',
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
      `Where itemized individual contributions came fromWe draw this only from a year whose donations we have checked against a filed report. ${year} is not yet one of them, so there is nothing here.`,
      `Contributor names also listed for other candidatesNo names are matched for ${year}. We match only from a year whose donations we have checked against a filed report, and that is not yet the case here.`,
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
      'Where itemized individual contributions came fromThe state’s list names no individual contributions for this committee in 2022',
    );
    expect(cards(page)[2].textContent).toBe(
      'Contributor names also listed for other candidatesWith no itemized individual contributions in 2022, there is no name to match against other candidates',
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
    expect(locations.textContent).not.toContain('list names no individual contributions');
    if (cash === '0') expect(locations.querySelector('[role="alert"]')).not.toBeNull();
    else expect(locations.textContent).toContain('$500');

    expect(connections.querySelector('[role="alert"]')?.textContent).toBe(
      'We couldn’t load these matches right now. Please try again in a moment.',
    );
    expect(connections.textContent).not.toContain('With no itemized individual contributions');
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
      'The state’s list names no individual contributions for this committee in 2025',
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
      'Contributor names also listed for other candidates',
    ]);
    expect(page.textContent).not.toContain('Where itemized individual contributions came from');
  });

  it.each(['party_unit', 'political_committee_or_fund'])(
    'holds an omitted candidate-report comparison after a successful %s read',
    (registerKind) => {
      const filing = cards(
        render({ registerKind, committee: committee({ statedByKind: undefined }) }),
      )[0];
      expect(filing.textContent).toContain(
        'This card needs a filed report for 2025 and our own figures checked against it. We do not yet have both, so no figures are drawn here.',
      );
      expect(filing.querySelector('[role="alert"]')).toBeNull();
      expect(filing.querySelector('table')).toBeNull();
      expect(filing.textContent).not.toContain('$0');
    },
  );

  it('keeps an omitted candidate comparison as a failed load', () => {
    const filing = cards(render({ committee: committee({ statedByKind: undefined }) }))[0];
    expect(filing.querySelector('[role="alert"]')?.textContent).toBe(
      'We couldn’t load this comparison right now. Please try again in a moment.',
    );
    expect(filing.querySelector('table')).toBeNull();
  });

  it.each(['party_unit', 'political_committee_or_fund', 'candidate_committee'])(
    'keeps a failed %s request separate from an unsupported comparison',
    (registerKind) => {
      const filing = cards(
        render({ registerKind, committee: committee({ statedByKind: undefined }), failed: true }),
      )[0];
      expect(filing.querySelector('[role="alert"]')?.textContent).toBe(
        'We couldn’t load this comparison right now. Please try again in a moment.',
      );
      expect(filing.textContent).not.toContain('This card needs a filed report');
    },
  );
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

it('keeps the calculated total aligned and stacks each heading on 3 lines', () => {
  responsive.isMobile = false;
  const filing = cards(render())[0];
  const headings = [...filing.querySelectorAll('thead th')].slice(1);
  for (const heading of headings) expect(heading.querySelectorAll('span')).toHaveLength(3);
  const total = filing.querySelector('tbody tr:last-child td:last-child span') as HTMLElement;
  expect(total.textContent).toBe('$30,603');
  expect(total.style.marginRight).toBe('-10px');
  expect(total.style.padding).toBe('5px 10px');
  expect(total.style.background).toBe('rgba(137, 144, 135, 0.2)');
});

it('keeps the same labelled figures and total wash on a phone', () => {
  responsive.isMobile = true;
  const filing = cards(render())[0];
  expect(filing.querySelector('table')).toBeNull();
  expect(filing.querySelector('dt')?.textContent).toBe('Total contributions in report');
  const total = [...filing.querySelectorAll('dd span')];
  expect(total).toHaveLength(1);
  expect(total[0].textContent).toBe('$30,603');
  responsive.isMobile = false;
});

it('lists positive matches without padding and ends the shorter list without a rule', () => {
  const nameConnections = {
    ...source.name_connections,
    top_names: [
      { name: 'Matched, A', other_committees: 2 },
      { name: 'Unmatched, B', other_committees: 0 },
      { name: 'Matched, C', other_committees: 1 },
    ],
  };
  const connections = cards(render({ committee: committee({ nameConnections }) }))[2];
  const table = tableWithCaption(connections, 'Names with the most matches');
  expect(cells(table)).toEqual([
    ['Matched, A', '2'],
    ['Matched, C', '1'],
  ]);
  expect(table.textContent).not.toContain('Unmatched, B');
  for (const cell of table.querySelectorAll<HTMLElement>('tbody tr:last-child > *')) {
    expect(cell.style.borderBottomStyle).toBe('none');
  }
  expect(connections.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe(
    '19 of 74 names are also listed for at least one other candidate committee. 0 other candidate committees, 55 names; 1 other candidate committee, 11 names; 2 other candidate committees, 5 names; 3 other candidate committees, 1 name; 4 or more other candidate committees, 2 names',
  );
});
