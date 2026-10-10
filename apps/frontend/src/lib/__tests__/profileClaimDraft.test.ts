// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  PROFILE_CLAIM_DRAFT_OFFER_MS,
  claimPageCandidate,
  createProfileClaimDraftTab,
  type ProfileClaimDraft,
  type ProfileClaimDraftHost,
} from '../profileClaimDraft';

const candidate = 'a'.repeat(64);
const other = 'b'.repeat(64);
const origin = 'https://www.alethical.com';
const claimHref = `/candidates/${candidate}/claim`;
const draft: ProfileClaimDraft = {
  role: 'Candidate',
  link: 'https://example.org/campaign',
  explanation: 'Illustrative private explanation',
  errors: {
    explanation: 'Add more detail about how we can confirm your role (at least 20 characters)',
  },
};

type Handle = { postMessage(message: unknown, targetOrigin: string): void };
type Listener = (event: { data: unknown; origin: string; source: unknown }) => void;

/** Browser windows in one process. A window's handle to another delivers messages to
 * that window with this window as the sender, as postMessage does. */
class FakeWindow {
  listeners = new Set<Listener>();
  handles = new Map<FakeWindow, Handle>();
  opener: FakeWindow | null = null;
  opened: FakeWindow[] = [];
  blocked = false;
  received: unknown[] = [];
  page = { pathname: '/', search: '' };
  constructor(public origin = 'https://www.alethical.com') {}
  handleTo(target: FakeWindow): Handle {
    if (!this.handles.has(target))
      this.handles.set(target, {
        postMessage: (message, targetOrigin) => {
          if (targetOrigin !== target.origin) return;
          const source = target.handleTo(this);
          const data = structuredClone(message);
          target.received.push(data);
          queueMicrotask(() => {
            for (const listener of target.listeners)
              listener({ data, origin: this.origin, source });
          });
        },
      });
    return this.handles.get(target)!;
  }
  host(): ProfileClaimDraftHost {
    return {
      origin: this.origin,
      where: () => this.page,
      open: () => {
        if (this.blocked) return null;
        const child = new FakeWindow(this.origin);
        child.opener = this;
        this.opened.push(child);
        return this.handleTo(child);
      },
      opener: () => (this.opener ? this.handleTo(this.opener) : null),
      forgetOpener: () => {
        this.opener = null;
      },
      listen: (handler) => {
        this.listeners.add(handler);
        return () => this.listeners.delete(handler);
      },
    };
  }
}

let clock = 0;
const tabFor = (window: FakeWindow) =>
  createProfileClaimDraftTab({ host: window.host(), now: () => clock });

beforeEach(() => {
  vi.useFakeTimers();
  clock = 0;
});
afterEach(() => vi.useRealTimers());

async function ask(
  window: FakeWindow,
  account = 'account-a',
  id = candidate,
  isCurrent = () => true,
) {
  const answer = tabFor(window).requestFromOpener(account, id, isCurrent);
  await vi.advanceTimersByTimeAsync(2000);
  return answer;
}

it('hands unsent answers only to the exact window this tab opened, once, and keeps its own', async () => {
  const original = new FakeWindow();
  const tab = tabFor(original);
  tab.save('account-a', candidate, draft);
  expect(tab.openWithAnswers(claimHref)).toBe('opened');
  const [child] = original.opened;
  expect(await ask(child)).toEqual(draft);
  // One exchange: the opened window no longer holds a link to its opener.
  expect(child.opener).toBeNull();
  child.opener = original;
  expect(await ask(child)).toBeNull();
  expect(tab.read('account-a', candidate)).toEqual(draft);
});

it('never answers a window it did not open, even one claiming it as opener', async () => {
  const original = new FakeWindow();
  const tab = tabFor(original);
  tab.save('account-a', candidate, draft);
  tab.openWithAnswers(claimHref);
  const stranger = new FakeWindow();
  stranger.opener = original;
  expect(await ask(stranger)).toBeNull();
  // A plain tab has no opener at all and never asks.
  const plain = new FakeWindow();
  expect(await ask(plain)).toBeNull();
  expect(plain.received).toEqual([]);
  // The opened window still receives.
  expect(await ask(original.opened[0])).toEqual(draft);
});

it('keeps 2 tabs with answers for the same candidate apart', async () => {
  const first = new FakeWindow();
  const second = new FakeWindow();
  const firstTab = tabFor(first);
  const secondTab = tabFor(second);
  firstTab.save('account-a', candidate, { ...draft, link: 'https://example.org/first' });
  secondTab.save('account-a', candidate, { ...draft, link: 'https://example.org/second' });
  firstTab.openWithAnswers(claimHref);
  secondTab.openWithAnswers(claimHref);
  expect((await ask(second.opened[0]))?.link).toBe('https://example.org/second');
  expect((await ask(first.opened[0]))?.link).toBe('https://example.org/first');
});

