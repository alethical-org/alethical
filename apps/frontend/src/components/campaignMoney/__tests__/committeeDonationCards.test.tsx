// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type {
  CampaignCommitteeMoney,
  CommitteeDonorStates,
  CommitteeReceivedPayment,
} from '../../../data/types';
import {
  CommitteeDonationCardsView,
  CONNECTION_COLORS,
  LOCATION_COLORS,
} from '../CommitteeDonationCards';
import { CAMPAIGN_MONEY_COLORS as c } from '../../../lib/campaignMoneyColors';
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

/** The panel's own expandable rows. The location block left the panel and is found by
 *  `locations` below. */
function cards(container: HTMLElement) {
  return [...container.querySelectorAll<HTMLElement>('[data-testid*="-donation-card-"]')];
}

/** The contributor-location card: its own region, outside and above the panel. */
function locations(container: HTMLElement) {
  return [...container.querySelectorAll<HTMLElement>('[role="region"]')].find(
    (region) =>
      region.querySelector('h2')?.textContent ===
      'Where itemized individual contributions came from',
  );
}

function panel(container: HTMLElement) {
  return [...container.querySelectorAll<HTMLElement>('[role="region"]')].find(
    (region) =>
      region.querySelector('h2')?.textContent === 'More on this year\u2019s contributions',
  )!;
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

/** One individual contribution, which is what proves the rows exist at all. */
const individualCash = payment('500.0000', { contributor: null, contributorType: 'Individual' });

const singleClosingPayment = [
  payment('500.0000'),
  payment('9000', { inKind: 'Yes' }),
  payment('8000', { receiptType: 'Loan' }),
  payment('7000', { receivedOn: '2026-01-01' }),
];

describe('drawn donation cards from committee 17868 in 2025', () => {
  it('prints all approved figures, labels, notes and exact-spelling limits', () => {
    const page = render({ payments: singleClosingPayment });
    const [filing, connections] = cards(page);
    expect(cards(page)).toHaveLength(2);
    expect(cards(page).map((card) => card.querySelector('h3')?.textContent)).toEqual([
      'What the committee’s own report says',
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

    const place = locations(page)!;
    expect(cells(place.querySelector('table')!)).toEqual([
      ['Minnesota', '71', '$38,700', '96.9%'],
      ['Other states', '0', '$0', '0%'],
      ['Unknown', '3', '$1,250', '3.1%'],
    ]);
    expect([...place.querySelectorAll('thead th')].map((heading) => heading.textContent)).toEqual([
      'State',
      'Names',
      'Amount',
      'Share of dollars',
    ]);
    expect(place.querySelector('caption')?.textContent).toBe(
      'Itemized individual contributions by state, 2025',
    );
    expect(place.textContent).toContain(
      'Shares of dollars by state, excluding donated goods and services',
    );
    expect([...place.querySelectorAll('p')].map((line) => line.textContent)).toEqual([
      'Shares of dollars by state, excluding donated goods and services',
      'States are identified from ZIP codes in the state’s file',
      'Unknown means the state’s file has no usable ZIP code to identify the donor’s state',
      'Names count distinct spellings within each row, including contributions of goods and services. The same name can appear in more than 1 state.',
    ]);

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
    const connections = cards(render())[1];
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
  ])('holds all 3 blocks for %s and names the viewed year', (_case, state, year) => {
    const held = committee({ split: { ...realCommittee.split, statedSplitState: state } });
    const page = render({ committee: held, year });
    expect(cards(page).map((card) => card.textContent)).toEqual([
      `What the committee’s own report saysThis card needs a filed report for ${year} and our own figures checked against it. We do not yet have both, so no figures are drawn here.`,
      `Contributor names also listed for other candidatesNo names are matched for ${year}. We match only from a year whose donations we have checked against a filed report, and that is not yet the case here.`,
    ]);
    const place = locations(page)!;
    expect(place.textContent).toBe(
      'Where itemized individual contributions came fromShares of dollars by state, excluding ' +
        `donated goods and servicesWe cannot show this breakdown for ${year} because the ` +
        'contributions have not passed our check against a filed report',
    );
    expect(place.querySelector('table')).toBeNull();
    expect(place.querySelector('[role="img"]')).toBeNull();
  });

  it('keeps each heading visible while its figures load', () => {
    const page = render({ loading: true });
    expect(cards(page)).toHaveLength(2);
    expect(page.querySelectorAll('[role="status"][aria-busy="true"]')).toHaveLength(3);
    expect(
      [...page.querySelectorAll('[role="status"]')].map(
        (state) => state.querySelector('span')?.textContent,
      ),
    ).toEqual(['Loading', 'Loading', 'Loading']);
    // The location card's placeholders rest: the word Loading already says a read is in
    // flight, and a pulse says it a second time in motion.
    const resting = [...locations(page)!.querySelectorAll<HTMLElement>('[aria-hidden="true"]')];
    expect(resting).toHaveLength(3);
    for (const block of resting) expect(block.className).toBe('');
    expect(locations(page)!.querySelector('style')).toBeNull();
  });

  it('gives each failed card its own alert and one retry sentence', () => {
    const page = render({ failed: true });
    expect([...page.querySelectorAll('[role="alert"]')].map((alert) => alert.textContent)).toEqual([
      'We couldn’t load where these donations came from right now. Please try again in a moment.',
      'We couldn’t load this comparison right now. Please try again in a moment.',
      'We couldn’t load these matches right now. Please try again in a moment.',
    ]);
    // A failed read is never an empty list or a zero.
    expect(locations(page)!.querySelector('table')).toBeNull();
    expect(locations(page)!.textContent).not.toContain('$0');
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
    expect(locations(page)!.textContent).toBe(
      'Where itemized individual contributions came fromShares of dollars by state, excluding ' +
        'donated goods and servicesThe state’s list names no individual contributions for ' +
        'this committee in 2022',
    );
    expect(locations(page)!.querySelector('table')).toBeNull();
    expect(locations(page)!.querySelector('[role="img"]')).toBeNull();
    expect(cards(page)[1].textContent).toBe(
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
    const page = render({ committee: noUsableNames, payments: [individualPayment] });
    const place = locations(page)!;
    const connections = cards(page)[1];
    expect(place.textContent).not.toContain('list names no individual contributions');
    if (cash === '0') {
      // Rows exist and none carries cash. Its own sentence, its own table of real zeros,
      // and no bar -- never the no-rows sentence and never a failed read.
      expect(place.textContent).toContain(
        'No itemized individual contribution dollars listed for 2025',
      );
      expect(place.querySelector('[role="alert"]')).toBeNull();
      expect(place.querySelector('[role="img"]')).toBeNull();
      expect(cells(place.querySelector('table')!)).toEqual([
        ['Minnesota', '0', '$0', 'Not applicable'],
        ['Other states', '0', '$0', 'Not applicable'],
        ['Unknown', '0', '$0', 'Not applicable'],
      ]);
    } else {
      expect(place.textContent).toContain('$500');
      expect(cells(place.querySelector('table')!)).toEqual([
        ['Minnesota', '0', '$0', '0%'],
        ['Other states', '0', '$0', '0%'],
        ['Unknown', '0', '$500', '100.0%'],
      ]);
    }

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
    const place = locations(
      render({ committee: committee({ donorStates }), payments: [individualCash] }),
    )!;
    expect(place.textContent).not.toContain(
      'The state’s list names no individual contributions for this committee in 2025',
    );
    expect(cells(place.querySelector('table')!)).toEqual([
      ['Minnesota', '0', '$0', '0%'],
      ['Other states', '0', '$0', '0%'],
      ['Unknown', '0', '$500', '100.0%'],
    ]);
  });

  it.each(['party_unit', 'political_committee_or_fund'])(
    'omits unsupported rows by established %s type, even when candidate fields are present',
    (registerKind) => {
      for (const failed of [false, true]) {
        const page = render({ registerKind, failed });
        expect(cards(page)).toHaveLength(1);
        expect(cards(page)[0].querySelector('h3')?.textContent).toBe(
          'Contributor names also listed for other candidates',
        );
        expect(page.textContent).not.toContain('What the committee’s own report says');
        // Absent entirely: no heading, no empty table, no message. We say nothing rather
        // than claiming a fund or a party organisation has no individual contributions.
        expect(locations(page)).toBeUndefined();
        expect(page.textContent).not.toContain('Where itemized individual contributions came from');
      }
    },
  );

  it.each(['missing', 'withheld', 'disagreeing', 'incomplete'] as const)(
    'keeps valid geography and name results when the report comparison is %s',
    (state) => {
      const statedByKind: CardCommittee['statedByKind'] =
        state === 'missing'
          ? undefined
          : state === 'withheld'
            ? null
            : state === 'disagreeing'
              ? { ...source.stated_by_kind, state: 'sources_disagree' }
              : { ...source.stated_by_kind, lines: [] };
      const page = render({ committee: committee({ statedByKind }) });
      const [filing, connections] = cards(page);
      const place = locations(page)!;
      expect(filing.querySelector('table')).toBeNull();
      expect(place.textContent).toContain('Minnesota');
      expect(place.textContent).toContain('$38,700');
      expect(place.querySelectorAll('table')).toHaveLength(1);
      expect(connections.textContent).toContain('19 of 74 names');
      expect(connections.querySelectorAll('table')).toHaveLength(2);
      expect(place.querySelector('[role="alert"]')).toBeNull();
      expect(connections.querySelector('[role="alert"]')).toBeNull();
    },
  );

  it('keeps an omitted candidate comparison as a failed load', () => {
    const filing = cards(render({ committee: committee({ statedByKind: undefined }) }))[0];
    expect(filing.querySelector('[role="alert"]')?.textContent).toBe(
      'We couldn’t load this comparison right now. Please try again in a moment.',
    );
    expect(filing.querySelector('table')).toBeNull();
  });

  it.each(['candidate_committee', null])(
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
  /** Deliberately out of alphabetical order in the source, and Wyoming carries names with
   *  no cash: a state we hold a spelling for is never dropped for giving $0. */
  const several: CommitteeDonorStates = {
    ...source.donor_states,
    rows: [
      source.donor_states.rows[0],
      { state: 'WI', names: 3, cash_total: '300.0000' },
      { state: 'DC', names: 1, cash_total: '1000.0000' },
      { state: 'CA', names: 2, cash_total: '200.0000' },
      { state: 'MA', names: 1, cash_total: '20.0000' },
      { state: 'WY', names: 2, cash_total: '0' },
      source.donor_states.rows[1],
    ],
    summary: {
      ...source.donor_states.summary,
      other_states: { names: 8, cash_total: '1520.0000' },
    },
  };

  it.each([
    ['computer', false, false, 28],
    ['tablet', false, true, 26],
    ['phone', true, false, 14],
  ])('nests every state under its subtotal on %s', (_band, mobile, tablet, indent) => {
    responsive.isMobile = mobile;
    responsive.isTablet = tablet;
    const place = locations(
      render({ committee: committee({ donorStates: several }), payments: [individualCash] }),
    )!;
    // Full names, alphabetical, District of Columbia inline under D, and all 4 columns at
    // every band so no name, amount or share is lost on a phone.
    expect(cells(place.querySelector('table')!)).toEqual([
      ['Minnesota', '71', '$38,700', '93.3%'],
      ['Other states', '8', '$1,520', '3.7%'],
      ['California', '2', '$200', '0.5%'],
      ['District of Columbia', '1', '$1,000', '2.4%'],
      ['Massachusetts', '1', '$20', '<0.1%'],
      ['Wisconsin', '3', '$300', '0.7%'],
      ['Wyoming', '2', '$0', '0%'],
      ['Unknown', '3', '$1,250', '3.0%'],
    ]);
    for (const row of place.querySelectorAll('th[scope="row"]')) {
      expect(row.getAttribute('colspan')).toBeNull();
    }
    const nested = [...place.querySelectorAll<HTMLElement>('th[scope="row"]')].filter((row) =>
      ['California', 'District of Columbia', 'Massachusetts', 'Wisconsin', 'Wyoming'].includes(
        row.textContent ?? '',
      ),
    );
    expect(nested).toHaveLength(5);
    for (const row of nested) {
      expect(row.style.paddingLeft).toBe(`${indent}px`);
      // A word the browser may not break: Massachusetts must never read Massachuset / ts.
      expect(row.style.overflowWrap).toBe('');
      expect(row.style.wordBreak).toBe('');
    }
    // The caption is the only place the subtotal relationship is stated in words.
    expect(place.querySelector('caption')?.textContent).toBe(
      'Itemized individual contributions by state, 2025. States listed under Other states ' +
        'are included in its subtotal.',
    );
    // Individual state names need not add to the subtotal's 8: one spelling can sit in 2
    // states. The dollars do add.
    expect(place.textContent).not.toContain('Total');
    responsive.isMobile = false;
    responsive.isTablet = false;
  });

  it('keeps a long state list whole, with no bucket, cut-off or Show more', () => {
    const many = [
      ['AZ', 1, '500'],
      ['CA', 4, '3250'],
      ['CO', 2, '900'],
      ['CT', 1, '250'],
      ['DC', 3, '4500'],
      ['FL', 2, '1200'],
      ['GA', 1, '400'],
      ['IL', 2, '1500'],
      ['IA', 1, '300'],
      ['MA', 2, '1750'],
      ['MI', 1, '250'],
      ['NH', 1, '150'],
      ['NY', 3, '2600'],
      ['NC', 1, '350'],
      ['ND', 2, '2000'],
      ['PA', 1, '600'],
      ['SD', 1, '400'],
      ['TX', 2, '2100'],
      ['VA', 1, '500'],
      ['WA', 1, '900'],
      ['WI', 2, '2000'],
    ] as const;
    const donorStates: CommitteeDonorStates = {
      ...source.donor_states,
      rows: [
        { state: 'MN', names: 118, cash_total: '74250' },
        ...many.map(([state, names, cash_total]) => ({ state, names, cash_total })),
        { state: 'unknown', names: 9, cash_total: '4100' },
      ],
      summary: {
        minnesota: { names: 118, cash_total: '74250' },
        // 35 state-level names against a subtotal of 31: one spelling can sit in more
        // than 1 state, so the state counts are not required to add to it. The dollars
        // are, and $26,400 is what these 21 states hold.
        other_states: { names: 31, cash_total: '26400' },
        unknown: { names: 9, cash_total: '4100' },
      },
    };
    const place = locations(
      render({ committee: committee({ donorStates }), payments: [individualCash] }),
    )!;
    const rows = cells(place.querySelector('table')!);
    expect(rows).toHaveLength(24);
    expect(many.reduce((sum, [, names]) => sum + names, 0)).toBe(35);
    expect(rows.map((row) => row[0]).slice(2, -1)).toEqual([
      'Arizona',
      'California',
      'Colorado',
      'Connecticut',
      'District of Columbia',
      'Florida',
      'Georgia',
      'Illinois',
      'Iowa',
      'Massachusetts',
      'Michigan',
      'New Hampshire',
      'New York',
      'North Carolina',
      'North Dakota',
      'Pennsylvania',
      'South Dakota',
      'Texas',
      'Virginia',
      'Washington',
      'Wisconsin',
    ]);
    expect(place.textContent).not.toContain('Show more');
    expect(place.textContent).not.toContain('All other states');
    expect(place.querySelector('button')).toBeNull();
    // The state counts add to 35 and the subtotal says 31. Neither figure is corrected
    // to match the other, and no total row is printed over them.
    expect(place.textContent).toContain('31');
    expect(rows.filter((row) => row[0] === 'Total')).toEqual([]);
  });

  it('announces each figure with its state and its column', () => {
    const place = locations(
      render({ committee: committee({ donorStates: several }), payments: [individualCash] }),
    )!;
    const table = place.querySelector('table')!;
    expect(
      [...table.querySelectorAll('thead th')].map((head) => head.getAttribute('scope')),
    ).toEqual(['col', 'col', 'col', 'col']);
    for (const row of table.querySelectorAll<HTMLTableRowElement>('tbody tr')) {
      expect(row.querySelector('th')?.getAttribute('scope')).toBe('row');
      expect(row.cells).toHaveLength(4);
    }
    // The caption is visible rather than hidden: it is the only place the subtotal
    // relationship is stated in words.
    expect(table.querySelector('caption')?.getAttribute('style')).not.toContain('clip:');
    // Swatches carry nothing a reader needs; the row header already names the category.
    for (const swatch of place.querySelectorAll('span[aria-hidden="true"]')) {
      expect(swatch.textContent).toBe('');
    }
    expect(place.getAttribute('aria-labelledby')).toBe(place.querySelector('h2')!.id);
  });

  it('draws one segment per positive category, seamed only between them', () => {
    const place = locations(
      render({ committee: committee({ donorStates: several }), payments: [individualCash] }),
    )!;
    const bar = place.querySelector<HTMLElement>('[role="img"]')!;
    const segments = [...bar.children] as HTMLElement[];
    expect(segments).toHaveLength(3);
    expect(segments.map((segment) => segment.style.boxShadow)).toEqual([
      'inset -2px 0 0 #ffffff',
      'inset -2px 0 0 #ffffff',
      '',
    ]);
    // Proportions, so the last segment lands exactly on the edge rather than a rounded
    // width leaving or overrunning a sliver.
    expect(segments.map((segment) => segment.style.flexGrow)).toEqual([
      '387000000',
      '15200000',
      '12500000',
    ]);
    expect(segments.every((segment) => segment.style.flexBasis === '0px')).toBe(true);
    expect(LOCATION_COLORS).toEqual(['#2f3a31', '#6b736c', '#9aa39c']);
  });

  it('shares divide by every itemized individual dollar, Unknown included', () => {
    const place = locations(
      render({ committee: committee({ donorStates: several }), payments: [individualCash] }),
    )!;
    // California's $200 is 0.5% of the whole $41,470, never 13.2% of the $1,520 subtotal.
    expect(place.textContent).toContain('0.5%');
    expect(place.textContent).not.toContain('13.2%');
    // Massachusetts gave $20, which is 0.048%. It prints as a positive share too small to
    // show rather than as nothing.
    expect(place.textContent).toContain('<0.1%');
    // Every share is rounded on its own and no row is adjusted to make them total 100%,
    // so the share column carries no total row at all.
    expect(place.querySelector('tfoot')).toBeNull();
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
  const connections = cards(render({ committee: committee({ nameConnections }) }))[1];
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

describe('shared contribution panel disclosures', () => {
  it('uses explicit address rows and keeps other open rows when toggled', () => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    const mount = document.createElement('div');
    const root = createRoot(mount);
    const onExpandedRowsChange = vi.fn();
    try {
      act(() =>
        root.render(
          <CommitteeDonationCardsView
            committee={committee()}
            year={2025}
            registerKind="candidate_committee"
            payments={singleClosingPayment}
            expandedRows={[2]}
            onExpandedRowsChange={onExpandedRowsChange}
          />,
        ),
      );
      // Two rows, addressed 0 and 2. The location row left the panel and its index left
      // with it, so a link somebody saved to row 2 still opens the name matches rather
      // than the report comparison.
      const buttons = [...mount.querySelectorAll('button')];
      expect(buttons).toHaveLength(2);
      expect(buttons.map((button) => button.getAttribute('aria-expanded'))).toEqual([
        'false',
        'true',
      ]);
      expect(
        [...mount.querySelectorAll('[data-testid]')].map((row) => row.getAttribute('data-testid')),
      ).toEqual([
        `committee-${realCommittee.registrationNumber}-donation-card-0`,
        `committee-${realCommittee.registrationNumber}-donation-card-2`,
      ]);
      act(() => buttons[0].click());
      expect(onExpandedRowsChange).toHaveBeenLastCalledWith([2, 0]);
      act(() => buttons[1].click());
      expect(onExpandedRowsChange).toHaveBeenLastCalledWith([]);
    } finally {
      act(() => root.unmount());
    }
  });

  it('starts closed, opens several rows independently, and resets on another committee or year', () => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    const mount = document.createElement('div');
    document.body.append(mount);
    const root = createRoot(mount);
    const draw = (year: number, registrationNumber = realCommittee.registrationNumber) =>
      act(() =>
        root.render(
          <CommitteeDonationCardsView
            committee={committee({ registrationNumber })}
            year={year}
            registerKind="candidate_committee"
            payments={singleClosingPayment}
          />,
        ),
      );
    try {
      draw(2025);
      const buttons = [...mount.querySelectorAll('button')];
      expect(buttons).toHaveLength(2);
      expect(buttons.map((button) => button.getAttribute('aria-expanded'))).toEqual([
        'false',
        'false',
      ]);
      for (const button of buttons) {
        const content = document.getElementById(button.getAttribute('aria-controls')!)!;
        expect(content.hidden).toBe(true);
        expect(content.getAttribute('aria-labelledby')).toBe(button.id);
      }
      act(() => buttons[0].click());
      act(() => buttons[1].click());
      expect(buttons.map((button) => button.getAttribute('aria-expanded'))).toEqual([
        'true',
        'true',
      ]);
      expect(document.getElementById(buttons[0].getAttribute('aria-controls')!)!.hidden).toBe(
        false,
      );
      act(() => buttons[0].click());
      expect(buttons[1].getAttribute('aria-expanded')).toBe('true');
      draw(2026);
      expect(
        [...mount.querySelectorAll('button')].every(
          (button) => button.getAttribute('aria-expanded') === 'false',
        ),
      ).toBe(true);
      act(() => mount.querySelector('button')!.click());
      draw(2026, '99999');
      expect(
        [...mount.querySelectorAll('button')].every(
          (button) => button.getAttribute('aria-expanded') === 'false',
        ),
      ).toBe(true);
    } finally {
      act(() => root.unmount());
      mount.remove();
    }
  });
});

it('keeps the full disclosure keyboard-focusable while focusing only the arrow', () => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  const mount = document.createElement('div');
  document.body.append(mount);
  const root = createRoot(mount);
  try {
    act(() =>
      root.render(
        <CommitteeDonationCardsView
          committee={committee()}
          year={2025}
          registerKind="candidate_committee"
          payments={singleClosingPayment}
        />,
      ),
    );
    const button = mount.querySelector<HTMLButtonElement>('h3 > button')!;
    const arrow = button.querySelector<HTMLElement>('span[aria-hidden="true"]')!;
    const content = document.getElementById(button.getAttribute('aria-controls')!)!;
    expect(button.type).toBe('button');
    expect(button.tabIndex).toBe(0);
    act(() => button.focus());
    expect(document.activeElement).toBe(button);
    expect(button.style.outline).toBe('none');
    expect(arrow.style.width).toBe('44px');
    expect(arrow.style.height).toBe('44px');
    expect(arrow.style.borderRadius).toBe('12px');
    expect(arrow.style.boxShadow).toBe(`0 0 0 3px ${c.fieldFocusRing}`);
    const expectedBorder = document.createElement('span');
    expectedBorder.style.borderColor = c.fieldFocusBorder;
    expect(arrow.style.borderColor).toBe(expectedBorder.style.borderColor);
    expect(content.hidden).toBe(true);
    // Native buttons receive a click with detail 0 from keyboard activation.
    act(() => button.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 })));
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(content.hidden).toBe(false);
    act(() => button.querySelector('span')!.click());
    expect(button.getAttribute('aria-expanded')).toBe('false');
    act(() => button.blur());
    expect(arrow.style.boxShadow).toBe('');
    expect(arrow.style.borderColor).toBe('transparent');
  } finally {
    act(() => root.unmount());
    mount.remove();
  }
});
