// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const request = vi.hoisted(() => vi.fn());
const auth = vi.hoisted(() => ({
  user: { id: 'admin', isAdmin: true },
  accessToken: 'one',
  isSignedIn: true,
  isLoading: false,
}));
vi.mock('../../../providers/AuthProvider', () => ({ useAuth: () => auth }));
vi.mock('../../../data/api', () => ({
  apiRequest: request,
  ApiError: class ApiError extends Error {
    constructor(
      public status: number,
      message: string,
    ) {
      super(message);
    }
  },
}));
vi.mock('../../../hooks/useResponsive', () => ({
  useResponsive: () => ({ isMobile: false, isDesktop: true, isTablet: false }),
}));
import { useTVAdAccess } from '../useTVAdAccess';
import { ApiError } from '../../../data/api';
import { readTVImage, readTV, onTVDenied, denyTV, safeTVReturn, type BrowseResult } from '../api';
import { TVSession, useTVRead, ChoiceMenu, FileRows } from '../pieces';
import { TVLanding, initialBrowse } from '../Landing';
import { TVAdConnectionCard, TVAdSearchGroup } from '../Connected';
import { TVFile, TVExpense, TVAgency, TVFolder } from '../Records';

let mount: HTMLDivElement;
let root: Root;
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}
beforeEach(() => {
  request.mockReset();
  vi.stubEnv('EXPO_PUBLIC_API_URL', 'https://api.example.test');
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  mount = document.createElement('div');
  document.body.append(mount);
  root = createRoot(mount);
});
afterEach(() => {
  act(() => root.unmount());
  mount.remove();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('private TV data boundaries', () => {
  it('refuses foreign and unbound image paths before sending a token', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const signal = new AbortController().signal;
    await expect(readTVImage('private', 'https://elsewhere.test/image', signal)).rejects.toThrow(
      'Invalid image path',
    );
    await expect(
      readTVImage('private', '/ads/files/file/pages/1?version=abc', signal),
    ).rejects.toThrow('Unbound image path');
    await expect(
      readTVImage('private', '/ads/files/file/source-pages/1?version=abc', signal),
    ).rejects.toThrow('Unbound image path');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('uses an authenticated non-cacheable image request with redirects disabled', async () => {
    const previous = process.env.EXPO_PUBLIC_API_URL;
    process.env.EXPO_PUBLIC_API_URL = 'https://api.example.test';
    const fetch = vi.fn().mockResolvedValue(
      new Response('safe', {
        headers: { 'Content-Type': 'image/png' },
      }),
    );
    vi.stubGlobal('fetch', fetch);
    try {
      await readTVImage(
        'secret',
        '/ads/files/file/pages/1?version=abc&copy=123',
        new AbortController().signal,
      );
      expect(fetch).toHaveBeenCalledWith(
        'https://api.example.test/api/v1/ads/files/file/pages/1?version=abc&copy=123',
        expect.objectContaining({
          cache: 'no-store',
          redirect: 'error',
          credentials: 'omit',
          headers: expect.objectContaining({ Authorization: 'Bearer secret' }),
        }),
      );
    } finally {
      if (previous === undefined) delete process.env.EXPO_PUBLIC_API_URL;
      else process.env.EXPO_PUBLIC_API_URL = previous;
    }
  });
  it('clears all TV consumers on revoked permission but not an ordinary missing file', async () => {
    const denied = vi.fn();
    const remove = onTVDenied(denied);
    try {
      request
        .mockRejectedValueOnce(new ApiError(404, 'Not found'))
        .mockResolvedValueOnce({ allowed: true });
      await expect(readTV('token', '/files/missing')).rejects.toThrow();
      expect(denied).not.toHaveBeenCalled();
      request
        .mockRejectedValueOnce(new ApiError(404, 'Not found'))
        .mockRejectedValueOnce(new ApiError(404, 'Not found'));
      await expect(readTV('token', '/files/old')).rejects.toThrow();
      expect(denied).toHaveBeenCalledWith('token');
    } finally {
      remove();
    }
  });
  it('keeps return navigation inside the TV landing and strips unknown fields', () => {
    expect(safeTVReturn('https://evil.test/money/ads')).toBe('/money/ads');
    expect(safeTVReturn('//evil.test/money/ads')).toBe('/money/ads');
    expect(safeTVReturn('/money/ads/files/123')).toBe('/money/ads');
    expect(safeTVReturn('/money/ads?q=sample&page=2&token=secret')).toBe(
      '/money/ads?q=sample&page=2',
    );
  });
});

describe('result replacement', () => {
  it('drops an older response and retains the last successful response on failure', async () => {
    const first = deferred<{ name: string }>();
    const second = deferred<{ name: string }>();
    const third = deferred<{ name: string }>();
    request
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
      .mockReturnValueOnce(third.promise);
    const denied = vi.fn();
    function Probe({ path }: { path: string }) {
      const read = useTVRead<{ name: string }>(path);
      return (
        <p>
          {read.data?.name || 'empty'}:{read.loading ? 'loading' : read.error ? 'failed' : 'ready'}
        </p>
      );
    }
    const draw = (path: string) =>
      act(() =>
        root.render(
          <TVSession.Provider value={{ token: 'one', denied }}>
            <Probe path={path} />
          </TVSession.Provider>,
        ),
      );
    draw('/first');
    draw('/second');
    await act(async () => second.resolve({ name: 'second' }));
    await act(async () => first.resolve({ name: 'old' }));
    expect(mount.textContent).toBe('second:ready');
    draw('/third');
    expect(mount.textContent).toBe('second:loading');
    await act(async () => third.reject(new Error('Offline')));
    expect(mount.textContent).toBe('second:failed');
  });
  it('does not relabel old search rows or counts while a replacement is pending or fails', async () => {
    const changed = deferred<BrowseResult>();
    const original: BrowseResult = {
      tab: 'folders',
      q: '',
      station: '',
      year: '2026',
      category: '',
      page: 1,
      page_size: 12,
      total: 1,
      capped: false,
      years: ['2026'],
      categories: ['State'],
      rows: [
        {
          key: 'old',
          label: 'Old folder',
          station: 'KSTP-TV',
          year: 2026,
          category: 'State',
          file_count: 1,
        },
      ],
    };
    request.mockImplementation((path: string) =>
      path.startsWith('/ads/browse')
        ? path.includes('q=new')
          ? changed.promise
          : Promise.resolve(original)
        : path === '/ads/counts'
          ? Promise.resolve({
              station_files_held: 1,
              unique_file_contents: 1,
              files_with_approved_copy: 1,
              text_read_failures: 0,
              download_failures: 0,
              checked_connection_files: 0,
            })
          : path === '/ads/recent'
            ? Promise.resolve({ stations: [] })
            : Promise.resolve({ stations: [], text_reader_version: 'test' }),
    );
    const denied = vi.fn();
    await act(async () =>
      root.render(
        <TVSession.Provider value={{ token: 'one', denied }}>
          <TVLanding params={{ year: '2026' }} onParams={vi.fn()} />
        </TVSession.Provider>,
      ),
    );
    const input = mount.querySelector('input')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'new');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () =>
      mount
        .querySelector('form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
    );
    expect(mount.textContent).toContain('Still showing station folders for 2026');
    expect(mount.textContent).toContain('Old folder');
    expect(mount.textContent).toContain('1 station folder');
    await act(async () => changed.reject(new Error('Offline')));
    expect(mount.textContent).toContain('We couldn’t search these records just now');
    expect(mount.textContent).toContain('Old folder');
  });
});

describe('overlay choice menu', () => {
  it('skips unavailable versions, supports keyboard selection and returns focus', () => {
    const choose = vi.fn();
    act(() =>
      root.render(
        <ChoiceMenu
          label="Versions"
          value="a"
          choices={[
            { value: 'a', label: 'First' },
            { value: 'b', label: 'Withdrawn', disabled: true },
            { value: 'c', label: 'Last' },
          ]}
          onChange={choose}
        />,
      ),
    );
    const button = mount.querySelector('button')!;
    button.focus();
    act(() =>
      button.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })),
    );
    act(() =>
      button.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })),
    );
    act(() => button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    expect(choose).toHaveBeenCalledWith('c');
    expect(document.activeElement).toBe(button);
    expect(mount.querySelector('[role=listbox]')).toBeNull();
  });
});