it('never answers another account or another candidate', async () => {
  const original = new FakeWindow();
  const tab = tabFor(original);
  tab.save('account-a', candidate, draft);
  tab.openWithAnswers(claimHref);
  const child = original.opened[0];
  expect(await ask(child, 'account-b')).toBeNull();
  child.opener = original;
  expect(await ask(child, 'account-a', other)).toBeNull();
  child.opener = original;
  expect(await ask(child)).toEqual(draft);
});

it('accepts only while the opened window is still the same account, eligible and untouched', async () => {
  const original = new FakeWindow();
  const tab = tabFor(original);
  tab.save('account-a', candidate, draft);
  tab.openWithAnswers(claimHref);
  expect(await ask(original.opened[0], 'account-a', candidate, () => false)).toBeNull();
});

it('forgets answers and offers on sign-out or an account switch', async () => {
  const original = new FakeWindow();
  const tab = tabFor(original);
  tab.save('account-a', candidate, draft);
  tab.openWithAnswers(claimHref);
  tab.clearAll();
  expect(await ask(original.opened[0])).toBeNull();
});

it('lets an offer lapse after 2 minutes, however slowly the opened page loads', async () => {
  const original = new FakeWindow();
  const tab = tabFor(original);
  tab.save('account-a', candidate, draft);
  tab.openWithAnswers(claimHref);
  clock += PROFILE_CLAIM_DRAFT_OFFER_MS - 1;
  const slow = original.opened[0];
  expect(await ask(slow)).toEqual(draft);
  tab.openWithAnswers(claimHref);
  clock += PROFILE_CLAIM_DRAFT_OFFER_MS + 1;
  expect(await ask(original.opened[1])).toBeNull();
});

it('opens nothing for a candidate with no unsent answers', () => {
  const original = new FakeWindow();
  const tab = tabFor(original);
  tab.save('account-a', other, draft);
  expect(tab.holds(claimHref)).toBe(false);
  expect(tab.openWithAnswers(claimHref)).toBeNull();
  expect(original.opened).toEqual([]);
});

it('reports a refused window', () => {
  const original = new FakeWindow();
  original.blocked = true;
  const tab = tabFor(original);
  tab.save('account-a', candidate, draft);
  expect(tab.openWithAnswers(claimHref)).toBe('blocked');
});

it('ignores replies that are malformed, from another sender or for someone else', async () => {
  const original = new FakeWindow();
  const child = new FakeWindow();
  child.opener = original;
  const answer = tabFor(child).requestFromOpener('account-a', candidate, () => true);
  const reply = {
    type: 'alethical-profile-claim-draft-reply',
    accountId: 'account-a',
    candidateId: candidate,
  };
  const fromOpener = original.handleTo(child);
  for (const bad of [
    { ...draft, explanation: 42 },
    { ...draft, errors: { surprise: 'Not a field' } },
    { ...draft, errors: null },
  ])
    fromOpener.postMessage({ ...reply, draft: bad }, origin);
  fromOpener.postMessage({ ...reply, accountId: 'account-b', draft }, origin);
  // A well-formed reply from any window other than the opener is ignored.
  new FakeWindow().handleTo(child).postMessage({ ...reply, draft }, origin);
  // As is one from another site.
  new FakeWindow('https://example.org').handleTo(child).postMessage({ ...reply, draft }, origin);
  await vi.advanceTimersByTimeAsync(2000);
  expect(await answer).toBeNull();
});

it('recognises only same-site claim page links', () => {
  expect(claimPageCandidate(claimHref, origin)).toBe(candidate);
  expect(claimPageCandidate(`${origin}${claimHref}`, origin)).toBe(candidate);
  expect(claimPageCandidate(`/candidates/features?candidate=${candidate}`, origin)).toBeNull();
  expect(claimPageCandidate(`/candidates/${candidate}`, origin)).toBeNull();
  expect(claimPageCandidate(`/candidates/${candidate}/manage`, origin)).toBeNull();
  expect(claimPageCandidate(`https://example.org${claimHref}`, origin)).toBeNull();
});

