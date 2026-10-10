import { registerCandidatePrivacyReset } from './candidatePrivacy';

/** Unsent profile claim answers for one signed-in account and one candidate.
 *
 * Kept in memory only, so a visit to another page in the same tab returns the claim
 * step as it was left. Never written to browser storage, an address, history or the
 * window name: the answers are private evidence. Any account change clears every draft.
 *
 * One bounded exception reaches another tab, and only the exact tab this one opens.
 * On /candidates/features for a candidate, its 2 return links to that candidate's claim
 * page (Go back and Continue claiming this candidate profile) are the only links taken
 * over. When the reader Ctrl- or Cmd-clicks (with or without Shift) or middle-clicks one
 * while this tab holds answers for that candidate, this tab opens the public claim
 * address itself and keeps the returned window only in its own memory. That window, once its claim
 * form is ready, signed in to the same account, eligible and still empty, asks its
 * opener directly; this tab answers only a message whose origin is this site and whose
 * sender is that exact window, within 2 minutes, and sends the answers to that window
 * alone, until that window confirms it filled its form; then the offer ends. Nothing is broadcast, and no code or answer enters an address.
 *
 * The browser's own link menu ("Open link in new tab") and a plain Shift-click (new
 * window) tell the page neither the chosen command nor the opened window, so those tabs
 * start empty; the original tab always keeps its answers. With no answers held, and on
 * every other link, each gesture stays the browser's own. */
export interface ProfileClaimDraft {
  role: string;
  link: string;
  explanation: string;
  errors: { role?: string; link?: string; explanation?: string };
}

type TargetWindow = { postMessage(message: unknown, targetOrigin: string): void };
type MessageLike = { data: unknown; origin: string; source: unknown };
export type ProfileClaimDraftHost = {
  origin: string;
  /** Where this tab is now, read at the moment of each gesture. */
  where(): { pathname: string; search: string };
  open(url: string): TargetWindow | null;
  opener(): TargetWindow | null;
  forgetOpener(): void;
  listen(handler: (event: MessageLike) => void): () => void;
};
type Offer = { child: TargetWindow; accountId: string; candidateId: string; expires: number };

const REQUEST = 'alethical-profile-claim-draft-request';
const REPLY = 'alethical-profile-claim-draft-reply';
const RECEIVED = 'alethical-profile-claim-draft-received';
export const PROFILE_CLAIM_DRAFT_OFFER_MS = 2 * 60 * 1000;
// The opened tab listens for as long as the offer can last; an edit before then wins.
const WAIT_MS = PROFILE_CLAIM_DRAFT_OFFER_MS;
const ERROR_KEYS = ['role', 'link', 'explanation'] as const;

// Any length: the form keeps over-long answers (with their error) exactly as typed.
const text = (value: unknown) => typeof value === 'string';
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

function browserHost(): ProfileClaimDraftHost | null {
  if (typeof window === 'undefined' || typeof location === 'undefined') return null;
  return {
    origin: location.origin,
    where: () => ({ pathname: location.pathname, search: location.search }),
    open: (url) => window.open(url, '_blank'),
    opener: () => (window.opener as TargetWindow | null) ?? null,
    forgetOpener: () => {
      window.opener = null;
    },
    listen: (handler) => {
      const listener = (event: MessageEvent) => handler(event);
      window.addEventListener('message', listener);
      return () => window.removeEventListener('message', listener);
    },
  };
}