describe('approved content and evidence', () => {
  it('clears an exact copy and its facts when its page is withdrawn while loading', async () => {
    const image = deferred<Response>();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => image.promise),
    );
    const refresh = deferred<unknown>();
    request
      .mockResolvedValueOnce({
        key: 'safe-id',
        copy_status: 'approved',
        name: 'OLD APPROVED NAME',
        station: 'KARE',
        year: '2026',
        version_id: 'hash',
        copy_id: 'copy-id',
        versions: [],
        page_count: 1,
        pages: [
          {
            number: 1,
            image_path: '/ads/files/safe-id/pages/1?version=hash&copy=copy-id',
            text_status: 'ready',
          },
        ],
        facts: [],
        dates: [],
        connections: [],
      })
      .mockReturnValueOnce(refresh.promise);
    const params = vi.fn();
    await act(async () =>
      root.render(
        <TVSession.Provider value={{ token: 'one', denied: vi.fn() }}>
          <TVFile fileKey="safe-id" params={{}} onParams={params} notFound={vi.fn()} />
        </TVSession.Provider>,
      ),
    );
    expect(mount.textContent).toContain('OLD APPROVED NAME');
    await act(async () => image.resolve(new Response(null, { status: 410 })));
    expect(mount.textContent).not.toContain('OLD APPROVED NAME');
    expect(mount.textContent).toContain('Loading saved record');
    expect(params).toHaveBeenCalledWith({ copy: 'copy-id', version: 'hash' });
    await act(async () =>
      refresh.resolve({ key: 'safe-id', copy_status: 'withdrawn', versions: [] }),
    );
    expect(mount.textContent).toContain('This copy is no longer shown');
  });
  it.each(['approved', 'archive'])(
    'releases private %s image URLs when the record unmounts',
    async (status) => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          new Response('safe', {
            headers: { 'Content-Type': 'image/png' },
          }),
        ),
      );
      const create = vi.fn(() => 'blob:private-image');
      const revoke = vi.fn();
      Object.defineProperty(URL, 'createObjectURL', { value: create, configurable: true });
      Object.defineProperty(URL, 'revokeObjectURL', { value: revoke, configurable: true });
      request.mockResolvedValue({
        key: 'safe-id',
        copy_status: status,
        name: 'SAFE NAME',
        station: 'KARE',
        year: '2026',
        version_id: 'hash',
        copy_id: 'copy-id',
        versions: [],
        page_count: 1,
        pages: [
          {
            number: 1,
            image_path:
              status === 'archive'
                ? `/ads/files/safe-id/source-pages/1?version=${'a'.repeat(64)}`
                : '/ads/files/safe-id/pages/1?version=hash&copy=copy-id',
            text_status: 'ready',
          },
        ],
        facts: [],
        dates: [],
        connections: [],
      });
      await act(async () =>
        root.render(
          <TVSession.Provider value={{ token: 'one', denied: vi.fn() }}>
            <TVFile fileKey="safe-id" params={{}} onParams={vi.fn()} notFound={vi.fn()} />
          </TVSession.Provider>,
        ),
      );
      expect(mount.querySelector('img')?.getAttribute('src')).toBe('blob:private-image');
      if (status === 'archive') {
        expect(mount.textContent).toContain(
          'Original station file · Not checked or approved for publication',
        );
        expect(mount.querySelector('img')?.getAttribute('alt')).toContain('original station file');
        expect(mount.textContent).not.toContain('Blank boxes cover personal details');
      }
      await act(async () => root.render(null));
      expect(revoke).toHaveBeenCalledWith('blob:private-image');
    },
  );

  it('renders a withdrawn tombstone without accidentally supplied old metadata', async () => {
    request.mockResolvedValue({
      key: 'safe-id',
      copy_status: 'withdrawn',
      withdrawn_at: '2026-10-01',
      versions: [],
      name: 'WITHDRAWN NAME',
      facts: [{ value: 'WITHDRAWN FACT' }],
      pages: [{ text: 'WITHDRAWN TEXT' }],
    });
    await act(async () =>
      root.render(
        <TVSession.Provider value={{ token: 'one', denied: vi.fn() }}>
          <TVFile fileKey="safe-id" params={{}} onParams={vi.fn()} notFound={vi.fn()} />
        </TVSession.Provider>,
      ),
    );
    expect(mount.textContent).toContain('This copy is no longer shown');
    expect(mount.textContent).not.toContain('WITHDRAWN');
    expect(mount.querySelector('img')).toBeNull();
  });
  it('allows approved metadata while withholding every not-ready content surface', async () => {
    request.mockResolvedValue({
      key: 'safe-id',
      copy_status: 'not_ready',
      name: 'SAFE FILE NAME',
      station: 'KARE',
      year: '2026',
      versions: [],
      facts: [{ value: 'UNAPPROVED FACT' }],
      pages: [{ text: 'UNAPPROVED TEXT' }],
      connections: [{ label: 'UNAPPROVED CONNECTION' }],
    });
    await act(async () =>
      root.render(
        <TVSession.Provider value={{ token: 'one', denied: vi.fn() }}>
          <TVFile fileKey="safe-id" params={{}} onParams={vi.fn()} notFound={vi.fn()} />
        </TVSession.Provider>,
      ),
    );
    expect(mount.textContent).toContain('SAFE FILE NAME');
    expect(mount.textContent).toContain('its approved copy is not ready');
    expect(mount.textContent).not.toContain('UNAPPROVED');
  });
  it('links expense evidence to the exact retained station copy and page', async () => {
    request.mockResolvedValue({
      id: 'connection',
      label: 'Saved expense row 12',
      dataset: 'saved export',
      source_date: '2026-10-01',
      source_changed: true,
      fields: [{ label: 'Reported expense', value: '$123' }],
      evidence: { page: 2, quote: 'PRINTED REFERENCE', version_id: 'source-hash' },
      file: {
        key: 'kare-file',
        name: 'Checked source',
        copy_id: 'approved-copy',
        version_id: 'source-hash',
      },
    });
    await act(async () =>
      root.render(
        <TVSession.Provider value={{ token: 'one', denied: vi.fn() }}>
          <TVExpense expenseId="connection" notFound={vi.fn()} />
        </TVSession.Provider>,
      ),
    );
    expect(mount.querySelector('a')?.getAttribute('href')).toBe(
      '/money/ads/files/kare-file?version=source-hash&copy=approved-copy&page=2',
    );
    expect(mount.textContent).toContain(
      'this connection was checked against the saved filing shown here',
    );
    expect(mount.textContent).toContain('PRINTED REFERENCE');
  });
});

