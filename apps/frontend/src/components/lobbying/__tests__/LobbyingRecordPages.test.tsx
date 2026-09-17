// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import live from '../../../data/__tests__/fixtures/lobbying-live.json';
import type {
  LobbyingAssociation,
  LobbyingContributions,
  LobbyingSpendingRow,
} from '../../../lib/lobbyingTypes';
import {
  lobbyingRecordNumberFromSlug,
  principalSpellingLines,
  spendingRowHasFullKinds,
  visibleLobbyingDonationYears,
} from '../../../lib/lobbyingRecordCopy';
import { LobbyistDonationsCard, LobbyistPrincipalsCard } from '../LobbyingRecordCards';
import { LobbyingSpendingTable } from '../LobbyingSpendingTable';

const responsive = vi.hoisted(() => ({ isMobile: false, isTablet: false, isDesktop: true }));
vi.mock('../../../hooks/useResponsive', () => ({ useResponsive: () => responsive }));
vi.mock('../LobbyingPageFrame', () => ({
  LobbyingCard: ({ label, title, children }: any) => (
    <article aria-label={label}>
      <h2>{title}</h2>
      {children}
    </article>
  ),
}));
vi.mock('react-native-svg', () => ({
  default: ({
    children,
    testID,
    ...props
  }: React.SVGProps<SVGSVGElement> & { testID?: string }) => (
    <svg data-testid={testID} {...props}>
      {children}
    </svg>
  ),
  Path: (props: React.SVGProps<SVGPathElement>) => <path {...props} />,
}));

let root: Root | null = null;
let mount: HTMLDivElement | null = null;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  mount?.remove();
  mount = null;
  responsive.isMobile = false;
  responsive.isTablet = false;
  responsive.isDesktop = true;
});

function row(
  year: number,
  recordNumber: number,
  values: Partial<LobbyingSpendingRow> = {},
): LobbyingSpendingRow {
  return {
    year,
    record_number: recordNumber,
    total_spent: null,
    puc_lobbying_amount: null,
    general_lobbying_amount: null,
    legislative_lobbying_amount: null,
    administrative_lobbying_amount: null,
    mgu_lobbying_amount: null,
    ...values,
  };
}

function staticPage(content: React.ReactNode): HTMLDivElement {
  const page = document.createElement('div');
  page.innerHTML = renderToStaticMarkup(content);
  return page;
}

function mountPage(content: React.ReactNode): HTMLDivElement {
  mount = document.createElement('div');
  document.body.appendChild(mount);
  root = createRoot(mount);
  act(() => root!.render(content));
  return mount;
}

