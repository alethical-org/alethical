// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  PROFILE_CLAIM_DRAFT_OFFER_MS,
  claimPageCandidate,
  createProfileClaimDraftTab,
  takeProfileClaimDraftCode,
  type ProfileClaimDraft,
} from '../profileClaimDraft';

const candidate = 'a'.repeat(64);
const other = 'b'.repeat(64);
const origin = 'https://www.alethical.com';
const draft: ProfileClaimDraft = {
  role: 'Candidate',
  link: 'https://example.org/campaign',
  explanation: 'Illustrative private explanation',
  errors: {
    explanation: 'Add more detail about how we can confirm your role (at least 20 characters)',
  },
};

/** Same-site tabs in one process: each message reaches every other open channel. */
function browser() {
  type Channel = {
    onmessage: ((event: { data: unknown }) => void) | null;
    postMessage(message: unknown): void;
    close(): void;
  };
  const open = new Set<Channel>();
  const sent: Record<string, unknown>[] = [];
  const channel = () => {
    const self: Channel = {
      onmessage: null,
      postMessage(message) {
        sent.push(message as Record<string, unknown>);
        for (const peer of open)
          if (peer !== self)
            queueMicrotask(() => peer.onmessage?.({ data: structuredClone(message) }));
      },
      close() {
        open.delete(self);
      },
    };
    open.add(self);
    return self;
  };
  let clock = 0;
  let count = 0;
  const tab = () =>
    createProfileClaimDraftTab({
      openChannel: channel,
      now: () => clock,
      newCode: () => `00000000-0000-4000-8000-${String(++count).padStart(12, '0')}`,
    });
  return { tab, raw: channel, sent, advance: (ms: number) => (clock += ms) };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

async function ask(
  tab: ReturnType<ReturnType<typeof browser>['tab']>,
  code: string | null,
  account = 'account-a',
  id = candidate,
  isCurrent = () => true,
) {
  if (!code) return null;
  const answer = tab.request(code, account, id, isCurrent);
  await vi.advanceTimersByTimeAsync(2000);
  return answer;
}

it('hands unsent answers only to the tab opened with the one-time code, once', async () => {
  const site = browser();
  const opener = site.tab();
  opener.save('account-a', candidate, draft);
  const code = opener.offer(candidate);
  expect(code).toMatch(/^[a-f0-9-]{36}$/);
  expect(await ask(site.tab(), code)).toEqual(draft);
  // The code works once.
  expect(await ask(site.tab(), code)).toBeNull();
  // The opener keeps its own answers.
  expect(opener.read('account-a', candidate)).toEqual(draft);
});

it('never answers a tab without the code, even while an offer is waiting', async () => {
  const site = browser();
  const opener = site.tab();
  opener.save('account-a', candidate, draft);
  const code = opener.offer(candidate)!;
  expect(await ask(site.tab(), '00000000-0000-4000-8000-999999999999')).toBeNull();
  expect(site.sent.filter((message) => message.type === 'profile-claim-draft-reply')).toEqual([]);
  // The opened tab can still use its own code.
  expect(await ask(site.tab(), code)).toEqual(draft);
});

it('never answers another account or another candidate, and keeps the offer for the right one', async () => {
  const site = browser();
  const opener = site.tab();
  opener.save('account-a', candidate, draft);
  const code = opener.offer(candidate)!;
  expect(await ask(site.tab(), code, 'account-b')).toBeNull();
  expect(await ask(site.tab(), code, 'account-a', other)).toBeNull();
  expect(await ask(site.tab(), code)).toEqual(draft);
});

it('accepts only while the receiving tab is still the same account with an empty, untouched form', async () => {
  const site = browser();
  const opener = site.tab();
  opener.save('account-a', candidate, draft);
  const code = opener.offer(candidate)!;
  expect(await ask(site.tab(), code, 'account-a', candidate, () => false)).toBeNull();
});

it('forgets answers and offers on sign-out or an account switch', async () => {
  const site = browser();
  const opener = site.tab();
  opener.save('account-a', candidate, draft);
  const code = opener.offer(candidate)!;
  opener.clearAll();
  expect(await ask(site.tab(), code)).toBeNull();
});

it('lets an offer lapse after 2 minutes', async () => {
  const site = browser();
  const opener = site.tab();
  opener.save('account-a', candidate, draft);
  const code = opener.offer(candidate)!;
  site.advance(PROFILE_CLAIM_DRAFT_OFFER_MS + 1);
  expect(await ask(site.tab(), code)).toBeNull();
});

it('offers nothing, and makes no code, for a candidate with no unsent answers', () => {
  const site = browser();
  const opener = site.tab();
  opener.save('account-a', other, draft);
  expect(opener.offer(candidate)).toBeNull();
});

it('offers nothing without a secure random source', () => {
  const opener = createProfileClaimDraftTab({
    openChannel: browser().raw,
    newCode: () => null,
  });
  opener.save('account-a', candidate, draft);
  expect(opener.offer(candidate)).toBeNull();
});

it('ignores a malformed reply, even one carrying the right code', async () => {
  const site = browser();
  const receiving = site.tab();
  const code = '00000000-0000-4000-8000-000000000042';
  const answer = receiving.request(code, 'account-a', candidate, () => true);
  const raw = site.raw();
  const reply = {
    type: 'profile-claim-draft-reply',
    code,
    accountId: 'account-a',
    candidateId: candidate,
  };
  for (const bad of [
    { ...draft, explanation: 42 },
    { ...draft, link: 'x'.repeat(10001) },
    { ...draft, errors: { surprise: 'Not a field' } },
    { ...draft, errors: null },
  ])
    raw.postMessage({ ...reply, draft: bad });
  raw.postMessage({ ...reply, accountId: 'account-b', draft });
  await vi.advanceTimersByTimeAsync(2000);
  expect(await answer).toBeNull();
});

it('recognises only same-site claim page links', () => {
  expect(claimPageCandidate(`/candidates/${candidate}/claim`, origin)).toBe(candidate);
  expect(claimPageCandidate(`${origin}/candidates/${candidate}/claim`, origin)).toBe(candidate);
  expect(claimPageCandidate(`/candidates/features?candidate=${candidate}`, origin)).toBeNull();
  expect(claimPageCandidate(`/candidates/${candidate}`, origin)).toBeNull();
  expect(claimPageCandidate(`/candidates/${candidate}/manage`, origin)).toBeNull();
  expect(
    claimPageCandidate(`https://example.org/candidates/${candidate}/claim`, origin),
  ).toBeNull();
});

it('puts a one-time code on a claim page link only for a new-tab gesture, and puts the address back', async () => {
  const site = browser();
  const opener = site.tab();
  opener.save('account-a', candidate, draft);
  const plain = `/candidates/${candidate}/claim`;
  // A fresh page per case: watchers are installed once per real page.
  const page = document.implementation.createHTMLDocument('claim');
  page.body.innerHTML = `<a id="claim" href="${plain}"><span>Continue</span></a><a id="away" href="https://example.org/">Away</a><a id="features" href="/candidates/features?candidate=${candidate}">Features</a>`;
  opener.watchNewTabGestures(page, location.origin);
  const link = page.querySelector<HTMLAnchorElement>('#claim')!;
  const span = link.querySelector('span')!;
  span.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
  expect(link.getAttribute('href')).toBe(plain);
  for (const event of [
    new MouseEvent('click', { bubbles: true, metaKey: true }),
    new MouseEvent('click', { bubbles: true, ctrlKey: true }),
    new MouseEvent('click', { bubbles: true, shiftKey: true }),
    new MouseEvent('auxclick', { bubbles: true, button: 1 }),
    new MouseEvent('contextmenu', { bubbles: true, button: 2 }),
  ]) {
    span.dispatchEvent(event);
    const href = link.getAttribute('href')!;
    expect(href).toMatch(new RegExp(`^${plain}#claim-draft=[a-f0-9-]{36}$`));
    // The next press puts the link's own address back.
    page.dispatchEvent(new Event('pointerdown'));
    expect(link.getAttribute('href')).toBe(plain);
    // Only the tab opened with that code can receive the answers.
    expect(await ask(site.tab(), href.split('=')[1])).toEqual(draft);
  }
  for (const id of ['#away', '#features']) {
    const element = page.querySelector<HTMLAnchorElement>(id)!;
    const before = element.getAttribute('href');
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true }));
    expect(element.getAttribute('href')).toBe(before);
  }
  // A dismissed link menu leaves no code behind once the offer ends.
  span.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, button: 2 }));
  await vi.advanceTimersByTimeAsync(PROFILE_CLAIM_DRAFT_OFFER_MS);
  expect(link.getAttribute('href')).toBe(plain);
});

