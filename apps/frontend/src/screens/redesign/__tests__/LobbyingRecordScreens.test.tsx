// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { LobbyingLobbyist, LobbyingPrincipal } from '../../../lib/lobbyingTypes';

const reads = vi.hoisted(() => ({ principal: vi.fn(), lobbyist: vi.fn() }));
const replaceHistory = vi.hoisted(() => vi.fn());
vi.mock('../../../hooks/useLobbying', () => ({
  useLobbyingPrincipal: reads.principal,
  useLobbyingLobbyist: reads.lobbyist,
}));
vi.mock('../../../hooks/useResponsive', () => ({
  useResponsive: () => ({ isMobile: false, isTablet: false, isDesktop: true }),
}));
vi.mock('../../../hooks/useHistoryScrollRestoration', () => ({
  useHistoryScrollRestoration: () => ({}),
}));
vi.mock('../../../navigation/documentTitle', () => ({ useDocumentTitle: vi.fn() }));
vi.mock('../../../navigation/webHistory', () => ({
  hasInAppBackEntry: () => false,
  markNextWebHistoryChangeAsReplace: replaceHistory,
}));
vi.mock('../../../components/lobbying/LobbyingPageFrame', () => ({
  LobbyingPageFrame: ({ eyebrow, title, details, source, children }: any) => (
    <main>
      {eyebrow ? <div data-testid="eyebrow">{eyebrow}</div> : null}
      {title ? <h1>{title}</h1> : null}
      {details}
      {children}
      {source ? <a href={source.url}>{source.label}</a> : null}
    </main>
  ),
  LobbyingCard: ({ title, children }: any) => (
    <section>
      <h2>{title}</h2>
      {children}
    </section>
  ),
  LobbyingRecordState: ({ state, identifier, onRetry }: any) => (
    <div data-testid="record-state" data-state={state} data-identifier={identifier ?? ''}>
      {onRetry ? <button onClick={onRetry}>Try again</button> : null}
    </div>
  ),
}));
vi.mock('../../../components/lobbying/LobbyingSpendingTable', () => ({
  LobbyingSpendingTable: ({ rows }: any) => (
    <div data-testid="spending-table">{rows.length} spending rows</div>
  ),
}));
vi.mock('../../../components/lobbying/LobbyingRecordCards', () => ({
  LobbyingSourceLink: ({ url, label }: any) => <a href={url}>{label}</a>,
  PrincipalLobbyistsCard: ({ state, total, rows }: any) => (
    <div data-testid="principal-lobbyists" data-state={state} data-total={total ?? ''}>
      {rows.length} lobbyists
    </div>
  ),
  LobbyistPrincipalsCard: ({ state, registrationNumber, total, rows }: any) => (
    <div
      data-testid="lobbyist-principals"
      data-state={state}
      data-registration={registrationNumber}
      data-total={total ?? ''}
    >
      {rows.length} principals
    </div>
  ),
  LobbyistDonationsCard: ({ contributions, registeredName, copiedDate }: any) => (
    <div
      data-testid="lobbyist-donations"
      data-state={contributions.state}
      data-name={registeredName}
      data-copied={copiedDate ?? ''}
    >
      {contributions.payment_count ?? 0} donations
    </div>
  ),
}));

import { LobbyingLobbyistScreen } from '../LobbyingLobbyistScreen';
import { LobbyingPrincipalScreen } from '../LobbyingPrincipalScreen';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
let mount: HTMLDivElement | null = null;

function navigation() {
  return { navigate: vi.fn(), push: vi.fn(), setParams: vi.fn() };
}

function render(content: React.ReactNode) {
  mount = document.createElement('div');
  document.body.appendChild(mount);
  root = createRoot(mount);
  act(() => root!.render(content));
  return mount;
}

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  mount?.remove();
  mount = null;
  reads.principal.mockReset();
  reads.lobbyist.mockReset();
  replaceHistory.mockReset();
});

const principal: LobbyingPrincipal = {
  entity_id: 2263,
  state: 'reported',
  name: 'American Express Company',
  latest_reported_year: 2025,
  source_latest_year: 2025,
  release_id: 'lobbying-release',
  copied_at: '2026-09-13T03:00:00Z',
  sources: { expenditures: 'https://cfb.mn.gov/spending', lobbyists: 'https://cfb.mn.gov/list' },
  spending: {
    state: 'reported',
    rows: [
      {
        year: 2025,
        record_number: 1,
        total_spent: '100.0000',
        puc_lobbying_amount: '0.0000',
        general_lobbying_amount: '100.0000',
        legislative_lobbying_amount: null,
        administrative_lobbying_amount: null,
        mgu_lobbying_amount: null,
      },
    ],
  },
  lobbyists: {
    state: 'reported',
    total: 1,
    rows: [
      {
        registration_number: '141',
        name: 'Kozak, Andrew',
        formatted_name: 'Andrew Kozak',
        principal_name_as_listed: 'American Express Co',
        principal_name_differs: true,
      },
    ],
  },
};

