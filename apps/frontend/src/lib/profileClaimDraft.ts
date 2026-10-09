import { registerCandidatePrivacyReset } from './candidatePrivacy';

/** Unsent profile claim answers for one signed-in account and one candidate.
 *
 * Kept in memory only, so a visit to /candidates/features and back returns the
 * claim step as it was left. Never written to browser storage or an address: the
 * answers are private evidence. Any account change clears every draft.
 *
 * One bounded exception reaches another tab, and only the tab the reader opens.
 * When the reader opens a claim page link in a new tab or window with the
 * browser's own gesture (Cmd/Ctrl/Shift-click, middle click, or the link's menu)
 * while this tab holds answers for that candidate, this tab adds a random one-time
 * code to that link's address fragment (`#claim-draft=<code>`, which browsers never
 * send to a server) and offers the answers to that code for 2 minutes. The opened
 * claim page removes the code from its address at once and asks for the answers
 * over the browser's same-site tab channel (BroadcastChannel). Only the tab holding
 * the matching code answers, once, for the same account and candidate, and the
 * receiving form accepts only while still signed in to that account and still
 * empty and untouched, so it never replaces newer answers. A tab opened any other
 * way has no code and starts empty. The code is not private text: it reveals
 * nothing, works once, and expires. */
export interface ProfileClaimDraft {
  role: string;
  link: string;
  explanation: string;
  errors: { role?: string; link?: string; explanation?: string };
}

type DraftChannel = {
  postMessage(message: unknown): void;
  onmessage: ((event: { data: unknown }) => void) | null;
  close(): void;
};
type Offer = { code: string; accountId: string; candidateId: string; expires: number };

const CHANNEL_NAME = 'alethical-profile-claim-draft';
const REQUEST = 'profile-claim-draft-request';
const REPLY = 'profile-claim-draft-reply';
const FRAGMENT_KEY = 'claim-draft';
export const PROFILE_CLAIM_DRAFT_OFFER_MS = 2 * 60 * 1000;
const WAIT_MS = 1500;
const MAX_TEXT = 10000;
const ERROR_KEYS = ['role', 'link', 'explanation'] as const;
const CODE = /^[a-f0-9-]{36}$/;

const text = (value: unknown) => typeof value === 'string' && value.length <= MAX_TEXT;
function validDraft(value: unknown): value is ProfileClaimDraft {
  if (!value || typeof value !== 'object') return false;
  const draft = value as Record<string, unknown>;
  const errors = draft.errors as Record<string, unknown> | null;
  return (
    text(draft.role) &&
    text(draft.link) &&
    text(draft.explanation) &&
    Boolean(errors) &&
    typeof errors === 'object' &&
    Object.entries(errors!).every(
      ([name, message]) =>
        (ERROR_KEYS as readonly string[]).includes(name) &&
        (message === undefined || text(message)),
    )
  );
}
function copyDraft(draft: ProfileClaimDraft): ProfileClaimDraft {
  const errors: ProfileClaimDraft['errors'] = {};
  for (const name of ERROR_KEYS) if (draft.errors[name]) errors[name] = draft.errors[name];
  return { role: draft.role, link: draft.link, explanation: draft.explanation, errors };
}

/** The candidate a same-site claim page link leads to, or null for any other link. */
export function claimPageCandidate(href: string, origin: string): string | null {
  let url: URL;
  try {
    url = new URL(href, origin);
  } catch {
    return null;
  }
  if (url.origin !== origin) return null;
  return /^\/candidates\/([a-f0-9]{64})\/claim\/?$/.exec(url.pathname)?.[1] ?? null;
}

