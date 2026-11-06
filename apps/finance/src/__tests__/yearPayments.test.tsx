import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { clearYearPayments, useYearPayments } from '../pages/committee/useYearPayments';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const session = { apiBaseUrl: 'https://first.example.test', accessToken: 'token', retry: vi.fn() };
vi.mock('../auth/session', () => ({ useFinanceSession: () => session }));
let container: HTMLDivElement, root: Root;
const path = 'finance/committees/90001/payments?direction=made&year=2026';
function Probe() {
  const read = useYearPayments<{ name: string }>(path);
  return (
    <>
      <p>
        {read.data?.payments.length ?? 'none'}:{read.data?.payments[0]?.name}:
        {read.failed ? 'failed' : 'ok'}
      </p>
      <button onClick={read.retry}>Retry</button>
    </>
  );
}
const json = (data: unknown) => new Response(JSON.stringify({ data }));
const page = (offset: number, version = 'aaaaaaaaaaaaaaaa', name = 'Old') => ({
  state: 'reported',
  version,
  release_id: 'r1',
  fetched_at: null,
  payments: Array.from({ length: offset ? 1 : 250 }, () => ({ name })),
  linkable_registration_numbers: [],
  page: { offset, limit: 250, has_more: offset === 0, total_payments: 251 },
});
async function settle() {
  for (let i = 0; i < 8; i++)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
}
async function render() {
  await act(async () => root.render(<Probe />));
  await settle();
}
beforeEach(() => {
  clearYearPayments();
  session.apiBaseUrl = 'https://first.example.test';
  session.retry.mockClear();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
it('pins later Finance year pages to the first response version', async () => {
  const urls: URL[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      const url = new URL(input);
      urls.push(url);
      const offset = Number(url.searchParams.get('offset'));
      if (offset && url.searchParams.get('version') !== 'aaaaaaaaaaaaaaaa')
        return new Response(null, { status: 409 });
      return json(page(offset));
    }),
  );
  await render();
  expect(container.textContent).toContain('251:Old:ok');
  expect(urls[1].searchParams.get('version')).toBe('aaaaaaaaaaaaaaaa');
});
it('never publishes a partial year or combines different metadata versions', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      const offset = Number(new URL(input).searchParams.get('offset'));
      return json(page(offset, offset ? 'bbbbbbbbbbbbbbbb' : 'aaaaaaaaaaaaaaaa'));
    }),
  );
  await render();
  expect(container.textContent).toContain('none::failed');
});
it('keeps the last complete year on a stale-page retry but clears it when access is revoked', async () => {
  let mode = 'ok';
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      const offset = Number(new URL(input).searchParams.get('offset'));
      if (mode === 'denied' && offset) return new Response(null, { status: 403 });
      if (mode === 'changed' && offset) return new Response(null, { status: 409 });
      return json(
        page(
          offset,
          mode === 'changed' ? 'bbbbbbbbbbbbbbbb' : 'aaaaaaaaaaaaaaaa',
          mode === 'changed' ? 'New partial' : 'Old',
        ),
      );
    }),
  );
  await render();
  expect(container.textContent).toContain('251:Old:ok');
  mode = 'changed';
  await act(async () => container.querySelector('button')!.click());
  await settle();
  expect(container.textContent).toContain('251:Old:failed');
  expect(container.textContent).not.toContain('New partial');
  mode = 'denied';
  await act(async () => container.querySelector('button')!.click());
  await settle();
  expect(container.textContent).toContain('none::failed');
  expect(session.retry).toHaveBeenCalled();
});
it('does not reuse a prior backend’s cached payment year', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      const url = new URL(input);
      return json(
        page(
          Number(url.searchParams.get('offset')),
          'aaaaaaaaaaaaaaaa',
          url.hostname.startsWith('first') ? 'First' : 'Second',
        ),
      );
    }),
  );
  await render();
  expect(container.textContent).toContain('251:First:ok');
  session.apiBaseUrl = 'https://second.example.test';
  await render();
  expect(container.textContent).toContain('251:Second:ok');
});

it('keeps legacy unversioned payment pages working without a version query', async () => {
  const urls: URL[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      const url = new URL(input);
      urls.push(url);
      const data = page(Number(url.searchParams.get('offset')));
      const { version: _version, ...legacy } = data;
      return json(legacy);
    }),
  );
  await render();
  expect(container.textContent).toContain('251:Old:ok');
  expect(urls.every((url) => !url.searchParams.has('version'))).toBe(true);
});