function clickButton(container: HTMLElement, label: string) {
  const button = [...container.querySelectorAll<HTMLElement>('[role="button"]')].find(
    (candidate) => candidate.textContent === label,
  );
  expect(button).toBeDefined();
  act(() => button!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
}

describe('lobbying spending table', () => {
  const rows = [
    row(2024, 1, {
      total_spent: '100.0000',
      puc_lobbying_amount: '0.0000',
      general_lobbying_amount: '100.0000',
    }),
    row(2023, 2, {
      total_spent: '75.0000',
      puc_lobbying_amount: '25.0000',
      general_lobbying_amount: '50.0000',
      legislative_lobbying_amount: '0.0000',
    }),
    row(2022, 3, {
      total_spent: '40.0000',
      puc_lobbying_amount: '10.0000',
      general_lobbying_amount: '30.0000',
    }),
    row(2021, 4),
  ];

  it('keeps missing amounts distinct from filed zero and labels the old three-kind gap', () => {
    const page = staticPage(<LobbyingSpendingTable rows={rows} />);
    const table = page.querySelector('table')!;
    expect(table.querySelector('caption')?.textContent).toBe('Reported lobbying spending by year');
    expect([...table.querySelectorAll('thead th')].map((cell) => cell.textContent)).toEqual([
      'Year',
      'Total spent',
      'PUC',
      'General',
      'Legislative',
      'Administrative',
      'Metropolitan',
    ]);
    const bodyRows = [...table.querySelectorAll('tbody tr')];
    expect(bodyRows[0].textContent).toContain('2024$100$0$100Not reportedNot reportedNot reported');
    expect(bodyRows[1].textContent).toContain('2023$75$25$50$0Not reportedNot reported');
    expect(bodyRows[2].textContent).toContain(
      '2022$40$10$30Not broken out by these kinds before 2024',
    );
    expect(bodyRows[3].textContent).toBe('2021Not reported');
    expect(spendingRowHasFullKinds(rows[0])).toBe(true);
    expect(spendingRowHasFullKinds(rows[1])).toBe(true);
    expect(spendingRowHasFullKinds(rows[2])).toBe(false);
  });

  it('uses the phone table and keeps both explanatory notes at 15 pixels', () => {
    responsive.isMobile = true;
    responsive.isDesktop = false;
    const page = staticPage(<LobbyingSpendingTable rows={rows} />);
    expect([...page.querySelectorAll('thead th')].map((cell) => cell.textContent)).toEqual([
      'Year',
      'Reported spending',
    ]);
    const oldKinds = [...page.querySelectorAll('p')].find((node) =>
      node.textContent?.startsWith('Not broken out by legislative'),
    );
    const puc = [...page.querySelectorAll('p')].find((node) =>
      node.textContent?.startsWith('PUC is the Public Utilities Commission'),
    );
    expect(oldKinds?.getAttribute('style')).toContain('font-size:15px');
    expect(puc?.getAttribute('style')).toContain('font-size:15px');
  });
});

describe('lobbying record lists', () => {
  it('starts with 5 clients and reveals every remaining client in groups of 5', () => {
    const rows = live.long_list.principals.rows as LobbyingAssociation[];
    const total = live.long_list.principals.total;
    const linkCount = (limit: number) => rows.slice(0, limit).filter((row) => row.linkable).length;
    const page = mountPage(
      <LobbyistPrincipalsCard
        state="reported"
        registrationNumber={live.long_list.registration_number}
        total={total}
        rows={rows}
        latestYear={2025}
        onOpenPrincipal={() => undefined}
      />,
    );
    expect(page.textContent).toContain('86 clients · showing 5');
    const explanation = [...page.querySelectorAll<HTMLElement>('*')].find(
      (node) =>
        node.textContent ===
        'The lobbyist list shows which organisations this lobbyist represented on the copy date. It does not show past clients.',
    )!;
    expect(getComputedStyle(explanation).maxWidth).not.toBe('820px');
    expect(
      page.querySelector(
        'a[href="https://cfb.mn.gov/reports-and-data/viewers/lobbying/lobbyists/"]',
      ),
    ).not.toBeNull();
    expect(page.querySelectorAll('[role="listitem"]')).toHaveLength(5);
    expect(page.querySelectorAll('[role="listitem"] > a[href]')).toHaveLength(linkCount(5));
    expect(page.querySelector('[role="listitem"] > a')?.getAttribute('role')).toBe('link');
    const reveal = [...page.querySelectorAll('[role="button"]')].find(
      (button) => button.textContent === 'Show 5 more clients',
    )!;
    expect(reveal.querySelector('[data-testid="link-arrow"]')).toBeNull();
    expect(reveal.querySelector('svg')?.getAttribute('width')).toBe('14');
    expect(reveal.querySelector('path')?.getAttribute('d')).toBe('M5 12 H19 M14 7 L19 12 L14 17');
    expect(reveal.querySelector('path')?.getAttribute('stroke')).toBe('#0f7a45');
    clickButton(page, 'Show 5 more clients');
    expect(page.textContent).toContain('86 clients · showing 10');
    expect(page.querySelectorAll('[role="listitem"]')).toHaveLength(10);
    expect(page.querySelectorAll('[role="listitem"] > a[href]')).toHaveLength(linkCount(10));
    for (let shown = 15; shown <= 85; shown += 5) clickButton(page, 'Show 5 more clients');
    clickButton(page, 'Show 1 more client');
    expect(page.textContent).toContain('86 clients');
    expect(page.textContent).not.toContain('showing 86');
    expect(page.querySelectorAll('[role="listitem"]')).toHaveLength(86);
    expect(page.querySelectorAll('[role="listitem"] > a[href]')).toHaveLength(linkCount(86));
    expect(page.textContent).not.toContain('Show 1 more client');
  });

  it('keeps a list-only principal plain and states the source year', () => {
    const page = staticPage(
      <LobbyistPrincipalsCard
        state="reported"
        registrationNumber="141"
        total={1}
        rows={[
          {
            entity_id: 8887,
            name: 'AMP Robotics',
            spending_name: null,
            position: 1,
            linkable: false,
            state: 'no_spending_rows',
          },
        ]}
        latestYear={2025}
        onOpenPrincipal={() => undefined}
      />,
    );
    expect(page.querySelector('[role="listitem"]')?.querySelector('a')).toBeNull();
    expect(page.textContent).toContain(
      "Some organisations have no spending page because the Board's spending file has no rows for them through 2025.",
    );
    expect(page.textContent).toContain('No spending page available');
  });
});

describe('lobbyist donations', () => {
  const contributions = live.kozak.contributions as LobbyingContributions;

  it('keeps all 3 payments, the different filed name and the campaign-file date', () => {
    const year = contributions.years.find((candidate) => candidate.year === 2025)!;
    const abeler = year.committees.find((committee) => committee.registration_number === '17868')!;
    expect(abeler.payments.map((payment) => payment.amount)).toEqual([
      '200.0000',
      '100.0000',
      '100.0000',
    ]);
    const page = mountPage(
      <LobbyistDonationsCard
        contributions={contributions}
        registeredName={live.kozak.name}
        copiedDate="Campaign contribution file copied Sep 1, 2026"
        onOpenCommittee={() => undefined}
      />,
    );
    expect(page.textContent).toContain('240 donations · showing 5');
    expect(page.textContent).toContain('Show 5 more campaign donations');
    expect(page.textContent).toContain('Campaign contribution file copied Sep 1, 2026');
    expect(page.textContent).toContain("View the Board's campaign contribution file");
    expect(page.textContent).toContain('Filed as Kozak, Andrew V');
    for (let shown = 10; shown <= 30; shown += 5)
      clickButton(page, 'Show 5 more campaign donations');
    const abelerLink = page.querySelector(
      'a[href="/money/committees/abeler-jim-senate-committee-17868"]',
    );
    expect(abelerLink).not.toBeNull();
    const abelerBlock = abelerLink!.closest('[role="listitem"]')!;
    expect(abelerBlock.textContent?.match(/\$100/g)).toHaveLength(2);
    expect(abelerBlock.textContent?.match(/\$200/g)).toHaveLength(1);
    expect(abelerBlock.textContent).not.toContain('$400');
  });

  it('truncates payment rows without merging duplicates or breaking their groups', () => {
    const countPayments = (years: LobbyingContributions['years']) =>
      years.flatMap((year) => year.committees.flatMap((committee) => committee.payments)).length;
    const first = visibleLobbyingDonationYears(contributions.years, 30);
    const second = visibleLobbyingDonationYears(contributions.years, 60);
    expect(countPayments(first)).toBe(30);
    expect(countPayments(second)).toBe(60);
    expect(first[0].year).toBe(2026);
    const abeler = first
      .find((year) => year.year === 2025)!
      .committees.find((committee) => committee.registration_number === '17868')!;
    expect(abeler.payments.map((payment) => payment.record_number)).toEqual([
      367605, 454675, 353526,
    ]);
  });

  it('marks donated goods only when the filed value is Yes', () => {
    const payment = contributions.years[0].committees[0].payments[0];
    const edgeCases: LobbyingContributions = {
      ...contributions,
      payment_count: 4,
      committee_count: 1,
      years: [
        {
          year: 2025,
          payment_count: 4,
          committee_count: 1,
          committees: [
            {
              ...contributions.years[0].committees[0],
              payment_count: 4,
              payments: [
                { ...payment, record_number: 1, in_kind: 'Yes', in_kind_description: 'Goods' },
                { ...payment, record_number: 2, in_kind: 'No', in_kind_description: null },
                { ...payment, record_number: 3, in_kind: null, in_kind_description: null },
                {
                  ...payment,
                  record_number: 4,
                  in_kind: 'Unknown',
                  in_kind_description: 'Unknown value',
                },
              ],
            },
          ],
        },
      ],
    };
    const page = staticPage(
      <LobbyistDonationsCard
        contributions={edgeCases}
        registeredName={live.kozak.name}
        copiedDate={null}
        onOpenCommittee={() => undefined}
      />,
    );
    expect(page.textContent?.match(/DONATED GOODS OR SERVICES/g)).toHaveLength(1);
    expect(page.textContent).toContain('DONATED GOODS OR SERVICES · Goods');
    expect(page.textContent).not.toContain('Unknown value');
  });
});

describe('record identity and exact names', () => {
  it('uses only a positive trailing number and deduplicates only spelling notices', () => {
    expect(lobbyingRecordNumberFromSlug('old-or-wrong-name-141')).toBe('141');
    expect(lobbyingRecordNumberFromSlug('141-old-name')).toBeNull();
    expect(
      principalSpellingLines([
        {
          registration_number: '1',
          name: 'One Lobbyist',
          formatted_name: 'One Lobbyist',
          principal_name_as_listed: 'North Metro Builders Assn',
          principal_name_differs: true,
        },
        {
          registration_number: '2',
          name: 'Two Lobbyist',
          formatted_name: 'Two Lobbyist',
          principal_name_as_listed: 'North Metro Builders Assn',
          principal_name_differs: true,
        },
      ]),
    ).toEqual(['Registered as North Metro Builders Assn in the lobbyist list']);
  });
});