describe('fresh administrator access', () => {
  function Access() {
    return <span>{useTVAdAccess().state}</span>;
  }
  it('does not trust a cached administrator flag when the server denies access', async () => {
    request.mockRejectedValue(new ApiError(404, 'Not found'));
    await act(async () => root.render(<Access />));
    expect(mount.textContent).toBe('restricted');
    expect(request).toHaveBeenCalledWith(
      '/ads/access',
      expect.objectContaining({ cache: 'no-store' }),
      'one',
    );
  });
  it('does not let an older access response undo a newer revocation', async () => {
    const response = deferred<{ allowed: boolean }>();
    request.mockReturnValue(response.promise);
    await act(async () => root.render(<Access />));
    await act(async () => denyTV('one'));
    expect(mount.textContent).toBe('restricted');
    await act(async () => response.resolve({ allowed: true }));
    expect(mount.textContent).toBe('restricted');
  });
});

describe('version-bound evidence', () => {
  it('keeps a related file link bound to the copy that supplied its evidence', async () => {
    await act(async () =>
      root.render(
        <FileRows
          files={[
            {
              key: 'file-a',
              name: 'Evidence A',
              station: 'KARE',
              year: '2026',
              category: 'State',
              uploaded_at: null,
              version_id: 'hash-a',
              copy_id: 'copy-a',
              source_changed: true,
            },
          ]}
        />,
      ),
    );
    expect(mount.querySelector('a')?.getAttribute('href')).toBe(
      '/money/ads/files/file-a?version=hash-a&copy=copy-a',
    );
    expect(mount.textContent).toContain('saved copy used for the check');
    request.mockResolvedValue({
      key: 'file-a',
      copy_status: 'withdrawn',
      versions: [],
      name: 'UNSAFE OLD TITLE',
    });
    await act(async () =>
      root.render(
        <TVSession.Provider value={{ token: 'one', denied: vi.fn() }}>
          <TVFile
            fileKey="file-a"
            version="hash-a"
            params={{ copy: 'copy-a' }}
            onParams={vi.fn()}
            notFound={vi.fn()}
          />
        </TVSession.Provider>,
      ),
    );
    expect(request).toHaveBeenCalledWith(
      '/ads/files/file-a?version=hash-a&copy=copy-a',
      expect.anything(),
      'one',
    );
    expect(mount.textContent).toContain('This copy is no longer shown');
    expect(mount.textContent).not.toContain('UNSAFE OLD TITLE');
  });
  it('uses the current approved source even when first-saved ordering differs', async () => {
    request.mockResolvedValue({
      key: 'a',
      name: 'Returned source A',
      copy_status: 'approved',
      version_id: 'hash-a',
      copy_id: 'copy-a',
      current_source_version: 'hash-a',
      newest_approved_version: 'hash-a',
      source_changed: false,
      page_count: 0,
      pages: [],
      versions: [
        { id: 'hash-b', first_saved_at: '2026-10-01', status: 'approved' },
        { id: 'hash-a', first_saved_at: '2026-09-01', status: 'approved' },
      ],
    });
    await act(async () =>
      root.render(
        <TVSession.Provider value={{ token: 'one', denied: vi.fn() }}>
          <TVFile fileKey="a" params={{}} onParams={vi.fn()} notFound={vi.fn()} />
        </TVSession.Provider>,
      ),
    );
    expect(mount.querySelector('.tv-error')).toBeNull();
    expect(mount.textContent).not.toContain('station file changed');
  });
});

