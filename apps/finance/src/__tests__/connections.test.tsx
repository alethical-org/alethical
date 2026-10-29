import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { clearReadCache } from '../api/read';
import { MoneyConnections } from '../pages/MoneyConnections';
import {
  edgeAmount,
  edgeEvidence,
  edgePeriod,
  nodeHref,
  type GraphEdge,
  type GraphNode,
} from '../pages/connections/data';
import { wrapLabel } from '../pages/connections/Map';
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock('../auth/session', () => ({
  useFinanceSession: () => ({ apiBaseUrl: 'https://api.example.test', accessToken: 'token' }),
}));
const node: GraphNode = {
  key: 'printed:Example',
  kind: 'printed_name',
  label: 'Example',
  record_id: 'Example',
  unresolved: true,
  target: { kind: 'printed_name', id: 'Example', role: 'vendor' },
};
const committee: GraphNode = {
  key: 'committee:1',
  kind: 'committee',
  label: 'Example committee',
  record_id: '1',
  unresolved: false,
  target: { kind: 'committee', id: '1' },
};
const edge: GraphEdge = {
  id: 'e',
  from: node.key,
  to: committee.key,
  relationship: 'payments',
  amount: '-42',
  amount_state: 'reported',
  period_basis: 'years',
  first_year: 2025,
  last_year: 2026,
  first_date: '2026-01-01',
  last_date: '2026-01-01',
  undated_count: 1,
  record_count: 2,
  source: {
    dataset: 'expenditures',
    url: 'https://cfb.mn.gov/example.csv',
    copied_at: '2026-10-29',
  },
};
it('links only explicit targets, preserving the printed role and source section', () => {
  expect(nodeHref(node)).toContain('role=payee');
  expect(nodeHref(node)).toContain('section=campaign-payments');
  expect(nodeHref({ ...node, role: 'agency', target: null })).toBeNull();
  expect(
    nodeHref({ ...node, target: { kind: 'printed_name', id: 'Example', role: 'payer' } }),
  ).toBeNull();
});
it('uses a complete year period instead of the partial date range and preserves refunds', () => {
  expect(edgePeriod(edge)).toBe('Years 2025–2026');
  expect(edgeAmount(edge)).toContain('42');
  expect(edgeAmount(edge)).toMatch(/[-−]/);
  expect(
    edgeAmount({ ...edge, period_basis: 'unknown', amount_state: 'incomplete_period' }),
  ).toContain('period is incomplete');
  expect(edgeAmount({ ...edge, amount_state: 'incomplete', amount: null })).toContain(
    'amount is missing',
  );
  expect(edgeAmount({ ...edge, amount_state: 'not_applicable', amount: null })).toBe('');
});
it('keeps exact station file version/page/quote in evidence', () => {
  const evidence = edgeEvidence(
    {
      ...edge,
      source: {
        dataset: 'station_file',
        file_key: 'f',
        version_id: 'v',
        page: 3,
        quote: 'Exact quote',
      },
    },
    node,
    committee,
  );
  expect(evidence.sourceHref).toBe('/media-buys/files/f?version=v&page=3');
  expect(evidence.quote).toBe('Exact quote');
  expect(evidence.checked).toBe('Checked');
});
it('wraps long words without losing letters or letting any line exceed the measured width', () => {
  const text = 'A verylongunbrokenorganizationnamewithallitsletters remains readable';
  const lines = wrapLabel(text, 45, (s) => s.length * 5);
  expect(lines.every((line) => line.length <= 9)).toBe(true);
  expect(lines.join('').replaceAll(' ', '')).toBe(text.replaceAll(' ', ''));
});
let container: HTMLDivElement, root: Root;
beforeEach(() => {
  clearReadCache();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  window.history.replaceState(null, '', '/money/connections?view=Table');
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
async function flush() {
  for (let i = 0; i < 4; i++)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
}
it('serves whole-server filters and visible paging without turning a source failure into empty results', async () => {
  let failure = false;
  const requests: URL[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      const u = new URL(input);
      requests.push(u);
      return new Response(
        JSON.stringify({
          data: failure
            ? { state: 'unavailable' }
            : {
                state: 'reported',
                nodes: [node, committee],
                edges: [edge],
                total: 80,
                has_more: true,
                offset: 0,
                limit: 50,
                q: '',
                year: null,
                relationship: 'all',
                focus: null,
                years: [2026],
                relationships: ['payments'],
                unavailable_sources: [],
              },
        }),
        { headers: { 'Content-Type': 'application/json' } },
      );
    }),
  );
  await act(async () => root.render(<MoneyConnections />));
  await flush();
  expect(container.textContent).toContain('1–1 of 80 connections');
  expect(container.textContent).toContain('0 confirmed people and organizations · 1 committee');
  expect(container.textContent).toContain('Page 1 of 2');
  const next = [...container.querySelectorAll('button')].find(
    (button) => button.textContent === 'Next',
  )!;
  failure = true;
  await act(async () => next.click());
  await flush();
  expect(requests.at(-1)!.searchParams.get('offset')).toBe('50');
  expect(container.textContent).toContain('Previous results are shown');
  expect(container.textContent).toContain('Example committee');
  expect(container.textContent).not.toContain('No connections are held');
});