/** One tab's drafts. A factory so tests can hold 2 tabs in one process. */
export function createProfileClaimDraftTab(
  options: {
    openChannel?: () => DraftChannel | null;
    now?: () => number;
    newCode?: () => string | null;
  } = {},
) {
  const openChannel =
    options.openChannel ??
    (() =>
      typeof BroadcastChannel === 'function'
        ? (new BroadcastChannel(CHANNEL_NAME) as unknown as DraftChannel)
        : null);
  const now = options.now ?? (() => Date.now());
  // Without a secure random source there is no code, so nothing is offered.
  const newCode =
    options.newCode ??
    (() =>
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : null);
  const drafts = new Map<string, ProfileClaimDraft>();
  let offers: Offer[] = [];
  let channel: DraftChannel | null = null;
  const waiting = new Map<string, (reply: Record<string, unknown>) => void>();
  const key = (accountId: string, candidateId: string) => `${accountId}\u0000${candidateId}`;

  const onMessage = (event: { data: unknown }) => {
    const message = event.data as Record<string, unknown> | null;
    if (!message || typeof message !== 'object' || typeof message.code !== 'string') return;
    if (message.type === REPLY) {
      waiting.get(message.code)?.(message);
      return;
    }
    if (message.type !== REQUEST) return;
    offers = offers.filter((item) => item.expires > now());
    const index = offers.findIndex(
      (item) =>
        item.code === message.code &&
        item.accountId === message.accountId &&
        item.candidateId === message.candidateId,
    );
    if (index < 0) return;
    const [offer] = offers.splice(index, 1);
    const draft = drafts.get(key(offer.accountId, offer.candidateId));
    if (!draft) return;
    channel?.postMessage({
      type: REPLY,
      code: offer.code,
      accountId: offer.accountId,
      candidateId: offer.candidateId,
      draft: copyDraft(draft),
    });
  };
  const connect = () => {
    if (!channel) {
      channel = openChannel();
      if (channel) channel.onmessage = onMessage;
    }
    return channel;
  };

  /** The reader is opening a claim page link for this candidate in a new tab or window.
   * Returns the one-time code to put in that link's fragment, or null to offer nothing. */
  const offer = (candidateId: string) => {
    const held = [...drafts.keys()]
      .map((value) => value.split('\u0000'))
      .find(([, candidate]) => candidate === candidateId);
    const code = held ? newCode() : null;
    if (!held || !code || !connect()) return null;
    offers = [
      ...offers.filter((item) => item.expires > now()),
      { code, accountId: held[0], candidateId, expires: now() + PROFILE_CLAIM_DRAFT_OFFER_MS },
    ];
    return code;
  };

  return {
    read(accountId: string, candidateId: string) {
      return drafts.get(key(accountId, candidateId)) ?? null;
    },
    save(accountId: string, candidateId: string, draft: ProfileClaimDraft) {
      const empty = !draft.role && !draft.link && !draft.explanation;
      if (empty && !Object.values(draft.errors).some(Boolean))
        drafts.delete(key(accountId, candidateId));
      else drafts.set(key(accountId, candidateId), draft);
    },
    clear(accountId: string, candidateId: string) {
      drafts.delete(key(accountId, candidateId));
      offers = offers.filter(
        (item) => item.accountId !== accountId || item.candidateId !== candidateId,
      );
    },
    clearAll() {
      drafts.clear();
      offers = [];
    },
    offer,
    /** Ask, once, for the answers offered to this code, account and candidate. `isCurrent`
     * re-checks the signed-in account and the empty, untouched form at acceptance. */
    request(
      code: string,
      accountId: string,
      candidateId: string,
      isCurrent: () => boolean,
      signal?: AbortSignal,
    ): Promise<ProfileClaimDraft | null> {
      const open = connect();
      if (!open || signal?.aborted || !CODE.test(code)) return Promise.resolve(null);
      return new Promise((resolve) => {
        const finish = (draft: ProfileClaimDraft | null) => {
          waiting.delete(code);
          clearTimeout(timeout);
          signal?.removeEventListener('abort', abort);
          resolve(draft && !signal?.aborted && isCurrent() ? draft : null);
        };
        const abort = () => finish(null);
        const timeout = setTimeout(() => finish(null), WAIT_MS);
        signal?.addEventListener('abort', abort);
        waiting.set(code, (reply) => {
          if (
            reply.accountId !== accountId ||
            reply.candidateId !== candidateId ||
            !validDraft(reply.draft)
          )
            return;
          finish(copyDraft(reply.draft));
        });
        open.postMessage({ type: REQUEST, code, accountId, candidateId });
      });
    },
    /** Put a one-time code on a claim page link as the browser opens it in a new tab or
     * window. The link's own address comes back at the next press or after the offer ends. */
    watchNewTabGestures(target: Document, origin: string) {
      const restore = new Map<HTMLAnchorElement, string>();
      const putBack = () => {
        for (const [anchor, href] of restore) anchor.setAttribute('href', href);
        restore.clear();
      };
      const handle = (event: Event) => {
        const pointer = event as MouseEvent;
        if (
          event.type === 'click' &&
          !(
            pointer.metaKey ||
            pointer.ctrlKey ||
            pointer.shiftKey ||
            (typeof pointer.button === 'number' && pointer.button !== 0)
          )
        )
          return;
        if (event.type === 'auxclick' && pointer.button !== 1) return;
        const anchor = (event.target as Element | null)?.closest?.('a[href]') as
          HTMLAnchorElement | null | undefined;
        if (!anchor) return;
        const href = restore.get(anchor) ?? anchor.getAttribute('href') ?? '';
        const candidateId = claimPageCandidate(href, origin);
        const code = candidateId ? offer(candidateId) : null;
        if (!code) return;
        putBack();
        restore.set(anchor, href);
        anchor.setAttribute('href', `${href.split('#')[0]}#${FRAGMENT_KEY}=${code}`);
        setTimeout(putBack, PROFILE_CLAIM_DRAFT_OFFER_MS);
      };
      for (const type of ['click', 'auxclick', 'contextmenu'])
        target.addEventListener(type, handle, { capture: true });
      // A later press is a new decision: the link shows its own address again.
      for (const type of ['pointerdown', 'keydown'])
        target.addEventListener(type, putBack, { capture: true });
    },
  };
}