describe('LobbyingPrincipalScreen', () => {
  it('resolves by trailing number, prints the record, and replaces an old name in the address', () => {
    reads.principal.mockReturnValue({
      data: principal,
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    });
    const nav = navigation();
    const page = render(
      <LobbyingPrincipalScreen
        route={{ params: { slug: 'old-name-2263' } } as any}
        navigation={nav as any}
      />,
    );
    expect(reads.principal).toHaveBeenCalledWith('2263');
    expect(page.querySelector('h1')?.textContent).toBe('American Express Company');
    expect(page.querySelector('[data-testid="eyebrow"]')?.textContent).toBe(
      'PRINCIPAL · ENTITY ID 2263',
    );
    expect(page.textContent).toContain(
      'Each row shows this principal’s reported lobbying spending for one calendar year.',
    );
    expect(page.textContent).toContain(
      'A shown $0 is a filed value. “Not reported” means the Board’s file leaves the value blank.',
    );
    expect(page.textContent).toContain("View the Board's Lobbying Organizations Search Tool");
    expect(page.textContent).toContain('Registered as American Express Co in the lobbyist list');
    expect(page.querySelector('[data-testid="spending-table"]')?.textContent).toBe(
      '1 spending rows',
    );
    expect(
      page.querySelector('[data-testid="principal-lobbyists"]')?.getAttribute('data-total'),
    ).toBe('1');
    expect(replaceHistory).toHaveBeenCalledOnce();
    expect(nav.setParams).toHaveBeenCalledWith({ slug: 'american-express-company-2263' });
  });

  it('shows the existing missing-record state when the principal has no spending rows', () => {
    reads.principal.mockReturnValue({
      data: {
        ...principal,
        state: 'no_spending_rows',
        name: null,
        spending: { state: 'no_spending_rows', rows: [] },
      },
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    });
    const page = render(
      <LobbyingPrincipalScreen
        route={{ params: { slug: 'list-only-principal-8887' } } as any}
        navigation={navigation() as any}
      />,
    );
    expect(page.querySelector('[data-testid="record-state"]')?.getAttribute('data-state')).toBe(
      'not-found',
    );
    expect(page.querySelector('[data-testid="spending-table"]')).toBeNull();
  });
});

describe('LobbyingLobbyistScreen', () => {
  it('keeps historical donations visible when the registration is absent from the copied list', () => {
    const absent: LobbyingLobbyist = {
      registration_number: '999999999',
      state: 'not_registered_today',
      name: null,
      formatted_name: null,
      latest_reported_year: 2025,
      release_id: 'lobbying-release',
      copied_at: '2026-09-13T03:00:00Z',
      sources: {
        expenditures: 'https://cfb.mn.gov/spending',
        lobbyists: 'https://cfb.mn.gov/list',
      },
      principals: { state: 'not_registered_today', total: 0, rows: [] },
      contributions: {
        state: 'reported',
        payment_count: 1,
        committee_count: 1,
        release_id: 'campaign-release',
        copied_at: '2026-09-01T18:33:35Z',
        source_url: 'https://cfb.mn.gov/campaign',
        years: [],
      },
    };
    reads.lobbyist.mockReturnValue({
      data: absent,
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    });
    const page = render(
      <LobbyingLobbyistScreen
        route={{ params: { slug: 'unknown-999999999' } } as any}
        navigation={navigation() as any}
      />,
    );
    expect(page.querySelector('h1')?.textContent).toBe('Registration 999999999');
    expect(
      page.querySelector('[data-testid="lobbyist-principals"]')?.getAttribute('data-state'),
    ).toBe('not_registered_today');
    expect(page.querySelector('[data-testid="lobbyist-donations"]')?.textContent).toBe(
      '1 donations',
    );
    expect(
      page.querySelector('[data-testid="lobbyist-donations"]')?.getAttribute('data-copied'),
    ).toBe('Campaign contribution file copied Sep 1, 2026');
    expect(page.textContent).toContain('Lobbying records copied Sep 12, 2026');
  });

  it('keeps an invalid address out of the data hook and shows a missing-record state', () => {
    reads.lobbyist.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    });
    const page = render(
      <LobbyingLobbyistScreen
        route={{ params: { slug: 'missing-number' } } as any}
        navigation={navigation() as any}
      />,
    );
    expect(reads.lobbyist).toHaveBeenCalledWith(null);
    expect(page.querySelector('[data-testid="record-state"]')?.getAttribute('data-state')).toBe(
      'not-found',
    );
  });
});
