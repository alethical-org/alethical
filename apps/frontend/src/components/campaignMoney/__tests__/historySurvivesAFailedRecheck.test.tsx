// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
vi.mock('../../../data/api', async (original) => ({
  ...(await original<typeof import('../../../data/api')>()),
  publicApiRequest: vi.fn(),
}));
vi.mock('../../../hooks/useResponsive', () => ({
  useResponsive: () => ({ isMobile: false, isTablet: false }),
}));
import { publicApiRequest } from '../../../data/api';
import { CommitteeMixHistory } from '../CommitteeMixHistory';
import { CAMPAIGN_MONEY_HISTORY_YEARS } from '../../../hooks/useCampaignMoneyDetails';

const request = vi.mocked(publicApiRequest);
const onRefresh = vi.fn();
const heading = 'How the mix of itemized contributions changed by year';
const notice =
  'We could not refresh this history. This is a problem on our side. The last complete history is still shown.';
type FailedRead = 'history' | 'received' | 'made';
let failed: FailedRead | null;
let failedHistoryYear: number;
let earlierReplacement: boolean;
let unavailable: FailedRead | null;
let responseRelease: string;
let empty: boolean;
let hold: Promise<void> | null;
let client: QueryClient;
let host: HTMLDivElement;
let root: Root;
let props: React.ComponentProps<typeof CommitteeMixHistory>;

function matches(kind: FailedRead | null, year: number, direction: string | null) {
  return kind === 'history'
    ? year === failedHistoryYear
    : kind === direction && year === props.year;
}
function payload(path: string) {
  const url = new URL(path, 'https://fixture.test');
  const year = Number(url.searchParams.get('year'));
  const direction = url.searchParams.get('direction');
  if (matches(failed, year, direction)) throw new Error('Controlled history recheck failure');
  const payments =
    direction === 'received' && (year === 2025 || (year === 2015 && earlierReplacement)) && !empty
      ? [
          {
            contributor: 'Accepted person',
            contributor_type: year === 2015 ? 'Lobbyist' : 'Individual',
            amount: '100',
            received_on: '2025-01-10',
            receipt_type: 'Contribution',
            in_kind: 'No',
            record_number: 1,
          },
        ]
      : [];
  const missing = matches(unavailable, year, direction);
  return {
    data: {
      registration_number: url.pathname.split('/')[2],
      year,
      direction,
      state: missing ? 'unavailable' : 'reported',
      payments: missing ? [] : payments,
      release_id: responseRelease,
      linkable_registration_numbers: [],
      fetched_at: '2026-10-01',
      source_url: 'https://cfb.mn.gov/fixture',
      page: {
        limit: 250,
        offset: 0,
        total_payments: missing ? 0 : payments.length,
        has_more: false,
      },
    },
  };
}
function draw() {
  act(() =>
    root.render(
      <QueryClientProvider client={client}>
        <CommitteeMixHistory {...props} />
      </QueryClientProvider>,
    ),
  );
}
async function settled() {
  await vi.waitFor(async () => {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(request).toHaveBeenCalled();
    expect(client.isFetching()).toBe(0);
  });
}
async function accepted() {
  draw();
  await vi.waitFor(async () => {
    await settled();
    expect(host.textContent).toContain(heading);
    expect(host.querySelector('[aria-label="2025, Individuals 100%"]')).not.toBeNull();
  });
}
async function recheck(kind: FailedRead) {
  await act(async () => {
    await client.refetchQueries({
      queryKey:
        kind === 'history'
          ? ['campaign-money-history']
          : ['campaign-money-details', props.registrationNumber, props.year, kind],
    });
  });
  await settled();
}
const retryButton = () =>
  [...host.querySelectorAll<HTMLButtonElement>('button')].find(
    (button) => button.textContent === 'Try again',
  )!;
const historyState = () =>
  client.getQueryState(['campaign-money-history', props.registrationNumber, responseRelease]);
const openPercentages = () => {
  act(() =>
    host.querySelector<HTMLButtonElement>('[aria-label="View percentages for 2025"]')!.click(),
  );
  expect(
    host.querySelector('[aria-label="Itemized contribution percentages for 2025"]'),
  ).not.toBeNull();
};

beforeEach(() => {
  failed = null;
  failedHistoryYear = 2016;
  earlierReplacement = false;
  unavailable = null;
  responseRelease = 'release-A';
  empty = false;
  hold = null;
  request.mockReset();
  onRefresh.mockReset();
  request.mockImplementation(async (path) => {
    if (hold) await hold;
    return payload(String(path)) as never;
  });
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: 0 } },
  });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  props = {
    registrationNumber: '17868',
    committeeName: 'Fixture committee',
    year: 2025,
    releaseId: 'release-A',
    onSelectYear: vi.fn(),
    onRefresh,
  };
});
afterEach(() => {
  act(() => root.unmount());
  client.clear();
  host.remove();
});

it.each(['history', 'received', 'made'] as const)(
  'keeps complete history and opened percentages when %s recheck fails, then retries',
  async (kind) => {
    await accepted();
    openPercentages();
    const saved = historyState()!.data;
    failed = kind;
    await recheck(kind);
    expect(historyState()!.data).toBe(saved);
    expect(host.textContent).toContain(heading);
    expect(host.textContent).toContain(notice);
    expect(
      host.querySelector('[aria-label="Itemized contribution percentages for 2025"]'),
    ).not.toBeNull();
    expect(retryButton().disabled).toBe(false);
    failed = null;
    act(() => retryButton().click());
    await settled();
    expect(onRefresh).toHaveBeenCalledOnce();
    expect(host.textContent).toContain(heading);
    expect(host.textContent).not.toContain(notice);
    expect(
      host.querySelector('[aria-label="Itemized contribution percentages for 2025"]'),
    ).not.toBeNull();
  },
);