/** One tab's drafts. A factory so tests can hold several tabs in one process. */
export function createProfileClaimDraftTab(
  options: { host?: ProfileClaimDraftHost | null; now?: () => number } = {},
) {
  const host = options.host === undefined ? browserHost() : options.host;
  const now = options.now ?? (() => Date.now());
  const drafts = new Map<string, ProfileClaimDraft>();
  let offers: Offer[] = [];
  let listening = false;
  const key = (accountId: string, candidateId: string) => `${accountId}\u0000${candidateId}`;

  // Opener side: answer only the exact window this tab opened, once.
  // The offer lasts until that window confirms it filled its form, so a form that restarts
  // while loading (for example as sign-in settles) can still ask; then it ends.
  const onRequest = (event: MessageLike) => {
    if (!host || event.origin !== host.origin) return;
    const message = event.data as Record<string, unknown> | null;
    if (!message || typeof message !== 'object') return;
    if (message.type !== REQUEST && message.type !== RECEIVED) return;
    offers = offers.filter((item) => item.expires > now());
    const index = offers.findIndex((item) => item.child === event.source);
    if (index < 0) return;
    const offer = offers[index];
    if (message.accountId !== offer.accountId || message.candidateId !== offer.candidateId) return;
    if (message.type === RECEIVED) {
      offers.splice(index, 1);
      return;
    }
    const draft = drafts.get(key(offer.accountId, offer.candidateId));
    if (!draft) return;
    offer.child.postMessage(
      {
        type: REPLY,
        accountId: offer.accountId,
        candidateId: offer.candidateId,
        draft: copyDraft(draft),
      },
      host.origin,
    );
  };

  /** Whether this tab holds answers for the candidate a claim page link leads to. */
  const holds = (href: string) => {
    const candidateId = host ? claimPageCandidate(href, host.origin) : null;
    return (
      candidateId !== null &&
      [...drafts.keys()].some((value) => value.split('\u0000')[1] === candidateId)
    );
  };
  /** Open the public claim address in a new tab and offer its answers to that exact
   * window. Returns 'opened', 'blocked' when the browser refused the window, or null
   * when this tab holds no answers for that candidate. */
  const openWithAnswers = (href: string): 'opened' | 'blocked' | null => {
    if (!host) return null;
    const candidateId = claimPageCandidate(href, host.origin);
    const held = candidateId
      ? [...drafts.keys()]
          .map((value) => value.split('\u0000'))
          .find(([, candidate]) => candidate === candidateId)
      : undefined;
    if (!candidateId || !held) return null;
    const child = host.open(new URL(href, host.origin).href);
    if (!child) return 'blocked';
    if (!listening) {
      host.listen(onRequest);
      listening = true;
    }
    offers = [
      ...offers.filter((item) => item.expires > now()),
      { child, accountId: held[0], candidateId, expires: now() + PROFILE_CLAIM_DRAFT_OFFER_MS },
    ];
    return 'opened';
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
    holds,
    openWithAnswers,
    /** Child side: ask the window that opened this one, once, for answers for this account
     * and candidate. `isCurrent` re-checks the account, eligibility and the empty, untouched
     * form at the moment of acceptance. */
    requestFromOpener(
      accountId: string,
      candidateId: string,
      isCurrent: () => boolean,
      signal?: AbortSignal,
    ): Promise<ProfileClaimDraft | null> {
      const opener = host?.opener();
      if (!host || !opener || signal?.aborted) return Promise.resolve(null);
      return new Promise((resolve) => {
        let stop = () => {};
        const finish = (draft: ProfileClaimDraft | null) => {
          stop();
          clearTimeout(timeout);
          signal?.removeEventListener('abort', abort);
          const accepted = draft && !signal?.aborted && isCurrent() ? draft : null;
          if (accepted) {
            // Kept in this tab's own memory too, so a form that restarts right after still
            // shows the answers.
            drafts.set(key(accountId, candidateId), accepted);
            // One transfer per opened tab: say so, then drop the link to the opener.
            try {
              opener.postMessage({ type: RECEIVED, accountId, candidateId }, host.origin);
            } catch {
              // The opener is gone; its offer lapses on its own.
            }
            host.forgetOpener();
          }
          resolve(accepted);
        };
        const abort = () => finish(null);
        const timeout = setTimeout(() => finish(null), WAIT_MS);
        signal?.addEventListener('abort', abort);
        stop = host.listen((event) => {
          if (event.origin !== host.origin || event.source !== opener) return;
          const reply = event.data as Record<string, unknown> | null;
          if (
            !reply ||
            reply.type !== REPLY ||
            reply.accountId !== accountId ||
            reply.candidateId !== candidateId ||
            !validDraft(reply.draft)
          )
            return;
          finish(copyDraft(reply.draft));
        });
        try {
          opener.postMessage({ type: REQUEST, accountId, candidateId }, host.origin);
        } catch {
          finish(null);
        }
      });
    },
    /** Take over Ctrl/Cmd-click (with or without Shift) and middle click on the 2 return
     * links of /candidates/features for a candidate, only while this tab holds answers for
     * that candidate. A refused window keeps the reader in this tab, where the answers are. */
    watchNewTabGestures(target: Pick<Document, 'addEventListener'>) {
      const handle = (event: Event) => {
        if (!host) return;
        const pointer = event as MouseEvent;
        const newTab =
          event.type === 'auxclick'
            ? pointer.button === 1
            : pointer.button === 0 && (pointer.metaKey || pointer.ctrlKey) && !pointer.altKey;
        if (!newTab || pointer.defaultPrevented) return;
        const page = host.where();
        const context = new URLSearchParams(page.search).get('candidate');
        if (page.pathname.replace(/\/$/, '') !== '/candidates/features' || !context) return;
        const anchor = (event.target as Element | null)?.closest?.('a[href]') as
          HTMLAnchorElement | null | undefined;
        const href = anchor?.getAttribute('href');
        if (!anchor || !href || claimPageCandidate(href, host.origin) !== context) return;
        if (!holds(href)) return;
        event.preventDefault();
        if (openWithAnswers(href) === 'blocked') anchor.click();
      };
      target.addEventListener('click', handle, { capture: true });
      target.addEventListener('auxclick', handle, { capture: true });
    },
  };
}

const tab = createProfileClaimDraftTab();
let watching = false;
function watchOnce() {
  if (watching || typeof document === 'undefined') return;
  watching = true;
  tab.watchNewTabGestures(document);
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
export function requestProfileClaimDraftFromOpener(
  accountId: string,
  candidateId: string,
  isCurrent: () => boolean,
  signal?: AbortSignal,
) {
  return tab.requestFromOpener(accountId, candidateId, isCurrent, signal);
}
registerCandidatePrivacyReset(clearAllProfileClaimDrafts);
