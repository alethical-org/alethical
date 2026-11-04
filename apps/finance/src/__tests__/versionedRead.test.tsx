import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { clearReadCache } from '../api/read';
import { useVersionedRead } from '../api/versionedRead';

const session = vi.hoisted(() => ({
  apiBaseUrl: 'https://api.example.test',
  accessToken: 'account-a',
  retry: vi.fn(),
}));
vi.mock('../auth/session', () => ({ useFinanceSession: () => session }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, container: HTMLDivElement;
const restart = vi.fn();
const reply = (label: string, version?: string) =>
  new Response(JSON.stringify({ data: { label, version } }));
function View({
  page = 1,
  filter = '',
  endpoint = 'people',
}: {
  page?: number;
  filter?: string;
  endpoint?: string;
}) {
  const read = useVersionedRead<{ label: string; version?: string }>(
    `finance/${endpoint}?q=${filter}&offset=${(page - 1) * 10}`,
    { page, onRestart: restart },
  );
  return (
    <div>
      {read.data?.label}
      <span>{read.updating ? 'Updating' : read.failed ? 'Failed' : ''}</span>
      <button onClick={read.retry}>Retry</button>
    </div>
  );
}
beforeEach(() => {
  clearReadCache();
  restart.mockClear();
  session.retry.mockClear();
  session.accessToken = 'account-a';
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it.each([
  'connections',
  'payees',
  'people',
  'identities',
  'identities/queue',
  'media-buys/browse',
  'media-buys/queue',
])('pins later pages of %s but starts a new filter without the old token', async (endpoint) => {
  const urls: URL[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      urls.push(new URL(input));
      return reply('Rows', 'aaaaaaaaaaaaaaaa');
    }),
  );
  await act(async () => root.render(<View endpoint={endpoint} />));
  await act(async () => root.render(<View endpoint={endpoint} page={2} />));
  expect(urls.at(-1)?.searchParams.get('version')).toBe('aaaaaaaaaaaaaaaa');
  await act(async () => root.render(<View endpoint={endpoint} filter="new" />));
  expect(urls.at(-1)?.searchParams.has('version')).toBe(false);
});

it('does not allow an unversioned response to be combined with a later page', async () => {
  const fetcher = vi.fn(async () => reply('Old rows'));
  vi.stubGlobal('fetch', fetcher);
  await act(async () => root.render(<View />));
  await act(async () => root.render(<View page={2} />));
  expect(fetcher).toHaveBeenCalledOnce();
  expect(container.textContent).toContain('Old rowsFailed');
  await act(async () => container.querySelector('button')!.click());
  expect(restart).toHaveBeenCalledOnce();
});

it('keeps prior rows while updating and ignores an older response after a newer filter', async () => {
  let oldResolve!: (value: Response) => void;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      const query = new URL(input).searchParams.get('q');
      return query === 'slow'
        ? new Promise<Response>((resolve) => {
            oldResolve = resolve;
          })
        : reply(query || 'Original', 'aaaaaaaaaaaaaaaa');
    }),
  );
  await act(async () => root.render(<View />));
  await act(async () => root.render(<View filter="slow" />));
  expect(container.textContent).toContain('OriginalUpdating');
  await act(async () => root.render(<View filter="new" />));
  expect(container.textContent).toContain('new');
  await act(async () => oldResolve(reply('Wrong old rows', 'bbbbbbbbbbbbbbbb')));
  expect(container.textContent).not.toContain('Wrong old rows');
});

it.each([401, 403])(
  'removes pinned private rows on %s and does not keep the pin across an account change',
  async (status) => {
    const urls: URL[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => {
        const url = new URL(input);
        urls.push(url);
        return url.searchParams.get('offset') === '0'
          ? reply('Private rows', 'aaaaaaaaaaaaaaaa')
          : new Response(null, { status });
      }),
    );
    await act(async () => root.render(<View />));
    await act(async () => root.render(<View page={2} />));
    expect(container.textContent).not.toContain('Private rows');
    expect(session.retry).toHaveBeenCalledOnce();
    session.accessToken = 'account-b';
    await act(async () => root.render(<View />));
    expect(urls.at(-1)?.searchParams.has('version')).toBe(false);
  },
);
