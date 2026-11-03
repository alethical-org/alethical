import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { clearReadCache, useRead } from '../api/read';
const session = vi.hoisted(() => ({
  apiBaseUrl: 'https://api.example.test',
  accessToken: 'account-a',
  retry: vi.fn(),
}));
vi.mock('../auth/session', () => ({ useFinanceSession: () => session }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let container: HTMLDivElement, root: Root;
function View({ path }: { path: string | null }) {
  const read = useRead<{ label: string }>(path, { keepPrevious: true });
  return <div>{read.loading ? 'Loading' : (read.data?.label ?? 'No request')}</div>;
}
beforeEach(() => {
  clearReadCache();
  session.accessToken = 'account-a';
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
it('does not show a disabled request as loading', async () => {
  await act(async () => root.render(<View path={null} />));
  expect(container.textContent).toBe('No request');
});
it('does not carry prior private results across an account change', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ data: { label: 'Private old answer' } }))),
  );
  await act(async () => root.render(<View path="finance/example" />));
  expect(container.textContent).toBe('Private old answer');
  session.accessToken = 'account-b';
  vi.stubGlobal(
    'fetch',
    vi.fn(() => new Promise(() => {})),
  );
  await act(async () => root.render(<View path="finance/example" />));
  expect(container.textContent).toBe('Loading');
  expect(container.textContent).not.toContain('Private old answer');
});

it.each([401, 403])(
  'withdraws private results and rechecks access after %s with the same token',
  async (status) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ data: { label: 'Private old answer' } }))),
    );
    await act(async () => root.render(<View path="finance/people?offset=0" />));
    expect(container.textContent).toBe('Private old answer');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status })),
    );
    await act(async () => root.render(<View path="finance/people?offset=10" />));
    expect(container.textContent).not.toContain('Private old answer');
    expect(session.retry).toHaveBeenCalledOnce();
  },
);
it('retains prior results after an ordinary500 response', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ data: { label: 'Private old answer' } }))),
  );
  await act(async () => root.render(<View path="finance/people?offset=0" />));
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(null, { status: 500 })),
  );
  await act(async () => root.render(<View path="finance/people?offset=10" />));
  expect(container.textContent).toBe('Private old answer');
  expect(session.retry).not.toHaveBeenCalled();
});