/** The one-time code this page was opened with, for this candidate's claim page, read
 * once and removed from the address before anything else can record it. */
export function takeProfileClaimDraftCode(
  candidateId: string,
  where: Pick<Location, 'pathname' | 'search' | 'hash'> | undefined = typeof location ===
  'undefined'
    ? undefined
    : location,
  replace: ((url: string) => void) | undefined = typeof history === 'undefined'
    ? undefined
    : (url) => history.replaceState(history.state, '', url),
): string | null {
  if (!where?.hash) return null;
  const fragment = new URLSearchParams(where.hash.slice(1));
  const code = fragment.get(FRAGMENT_KEY);
  if (code === null) return null;
  fragment.delete(FRAGMENT_KEY);
  const rest = fragment.toString();
  replace?.(`${where.pathname}${where.search}${rest ? `#${rest}` : ''}`);
  const forThisPage =
    claimPageCandidate(where.pathname, 'https://alethical.invalid') === candidateId;
  return forThisPage && CODE.test(code) ? code : null;
}

const tab = createProfileClaimDraftTab();
let watching = false;
function watchOnce() {
  if (watching || typeof document === 'undefined' || typeof location === 'undefined') return;
  watching = true;
  tab.watchNewTabGestures(document, location.origin);
}

export function readProfileClaimDraft(accountId: string, candidateId: string) {
  return tab.read(accountId, candidateId);
}
export function saveProfileClaimDraft(
  accountId: string,
  candidateId: string,
  draft: ProfileClaimDraft,
) {
  tab.save(accountId, candidateId, draft);
  if (tab.read(accountId, candidateId)) watchOnce();
}
export function clearProfileClaimDraft(accountId: string, candidateId: string) {
  tab.clear(accountId, candidateId);
}
export function clearAllProfileClaimDrafts() {
  tab.clearAll();
}
export function requestProfileClaimDraftFromOpeningTab(
  code: string,
  accountId: string,
  candidateId: string,
  isCurrent: () => boolean,
  signal?: AbortSignal,
) {
  return tab.request(code, accountId, candidateId, isCurrent, signal);
}
registerCandidatePrivacyReset(clearAllProfileClaimDrafts);
