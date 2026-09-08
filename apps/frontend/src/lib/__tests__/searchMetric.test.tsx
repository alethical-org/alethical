// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../siteMetricEvents', () => ({ recordSiteMetricEvent: vi.fn() }));
import { recordSiteMetricEvent } from '../siteMetricEvents';
import { useSearchMetric } from '../../hooks/useSearchMetric';

type Input = Parameters<typeof useSearchMetric>[0];
const initial: Input = {
  event: 'bill_search_with_results',
  query: 'schools',
  context: 'all',
  page: 1,
  isSuccess: true,
  isPlaceholderData: false,
  isFetching: false,
  displayedResults: 1,
};
let root: Root;
let container: HTMLDivElement;
function Probe(input: Input) {
  useSearchMetric(input);
  return null;
}
async function render(input: Partial<Input> = {}) {
  await act(async () => root.render(createElement(Probe, { ...initial, ...input })));
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.mocked(recordSiteMetricEvent).mockClear();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe('successful search counting', () => {
  it('does not count the previous result while a new query is unresolved', async () => {
    await render({ isPlaceholderData: true, isFetching: true });
    expect(recordSiteMetricEvent).not.toHaveBeenCalled();
    await render({ displayedResults: 0 });
    expect(recordSiteMetricEvent).not.toHaveBeenCalled();
    await render({ query: 'another', isSuccess: false });
    expect(recordSiteMetricEvent).not.toHaveBeenCalled();
    await render({ query: 'another' });
    expect(recordSiteMetricEvent).toHaveBeenCalledTimes(1);
  });
  it('waits for an ongoing refresh instead of counting cached results that may fail', async () => {
    await render({ isFetching: true });
    expect(recordSiteMetricEvent).not.toHaveBeenCalled();
    await render();
    expect(recordSiteMetricEvent).toHaveBeenCalledTimes(1);
  });
  it('counts changed result filters, but not repeat queries, case, paging, or refresh', async () => {
    await render();
    await render({ query: ' SCHOOLS ' });
    await render({ page: 2 });
    await render();
    expect(recordSiteMetricEvent).toHaveBeenCalledTimes(1);
    await render({ context: 'House', displayedResults: 0 });
    expect(recordSiteMetricEvent).toHaveBeenCalledTimes(1);
    await render({ context: 'House' });
    expect(recordSiteMetricEvent).toHaveBeenCalledTimes(2);
    expect(recordSiteMetricEvent).toHaveBeenLastCalledWith('bill_search_with_results');
  });
  it('does not count empty text or a filter with no displayed legislators', async () => {
    await render({ query: '' });
    await render({ event: 'legislator_search_with_results', displayedResults: 0 });
    expect(recordSiteMetricEvent).not.toHaveBeenCalled();
    await render({ event: 'legislator_search_with_results' });
    expect(recordSiteMetricEvent).toHaveBeenCalledWith('legislator_search_with_results');
  });
});