describe('browse scope and exact search destinations', () => {
  it.each([
    {
      tab: 'stations',
      row: { key: 'kare', label: 'KARE', station: 'KARE', folder_count: 2, file_count: 4 },
      expected: '2 folders · 4 files',
    },
    {
      tab: 'years',
      row: { key: '2026', label: '2026', year: 2026, folder_count: 1, file_count: 1 },
      expected: '1 folder · 1 file',
    },
    {
      tab: 'agencies',
      row: { key: 'agency', label: 'Example agency', stations: ['KARE', 'KSTP-TV'], file_count: 4 },
      expected: '4 files · KARE, KSTP-TV',
    },
  ])('shows the matching metadata for $tab rows', async ({ tab, row, expected }) => {
    request.mockImplementation((path: string) =>
      Promise.resolve(
        path.startsWith('/ads/browse')
          ? {
              ...initialBrowse({ tab }),
              page_size: 12,
              total: 1,
              capped: false,
              years: [],
              categories: [],
              rows: [row],
            }
          : path === '/ads/counts'
            ? {
                station_files_held: 0,
                unique_file_contents: 0,
                files_with_approved_copy: 0,
                text_read_failures: 0,
                download_failures: 0,
                checked_connection_files: 0,
              }
            : { stations: [], text_reader_version: 'test' },
      ),
    );
    await act(async () =>
      root.render(
        <TVSession.Provider value={{ token: 'one', denied: vi.fn() }}>
          <TVLanding params={{ tab }} onParams={vi.fn()} />
        </TVSession.Provider>,
      ),
    );
    const rendered = mount.querySelector('.tv-row')!;
    expect(rendered.querySelector('.tv-small')?.textContent).toBe(expected);
    expect(rendered.textContent).not.toContain('Category not identified');
  });
  it.each(['agencies', 'stations', 'years'])(
    'clears folder-only filters when changing to %s',
    async (tab) => {
      const onParams = vi.fn();
      request.mockImplementation((path: string) =>
        Promise.resolve(
          path.startsWith('/ads/browse')
            ? {
                ...initialBrowse({ year: '2026', station: 'KARE', category: 'State' }),
                page_size: 12,
                total: 0,
                capped: false,
                years: ['2026'],
                categories: [],
                rows: [],
              }
            : path === '/ads/counts'
              ? {
                  station_files_held: 0,
                  unique_file_contents: 0,
                  files_with_approved_copy: 0,
                  text_read_failures: 0,
                  download_failures: 0,
                  checked_connection_files: 0,
                }
              : { stations: [], text_reader_version: 'test' },
        ),
      );
      await act(async () =>
        root.render(
          <TVSession.Provider value={{ token: 'one', denied: vi.fn() }}>
            <TVLanding
              params={{ year: '2026', station: 'KARE', category: 'State' }}
              onParams={onParams}
            />
          </TVSession.Provider>,
        ),
      );
      const labels: Record<string, string> = {
        agencies: 'Ad agency names',
        stations: 'Stations',
        years: 'Years',
      };
      const trigger = Array.from(mount.querySelectorAll<HTMLButtonElement>('[role=tab]')).find(
        (button) => button.textContent === labels[tab],
      )!;
      await act(async () => trigger.click());
      expect(onParams).toHaveBeenLastCalledWith(
        expect.objectContaining({ tab, station: undefined, year: undefined, category: undefined }),
      );
      expect(
        initialBrowse({ tab, year: '2026', station: 'KARE', category: 'State' }),
      ).toMatchObject({ station: '', year: '', category: '' });
    },
  );
  it('limits URL and input queries to 200 characters and carries the shown query to the exact copy', async () => {
    const q = 'x'.repeat(220);
    expect(initialBrowse({ q }).q).toHaveLength(200);
    request.mockImplementation((path: string) =>
      Promise.resolve(
        path.startsWith('/ads/browse')
          ? {
              ...initialBrowse({ q: 'synthetic' }),
              page_size: 12,
              total: 1,
              capped: false,
              years: [],
              categories: [],
              rows: [
                {
                  key: 'result',
                  label: 'Synthetic result',
                  version_id: 'version-a',
                  copy_id: 'copy-a',
                },
              ],
            }
          : path === '/ads/counts'
            ? {
                station_files_held: 0,
                unique_file_contents: 0,
                files_with_approved_copy: 0,
                text_read_failures: 0,
                download_failures: 0,
                checked_connection_files: 0,
              }
            : { stations: [], text_reader_version: 'test' },
      ),
    );
    await act(async () =>
      root.render(
        <TVSession.Provider value={{ token: 'one', denied: vi.fn() }}>
          <TVLanding params={{ q: 'synthetic' }} onParams={vi.fn()} />
        </TVSession.Provider>,
      ),
    );
    expect(mount.querySelector('input')?.maxLength).toBe(200);
    const href = mount.querySelector<HTMLAnchorElement>('a.tv-row')!.href;
    const params = new URL(href).searchParams;
    expect(params.get('q')).toBe('synthetic');
    expect(params.get('version')).toBe('version-a');
    expect(params.get('copy')).toBe('copy-a');
    expect(params.get('from')).toContain('q=synthetic');
  });
});

