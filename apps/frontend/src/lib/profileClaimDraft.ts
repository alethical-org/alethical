import { candidateFeaturesContext } from './candidateFeatures';
import { registerCandidatePrivacyReset } from './candidatePrivacy';

/** Unsent profile claim answers for one signed-in account and one candidate.
 *
 * Kept in memory only, so a visit to /candidates/features and back returns the
 * claim step as it was left. Never written to browser storage or an address: the
 * answers are private evidence. Any account change clears every draft.
 *
 * One bounded exception reaches another tab. When the reader explicitly opens a
 * claim-step link in a new tab or window (Cmd/Ctrl/Shift-click, middle click, or
 * the link's own menu), this tab offers that candidate's answers for 2 minutes.
 * A claim form that opens empty in another tab of this site asks once; only a tab
 * holding an offer for the same account and candidate answers, once, over the
 * browser's same-site tab channel (BroadcastChannel). Nothing goes through an
 * address, storage, history or a server. The receiving form accepts only while
 * still signed in to that account and still empty and untouched, so it never
 * replaces newer answers. */
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
type Offer = { accountId: string; candidateId: string; expires: number };
type Reply = { draft: ProfileClaimDraft; editedAt: number };

const CHANNEL_NAME = 'alethical-profile-claim-draft';
const REQUEST = 'profile-claim-draft-request';
const REPLY = 'profile-claim-draft-reply';
export const PROFILE_CLAIM_DRAFT_OFFER_MS = 2 * 60 * 1000;
const WAIT_MS = 1500;
const SETTLE_MS = 100;
const MAX_TEXT = 10000;
const ERROR_KEYS = ['role', 'link', 'explanation'] as const;

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

/** The candidate a same-site claim-step link leads to, or null for any other link. */
export function claimStepCandidate(href: string, origin: string): string | null {
  let url: URL;
  try {
    url = new URL(href, origin);
  } catch {
    return null;
  }
  if (url.origin !== origin) return null;
  const claim = /^\/candidates\/([a-f0-9]{64})\/claim\/?$/.exec(url.pathname);
  if (claim) return claim[1];
  if (url.pathname.replace(/\/$/, '') === '/candidates/features')
    return candidateFeaturesContext(url.searchParams.get('candidate'));
  return null;
}

