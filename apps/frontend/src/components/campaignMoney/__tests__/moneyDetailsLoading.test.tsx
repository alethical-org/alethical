// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';

const chunk = vi.hoisted(() => {
  let reject!: (error: Error) => void;
  return {
    promise: new Promise<never>((_resolve, fail) => {
      reject = fail;
    }),
    reject: (error: Error) => reject(error),
  };
});
vi.hoisted(() => {
  (globalThis as { __DEV__?: boolean }).__DEV__ = false;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
vi.mock('../MoneyDetailsBundle', () => chunk.promise);
vi.mock('../../../lib/releaseReload', () => ({ requestReleaseReload: vi.fn(() => false) }));
import {
  CommitteeDonations,
  GroupedOutsideSpending,
  CommitteeMixHistory,
} from '../MoneyDetailsOnDemand';
import { requestReleaseReload } from '../../../lib/releaseReload';
import { moneyDetailsPageCopy as copy } from '../../../lib/campaignMoneyDetailsPageCopy';
import type { ComponentProps } from 'react';

const host = document.createElement('div');
const root = createRoot(host);
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});
it('keeps accepted summaries while the optional chunk loads and after recovery is declined', async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  document.body.append(host);
  const donations = {} as ComponentProps<typeof CommitteeDonations>;
  const outside = {} as ComponentProps<typeof GroupedOutsideSpending>;
  const history = {} as ComponentProps<typeof CommitteeMixHistory>;
  await act(async () =>
    root.render(
      <>
        <CommitteeDonations {...donations}>
          <div>Official spending $5261240</div>
        </CommitteeDonations>
        <GroupedOutsideSpending {...outside} />
        <CommitteeMixHistory {...history} />
      </>,
    ),
  );
  expect(host.textContent).toContain('Official spending $5261240');
  expect(host.textContent).toContain(copy.chartLoading);
  expect(host.textContent).toContain(copy.outsideLoading);
  await act(async () => {
    chunk.reject(new Error('release chunk missing'));
    await chunk.promise.catch(() => {});
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  expect(requestReleaseReload).toHaveBeenCalled();
  expect(host.textContent).toContain('Official spending $5261240');
  expect(host.textContent).toContain(copy.chartFailed);
  expect(host.textContent).toContain(copy.outsideFailed);
  expect(host.textContent).toContain(copy.refreshRecords);
  expect(host.textContent).not.toContain('This page hit a problem');
  expect(host.textContent).not.toContain('No donors');
  error.mockRestore();
});