describe('approved reader wording and exact printed names', () => {
  it.each([0, 1, 2])(
    'uses the correct count grammar for %s files and connections',
    async (count) => {
      request.mockImplementation((path: string) =>
        Promise.resolve(
          path.startsWith('/ads/browse')
            ? {
                ...initialBrowse({ q: 'sample' }),
                page_size: 12,
                total: count,
                capped: false,
                years: [],
                categories: [],
                rows: count ? [{ key: 'record', label: 'Sample', file_count: count }] : [],
              }
            : path === '/ads/counts'
              ? {
                  station_files_held: count,
                  unique_file_contents: count,
                  files_with_approved_copy: count,
                  text_read_failures: 0,
                  download_failures: 0,
                  checked_connection_files: count,
                }
              : { stations: [] },
        ),
      );
      await act(async () =>
        root.render(
          <TVSession.Provider value={{ token: 'one', denied: vi.fn() }}>
            <TVLanding params={{ q: 'sample' }} onParams={vi.fn()} />
          </TVSession.Provider>,
        ),
      );
      expect(mount.querySelector('.tv-result-count')?.textContent).toBe(
        `${count} ${count === 1 ? 'file' : 'files'}`,
      );
      expect(mount.textContent).toContain(
        `${count} ${count === 1 ? 'file has' : 'files have'} a checked connection`,
      );
      if (count === 0) {
        expect(mount.textContent).toContain('No station files match “sample”');
        expect(mount.textContent).toContain(
          'Try a shorter part of the name or number, or a different spelling',
        );
      }
    },
  );
  it('identifies each exact printed name before its payment search and keeps saved version details in the menu', async () => {
    request.mockResolvedValue({
      key: 'file',
      name: 'Safe record',
      copy_status: 'approved',
      version_id: 'a',
      page_count: 1,
      pages: [],
      versions: [
        { id: 'a', first_saved_at: '2026-10-01', status: 'approved' },
        { id: 'b', first_saved_at: '2026-09-01', status: 'approved' },
      ],
      facts: [
        {
          id: 'name',
          kind: 'Advertiser',
          status: 'checked',
          value: 'PRINTED & NAME',
          quote: 'source quote',
          page: 1,
        },
      ],
      dates: [],
      connections: [],
    });
    await act(async () =>
      root.render(
        <TVSession.Provider value={{ token: 'one', denied: vi.fn() }}>
          <TVFile fileKey="file" params={{}} onParams={vi.fn()} notFound={vi.fn()} />
        </TVSession.Provider>,
      ),
    );
    const payments = Array.from(mount.querySelectorAll<HTMLAnchorElement>('a')).find((link) =>
      link.textContent?.includes('Campaign payments with this exact printed name'),
    )!;
    expect(new URL(payments.href).pathname).toBe('/money/payments');
    expect(new URL(payments.href).searchParams.get('name')).toBe('PRINTED & NAME');
    expect(new URL(payments.href).searchParams.get('role')).toBe('vendor');
    expect(payments.parentElement?.textContent).toContain('Advertiser, as printedPRINTED & NAME');
    const versions = mount.querySelector<HTMLButtonElement>('[role=combobox]')!;
    expect(versions.textContent).toContain('1 other saved version');
    await act(async () => versions.click());
    expect(mount.querySelector('[role=listbox]')?.textContent).toContain('First saved');
    expect(mount.querySelector('[role=listbox]')?.textContent).toContain('Upload date unavailable');
  });
  it('keeps the complete identity limit beside agency payments and the printed address role', async () => {
    request.mockResolvedValue({
      key: 'agency',
      name: 'PRINTED NAME',
      payments_href: '/money/payments?name=PRINTED%20NAME&role=vendor',
      groups: [],
      addresses: [{ address: '123 SAMPLE ST', role: 'BILLING OFFICE', evidence: [] }],
    });
    await act(async () =>
      root.render(
        <TVSession.Provider value={{ token: 'one', denied: vi.fn() }}>
          <TVAgency recordKey="agency" notFound={vi.fn()} />
        </TVSession.Provider>,
      ),
    );
    expect(mount.textContent).toContain(
      'A name on a file is the spelling the station printed, and a matching name alone does not establish identity',
    );
    expect(mount.textContent).toContain('Campaign payments with this exact printed name');
    expect(mount.textContent).toContain('Role as printed: BILLING OFFICE');
  });
});

