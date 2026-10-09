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
    { ...draft, link: 'x'.repeat(10001) },
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

it('takes over only Ctrl/Cmd-click and middle click on a claim link it holds answers for', () => {
  const original = new FakeWindow(location.origin);
  const tab = tabFor(original);
  const page = document.implementation.createHTMLDocument('claim');
  page.body.innerHTML = `<a id="claim" href="${claimHref}"><span>Claim</span></a><a id="away" href="https://example.org/">Away</a>`;
  tab.watchNewTabGestures(page);
  const span = page.querySelector('#claim span')!;
  const fire = (type: string, init: MouseEventInit) => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, ...init });
    span.dispatchEvent(event);
    return event.defaultPrevented;
  };
  // No answers held: every gesture stays the browser's own.
  expect(fire('click', { metaKey: true })).toBe(false);
  expect(original.opened).toHaveLength(0);
  tab.save('account-a', candidate, draft);
  expect(fire('click', { button: 0 })).toBe(false);
  expect(fire('click', { shiftKey: true })).toBe(false);
  expect(fire('click', { metaKey: true, shiftKey: true })).toBe(false);
  expect(fire('contextmenu', { button: 2 })).toBe(false);
  expect(original.opened).toHaveLength(0);
  expect(fire('click', { metaKey: true })).toBe(true);
  expect(fire('click', { ctrlKey: true })).toBe(true);
  expect(fire('auxclick', { button: 1 })).toBe(true);
  expect(original.opened).toHaveLength(3);
  const away = page.querySelector('#away')!;
  const event = new MouseEvent('click', { bubbles: true, cancelable: true, metaKey: true });
  away.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(false);
});

it('keeps the reader in this tab, with the answers, when the browser refuses the window', () => {
  const original = new FakeWindow(location.origin);
  original.blocked = true;
  const tab = tabFor(original);
  tab.save('account-a', candidate, draft);
  const page = document.implementation.createHTMLDocument('claim');
  page.body.innerHTML = `<a id="claim" href="${claimHref}">Claim</a>`;
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