it('reads the code once for this candidate’s claim page and removes it from the address', () => {
  const replace = vi.fn();
  const code = '00000000-0000-4000-8000-000000000007';
  const where = {
    pathname: `/candidates/${candidate}/claim`,
    search: '',
    hash: `#claim-draft=${code}`,
  };
  expect(takeProfileClaimDraftCode(candidate, where, replace)).toBe(code);
  expect(replace).toHaveBeenCalledWith(`/candidates/${candidate}/claim`);
  // Another candidate's page gets nothing, but the code still leaves the address.
  replace.mockClear();
  expect(
    takeProfileClaimDraftCode(other, { ...where, hash: `#x=1&claim-draft=${code}` }, replace),
  ).toBeNull();
  expect(replace).toHaveBeenCalledWith(`/candidates/${candidate}/claim#x=1`);
  // A page opened any other way has no code and changes nothing.
  replace.mockClear();
  expect(takeProfileClaimDraftCode(candidate, { ...where, hash: '' }, replace)).toBeNull();
  expect(replace).not.toHaveBeenCalled();
  expect(
    takeProfileClaimDraftCode(candidate, { ...where, hash: '#claim-draft=not-a-code' }, replace),
  ).toBeNull();
});

it('keeps answers out of browser storage and the page history', async () => {
  const setItem = vi.spyOn(Storage.prototype, 'setItem');
  const push = vi.spyOn(history, 'pushState');
  const site = browser();
  const opener = site.tab();
  opener.save('account-a', candidate, draft);
  const code = opener.offer(candidate)!;
  expect(await ask(site.tab(), code)).toEqual(draft);
  expect(setItem).not.toHaveBeenCalled();
  expect(push).not.toHaveBeenCalled();
  expect(location.href).not.toContain('Illustrative');
  expect(
    JSON.stringify(site.sent.filter((m) => m.type === 'profile-claim-draft-request')),
  ).not.toContain('Illustrative');
});