describe('connected reader copy', () => {
  it.each([0, 1, 501])(
    'keeps search scope and result action accurate for %s matches',
    async (count) => {
      request.mockImplementation((path: string) =>
        Promise.resolve(
          path === '/ads/access'
            ? { allowed: true }
            : {
                ...initialBrowse({ q: 'printed' }),
                total: count,
                capped: count > 500,
                page_size: 12,
                years: [],
                categories: [],
                rows: count
                  ? [{ key: 'match', label: 'Printed match', version_id: 'v', copy_id: 'c' }]
                  : [],
              },
        ),
      );
      await act(async () => root.render(<TVAdSearchGroup query="printed" />));
      expect(mount.textContent).toContain('Matches folder labels, checked names, and file text');
      if (count === 0) {
        expect(mount.textContent).toContain('No station file matches this search');
        expect(mount.querySelector('.tv-result-count')).toBeNull();
        expect(mount.textContent).not.toContain('All 0');
      } else {
        expect(mount.querySelector('.tv-result-count')?.textContent).toBe(
          count === 1 ? '1 FILE' : 'MORE THAN 500 FILES',
        );
        expect(mount.textContent).toContain(
          count === 1 ? 'All 1 in TV ad records' : 'The first 500 in TV ad records',
        );
      }
    },
  );
  it('gives a singular exact-name connection and identifies an empty committee separately from name matching', async () => {
    request.mockImplementation((path: string) =>
      Promise.resolve(
        path === '/ads/access'
          ? { allowed: true }
          : path.includes('kind=name')
            ? { agency_key: 'agency', exact_name_count: 1 }
            : { files: [] },
      ),
    );
    await act(async () => root.render(<TVAdConnectionCard kind="name" target="PRINTED NAME" />));
    expect(mount.textContent).toContain('This exact name also appears on 1 station file');
    expect(mount.textContent).not.toContain('1 station files');
    await act(async () =>
      root.render(<TVAdConnectionCard kind="committee" target="123" name="PRINTED NAME" />),
    );
    expect(mount.textContent).toContain(
      'No station file has a checked connection to this committee yet',
    );
    expect(mount.textContent).toContain(
      'A name on a file is the spelling the station printed, and a matching name alone does not establish identity',
    );
  });
});

