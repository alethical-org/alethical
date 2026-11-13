import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PageImage } from '../pages/media/shared';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const session = {
  apiBaseUrl: 'https://api.example.test',
  accessToken: 'account-a',
};
vi.mock('../auth/session', () => ({ useFinanceSession: () => session }));
let host: HTMLDivElement;
let root: Root;
let fetcher: ReturnType<typeof vi.fn>;
const version = 'a'.repeat(64);
async function show(page = 2, inside = true, savedVersion = version) {
  await act(async () => {
    root.render(
      <PageImage
        fileKey="station-file"
        version={savedVersion}
        page={page}
        alt={`Page ${page}`}
        failure={{
          text: 'Couldn’t load page image',
          retry: 'Retry image',
          inside,
        }}
      />,
    );
  });
}
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  session.accessToken = 'account-a';
  session.apiBaseUrl = 'https://api.example.test';
  let image = 0;
  URL.createObjectURL = vi.fn(() => `blob:page-${++image}`);
  URL.revokeObjectURL = vi.fn();
  fetcher = vi.fn(
    async () =>
      new Response('invalid image', {
        headers: { 'Content-Type': 'image/png' },
      }),
  );
  vi.stubGlobal('fetch', fetcher);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
it.each([true, false])(
  'offers the existing retry after image decode failure (inside=%s)',
  async (inside) => {
    await show(2, inside);
    await act(async () => host.querySelector('img')!.dispatchEvent(new Event('error')));
    expect(host.textContent).toContain('Couldn’t load page image');
    expect(host.querySelector('img')).toBeNull();
    const retry = host.querySelector('button')!;
    expect(retry.textContent).toContain(inside ? 'Try again' : 'Retry image');
    await act(async () => retry.click());
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[1][0]).toBe(fetcher.mock.calls[0][0]);
    expect(String(fetcher.mock.calls[1][0])).toContain(`/pages/2?version=${version}`);
    expect(fetcher.mock.calls[1][1].headers).toEqual({
      Authorization: 'Bearer account-a',
    });
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:page-1');
    expect(host.querySelector('img')?.getAttribute('src')).toBe('blob:page-2');
    await act(async () => host.querySelector('img')!.dispatchEvent(new Event('load')));
    expect(host.textContent).not.toContain('couldn’t');
  },
);
it('does not carry a failed image into another page, version context or account', async () => {
  await show(2);
  const old = host.querySelector('img')!;
  await show(1);
  await act(async () => old.dispatchEvent(new Event('error')));
  expect(host.querySelector('img')?.getAttribute('alt')).toBe('Page 1');
  expect(host.textContent).not.toContain('couldn’t');
  session.accessToken = 'account-b';
  await show(1);
  expect(fetcher.mock.calls.at(-1)![1].headers).toEqual({
    Authorization: 'Bearer account-b',
  });
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:page-2');
});

it.each([403, 500])('uses retry for a failed request (%s)', async (status) => {
  fetcher.mockResolvedValueOnce(new Response('Unavailable', { status }));
  await show();
  expect(host.textContent).toContain('Couldn’t load page image');
  expect(host.querySelector('img')).toBeNull();
});
it('replaces an image when the saved version or API source changes', async () => {
  await show();
  await show(2, true, 'b'.repeat(64));
  expect(String(fetcher.mock.calls.at(-1)![0])).toContain(`version=${'b'.repeat(64)}`);
  session.apiBaseUrl = 'https://another.example.test';
  await show(2, true, 'b'.repeat(64));
  expect(String(fetcher.mock.calls.at(-1)![0])).toContain('https://another.example.test/');
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:page-1');
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:page-2');
});
