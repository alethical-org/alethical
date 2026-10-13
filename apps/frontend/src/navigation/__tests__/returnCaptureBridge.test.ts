import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { PUBLISHED_PIECE_INDEX, pieceAddressFolder } from '../../lib/researchIndex';

let dom: JSDOM;
beforeEach(() => {
  vi.resetModules();
  dom = new JSDOM('', { url: 'https://alethical.test/bills?q=schools&page=2' });
  vi.stubGlobal('window', dom.window);
});
afterEach(() => {
  dom.window.close();
  vi.unstubAllGlobals();
});

it('captures a filtered list immediately and resolves its name only when the detail module loads', async () => {
  const history = await import('../webHistory');
  history.initializeWebHistory();
  history.pushWebHistory('/legislators/example');
  expect(history.currentWebHistoryEntry()?.returnTo).toMatchObject({
    href: '/bills?q=schools&page=2',
  });
  expect(history.currentWebHistoryEntry()?.returnTo?.name).toBeUndefined();
  const { resolveReturnDestination } = await import('../returnDestination');
  expect(resolveReturnDestination('/legislators', 'Search legislators')).toMatchObject({
    href: '/bills?q=schools&page=2',
    name: 'Search bills',
  });
});

it('resolves a cold published article source for Contact without prior record-module warmup', async () => {
  const piece = PUBLISHED_PIECE_INDEX[0];
  const source = `/blog/${pieceAddressFolder(piece)}/${piece.slug}?from=${encodeURIComponent('/blog/guides?page=1')}`;
  window.history.replaceState({}, '', source);
  const history = await import('../webHistory');
  history.initializeWebHistory();
  history.pushWebHistory('/about/contact');
  expect(history.currentWebHistoryEntry()?.returnTo).toMatchObject({ href: source });
  expect(history.currentWebHistoryEntry()?.returnTo?.name).toBeUndefined();
  const { resolveReturnDestination } = await import('../returnDestination');
  expect(resolveReturnDestination('/', 'Home')).toMatchObject({ href: source, name: piece.title });
});

it('never captures unknown routes, private addresses or account editors before registration', async () => {
  const { capturePageReturn } = await import('../returnCaptureBridge');
  for (const source of [
    '/unknown',
    '/admin/users',
    '/candidates/example/claim',
    '/candidates?address=private',
    '/bills?token=private',
    '/blog/guides?from=%2Fconfirm%3Fcode%3Dprivate',
  ])
    expect(capturePageReturn(source), source).toBeNull();
});

it('notifies existing controls only when account scope or readiness actually changes', async () => {
  const { setReturnAccess } = await import('../returnCaptureBridge');
  const listener = vi.fn();
  window.addEventListener('alethical-return-context', listener);
  setReturnAccess(null, false, false);
  expect(listener).not.toHaveBeenCalled();
  setReturnAccess('account-a', false);
  setReturnAccess('account-a', false);
  expect(listener).toHaveBeenCalledTimes(1);
  setReturnAccess('account-a', false, false);
  setReturnAccess('account-a', false, false);
  expect(listener).toHaveBeenCalledTimes(2);
  setReturnAccess('account-a', false);
  expect(listener).toHaveBeenCalledTimes(3);
});

it('restores already saved cold public context after a reload without saving unsupported fields', async () => {
  window.history.replaceState(
    {},
    '',
    '/bills?q=schools&chamber=house&scope=name&page=2&unknown=private',
  );
  let history = await import('../webHistory');
  history.initializeWebHistory();
  history.pushWebHistory('/about/contact');
  expect(history.currentWebHistoryEntry()?.returnTo?.href).not.toContain('unknown');
  vi.resetModules();
  history = await import('../webHistory');
  const { resolveReturnDestination } = await import('../returnDestination');
  const result = resolveReturnDestination('/', 'Home');
  expect(result.name).toBe('Search bills');
  expect(new URL(result.href, 'https://alethical.test').searchParams).toEqual(
    new URLSearchParams('q=schools&scope=name&chamber=house&page=2'),
  );
  expect(history.currentWebHistoryEntry()?.returnTo?.href).toBe(result.href);
});

it.each([
  ['/legislators?q=Example&tab=money&party=DFL&page=2', 'q'],
  ['/money/committees?q=Example&kind=party_unit&page=2', 'kind'],
  ['/money/races?year=2024&office=house&q=Example', 'office'],
  ['/money/outside-spending?browse=groups&year=2024&q=Example&page=2', 'browse'],
])('keeps actual route-owned list state before a resolver loads: %s', async (source, key) => {
  const { capturePageReturn } = await import('../returnCaptureBridge');
  const captured = capturePageReturn(source);
  expect(captured).not.toBeNull();
  const retained = new URL(captured!.href, 'https://alethical.test').searchParams;
  expect(retained.get(key)).toBe(new URL(source, 'https://alethical.test').searchParams.get(key));
  expect(retained.get('q')).toBe('Example');
});
