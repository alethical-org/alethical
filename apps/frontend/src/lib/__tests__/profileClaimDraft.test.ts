// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  PROFILE_CLAIM_DRAFT_OFFER_MS,
  claimStepCandidate,
  createProfileClaimDraftTab,
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
  const sent: unknown[] = [];
  const channel = () => {
    const self: Channel = {
      onmessage: null,
      postMessage(message) {
        sent.push(message);
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
  const tab = () =>
    createProfileClaimDraftTab({
      openChannel: channel,
      now: () => clock,
      nonce: () => `n${Math.random()}`,
    });
  return { tab, raw: channel, sent, advance: (ms: number) => (clock += ms) };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

async function ask(
  tab: ReturnType<ReturnType<typeof browser>['tab']>,
  account = 'account-a',
  id = candidate,
  isCurrent = () => true,
) {
  const answer = tab.request(account, id, isCurrent);
  await vi.advanceTimersByTimeAsync(2000);
  return answer;
}

it('hands unsent answers to a new tab only after an explicit new-tab opening, once', async () => {
  const site = browser();
  const opener = site.tab();
  const opened = site.tab();
  opener.save('account-a', candidate, draft);
  expect(await ask(opened)).toBeNull();
  opener.offer(candidate);
  expect(await ask(opened)).toEqual(draft);
  // One answer per opening: a second tab asking later gets nothing.
  expect(await ask(site.tab())).toBeNull();
  // The opener keeps its own answers.
  expect(opener.read('account-a', candidate)).toEqual(draft);
});

it('never answers another account or another candidate', async () => {
  const site = browser();
  const opener = site.tab();
  opener.save('account-a', candidate, draft);
  opener.offer(candidate);
  expect(await ask(site.tab(), 'account-b')).toBeNull();
  expect(await ask(site.tab(), 'account-a', other)).toBeNull();
  // The offer is still there for the right account and candidate.
  expect(await ask(site.tab())).toEqual(draft);
});

it('accepts only while the receiving tab is still the same account with an empty, untouched form', async () => {
  const site = browser();
  const opener = site.tab();
  opener.save('account-a', candidate, draft);
  opener.offer(candidate);
  expect(await ask(site.tab(), 'account-a', candidate, () => false)).toBeNull();
});

it('forgets answers and offers on sign-out or an account switch', async () => {
  const site = browser();
  const opener = site.tab();
  opener.save('account-a', candidate, draft);
  opener.offer(candidate);
  opener.clearAll();
  expect(await ask(site.tab())).toBeNull();
});

it('lets an offer lapse after 2 minutes', async () => {
  const site = browser();
  const opener = site.tab();
  opener.save('account-a', candidate, draft);
  opener.offer(candidate);
  site.advance(PROFILE_CLAIM_DRAFT_OFFER_MS + 1);
  expect(await ask(site.tab())).toBeNull();
});

it('offers nothing for a candidate with no unsent answers', async () => {
  const site = browser();
  const opener = site.tab();
  opener.save('account-a', other, draft);
  opener.offer(candidate);
  expect(await ask(site.tab())).toBeNull();
  expect(
    site.sent.filter((message) => (message as { type: string }).type.endsWith('reply')),
  ).toEqual([]);
});

it('takes the most recently edited answers when 2 tabs offer them', async () => {
  const site = browser();
  const older = site.tab();
  const newer = site.tab();
  older.save('account-a', candidate, { ...draft, link: 'https://example.org/older' });
  site.advance(1000);
  newer.save('account-a', candidate, { ...draft, link: 'https://example.org/newer' });
  older.offer(candidate);
  newer.offer(candidate);
  expect((await ask(site.tab()))?.link).toBe('https://example.org/newer');
});

it('ignores a malformed reply, even one carrying the right request', async () => {
  const site = browser();
  const receiving = site.tab();
  const answer = receiving.request('account-a', candidate, () => true);
  const nonce = (site.sent[0] as { nonce: string }).nonce;
  const raw = site.raw();
  const reply = {
    type: 'profile-claim-draft-reply',
    nonce,
    accountId: 'account-a',
    candidateId: candidate,
    editedAt: 1,
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

it('recognises only same-site claim-step links', () => {
  expect(claimStepCandidate(`/candidates/${candidate}/claim`, origin)).toBe(candidate);
  expect(claimStepCandidate(`${origin}/candidates/${candidate}/claim`, origin)).toBe(candidate);
  expect(claimStepCandidate(`/candidates/features?candidate=${candidate}`, origin)).toBe(candidate);
  expect(claimStepCandidate('/candidates/features', origin)).toBeNull();
  expect(claimStepCandidate(`/candidates/${candidate}`, origin)).toBeNull();
  expect(claimStepCandidate(`/candidates/${candidate}/manage`, origin)).toBeNull();
  expect(
    claimStepCandidate(`https://example.org/candidates/${candidate}/claim`, origin),
  ).toBeNull();
});

it('arms an offer from new-tab gestures on claim-step links, never from a plain click', async () => {
  const site = browser();
  const opener = site.tab();
  opener.save('account-a', candidate, draft);
  document.body.innerHTML = `<a id="claim" href="/candidates/${candidate}/claim"><span>Continue</span></a><a id="away" href="https://example.org/">Away</a>`;
  opener.watchNewTabGestures(document, location.origin);
  const span = document.querySelector('#claim span')!;
  span.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
  expect(await ask(site.tab())).toBeNull();
  for (const event of [
    new MouseEvent('click', { bubbles: true, metaKey: true }),
    new MouseEvent('click', { bubbles: true, ctrlKey: true }),
    new MouseEvent('click', { bubbles: true, shiftKey: true }),
    new MouseEvent('auxclick', { bubbles: true, button: 1 }),
    new MouseEvent('contextmenu', { bubbles: true, button: 2 }),
  ]) {
    span.dispatchEvent(event);
    expect(await ask(site.tab())).toEqual(draft);
  }
  document
    .querySelector('#away')!
    .dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true }));
  expect(await ask(site.tab())).toBeNull();
});

it('keeps answers out of browser storage and the address', async () => {
  const setLocal = vi.spyOn(Storage.prototype, 'setItem');
  const push = vi.spyOn(history, 'pushState');
  const replace = vi.spyOn(history, 'replaceState');
  const site = browser();
  const opener = site.tab();
  opener.save('account-a', candidate, draft);
  opener.offer(candidate);
  expect(await ask(site.tab())).toEqual(draft);
  expect(setLocal).not.toHaveBeenCalled();
  expect(push).not.toHaveBeenCalled();
  expect(replace).not.toHaveBeenCalled();
  expect(location.href).not.toContain('Illustrative');
});