it('keeps 2 tabs with answers for the same candidate apart: each opened tab gets its own opener’s answers', async () => {
  const site = browser();
  const first = site.tab();
  const second = site.tab();
  first.save('account-a', candidate, { ...draft, link: 'https://example.org/first' });
  second.save('account-a', candidate, { ...draft, link: 'https://example.org/second' });
  const firstCode = first.offer(candidate)!;
  const secondCode = second.offer(candidate)!;
  expect(firstCode).not.toBe(secondCode);
  expect((await ask(site.tab(), secondCode))?.link).toBe('https://example.org/second');
  expect((await ask(site.tab(), firstCode))?.link).toBe('https://example.org/first');
  // Neither code works again, and a tab with no code gets nothing from either.
  expect(await ask(site.tab(), firstCode)).toBeNull();
  expect(await ask(site.tab(), secondCode)).toBeNull();
  expect(site.sent.filter((message) => message.type === 'profile-claim-draft-reply')).toHaveLength(
    2,
  );
});

it('hands nothing to a plain tab after the link menu was opened and dismissed', async () => {
  const site = browser();
  const opener = site.tab();
  opener.save('account-a', candidate, draft);
  // A fresh page per case: watchers are installed once per real page.
  const page = document.implementation.createHTMLDocument('claim');
  page.body.innerHTML = `<a id="claim" href="/candidates/${candidate}/claim">Continue</a>`;
  opener.watchNewTabGestures(page, location.origin);
  const link = page.querySelector<HTMLAnchorElement>('#claim')!;
  link.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, button: 2 }));
  page.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  expect(link.getAttribute('href')).toBe(`/candidates/${candidate}/claim`);
  // A claim page opened by typing its address has no code, so it never asks.
  const typed = takeProfileClaimDraftCode(candidate, {
    pathname: `/candidates/${candidate}/claim`,
    search: '',
    hash: '',
  });
  expect(typed).toBeNull();
  expect(site.sent.filter((message) => message.type === 'profile-claim-draft-reply')).toEqual([]);
});
