// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { __DEV__?: boolean }).__DEV__ = false;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
vi.mock('../MoneyDetailsBundle', () => ({
  CommitteeDonations: ({ children }: { children?: React.ReactNode }) => (
    <div>
      <div>THE DONUT</div>
      {children}
    </div>
  ),
  GroupedOutsideSpending: () => <div>OUTSIDE GROUPS</div>,
  OutsideSpendingCard: () => <div>OUTSIDE CARD</div>,
  CommitteeMixHistory: () => <div>MIX HISTORY</div>,
}));
vi.mock('../../../lib/releaseReload', () => ({ requestReleaseReload: vi.fn(() => false) }));
import {
  CommitteeDonations,
  CommitteeMixHistory,
  GroupedOutsideSpending,
  OutsideSpendingCard,
  preloadMoneyDetails,
} from '../MoneyDetailsOnDemand';
import { moneyDetailsPageCopy as copy } from '../../../lib/campaignMoneyDetailsPageCopy';
import type { ComponentProps } from 'react';

const host = document.createElement('div');
const root = createRoot(host);
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

it('draws the chart in the first frame once its piece has already arrived', async () => {
  document.body.append(host);
  await preloadMoneyDetails();
  const donations = {
    committee: { registrationNumber: '18430', split: { state: 'no_reported_total' } },
  } as unknown as ComponentProps<typeof CommitteeDonations>;
  const seen: string[] = [];
  // Each commit's text, so a frame that showed the figures without the chart is caught
  // even though a later frame replaces it.
  const watcher = new MutationObserver(() => seen.push(host.textContent ?? ''));
  watcher.observe(host, { childList: true, subtree: true, characterData: true });
  await act(async () =>
    root.render(
      <>
        <CommitteeDonations {...donations}>
          <div>Official spending $5261240</div>
        </CommitteeDonations>
        <GroupedOutsideSpending {...({} as ComponentProps<typeof GroupedOutsideSpending>)} />
        <OutsideSpendingCard {...({} as ComponentProps<typeof OutsideSpendingCard>)} />
        <CommitteeMixHistory {...({} as ComponentProps<typeof CommitteeMixHistory>)} />
      </>,
    ),
  );
  watcher.disconnect();
  const frames = [...seen, host.textContent ?? ''];
  expect(frames.length).toBeGreaterThan(0);
  for (const frame of frames) {
    expect(frame).toContain('THE DONUT');
    expect(frame).toContain('Official spending $5261240');
    expect(frame).not.toContain(copy.chartLoading);
    expect(frame).not.toContain(copy.outsideLoading);
  }
  expect(host.textContent).toContain('OUTSIDE GROUPS');
  expect(host.textContent).toContain('OUTSIDE CARD');
  expect(host.textContent).toContain('MIX HISTORY');
});
