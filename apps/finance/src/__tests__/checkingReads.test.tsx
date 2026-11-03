import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { clearReadCache } from '../api/read';
import { StationCheckRead, type PreparedFact } from '../pages/checking/StationRead';
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock('../auth/session', () => ({
  useFinanceSession: () => ({ apiBaseUrl: 'https://api.example.test', accessToken: 'token' }),
}));
vi.mock('../pages/media/shared', async () => ({
  ...(await vi.importActual('../pages/media/shared')),
  PageImage: () => <div>Page image</div>,
}));
let container: HTMLDivElement, root: Root;
beforeEach(() => {
  clearReadCache();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  window.history.replaceState(null, '', '/media-buys/check');
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
const json = (data: unknown) =>
  new Response(JSON.stringify({ data }), { headers: { 'Content-Type': 'application/json' } });
async function flush() {
  for (let i = 0; i < 5; i++)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
}
it('prepares exact-version suggestions without a write, and resets a draft when changing files', async () => {
  const requests: Array<{ url: URL; method: string }> = [];
  const file = {
    key: 'one',
    name: 'First file',
    station: 'KARE',
    year: 2026,
    folder: { key: 'f', label: 'Folder' },
    version_id: 'v1',
    page_count: 2,
    pages: [{ number: 1, text: 'Exact page quote' }],
    versions: [],
  };
  let prepared: PreparedFact | null = null;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init: RequestInit) => {
      const url = new URL(input);
      requests.push({ url, method: init?.method ?? 'GET' });
      if (url.pathname.endsWith('/queue'))
        return json({
          rows: [
            { ...file, saved_at: '2026-10-29', suggestion_count: 1, reasons: [] },
            {
              ...file,
              key: 'two',
              name: 'Second file',
              version_id: 'v2',
              saved_at: '2026-10-29',
              suggestion_count: 0,
              reasons: [],
            },
          ],
          total: 2,
          offset: 0,
          limit: 20,
        });
      if (url.pathname.endsWith('/sources')) return json({ stations: [] });
      if (url.pathname.endsWith('/suggestions'))
        return json({
          key: 'one',
          version_id: 'v1',
          facts: [
            {
              field: 'payer',
              machine_field: 'payer',
              value: 'Example Payer',
              page: 1,
              pages: [1],
              quote: 'Exact page quote',
              in_source_text: true,
              already_checked: false,
            },
          ],
        });
      return json(
        url.pathname.endsWith('/two')
          ? { ...file, key: 'two', name: 'Second file', version_id: 'v2' }
          : file,
      );
    }),
  );
  await act(async () =>
    root.render(
      <StationCheckRead
        renderForm={(_file, next) => {
          prepared = next;
          return null;
        }}
      />,
    ),
  );
  await flush();
  await act(async () =>
    [...container.querySelectorAll('button')]
      .find((b) => b.textContent === 'Use suggestion')!
      .click(),
  );
  await flush();
  expect(prepared).toMatchObject({
    file_key: 'one',
    version_id: 'v1',
    suggestion: { quote: 'Exact page quote', page: 1 },
  });
  expect(
    requests
      .filter((r) => r.url.pathname.endsWith('/suggestions'))
      .every((r) => r.url.searchParams.get('version') === 'v1'),
  ).toBe(true);
  await act(async () =>
    [...container.querySelectorAll<HTMLButtonElement>('.ck-queue-item')]
      .find((b) => b.textContent?.includes('Second file'))!
      .click(),
  );
  await flush();
  expect(prepared).toBeNull();
  expect(requests.every((r) => r.method === 'GET')).toBe(true);
});
