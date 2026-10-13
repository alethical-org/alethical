import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { initializeWebHistory, pushWebHistory, currentWebHistoryEntry } from '../webHistory';
import {
  resolveReturnDestination,
  canRestoreReturnDestination,
  rememberReturnPageName,
  returnPageName,
  forgetReturnPageName,
  rememberReturnPageAlias,
  setReturnAccess,
} from '../returnDestination';
import { safeReturnPath, safeAccountReturnPath } from '../returnPageNames';

let dom: JSDOM;
beforeEach(() => {
  dom = new JSDOM('', { url: 'https://alethical.test/bills?q=schools&page=2' });
  vi.stubGlobal('window', dom.window);
  setReturnAccess(null, false);
  initializeWebHistory();
});
afterEach(() => {
  dom.window.close();
  vi.unstubAllGlobals();
});

describe('truthful return destinations', () => {
  it('keeps a named direct-entry fallback without inventing previous history', () => {
    expect(resolveReturnDestination('/legislators', 'Search legislators')).toEqual({
      href: '/legislators',
      name: 'Search legislators',
    });
  });
  it('advertises the same filtered source that an ordinary history return opens', () => {
    pushWebHistory('/legislators/example');
    const destination = resolveReturnDestination('/legislators', 'Search legislators');
    expect(destination).toMatchObject({ href: '/bills?q=schools&page=2', name: 'Search bills' });
    expect(canRestoreReturnDestination(destination)).toBe(true);
    pushWebHistory('/money');
    expect(canRestoreReturnDestination(destination)).toBe(false);
  });
  it('records only the served public name of a previous profile', () => {
    pushWebHistory('/legislators/example-person');
    rememberReturnPageName('/legislators/example-person', 'Rep. Example Person');
    pushWebHistory('/bills/example-bill');
    expect(resolveReturnDestination('/bills', 'Search bills')).toMatchObject({
      href: '/legislators/example-person',
      name: 'Rep. Example Person',
    });
  });
  it('uses the list when an earlier entity was never named', () => {
    pushWebHistory('/legislators/unknown-person');
    pushWebHistory('/bills/example-bill');
    expect(resolveReturnDestination('/bills', 'Search bills')).toEqual({
      href: '/bills',
      name: 'Search bills',
    });
  });
  it.each([
    '/admin/users',
    '/confirm',
    '/candidates/example/manage',
    '/candidates?address=private',
    '/blog/guides?token=private',
    '//outside.test/path',
    '/blog/guides?from=%2Fconfirm%3Fcode%3Dprivate',
  ])('does not save protected or unsafe source %s', (path) => {
    if (path.startsWith('//')) window.history.replaceState(window.history.state, '', '/unknown');
    if (path.startsWith('/') && !path.startsWith('//'))
      window.history.replaceState(window.history.state, '', path);
    expect(safeReturnPath(path)).toBeNull();
    pushWebHistory('/bills/example-bill');
    expect(resolveReturnDestination('/bills', 'Search bills')).toEqual({
      href: '/bills',
      name: 'Search bills',
    });
  });
  it('does not change the name of a search destination when filters change', () => {
    expect(returnPageName('/bills?q=schools')).toBe('Search bills');
    expect(returnPageName('/legislators?tab=money&party=DFL')).toBe('Search legislators');
    expect(returnPageName('/money/search?q=Example')).toBe('money search');
  });
  it('distinguishes the outside-spending directory from individual subjects', () => {
    rememberReturnPageName(
      '/money/outside-spending?spender=10&year=2026',
      'Outside spending by Example Group',
    );
    expect(returnPageName('/money/outside-spending?spender=10&year=2025')).toBe(
      'Outside spending by Example Group',
    );
    expect(returnPageName('/money/outside-spending?about=10')).toBeNull();
    expect(returnPageName('/money/outside-spending')).toBe('Outside spending');
  });
  it('rejects damaged or mismatched prior-entry metadata', () => {
    pushWebHistory('/legislators/example');
    const entry = currentWebHistoryEntry()!;
    for (const returnTo of [
      {},
      { ...entry.returnTo, href: '//outside.test' },
      { ...entry.returnTo, depth: 100 },
      { ...entry.returnTo, sessionId: 'other' },
    ]) {
      window.history.replaceState({ __alethical: { ...entry, returnTo } }, '');
      expect(resolveReturnDestination('/legislators', 'Search legislators')).toEqual({
        href: '/legislators',
        name: 'Search legislators',
      });
    }
  });
  it('continues with memory-only history when browser storage is unavailable', () => {
    vi.spyOn(dom.window.Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(dom.window.Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    pushWebHistory('/legislators/example');
    expect(resolveReturnDestination('/legislators', 'Search legislators').name).toBe(
      'Search bills',
    );
  });
});

describe('protected context and missing records', () => {
  it('keeps an allowed admin source only in memory and clears it on account or access change', () => {
    setReturnAccess('test-account-a', true);
    window.history.replaceState(window.history.state, '', '/admin/users');
    rememberReturnPageName('/admin/users', 'Users');
    pushWebHistory('/admin/operations');
    expect(resolveReturnDestination('/', 'Home')).toMatchObject({
      href: '/admin/users',
      name: 'Users',
    });
    expect(window.history.state.__alethical.returnTo).toBeUndefined();
    setReturnAccess('test-account-a', false);
    expect(resolveReturnDestination('/', 'Home')).toEqual({ href: '/', name: 'Home' });
    setReturnAccess('test-account-b', true);
    expect(resolveReturnDestination('/', 'Home')).toEqual({ href: '/', name: 'Home' });
  });
  it('keeps an established signed-out claim context, but not across sign-in', () => {
    const claimPath = `/candidates/${'a'.repeat(64)}/claim`;
    window.history.replaceState(window.history.state, '', claimPath);
    rememberReturnPageName(claimPath, 'Example Candidate’s profile claim');
    pushWebHistory('/candidates/features');
    expect(resolveReturnDestination('/candidates', 'Find my candidates')).toMatchObject({
      href: claimPath,
      name: 'Example Candidate’s profile claim',
    });
    setReturnAccess('test-account-a', false);
    expect(resolveReturnDestination('/candidates', 'Find my candidates')).toEqual({
      href: '/candidates',
      name: 'Find my candidates',
    });
  });
  it('retains recognized admin identifiers and profile context through the owning route', () => {
    setReturnAccess('test-account-a', true);
    const candidate = 'b'.repeat(64);
    const claim = '11111111-2222-4333-8444-555555555555';
    const source = `/admin/candidate-claims?claim=${claim}&candidate=${candidate}&from=profile&page=2`;
    const expected = `/admin/candidate-claims?candidate=${candidate}&claim=${claim}&from=profile`;
    expect(safeAccountReturnPath(source)).toBe(expected);
    window.history.replaceState(window.history.state, '', source);
    rememberReturnPageName(source, 'Review profile claim request');
    pushWebHistory('/about/contact');
    expect(resolveReturnDestination('/', 'Home')).toMatchObject({
      href: expected,
      name: 'Review profile claim request',
    });
    expect(window.history.state.__alethical.returnTo).toBeUndefined();
  });
  it('drops ignored values and recognizes protected aliases without changing their named page', () => {
    setReturnAccess('test-account-a', true);
    expect(safeAccountReturnPath('/admin/?candidate=ignored&page=2')).toBe('/admin/users');
    expect(safeAccountReturnPath('/admin/site-metrics?claim=ignored')).toBe('/admin/site-metrics');
    expect(safeAccountReturnPath(`/candidates/${'c'.repeat(64)}/manage?page=2`)).toBe(
      `/candidates/${'c'.repeat(64)}/manage`,
    );
    expect(safeAccountReturnPath('/candidates/unknown/claim')).toBeNull();
  });
  it('refuses nested private input and sensitive fields instead of copying them into account returns', () => {
    setReturnAccess('test-account-a', true);
    for (const source of [
      '/admin/candidate-claims?from=%2Fconfirm%3Fcode%3Dfixture-code',
      '/admin/users?token=fixture-token',
      '/email-preferences?address=fixture-address',
    ]) {
      expect(safeAccountReturnPath(source)).toBeNull();
      window.history.replaceState(window.history.state, '', source);
      pushWebHistory('/about/contact');
      expect(resolveReturnDestination('/', 'Home')).toEqual({ href: '/', name: 'Home' });
    }
  });
  it('requires the current account and administrator scope after protected-route normalization', () => {
    const claimPath = `/candidates/${'d'.repeat(64)}/claim`;
    expect(safeAccountReturnPath(claimPath)).toBe(claimPath);
    expect(safeAccountReturnPath(claimPath.replace('/claim', '/manage'))).toBeNull();
    expect(safeAccountReturnPath('/admin/')).toBeNull();
    setReturnAccess('test-account-a', false);
    expect(safeAccountReturnPath('/admin/site-metrics')).toBeNull();
    expect(safeAccountReturnPath('/tracked')).toBe('/tracked');
  });
  it('invalidates old saved history and explicit served aliases when a record is confirmed missing', () => {
    rememberReturnPageName('/legislators/example-alias', 'Rep. Example');
    rememberReturnPageName('/legislators/example-canonical', 'Rep. Example');
    rememberReturnPageAlias('/legislators/example-alias', '/legislators/example-canonical');
    window.history.replaceState(window.history.state, '', '/legislators/example-alias');
    pushWebHistory('/bills/example');
    forgetReturnPageName('/legislators/example-canonical');
    expect(returnPageName('/legislators/example-alias')).toBeNull();
    expect(resolveReturnDestination('/bills', 'Search bills')).toEqual({
      href: '/bills',
      name: 'Search bills',
    });
  });
  it('preserves all registered bill-search filters', () => {
    const path = '/bills?topic=education&scope=all&omnibus=1&q=schools&page=2';
    window.history.replaceState(window.history.state, '', path);
    pushWebHistory('/bills/example');
    const destination = resolveReturnDestination('/bills', 'Search bills');
    const retained = new URL(destination.href, 'https://alethical.test');
    expect(destination.name).toBe('Search bills');
    expect(retained.pathname).toBe('/bills');
    expect(Object.fromEntries(retained.searchParams)).toEqual({
      topic: 'education',
      scope: 'all',
      omnibus: '1',
      q: 'schools',
      page: '2',
    });
  });
  it('keeps a served public source when ignored tracking input is present after the resolver loads', () => {
    const path = '/bills/warm-capture-fixture?utm_source=fixture&tab=votes';
    rememberReturnPageName(path, 'HF 719');
    window.history.replaceState(window.history.state, '', path);
    pushWebHistory('/legislators/example');
    expect(resolveReturnDestination('/legislators', 'Search legislators')).toMatchObject({
      href: '/bills/warm-capture-fixture?tab=votes',
      name: 'HF 719',
    });
    expect(window.history.state.__alethical.returnTo.href).not.toContain('utm_source');
  });
  it('still refuses private fields in a recognized warm public source with harmless extra input', () => {
    const path = '/bills/warm-private-fixture?utm_source=fixture&code=fixture-code';
    expect(safeReturnPath(path)).toBeNull();
    rememberReturnPageName('/bills/warm-private-fixture', 'HF 720');
    window.history.replaceState(window.history.state, '', path);
    pushWebHistory('/legislators/example');
    expect(resolveReturnDestination('/legislators', 'Search legislators')).toEqual({
      href: '/legislators',
      name: 'Search legislators',
    });
  });
  it.each(['/bills/%', '/legislators/%'])(
    'refuses malformed public route encoding without throwing: %s',
    (path) => {
      expect(safeReturnPath(path)).toBeNull();
    },
  );
});