describe('folder and printed-name retry continuity', () => {
  it.each(['folder', 'agency'])(
    'retains authorized %s data through retry but clears it across records and accounts',
    async (kind) => {
      const first =
        kind === 'folder'
          ? {
              key: 'first',
              station: 'KARE',
              label: 'Original folder',
              year: 2026,
              category: 'State',
              files: [],
              fcc_url: 'https://publicfiles.fcc.gov/',
            }
          : { key: 'first', name: 'Original agency', groups: [], addresses: [] };
      const oldName = kind === 'folder' ? 'Original folder' : 'Original agency';
      const fallback = kind === 'folder' ? 'Station folder' : 'Printed agency name';
      const next =
        kind === 'folder'
          ? { ...first, label: 'Replacement folder' }
          : { ...first, name: 'Replacement agency' };
      const pending = deferred<unknown>();
      const retry = deferred<unknown>();
      const different = deferred<unknown>();
      const account = deferred<unknown>();
      request
        .mockResolvedValueOnce(first)
        .mockReturnValueOnce(pending.promise)
        .mockReturnValueOnce(retry.promise)
        .mockReturnValueOnce(different.promise)
        .mockReturnValueOnce(account.promise);
      const notFound = vi.fn();
      let denied = vi.fn();
      const render = (key = 'first', token = 'one') =>
        root.render(
          <TVSession.Provider value={{ token, denied }}>
            {kind === 'folder' ? (
              <TVFolder recordKey={key} notFound={notFound} />
            ) : (
              <TVAgency recordKey={key} notFound={notFound} />
            )}
          </TVSession.Provider>,
        );
      await act(async () => render());
      expect(mount.querySelector('h1')?.textContent).toContain(oldName);
      denied = vi.fn();
      await act(async () => render());
      expect(mount.querySelector('h1')?.textContent).toContain(oldName);
      expect(mount.querySelector('[role=status]')?.textContent).toBe('Updating records');
      await act(async () => pending.reject(new ApiError(503, 'Temporary')));
      expect(mount.querySelector('h1')?.textContent).toContain(oldName);
      expect(mount.querySelector('[role=alert]')?.textContent).toContain(
        'This is a problem on our side',
      );
      await act(async () => mount.querySelector<HTMLButtonElement>('.tv-error button')!.click());
      expect(mount.querySelector('h1')?.textContent).toContain(oldName);
      await act(async () => retry.resolve(next));
      expect(mount.querySelector('h1')?.textContent).toContain('Replacement');
      expect(mount.querySelector('[role=alert]')).toBeNull();
      await act(async () => render('different'));
      expect(mount.querySelector('h1')?.textContent).toBe(fallback);
      expect(mount.textContent).not.toContain('Replacement');
      await act(async () => different.resolve(first));
      expect(mount.querySelector('h1')?.textContent).toContain(oldName);
      await act(async () => render('different', 'another-account'));
      expect(mount.querySelector('h1')?.textContent).toBe(fallback);
      expect(mount.textContent).not.toContain(oldName);
      await act(async () => account.reject(new ApiError(403, 'Forbidden')));
      expect(mount.textContent).not.toContain(oldName);
      expect(denied).toHaveBeenCalled();
    },
  );
});