const featuresPage = { pathname: '/candidates/features', search: `?candidate=${candidate}` };
it('takes over Ctrl/Cmd-click (with or without Shift) and middle click only on the features page return links', () => {
  const original = new FakeWindow(location.origin);
  original.page = featuresPage;
  const tab = tabFor(original);
  const page = document.implementation.createHTMLDocument('features');
  page.body.innerHTML = `<a id="back" href="${claimHref}">Go back</a><a id="claim" href="${claimHref}"><span>Continue claiming this candidate profile</span></a><a id="other" href="/candidates/${other}/claim">Other</a><a id="away" href="https://example.org/">Away</a>`;
  tab.watchNewTabGestures(page);
  const fire = (selector: string, type: string, init: MouseEventInit) => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, ...init });
    page.querySelector(selector)!.dispatchEvent(event);
    return event.defaultPrevented;
  };
  // No answers held: every gesture stays the browser's own.
  expect(fire('#claim span', 'click', { metaKey: true })).toBe(false);
  expect(original.opened).toHaveLength(0);
  tab.save('account-a', candidate, draft);
  expect(fire('#claim span', 'click', { button: 0 })).toBe(false);
  // A plain Shift-click stays the browser's new window; the link menu stays native.
  expect(fire('#claim span', 'click', { shiftKey: true })).toBe(false);
  expect(fire('#claim span', 'contextmenu', { button: 2 })).toBe(false);
  expect(original.opened).toHaveLength(0);
  expect(fire('#claim span', 'click', { metaKey: true })).toBe(true);
  expect(fire('#claim span', 'click', { ctrlKey: true })).toBe(true);
  expect(fire('#claim span', 'click', { metaKey: true, shiftKey: true })).toBe(true);
  expect(fire('#claim span', 'click', { ctrlKey: true, shiftKey: true })).toBe(true);
  expect(fire('#back', 'auxclick', { button: 1 })).toBe(true);
  expect(fire('#back', 'click', { metaKey: true })).toBe(true);
  expect(original.opened).toHaveLength(6);
  // Another candidate's claim link and other sites stay native.
  expect(fire('#other', 'click', { metaKey: true })).toBe(false);
  expect(fire('#away', 'click', { metaKey: true })).toBe(false);
  expect(original.opened).toHaveLength(6);
});

it('leaves claim links alone anywhere but the features page for that candidate', () => {
  const original = new FakeWindow(location.origin);
  const tab = tabFor(original);
  tab.save('account-a', candidate, draft);
  const page = document.implementation.createHTMLDocument('profile');
  page.body.innerHTML = `<a id="claim" href="${claimHref}">Claim this candidate profile</a>`;
  tab.watchNewTabGestures(page);
  const fire = () => {
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, metaKey: true });
    page.querySelector('#claim')!.dispatchEvent(event);
    return event.defaultPrevented;
  };
  for (const where of [
    { pathname: `/candidates/${candidate}`, search: '' },
    { pathname: `/candidates/${candidate}/claim`, search: '' },
    { pathname: '/candidates/features', search: '' },
    { pathname: '/candidates/features', search: `?candidate=${other}` },
  ]) {
    original.page = where;
    expect(fire()).toBe(false);
  }
  expect(original.opened).toHaveLength(0);
});

it('hands over answers of any length, with their errors, exactly as typed', async () => {
  const original = new FakeWindow();
  const tab = tabFor(original);
  const long = {
    role: 'Authorized campaign representative',
    link: `https://example.org/${'l'.repeat(10050)}`,
    explanation: `Illustrative ${'e'.repeat(10050)}`,
    errors: {
      link: 'Use a web address with no more than 2000 characters',
      explanation: 'Keep your explanation to 1900 characters or fewer',
    },
  };
  tab.save('account-a', candidate, long);
  tab.openWithAnswers(claimHref);
  expect(await ask(original.opened[0])).toEqual(long);
  expect(tab.read('account-a', candidate)).toEqual(long);
});

it('keeps the reader in this tab, with the answers, when the browser refuses the window', () => {
  const original = new FakeWindow(location.origin);
  original.blocked = true;
  const tab = tabFor(original);
  tab.save('account-a', candidate, draft);
  original.page = featuresPage;
  const page = document.implementation.createHTMLDocument('features');
  page.body.innerHTML = `<a id="claim" href="${claimHref}">Continue claiming this candidate profile</a>`;
  const link = page.querySelector<HTMLAnchorElement>('#claim')!;
  const plainClicks: boolean[] = [];
  link.addEventListener('click', (event) => plainClicks.push(event.metaKey));
  tab.watchNewTabGestures(page);
  const event = new MouseEvent('click', { bubbles: true, cancelable: true, metaKey: true });
  link.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  // The fallback is a plain click, which the link's own handler turns into an in-app move.
  expect(plainClicks).toEqual([false, true]);
});

it('keeps answers out of browser storage, the address and the page history', async () => {
  const setItem = vi.spyOn(Storage.prototype, 'setItem');
  const push = vi.spyOn(history, 'pushState');
  const replace = vi.spyOn(history, 'replaceState');
  const original = new FakeWindow();
  const tab = tabFor(original);
  tab.save('account-a', candidate, draft);
  tab.openWithAnswers(claimHref);
  const child = original.opened[0];
  expect(await ask(child)).toEqual(draft);
  expect(setItem).not.toHaveBeenCalled();
  expect(push).not.toHaveBeenCalled();
  expect(replace).not.toHaveBeenCalled();
  // The request carries only the public candidate id and the account it is for.
  expect(JSON.stringify(original.received)).not.toContain('Illustrative');
});
