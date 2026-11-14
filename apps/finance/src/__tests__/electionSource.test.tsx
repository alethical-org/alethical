import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { App } from '../App';
import { navigate } from '../router';
import { matchRoute, safeReturnPath } from '../routes';
import { retainedSourceSelection } from '../pages/elections/sourceRoute';
import { EvidencePanel } from '../ui/controls';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const session = vi.hoisted(() => ({
  apiBaseUrl: 'https://api.example.test',
  accessToken: 'private-token' as string | null,
  email: 'reader@example.test',
  status: 'granted',
  revoked: false,
  screens: true,
  canEdit: true,
  signInPath: '/sign-in',
  retry: vi.fn(),
}));
vi.mock('../auth/session', () => ({ useFinanceSession: () => session }));
vi.mock('../shell/AppShell', () => ({
  AppShell: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('../pages/SignIn', () => ({ SignIn: () => <main>Sign in</main> }));
const key = 'mn-2026-11-03-general';
const source = 'a'.repeat(64),
  pin = 'b'.repeat(64);
const path = `/elections/${key}/sources/${source}`;
const address = `${path}?kind=report&collection_id=${pin}`;
let container: HTMLDivElement, root: Root;
let fetcher: ReturnType<typeof vi.fn<typeof fetch>>;
let revoke: ReturnType<typeof vi.fn<typeof URL.revokeObjectURL>>;

beforeEach(() => {
  Object.assign(session, {
    status: 'granted',
    accessToken: 'private-token',
    revoked: false,
    email: 'reader@example.test',
  });
  session.retry.mockClear();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  fetcher = vi.fn<typeof fetch>().mockImplementation(
    async () =>
      new Response('%PDF-original', {
        headers: { 'content-type': 'application/pdf' },
      }),
  );
  vi.stubGlobal('fetch', fetcher);
  revoke = vi.fn<typeof URL.revokeObjectURL>();
  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL = vi.fn(() => 'blob:retained-source');
      static revokeObjectURL = revoke;
    },
  );
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
async function open(value = address) {
  await act(async () => {
    navigate(value);
    root.render(<App />);
  });
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(container.querySelector('main[aria-busy="true"]')).toBeNull();
  });
}

it.each([
  ['report', 'collection_id', `finance/sources/${source}`],
  ['finance', 'collection_id', `finance/sources/${source}/raw`],
  ['election', 'snapshot_id', `sources/${source}`],
  ['external', 'generation_id', `external-finance/sources/${source}`],
])('opens %s through the same pinned private evidence loader', async (kind, pinName, suffix) => {
  await open(`${path}?kind=${kind}&${pinName}=${pin}`);
  expect(fetcher).toHaveBeenCalledExactlyOnceWith(
    `https://api.example.test/api/v1/finance/elections/${key}/${suffix}?${pinName}=${pin}`,
    {
      headers: { Authorization: 'Bearer private-token' },
      cache: 'no-store',
      redirect: 'error',
      signal: expect.any(AbortSignal),
    },
  );
  const link = container.querySelector<HTMLAnchorElement>('a[href="blob:retained-source"]');
  expect(link?.textContent).toMatch(/Download original\s+source/);
  expect(window.location.href).not.toContain('private-token');
  expect(container.textContent).not.toContain('private-token');
  expect(container.querySelector('.f-evidence-checked')).toBeNull();
});

it('keeps the full immutable address through ordinary sign-in continuation', async () => {
  session.status = 'signed-out';
  session.accessToken = null;
  await open();
  expect(window.location.pathname).toBe('/sign-in');
  const next = new URLSearchParams(window.location.search).get('next');
  expect(next).toBe(address);
  expect(fetcher).not.toHaveBeenCalled();
  expect(safeReturnPath(next, true)).toBe(address);
  session.status = 'granted';
  session.accessToken = 'private-token';
  await open(safeReturnPath(next, true));
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(container.querySelector('a[href="blob:retained-source"]')).not.toBeNull();
});

it.each([
  '',
  `?kind=report`,
  `?kind=report&snapshot_id=${pin}`,
  `?kind=report&collection_id=${pin}&collection_id=${pin}`,
  `?kind=report&kind=election&collection_id=${pin}`,
  `?kind=report&collection_id=${pin}&url=https://attacker.invalid`,
  `?kind=https://attacker.invalid&collection_id=${pin}`,
  `?kind=report&collection_id=https://attacker.invalid`,
  `?kind=report&collection_id=${pin}&path=finance/private`,
  `?kind=report&collection_id=${pin}#fragment`,
])('refuses unknown, duplicate or arbitrary source scope without fetching: %s', async (query) => {
  await open(path + query);
  expect(container.textContent).toContain('Couldn’t find that page');
  expect(fetcher).not.toHaveBeenCalled();
});

it.each(['https%3A%2F%2Fattacker.invalid', '..', '%2Fapi%2Fprivate', 'A'.repeat(64)])(
  'rejects an arbitrary source identity: %s',
  async (value) => {
    await open(`/elections/${key}/sources/${value}?kind=report&collection_id=${pin}`);
    expect(fetcher).not.toHaveBeenCalled();
  },
);

it('refuses foreign return addresses and unsupported election paths', () => {
  expect(safeReturnPath(`https://attacker.invalid${address}`, true)).toBe('/home');
  expect(safeReturnPath(`//attacker.invalid${address}`, true)).toBe('/home');
  const match = matchRoute(`/elections/not-an-election/sources/${source}`)!;
  expect(retainedSourceSelection(match, `?kind=report&collection_id=${pin}`)).toBeNull();
});

it('closes and reopens the existing evidence drawer without retaining old blobs', async () => {
  await open();
  await act(async () =>
    container.querySelector<HTMLButtonElement>('[aria-label="Close source evidence"]')!.click(),
  );
  expect(revoke).toHaveBeenCalledWith('blob:retained-source');
  expect(container.querySelector('a[href="blob:retained-source"]')).toBeNull();
  await act(async () =>
    [...container.querySelectorAll('button')].find((b) => b.textContent === 'View source')!.click(),
  );
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it('keeps failed or revoked downloads private and offers the existing retry', async () => {
  fetcher.mockResolvedValue(new Response(null, { status: 403 }));
  await open();
  expect(container.querySelector('a[href="blob:retained-source"]')).toBeNull();
  expect(session.retry).toHaveBeenCalledTimes(1);
  expect(container.textContent).toContain('Couldn’t load source');
});

it('keeps a missing review status distinct from source-only attachment status', async () => {
  await act(async () =>
    root.render(
      <EvidencePanel
        evidence={{
          title: 'Report figure',
          authority: 'Official source',
          rows: [],
        }}
        onClose={() => {}}
      />,
    ),
  );
  expect(container.querySelector('.f-evidence-checked')?.textContent).toBe('Not checked');
});

it.each(['contributions', 'independent_expenditures', 'expenditures'])(
  'opens pinned analytics %s through existing Finance access',
  async (dataset) => {
    const address = `/elections/${key}/sources/${dataset}?kind=analytics&snapshot_id=${pin}&version=${'c'.repeat(16)}`;
    await open(address);
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(
      `https://api.example.test/api/v1/finance/elections/${key}/analytics/sources/${dataset}?snapshot_id=${pin}&version=${'c'.repeat(16)}`,
      {
        headers: { Authorization: 'Bearer private-token' },
        cache: 'no-store',
        redirect: 'error',
        signal: expect.any(AbortSignal),
      },
    );
    expect(container.querySelector('a[href="blob:retained-source"]')).not.toBeNull();
  },
);

it.each([
  `kind=analytics&snapshot_id=${pin}`,
  `kind=analytics&version=${'c'.repeat(16)}`,
  `kind=analytics&snapshot_id=${pin}&version=${pin}`,
  `kind=analytics&snapshot_id=${pin}&version=${'c'.repeat(16)}&version=${'c'.repeat(16)}`,
  `kind=analytics&snapshot_id=${pin}&version=${'c'.repeat(16)}&url=https://attacker.invalid`,
  `kind=analytics&collection_id=${pin}&version=${'c'.repeat(16)}`,
])('refuses incomplete or widened analytics source pins: %s', async (query) => {
  await open(`/elections/${key}/sources/contributions?${query}`);
  expect(fetcher).not.toHaveBeenCalled();
  expect(container.textContent).toContain('Couldn’t find that page');
});

it.each(['other', 'https%3A%2F%2Fattacker.invalid', '%2Fapi%2Fprivate'])(
  'refuses an unapproved analytics dataset: %s',
  async (dataset) => {
    await open(
      `/elections/${key}/sources/${dataset}?kind=analytics&snapshot_id=${pin}&version=${'c'.repeat(16)}`,
    );
    expect(fetcher).not.toHaveBeenCalled();
  },
);

it('pins an outside source to its release and exact content hash', async () => {
  const release = '12345678-1234-1234-1234-123456789abc',
    version = 'c'.repeat(16);
  await open(
    `${path}?kind=outside&election_snapshot_id=${pin}&version=${version}&release_id=${release}`,
  );
  expect(fetcher.mock.calls[0][0]).toBe(
    `https://api.example.test/api/v1/finance/elections/${key}/outside-spending/source?election_snapshot_id=${pin}&version=${version}&release_id=${release}&source_hash=${source}`,
  );
});

it.each([
  `kind=external&generation_id=${pin}&generation_id=${pin}`,
  `kind=external&generation_id=${pin}&url=https://foreign.test`,
  `kind=outside&election_snapshot_id=${pin}&version=${'c'.repeat(16)}&release_id=foreign`,
  `kind=outside&election_snapshot_id=${pin}&version=${'c'.repeat(16)}&release_id=12345678-1234-1234-1234-123456789abc&token=secret`,
])('rejects malformed external source parameters: %s', async (query) => {
  await open(`${path}?${query}`);
  expect(fetcher).not.toHaveBeenCalled();
});