it.each(['history', 'received', 'made'] as const)(
  'keeps accepted history through a delayed %s retry and prevents duplicate retries',
  async (kind) => {
    await accepted();
    failed = kind;
    await recheck(kind);
    failed = null;
    let release!: () => void;
    hold = new Promise((resolve) => {
      release = resolve;
    });
    act(() => retryButton().click());
    await vi.waitFor(() => expect(retryButton().disabled).toBe(true));
    expect(host.textContent).toContain(heading);
    expect(host.textContent).toContain(notice);
    act(() => retryButton().click());
    expect(onRefresh).toHaveBeenCalledOnce();
    hold = null;
    await act(async () => {
      release();
    });
    await settled();
    expect(host.textContent).toContain(heading);
    expect(host.textContent).not.toContain(notice);
  },
);

it.each(['history', 'received', 'made'] as const)(
  'does not borrow history after a first %s failure',
  async (kind) => {
    failed = kind;
    draw();
    await settled();
    expect(host.textContent).not.toContain(heading);
    expect(host.textContent).not.toContain(notice);
  },
);

it.each(['history', 'received', 'made'] as const)(
  'clears accepted history after an explicit %s unavailable answer',
  async (kind) => {
    await accepted();
    unavailable = kind;
    await recheck(kind);
    expect(host.textContent).not.toContain(heading);
    unavailable = null;
    failed = kind;
    await recheck(kind);
    expect(host.textContent).not.toContain(heading);
    expect(host.textContent).not.toContain(notice);
  },
);

it('does not retain history without a pinned summary release', async () => {
  props.releaseId = undefined;
  await accepted();
  failed = 'history';
  await recheck('history');
  expect(host.textContent).not.toContain(heading);
  expect(host.textContent).not.toContain(notice);
});

it('does not borrow accepted history for a changed committee or revive it after returning on error', async () => {
  await accepted();
  failed = 'history';
  await recheck('history');
  props.registrationNumber = '99999';
  draw();
  await settled();
  expect(host.textContent).not.toContain(heading);
  props.registrationNumber = '17868';
  draw();
  await settled();
  expect(host.textContent).not.toContain(heading);
});

it('does not borrow accepted history for a changed summary release', async () => {
  await accepted();
  failed = 'history';
  await recheck('history');
  props.releaseId = 'release-B';
  draw();
  expect(host.textContent).not.toContain(heading);
  props.releaseId = 'release-A';
  draw();
  expect(host.textContent).not.toContain(heading);
});

it.each(['received', 'made'] as const)(
  'withholds accepted history when %s changes source copy',
  async (kind) => {
    await accepted();
    responseRelease = 'release-B';
    await recheck(kind);
    expect(host.textContent).not.toContain(heading);
  },
);

it('replaces accepted history with a successful complete empty history', async () => {
  await accepted();
  empty = true;
  await act(async () => {
    await client.refetchQueries({ queryKey: ['campaign-money-details'] });
  });
  await settled();
  await recheck('history');
  expect(host.textContent).toContain(heading);
  expect(host.querySelector('[aria-label="2025, Individuals 100%"]')).toBeNull();
  expect(host.textContent?.match(/No itemized contributions listed/g)).toHaveLength(
    CAMPAIGN_MONEY_HISTORY_YEARS.length,
  );
});

it('keeps the complete accepted history when a later year of a replacement fails without exposing earlier replacement rows', async () => {
  await accepted();
  openPercentages();
  earlierReplacement = true;
  failedHistoryYear = 2024;
  failed = 'history';
  await recheck('history');
  expect(host.textContent).toContain(heading);
  expect(host.textContent).toContain(notice);
  expect(host.querySelector('[aria-label="2015, Lobbyists 100%"]')).toBeNull();
  expect(
    host.querySelector('[aria-label="Itemized contribution percentages for 2025"]'),
  ).not.toBeNull();
  failed = null;
  act(() => retryButton().click());
  await settled();
  expect(host.querySelector('[aria-label="2015, Lobbyists 100%"]')).not.toBeNull();
  expect(host.textContent).not.toContain(notice);
});

it('does not restore the old committee history when an earlier request finishes after switching committees', async () => {
  await accepted();
  let release!: () => void;
  let oldReadStarted = false;
  const oldRead = new Promise<void>((resolve) => {
    release = resolve;
  });
  request.mockImplementation(async (path) => {
    const url = new URL(String(path), 'https://fixture.test');
    if (url.pathname.includes('/17868/') && url.searchParams.get('year') === '2016') {
      oldReadStarted = true;
      await oldRead;
    }
    return payload(String(path)) as never;
  });
  const replacement = client.refetchQueries({ queryKey: ['campaign-money-history'] });
  await vi.waitFor(() => expect(oldReadStarted).toBe(true));
  props.registrationNumber = '99999';
  empty = true;
  draw();
  await settled();
  expect(host.textContent).toContain(heading);
  expect(host.querySelector('[aria-label="2025, Individuals 100%"]')).toBeNull();
  await act(async () => {
    release();
    await replacement;
  });
  await settled();
  expect(host.textContent).toContain(heading);
  expect(host.querySelector('[aria-label="2025, Individuals 100%"]')).toBeNull();
});
