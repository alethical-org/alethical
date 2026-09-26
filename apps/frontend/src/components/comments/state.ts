import type { CommentRequestIdentity, CommentSettings, ReaderComment } from '../../data/comments';

export type DraftKind = 'comment' | 'reply' | 'edit';
export interface PendingContribution {
  key: string;
  body: string;
  kind: DraftKind;
  target: string | null;
  targetRootId: string | null;
  expectedVersion?: number;
  publicName?: string;
  profileVersion?: number;
}
export interface ContributionDraft {
  body: string;
  busy: boolean;
  checking: boolean;
  pending: PendingContribution | null;
  notice: string;
  bodyError: string;
  nameError: string;
  unavailable?: boolean;
}
export const emptyDraft = (): ContributionDraft => ({
  body: '',
  busy: false,
  checking: false,
  pending: null,
  notice: '',
  bodyError: '',
  nameError: '',
});

export interface PieceDiscussion {
  items: ReaderComment[];
  loadedRoots: string[];
  nextCursor: string | null;
  loaded: boolean;
  loading: boolean;
  loadingMore: boolean;
  listError: boolean;
  updating: boolean;
  settings: CommentSettings | null;
  settingsLoading: boolean;
  settingsError: boolean;
  drafts: Record<string, ContributionDraft>;
  activeBox: { kind: 'reply' | 'edit'; target: string; rootId: string | null } | null;
  nameDraft: string;
  nameEditing: boolean;
  nameEditDraft: string;
  nameBusy: boolean;
  nameError: string;
  nameNotice: string;
  nameStatus: string;
  preferencesBusy: boolean;
  preferencesStatus: string;
  preferencesError: string;
  messages: Record<string, string>;
}

const emptyPiece = (): PieceDiscussion => ({
  items: [],
  loadedRoots: [],
  nextCursor: null,
  loaded: false,
  loading: false,
  loadingMore: false,
  listError: false,
  updating: false,
  settings: null,
  settingsLoading: false,
  settingsError: false,
  drafts: { comment: emptyDraft() },
  activeBox: null,
  nameDraft: '',
  nameEditing: false,
  nameEditDraft: '',
  nameBusy: false,
  nameError: '',
  nameNotice: '',
  nameStatus: '',
  preferencesBusy: false,
  preferencesStatus: '',
  preferencesError: '',
  messages: {},
});

export function characterCount(body: string): number {
  return Array.from(body).length;
}
export function commentDate(value: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(value));
}
export function commentDateLine(comment: ReaderComment): string {
  return `Posted ${commentDate(comment.posted_at)}${comment.edited_at ? ` · Edited ${commentDate(comment.edited_at)}` : ''}`;
}
export function mergeComments(
  current: ReaderComment[],
  incoming: ReaderComment[],
): ReaderComment[] {
  const byId = new Map(current.map((item) => [item.id, item]));
  for (const item of incoming) {
    const old = byId.get(item.id);
    if (!old || old.version <= item.version) byId.set(item.id, item);
  }
  return [...byId.values()];
}

// A deleted root anchors its conversation. A deleted reply anchors only replies
// directly answering it; removing a leaf can therefore remove several tombstones.
export function visibleComments(items: ReaderComment[]): ReaderComment[] {
  let result = [...items];
  let changed = true;
  while (changed) {
    const kept = result.filter(
      (item) =>
        item.status === 'live' ||
        result.some(
          (other) =>
            other.id !== item.id &&
            (item.root_id ? other.reply_to_id === item.id : other.root_id === item.id),
        ),
    );
    changed = kept.length !== result.length;
    result = kept;
  }
  const byDate = (a: ReaderComment, b: ReaderComment) =>
    a.posted_at.localeCompare(b.posted_at) || a.id.localeCompare(b.id);
  return result
    .filter((item) => !item.root_id)
    .sort(byDate)
    .flatMap((root) => [root, ...result.filter((item) => item.root_id === root.id).sort(byDate)])
    .map((item) =>
      item.reply_to_id && result.find((target) => target.id === item.reply_to_id)?.status !== 'live'
        ? { ...item, reply_to_name: null }
        : item,
    );
}

export class DiscussionStore {
  private pieces = new Map<string, PieceDiscussion>();
  private listeners = new Set<() => void>();
  private profile: Pick<
    CommentSettings,
    'public_name' | 'reply_emails' | 'profile_version' | 'is_admin'
  > | null = null;
  readonly accountId: string | null;
  readonly nameRequests = new Map<
    string,
    { identity: CommentRequestIdentity; name: string; version: number }
  >();
  readonly preferenceRequests = new Map<string, string>();
  constructor(accountId: string | null) {
    this.accountId = accountId;
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  get = (articleId: string): PieceDiscussion => {
    if (!this.pieces.has(articleId)) this.pieces.set(articleId, emptyPiece());
    return this.pieces.get(articleId)!;
  };
  update(articleId: string, update: (piece: PieceDiscussion) => PieceDiscussion) {
    this.pieces.set(articleId, update(this.get(articleId)));
    this.listeners.forEach((listener) => listener());
  }
  patch(articleId: string, update: Partial<PieceDiscussion>) {
    this.update(articleId, (piece) => ({ ...piece, ...update }));
  }
  draft(articleId: string, key: string, update: Partial<ContributionDraft>) {
    this.update(articleId, (piece) => ({
      ...piece,
      drafts: { ...piece.drafts, [key]: { ...(piece.drafts[key] ?? emptyDraft()), ...update } },
    }));
  }
  acceptSettings(articleId: string, incoming: CommentSettings) {
    if (incoming.account_id !== this.accountId) return;
    if (!this.profile || incoming.profile_version >= this.profile.profile_version)
      this.profile = {
        public_name: incoming.public_name,
        reply_emails: incoming.reply_emails,
        profile_version: incoming.profile_version,
        is_admin: incoming.is_admin,
      };
    const profile = this.profile;
    for (const [id, piece] of this.pieces) {
      const old = piece.settings;
      const settings =
        id === articleId
          ? {
              ...incoming,
              ...(old ?? {}),
              ...profile,
              ...(!old || incoming.follow_version >= old.follow_version
                ? {
                    article_updates: incoming.article_updates,
                    follow_version: incoming.follow_version,
                  }
                : {}),
            }
          : old
            ? { ...old, ...profile }
            : null;
      this.pieces.set(id, {
        ...piece,
        settings,
        items: piece.items.map((item) => ({
          ...item,
          ...(item.author_id === this.accountId && item.status === 'live'
            ? { name: profile.public_name }
            : {}),
          ...(item.reply_to_id &&
          piece.items.find((target) => target.id === item.reply_to_id)?.author_id === this.accountId
            ? { reply_to_name: profile.public_name }
            : {}),
        })),
      });
    }
    this.listeners.forEach((listener) => listener());
  }
}
