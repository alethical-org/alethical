// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  useCampaignFinanceCommittees,
  useCampaignFinanceRaces,
  useOutsideSpendingRecord,
  useWarmMoneyDestinations,
} from '../useAppQueries';
import { createAppQueryClient } from '../../lib/appQueryClient';
import { COMMITTEE_PAGE_SIZE } from '../../lib/committeeList';
import { campaignMoneyYear } from '../../lib/legislatorCampaignMoney';

// The hooks module reaches the auth provider, which pulls in Expo's native
// module loader; nothing under test needs either.
vi.mock('../../providers/AuthProvider', () => ({
  useAuth: () => ({ user: null, session: null }),
}));

const screenFiles = vi.hoisted(() => ({ asked: [] as string[] }));

// The real loaders fetch a screen's own file; here we only care which addresses
// were asked for.
vi.mock('../../navigation/screenPreload', () => ({
  screenLoaderForPath: (path: string) => () => {
    screenFiles.asked.push(path);
    return Promise.resolve({ default: () => null });
  },
}));

vi.mock('../../data/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../data/api')>()),
  getCampaignFinanceCommitteesFromApi: vi.fn(async () => ({ register: 'committees' })),
  getCampaignFinanceRacesFromApi: vi.fn(async () => ({ state: 'reported' })),
  getOutsideSpendingRecordFromApi: vi.fn(async () => ({ rows: [] })),
}));

import {
  getCampaignFinanceCommitteesFromApi,
  getCampaignFinanceRacesFromApi,
  getOutsideSpendingRecordFromApi,
} from '../../data/api';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const committees = vi.mocked(getCampaignFinanceCommitteesFromApi);
const races = vi.mocked(getCampaignFinanceRacesFromApi);
const outsideSpending = vi.mocked(getOutsideSpendingRecordFromApi);

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let client: QueryClient;

function render(node: React.ReactNode) {
  act(() => {
    root.render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
  });
}

/** Let the chained warms settle. They run one after another, so each one's
 *  promise has to finish before the next is started. */
async function runWarming() {
  await act(async () => {
    for (let round = 0; round < 10; round += 1) await Promise.resolve();
  });
}

function Warmer({ ready }: { ready: boolean }) {
  useWarmMoneyDestinations(ready);
  return null;
}

beforeEach(() => {
  vi.clearAllMocks();
  screenFiles.asked = [];
  // jsdom has no idle callback, and the hook's fallback timer would make every
  // test wait on a real clock. Run the warming the moment it is asked for.
  vi.stubGlobal('requestIdleCallback', (task: () => void) => {
    task();
    return 1;
  });
  vi.stubGlobal('cancelIdleCallback', () => {});
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  // The app's own client, so the 5-minute freshness window under test is the real
  // one: it is what stops a warmed entry being read again the moment a screen opens.
  client = createAppQueryClient();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  client.clear();
  vi.unstubAllGlobals();
});

describe('useWarmMoneyDestinations', () => {
  it('reads nothing until the landing page itself is drawn', async () => {
    render(<Warmer ready={false} />);
    await runWarming();
    expect(committees).not.toHaveBeenCalled();
    expect(races).not.toHaveBeenCalled();
    expect(outsideSpending).not.toHaveBeenCalled();
  });

  it('reads nothing for a reader who is saving data', async () => {
    vi.stubGlobal('navigator', { ...globalThis.navigator, connection: { saveData: true } });
    render(<Warmer ready={true} />);
    await runWarming();
    expect(committees).not.toHaveBeenCalled();
  });

  it('fetches the 3 destination screens\u2019 own files as well as their records', async () => {
    render(<Warmer ready={true} />);
    await runWarming();
    expect(screenFiles.asked).toEqual([
      '/money/committees',
      '/money/races',
      '/money/outside-spending',
    ]);
  });

  it('warms the 3 destinations with the settings their screens default to', async () => {
    render(<Warmer ready={true} />);
    await runWarming();
    expect(committees).toHaveBeenCalledWith({ limit: COMMITTEE_PAGE_SIZE, offset: 0 });
    expect(races).toHaveBeenCalledWith({ year: campaignMoneyYear(undefined) });
    expect(outsideSpending).toHaveBeenCalledWith({ year: null, sort: 'newest', page: 1 });
  });

  it('warms one at a time rather than 3 heavy reads at once', async () => {
    let releaseFirst: () => void = () => {};
    committees.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseFirst = () => resolve({ register: 'committees' } as never);
        }),
    );
    render(<Warmer ready={true} />);
    await runWarming();
    expect(committees).toHaveBeenCalledTimes(1);
    expect(races).not.toHaveBeenCalled();
    expect(outsideSpending).not.toHaveBeenCalled();
    await act(async () => {
      releaseFirst();
      for (let round = 0; round < 10; round += 1) await Promise.resolve();
    });
    expect(races).toHaveBeenCalledTimes(1);
    expect(outsideSpending).toHaveBeenCalledTimes(1);
  });

  it('leaves the entries the destination screens read, so they draw with no new request', async () => {
    function Destinations() {
      const list = useCampaignFinanceCommittees({ page: 1, pageSize: COMMITTEE_PAGE_SIZE });
      const byRace = useCampaignFinanceRaces({ year: campaignMoneyYear(undefined) });
      const spending = useOutsideSpendingRecord({ year: null, sort: 'newest', page: 1 });
      return (
        <div
          data-testid="destinations"
          data-committees={JSON.stringify(list.data ?? null)}
          data-races={JSON.stringify(byRace.data ?? null)}
          data-spending={JSON.stringify(spending.data ?? null)}
        />
      );
    }

    render(<Warmer ready={true} />);
    await runWarming();
    render(<Destinations />);
    // No timer advance here: the point is what the screen has the instant it
    // opens, and running React Query's own timers would age the warmed entry
    // past its 5-minute freshness window.
    await act(async () => {});

    const drawn = container.querySelector('[data-testid="destinations"]')!;
    expect(drawn.getAttribute('data-committees')).toBe(JSON.stringify({ register: 'committees' }));
    expect(drawn.getAttribute('data-races')).toBe(JSON.stringify({ state: 'reported' }));
    expect(drawn.getAttribute('data-spending')).toBe(JSON.stringify({ rows: [] }));
    // One read each: the warmed entry is the one the screen reads, so opening the
    // page does not start the read again.
    expect(committees).toHaveBeenCalledTimes(1);
    expect(races).toHaveBeenCalledTimes(1);
    expect(outsideSpending).toHaveBeenCalledTimes(1);
  });
});