/** One tab's drafts. A factory so tests can hold 2 tabs in one process. */
export function createProfileClaimDraftTab(
  options: {
    openChannel?: () => DraftChannel | null;
    now?: () => number;
    nonce?: () => string;
  } = {},
) {
  const openChannel =
    options.openChannel ??
    (() =>
      typeof BroadcastChannel === 'function'
        ? (new BroadcastChannel(CHANNEL_NAME) as unknown as DraftChannel)
        : null);
  const now = options.now ?? (() => Date.now());
  const nonce =
    options.nonce ??
    (() =>
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Math.random()}${now()}`);
  const drafts = new Map<string, Reply>();
  let offers: Offer[] = [];
  let channel: DraftChannel | null = null;
  const waiting = new Map<
    string,
    (reply: Reply & { accountId: string; candidateId: string }) => void
  >();
  const key = (accountId: string, candidateId: string) => `${accountId}\u0000${candidateId}`;

  const onMessage = (event: { data: unknown }) => {
    const message = event.data as Record<string, unknown> | null;
    if (!message || typeof message !== 'object') return;
    if (
      message.type === REQUEST &&
      typeof message.nonce === 'string' &&
      typeof message.accountId === 'string' &&
      typeof message.candidateId === 'string'
    ) {
      const { accountId, candidateId } = message as { accountId: string; candidateId: string };
      offers = offers.filter((offer) => offer.expires > now());
      const index = offers.findIndex(
        (offer) => offer.accountId === accountId && offer.candidateId === candidateId,
      );
      const entry = drafts.get(key(accountId, candidateId));
      if (index < 0 || !entry) return;
      // One answer per explicit new-tab opening.
      offers.splice(index, 1);
      channel?.postMessage({
        type: REPLY,
        nonce: message.nonce,
        accountId,
        candidateId,
        editedAt: entry.editedAt,
        draft: copyDraft(entry.draft),
      });
      return;
    }
    if (
      message.type === REPLY &&
      typeof message.nonce === 'string' &&
      typeof message.accountId === 'string' &&
      typeof message.candidateId === 'string' &&
      typeof message.editedAt === 'number' &&
      validDraft(message.draft)
    )
      waiting.get(message.nonce)?.({
        accountId: message.accountId,
        candidateId: message.candidateId,
        editedAt: message.editedAt,
        draft: copyDraft(message.draft),
      });
  };
  const connect = () => {
    if (!channel) {
      channel = openChannel();
      if (channel) channel.onmessage = onMessage;
    }
    return channel;
  };

  /** The reader opened a claim-step link for this candidate in a new tab or window. */
  const offer = (candidateId: string) => {
    const held = [...drafts.keys()]
      .map((value) => value.split('\u0000'))
      .filter(([, candidate]) => candidate === candidateId);
    if (!held.length) return;
    const expires = now() + PROFILE_CLAIM_DRAFT_OFFER_MS;
    offers = [
      ...offers.filter((item) => item.candidateId !== candidateId),
      ...held.map(([accountId]) => ({ accountId, candidateId, expires })),
    ];
    connect();
  };

  return {
    read(accountId: string, candidateId: string) {
      return drafts.get(key(accountId, candidateId))?.draft ?? null;
    },
    save(accountId: string, candidateId: string, draft: ProfileClaimDraft) {
      const empty = !draft.role && !draft.link && !draft.explanation;
      if (empty && !Object.values(draft.errors).some(Boolean))
        drafts.delete(key(accountId, candidateId));
      else drafts.set(key(accountId, candidateId), { draft, editedAt: now() });
    },
    clear(accountId: string, candidateId: string) {
      drafts.delete(key(accountId, candidateId));
      offers = offers.filter(
        (offer) => offer.accountId !== accountId || offer.candidateId !== candidateId,
      );
    },
    clearAll() {
      drafts.clear();
      offers = [];
    },
    offer,
    /** Ask other tabs once for answers offered to this account and candidate. Resolves
     * with the most recently edited answer, or null. `isCurrent` re-checks the signed-in
     * account and the empty form at the moment of acceptance. */
    request(
      accountId: string,
      candidateId: string,
      isCurrent: () => boolean,
      signal?: AbortSignal,
    ): Promise<ProfileClaimDraft | null> {
      const open = connect();
      if (!open || signal?.aborted) return Promise.resolve(null);
      const id = nonce();
      return new Promise((resolve) => {
        let best: Reply | null = null;
        let settle: ReturnType<typeof setTimeout> | null = null;
        const finish = () => {
          waiting.delete(id);
          clearTimeout(timeout);
          if (settle) clearTimeout(settle);
          signal?.removeEventListener('abort', abort);
          resolve(best && !signal?.aborted && isCurrent() ? best.draft : null);
        };
        const abort = () => {
          best = null;
          finish();
        };
        const timeout = setTimeout(finish, WAIT_MS);
        signal?.addEventListener('abort', abort);
        waiting.set(id, (reply) => {
          if (reply.accountId !== accountId || reply.candidateId !== candidateId) return;
          if (!best || reply.editedAt > best.editedAt) best = reply;
          settle ??= setTimeout(finish, SETTLE_MS);
        });
        open.postMessage({ type: REQUEST, nonce: id, accountId, candidateId });
      });
    },
    /** Arm an offer from the browser's own new-tab gestures on claim-step links. */
    watchNewTabGestures(target: Pick<Document, 'addEventListener'>, origin: string) {
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
        const anchor = (event.target as Element | null)?.closest?.('a[href]');
        const href = anchor?.getAttribute('href');
        const candidateId = href ? claimStepCandidate(href, origin) : null;
        if (candidateId) offer(candidateId);
      };
      for (const type of ['click', 'auxclick', 'contextmenu'])
        target.addEventListener(type, handle, { capture: true });
    },
  };
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
export function requestProfileClaimDraftFromOtherTab(
  accountId: string,
  candidateId: string,
  isCurrent: () => boolean,
  signal?: AbortSignal,
) {
  return tab.request(accountId, candidateId, isCurrent, signal);
}
registerCandidatePrivacyReset(clearAllProfileClaimDrafts);
