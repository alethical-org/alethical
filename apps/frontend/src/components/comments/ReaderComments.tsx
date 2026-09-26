import { useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useIsFocused } from '@react-navigation/native';
import { ApiError } from '../../data/api';
import { useAuth } from '../../providers/AuthProvider';
import { useSignInModal } from '../../providers/signInModalContext';
import {
  changeComment,
  checkCommentRequest,
  commentOutcomeUnknown,
  postComment,
  readCommentConversation,
  readComments,
  readCommentSettings,
  saveCommentName,
  saveCommentPreferences,
  type CommentWriteResult,
  type ReaderComment,
} from '../../data/comments';
import {
  COMMENTS_CSS,
  CommentButton,
  CommentDialog,
  CommentNotice,
  DiscussionRules,
  FieldError,
} from './CommentsUI';
import {
  characterCount,
  commentDateLine,
  type DiscussionStore,
  emptyDraft,
  mergeComments,
  visibleComments,
  type ContributionDraft,
  type DraftKind,
  type PendingContribution,
} from './state';
import { useCommentStore } from './useCommentStore';

const SIGN_IN_TARGET = 'alethical.comments.signInTarget';
const newKey = () => crypto.randomUUID();
const draftKey = (kind: DraftKind, target: string | null) =>
  kind === 'comment' ? 'comment' : `${kind}:${target}`;
type ContributionTarget = Pick<ReaderComment, 'id' | 'root_id' | 'name' | 'version'>;

function NameField({
  id,
  value,
  onChange,
  readOnly,
  error,
  edit = false,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  readOnly: boolean;
  error: string;
  edit?: boolean;
}) {
  return (
    <div className="rc-name-field">
      <label className="rc-field-label" htmlFor={id}>
        Public name
      </label>
      <p className="rc-helper" id={`${id}-help`}>
        {edit
          ? 'Changing your public name updates your comments and replies'
          : 'This name appears on your comments and replies'}
      </p>
      <input
        id={id}
        type="text"
        autoComplete="off"
        spellCheck={false}
        value={value}
        readOnly={readOnly}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={!!error}
        aria-describedby={`${id}-help${error ? ` ${id}-error` : ''}`}
      />
      <FieldError id={`${id}-error`}>{error}</FieldError>
    </div>
  );
}

function Composer({
  id,
  kind,
  draft,
  needName,
  name,
  setName,
  setBody,
  submit,
  check,
  cancel,
  locked = false,
  children,
  isReply = false,
  unavailableNotice,
}: {
  id: string;
  kind: DraftKind;
  draft: ContributionDraft;
  needName: boolean;
  name: string;
  setName: (value: string) => void;
  setBody: (value: string) => void;
  submit: () => void;
  check: () => void;
  cancel?: () => void;
  locked?: boolean;
  children?: ReactNode;
  isReply?: boolean;
  unavailableNotice?: string;
}) {
  const label = kind === 'reply' || isReply ? 'Write a reply' : 'Write a comment';
  const count = characterCount(draft.body);
  const busy = draft.busy || draft.checking;
  return (
    <form
      noValidate
      aria-busy={busy}
      onSubmit={(event) => {
        event.preventDefault();
        if (!busy && !draft.pending && !locked) submit();
      }}
    >
      {needName && (
        <NameField
          id={`${id}-name`}
          value={name}
          onChange={setName}
          readOnly={busy || locked}
          error={draft.nameError}
        />
      )}
      {children}
      {unavailableNotice && <CommentNotice>{unavailableNotice}</CommentNotice>}
      <label className="rc-field-label" htmlFor={`${id}-text`}>
        {label}
      </label>
      <textarea
        id={`${id}-text`}
        rows={kind === 'comment' ? 5 : 4}
        value={draft.body}
        readOnly={busy}
        aria-invalid={!!draft.bodyError}
        aria-describedby={`${id}-count${draft.bodyError ? ` ${id}-error` : ''}`}
        onChange={(event) => setBody(event.target.value)}
      />
      <div className="rc-field-bottom">
        <div>
          <FieldError id={`${id}-error`}>{draft.bodyError}</FieldError>
        </div>
        <span id={`${id}-count`} className={`rc-count${count > 2000 ? ' rc-count-over' : ''}`}>
          {count.toLocaleString('en-US')} of 2,000
        </span>
      </div>
      {draft.notice && (!unavailableNotice || draft.pending) && (
        <CommentNotice>
          {draft.notice}
          {draft.pending && (
            <div>
              <CommentButton
                type="button"
                label="Check submission"
                busyLabel="Checking…"
                kind="outline"
                busy={draft.checking}
                onClick={check}
              />
            </div>
          )}
        </CommentNotice>
      )}
      <div className="rc-actions">
        <CommentButton
          type="submit"
          className={kind === 'comment' ? 'rc-post rc-primary' : ''}
          label={
            kind === 'edit' ? 'Save changes' : kind === 'reply' ? 'Post reply' : 'Post comment'
          }
          busyLabel={kind === 'edit' ? 'Saving…' : 'Posting…'}
          busy={draft.busy}
          locked={!!draft.pending || draft.checking || locked}
        />
        {cancel && (
          <CommentButton
            type="button"
            label="Cancel"
            kind="outline"
            locked={busy || !!draft.pending}
            onClick={cancel}
          />
        )}
      </div>
      <span className="rc-sr-only" role="status">
        {busy ? (draft.checking ? 'Checking…' : kind === 'edit' ? 'Saving…' : 'Posting…') : ''}
      </span>
    </form>
  );
}

export function ReaderComments({ articleId }: { articleId: string }) {
  const focused = useIsFocused();
  const { user, accessToken, isLoading: authLoading } = useAuth();
  const { openSignIn } = useSignInModal();
  const store = useCommentStore();
  const piece = useSyncExternalStore(
    store.subscribe,
    () => store.get(articleId),
    () => store.get(articleId),
  );
  const prefix = useId();
  const headingId = `${prefix}-comments`;
  const section = useRef<HTMLElement>(null);
  const current = useRef({ articleId, store, focused, mounted: true });
  current.current = { articleId, store, focused, mounted: true };
  const requestEpoch = useRef(new Map<string, number>());
  const nameRequests = store.nameRequests;
  const preferenceRequests = store.preferenceRequests;
  const signInTarget = useRef<{ articleId: string; target: string | null; path: string } | null>(
    null,
  );
  const [dialog, setDialog] = useState<{
    articleId: string;
    store: DiscussionStore;
    comment: ReaderComment;
    action: 'delete' | 'remove';
    key: string;
    busy: boolean;
    error: string;
  } | null>(null);
  const dialogRef = useRef(dialog);
  dialogRef.current = dialog;

  useEffect(() => {
    current.current.mounted = true;
    return () => {
      current.current.mounted = false;
    };
  }, []);
  useEffect(() => {
    setDialog(null);
  }, [store]);
  useEffect(() => {
    setDialog(null);
  }, [articleId, focused]);
  const isVisible = (id = articleId, owner = store) =>
    current.current.mounted &&
    current.current.focused &&
    current.current.articleId === id &&
    current.current.store === owner;
  const focus = (id: string, ownerArticle = articleId, owner = store, scroll = false) => {
    requestAnimationFrame(() => {
      if (!isVisible(ownerArticle, owner)) return;
      const node = section.current?.querySelector<HTMLElement>(`[id="${id}"]`);
      node?.focus({ preventScroll: !scroll });
      if (scroll) node?.scrollIntoView?.({ block: 'nearest' });
    });
  };
  const apply = (result: CommentWriteResult) => {
    if (result.comment)
      store.update(articleId, (state) => ({
        ...state,
        items: mergeComments(state.items, [result.comment!]),
      }));
    if (result.settings) store.acceptSettings(articleId, result.settings);
  };
  const refreshConversation = async (target: Pick<ReaderComment, 'id' | 'root_id'>) => {
    const rootId = target.root_id ?? target.id;
    const before = store.get(articleId).items;
    let page;
    try {
      page = await readCommentConversation(articleId, rootId);
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 404) throw error;
      page = { items: [], next_cursor: null };
    }
    const returned = new Set(page.items.map((item) => item.id));
    store.update(articleId, (state) => ({
      ...state,
      items: mergeComments(
        state.items.filter((item) => {
          if (item.id !== rootId && item.root_id !== rootId) return true;
          return (
            returned.has(item.id) ||
            !before.some((previous) => previous.id === item.id && previous.version === item.version)
          );
        }),
        page.items,
      ),
    }));
    return store
      .get(articleId)
      .items.some((item) => item.id === target.id && item.status === 'live');
  };

  const load = async (more = false) => {
    const before = store.get(articleId);
    if (before.loading || before.loadingMore || (more && !before.nextCursor)) return;
    const epoch = (requestEpoch.current.get(articleId) ?? 0) + 1;
    requestEpoch.current.set(articleId, epoch);
    store.patch(articleId, { loading: !more, loadingMore: more, listError: false });
    try {
      const page = await readComments(articleId, more ? before.nextCursor : null);
      if (requestEpoch.current.get(articleId) !== epoch) {
        store.patch(articleId, { loading: false, loadingMore: false });
        return;
      }
      const roots = page.items.filter((item) => !item.root_id).map((item) => item.id);
      store.update(articleId, (state) => ({
        ...state,
        items: mergeComments(state.items, page.items),
        loadedRoots: more ? [...new Set([...state.loadedRoots, ...roots])] : roots,
        nextCursor: page.next_cursor,
        loaded: true,
        loading: false,
        loadingMore: false,
        listError: false,
      }));
      const settings = store.get(articleId).settings;
      if (settings) store.acceptSettings(articleId, settings);
      if (more && roots[0]) focus(`comment-${roots[0]}`, articleId, store);
    } catch {
      if (requestEpoch.current.get(articleId) !== epoch) return;
      store.patch(articleId, { loading: false, loadingMore: false, listError: true });
      if (more) focus(`${prefix}-retry`);
    }
  };

  const loadSettings = async () => {
    if (!accessToken || !store.accountId || store.get(articleId).settingsLoading) return;
    store.patch(articleId, { settingsLoading: true, settingsError: false });
    try {
      store.acceptSettings(articleId, await readCommentSettings(accessToken, articleId));
    } catch {
      store.patch(articleId, { settingsError: true });
    } finally {
      store.patch(articleId, { settingsLoading: false });
    }
  };

  useEffect(() => {
    if (!focused) return;
    if (!store.get(articleId).loaded && !store.get(articleId).loading) void load();
    if (accessToken && !store.get(articleId).settings) void loadSettings();
    // Each article owns its loaded pages. Returning to it keeps its draft and view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [articleId, store, accessToken, focused]);

  useEffect(() => {
    if (!focused) return;
    const match = /^#comment-([0-9a-f-]{36})$/i.exec(window.location.hash);
    if (!match) return;
    const id = match[1];
    let cancelled = false;
    void readCommentConversation(articleId, id)
      .then((page) => {
        if (cancelled) return;
        store.update(articleId, (state) => ({
          ...state,
          items: mergeComments(state.items, page.items),
        }));
        focus(`comment-${id}`, articleId, store, true);
      })
      .catch(() => {
        /* The ordinary comments list remains usable if a link was removed. */
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [articleId, store, focused]);

  const openBox = (kind: 'reply' | 'edit', item: ReaderComment) => {
    const key = draftKey(kind, item.id);
    store.update(articleId, (state) => ({
      ...state,
      activeBox: { kind, target: item.id, rootId: item.root_id },
      drafts: {
        ...state.drafts,
        [key]: state.drafts[key] ?? {
          ...emptyDraft(),
          body: kind === 'edit' ? (item.body ?? '') : '',
        },
      },
    }));
    focus(
      `${prefix}-${key}-${kind === 'reply' && !piece.settings?.public_name ? 'name' : 'text'}`,
      articleId,
      store,
      true,
    );
  };

  const signIn = (target: string | null) => {
    signInTarget.current = { articleId, target, path: window.location.pathname };
    try {
      window.sessionStorage.setItem(SIGN_IN_TARGET, JSON.stringify(signInTarget.current));
    } catch {
      /* The in-place flow still works when browser storage is unavailable. */
    }
    openSignIn({ intent: 'nav', returnTo: window.location.pathname, scrollY: window.scrollY });
  };

  useEffect(() => {
    if (!focused || !piece.settings || !store.accountId) return;
    let pending: { articleId?: string; target?: string | null; path?: string };
    try {
      pending =
        JSON.parse(window.sessionStorage.getItem(SIGN_IN_TARGET) ?? 'null') ?? signInTarget.current;
    } catch {
      pending = signInTarget.current ?? {};
    }
    if (!pending || pending.articleId !== articleId || pending.path !== window.location.pathname)
      return;
    let cancelled = false;
    const restore = async () => {
      if (pending.target) {
        try {
          const conversation = await readCommentConversation(articleId, pending.target);
          if (cancelled) return;
          store.update(articleId, (state) => ({
            ...state,
            items: mergeComments(state.items, conversation.items),
          }));
          const target = conversation.items.find(
            (item) => item.id === pending.target && item.status === 'live',
          );
          if (target) openBox('reply', target);
          else
            focus(
              `${prefix}-comment-${piece.settings?.public_name ? 'text' : 'name'}`,
              articleId,
              store,
              true,
            );
        } catch {
          if (!cancelled) focus(headingId, articleId, store, true);
        }
      } else
        focus(
          `${prefix}-comment-${piece.settings?.public_name ? 'text' : 'name'}`,
          articleId,
          store,
          true,
        );
      if (!cancelled) {
        signInTarget.current = null;
        try {
          window.sessionStorage.removeItem(SIGN_IN_TARGET);
        } catch {
          /* No private draft is stored here. */
        }
      }
    };
    void restore();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [articleId, store, !!piece.settings, focused]);

  const finishContribution = (
    key: string,
    pending: PendingContribution,
    result: CommentWriteResult,
    checked: boolean,
  ) => {
    apply(result);
    const sameBody = store.get(articleId).drafts[key]?.body === pending.body;
    store.draft(articleId, key, {
      busy: false,
      checking: false,
      pending: null,
      notice: '',
      body: sameBody ? '' : (store.get(articleId).drafts[key]?.body ?? ''),
    });
    if (sameBody && pending.kind !== 'comment')
      store.update(articleId, (state) => {
        const drafts = { ...state.drafts };
        delete drafts[key];
        return { ...state, drafts };
      });
    if (result.comment) {
      const noun = pending.kind === 'reply' ? 'reply' : 'comment';
      store.update(articleId, (state) => ({
        ...state,
        activeBox: sameBody && state.activeBox?.target === pending.target ? null : state.activeBox,
        messages: {
          ...state.messages,
          [result.comment!.id]:
            pending.kind === 'edit'
              ? 'Changes saved'
              : checked
                ? `Your ${noun} was posted`
                : `${noun === 'reply' ? 'Reply' : 'Comment'} posted`,
        },
      }));
      focus(`comment-${result.comment.id}`, articleId, store, true);
    }
  };

  const submit = async (kind: DraftKind, target: ContributionTarget | null) => {
    const state = store.get(articleId);
    const settings = state.settings;
    if (!accessToken || !settings) return;
    const key = draftKey(kind, target?.id ?? null);
    const draft = state.drafts[key] ?? emptyDraft();
    if (
      draft.busy ||
      draft.checking ||
      draft.pending ||
      draft.unavailable ||
      state.nameBusy ||
      state.preferencesBusy
    )
      return;
    const needName = !settings.public_name && kind !== 'edit';
    const noun = kind === 'reply' || target?.root_id ? 'reply' : 'comment';
    const bodyError = !draft.body.trim()
      ? `Write a ${noun}`
      : characterCount(draft.body) > 2000
        ? `Keep your ${noun} to 2,000 characters`
        : '';
    const nameError = needName && !state.nameDraft.trim() ? 'Enter a public name' : '';
    store.draft(articleId, key, { bodyError, nameError, notice: '' });
    if (bodyError || nameError) {
      focus(`${prefix}-${key}-${nameError ? 'name' : 'text'}`);
      return;
    }
    const pending: PendingContribution = {
      key: newKey(),
      body: draft.body,
      kind,
      target: target?.id ?? null,
      targetRootId: target?.root_id ?? null,
      expectedVersion: target?.version,
      publicName: needName ? state.nameDraft : undefined,
      profileVersion: needName ? settings.profile_version : undefined,
    };
    store.draft(articleId, key, { busy: true });
    try {
      const identity = { request_key: pending.key, expected_account_id: settings.account_id };
      const result =
        kind === 'edit' && target
          ? await changeComment(accessToken, articleId, target.id, 'edit', {
              ...identity,
              expected_version: target.version,
              body: pending.body,
            })
          : await postComment(accessToken, articleId, {
              ...identity,
              body: pending.body,
              reply_to_id: target?.id ?? null,
              ...(needName
                ? {
                    public_name: pending.publicName,
                    expected_profile_version: pending.profileVersion,
                  }
                : {}),
            });
      finishContribution(key, pending, result, false);
    } catch (error) {
      const unknown = commentOutcomeUnknown(error);
      let unavailable = !!target && error instanceof ApiError && error.status === 404;
      if (!unknown && target) {
        try {
          unavailable = !(await refreshConversation(target));
        } catch {
          /* A failed refresh cannot establish a different target state. */
        }
      }
      store.draft(articleId, key, {
        busy: false,
        unavailable,
        pending: unknown ? pending : null,
        notice:
          kind === 'edit'
            ? unknown
              ? 'We couldn’t confirm whether your changes were saved'
              : 'Couldn’t save your changes. Try again.'
            : unknown
              ? `We couldn’t confirm whether your ${noun} was posted`
              : `Couldn’t post your ${noun}. Try again.`,
      });
      if (!unknown) void loadSettings();
    }
  };

  const check = async (key: string) => {
    const draft = store.get(articleId).drafts[key];
    const pending = draft?.pending;
    if (!accessToken || !pending || draft.checking || draft.busy) return;
    store.draft(articleId, key, { checking: true });
    try {
      const response = await checkCommentRequest(accessToken, articleId, pending.key);
      if (response.state === 'saved' && response.result)
        finishContribution(key, pending, response.result, true);
      else {
        let unavailable = draft.unavailable ?? false;
        if (pending.target) {
          try {
            unavailable = !(await refreshConversation({
              id: pending.target,
              root_id: pending.targetRootId,
            }));
          } catch {
            /* Keep a known draft even when its target cannot be refreshed. */
          }
        }
        store.draft(articleId, key, {
          checking: false,
          pending: null,
          unavailable,
          notice:
            pending.kind === 'edit'
              ? 'Your changes weren’t saved. Try again.'
              : `Your ${pending.kind === 'reply' ? 'reply' : 'comment'} wasn’t posted. Try again.`,
        });
      }
    } catch {
      store.draft(articleId, key, { checking: false });
    }
  };

  const saveName = async () => {
    const state = store.get(articleId);
    const settings = state.settings;
    if (!settings || !accessToken || state.nameBusy || state.preferencesBusy) return;
    if (!state.nameEditDraft.trim()) {
      store.patch(articleId, { nameError: 'Enter a public name' });
      focus(`${prefix}-name-edit`);
      return;
    }
    let pending = nameRequests.get(articleId);
    if (!pending) {
      pending = {
        identity: { request_key: newKey(), expected_account_id: settings.account_id },
        name: state.nameEditDraft,
        version: settings.profile_version,
      };
      nameRequests.set(articleId, pending);
    }
    store.patch(articleId, { nameBusy: true, nameError: '', nameNotice: '', nameStatus: '' });
    try {
      const result = await saveCommentName(accessToken, {
        ...pending.identity,
        article_id: articleId,
        expected_version: pending.version,
        public_name: pending.name,
      });
      apply(result);
      nameRequests.delete(articleId);
      const unchanged = store.get(articleId).nameEditDraft === pending.name;
      store.patch(articleId, {
        nameBusy: false,
        nameEditing: !unchanged,
        nameStatus: 'Name updated',
      });
      if (unchanged) focus(`${prefix}-change-name`);
    } catch (error) {
      const unknown = commentOutcomeUnknown(error);
      if (!unknown) nameRequests.delete(articleId);
      store.patch(articleId, {
        nameBusy: false,
        nameNotice: unknown
          ? 'We couldn’t confirm whether your name was saved. Try again.'
          : 'Couldn’t save your name. Try again.',
      });
      if (!unknown) void loadSettings();
    }
  };

  const savePreference = async (field: 'reply_emails' | 'article_updates', value: boolean) => {
    const state = store.get(articleId);
    let settings = state.settings;
    if (!settings || !accessToken || state.preferencesBusy || state.nameBusy) return;
    store.patch(articleId, {
      preferencesBusy: true,
      preferencesStatus: 'Saving…',
      preferencesError: '',
    });
    let sendingKey: string | null = null;
    try {
      const unresolved = preferenceRequests.get(articleId);
      if (unresolved) {
        const previous = await checkCommentRequest(accessToken, articleId, unresolved);
        if (previous.state === 'saved' && previous.result) apply(previous.result);
        preferenceRequests.delete(articleId);
        settings = store.get(articleId).settings ?? settings;
      }
      store.patch(articleId, { settings: { ...settings, [field]: value } });
      sendingKey = newKey();
      preferenceRequests.set(articleId, sendingKey);
      apply(
        await saveCommentPreferences(accessToken, {
          request_key: sendingKey,
          expected_account_id: settings.account_id,
          article_id: articleId,
          [field]: value,
          expected_profile_version: settings.profile_version,
          expected_follow_version: settings.follow_version,
        }),
      );
      preferenceRequests.delete(articleId);
      store.patch(articleId, { preferencesBusy: false, preferencesStatus: 'Email choices saved' });
    } catch (error) {
      const unknown = commentOutcomeUnknown(error);
      if (!unknown && sendingKey) preferenceRequests.delete(articleId);
      const latest = store.get(articleId).settings ?? settings;
      const version = field === 'reply_emails' ? 'profile_version' : 'follow_version';
      store.patch(articleId, {
        settings: {
          ...latest,
          [field]: latest[version] > settings[version] ? latest[field] : settings[field],
        },
        preferencesBusy: false,
        preferencesStatus: '',
        preferencesError: unknown
          ? 'We couldn’t confirm whether your email choices were saved. Try again.'
          : 'Couldn’t save your email choices. Try again.',
      });
      if (!unknown) void loadSettings();
    }
  };

  const remove = async () => {
    const captured = dialogRef.current;
    const settings = piece.settings;
    if (
      !captured ||
      captured.busy ||
      captured.store !== store ||
      captured.articleId !== articleId ||
      !settings ||
      !accessToken
    )
      return;
    const next = { ...captured, busy: true, error: '' };
    dialogRef.current = next;
    setDialog(next);
    const item = captured.comment;
    const beforeOrder = visibleComments(store.get(articleId).items);
    try {
      const result = await changeComment(accessToken, articleId, item.id, captured.action, {
        request_key: captured.key,
        expected_account_id: settings.account_id,
        expected_version: item.version,
      });
      apply(result);
      if (isVisible() && dialogRef.current?.key === captured.key) {
        dialogRef.current = null;
        setDialog(null);
      }
      store.patch(articleId, { updating: true });
      try {
        await refreshConversation(item);
      } catch {
        /* The saved tombstone is authoritative even if refresh is unavailable. */
      }
      store.patch(articleId, { updating: false });
      const visible = visibleComments(store.get(articleId).items);
      const surviving = new Set(visible.map((comment) => comment.id));
      const nextItem = beforeOrder
        .slice(beforeOrder.findIndex((comment) => comment.id === item.id) + 1)
        .find((comment) => surviving.has(comment.id));
      focus(
        surviving.has(item.id)
          ? `comment-${item.id}`
          : nextItem
            ? `comment-${nextItem.id}`
            : headingId,
      );
    } catch (error) {
      const noun = item.root_id ? 'reply' : 'comment';
      const removing = captured.action === 'remove';
      const message = commentOutcomeUnknown(error)
        ? `We couldn’t confirm whether ${removing ? 'this' : 'your'} ${noun} was ${removing ? 'removed' : 'deleted'}. Try again.`
        : `Couldn’t ${removing ? 'remove this' : 'delete your'} ${noun}. Try again.`;
      if (isVisible() && dialogRef.current?.key === captured.key) {
        const failed = { ...captured, busy: false, error: message };
        dialogRef.current = failed;
        setDialog(failed);
      }
      if (!commentOutcomeUnknown(error)) {
        try {
          await refreshConversation(item);
          const latest = store.get(articleId).items.find((comment) => comment.id === item.id);
          if (isVisible() && dialogRef.current?.key === captured.key && latest) {
            const refreshed = { ...dialogRef.current, comment: latest, key: newKey() };
            dialogRef.current = refreshed;
            setDialog(refreshed);
          }
        } catch {
          /* Keep the failed action and excerpt available for retry. */
        }
      }
    }
  };

  const cancelBox = (kind: 'reply' | 'edit', target: string) => {
    const key = draftKey(kind, target);
    const draft = store.get(articleId).drafts[key];
    if (draft?.busy || draft?.checking || draft?.pending) return;
    store.update(articleId, (state) => {
      const drafts = { ...state.drafts };
      delete drafts[key];
      return { ...state, activeBox: null, drafts };
    });
    focus(
      store.get(articleId).items.some((item) => item.id === target && item.status === 'live')
        ? `${prefix}-${kind}-action-${target}`
        : headingId,
    );
  };
  const composing = Object.values(piece.drafts).some((draft) => draft.busy || draft.checking);
  const settingsLocked = composing || piece.nameBusy || piece.preferencesBusy;
  const composer = (kind: DraftKind, target: ContributionTarget | null, unavailable = false) => {
    const key = draftKey(kind, target?.id ?? null);
    return (
      <Composer
        id={`${prefix}-${key}`}
        kind={kind}
        isReply={!!target?.root_id}
        draft={piece.drafts[key] ?? emptyDraft()}
        needName={!unavailable && kind !== 'edit' && !piece.settings?.public_name}
        unavailableNotice={
          unavailable
            ? `${kind === 'reply' ? `The ${target?.root_id ? 'reply' : 'comment'} you were replying to` : `This ${target?.root_id ? 'reply' : 'comment'}`} is no longer available. Your draft is kept here.`
            : undefined
        }
        name={piece.nameDraft}
        setName={(nameDraft) => store.patch(articleId, { nameDraft })}
        setBody={(body) => store.draft(articleId, key, { body, bodyError: '' })}
        submit={() => {
          void submit(kind, target);
        }}
        check={() => {
          void check(key);
        }}
        locked={
          unavailable ||
          piece.nameBusy ||
          piece.preferencesBusy ||
          (!piece.settings?.public_name &&
            composing &&
            !(piece.drafts[key]?.busy || piece.drafts[key]?.checking))
        }
        cancel={kind !== 'comment' && target ? () => cancelBox(kind, target.id) : undefined}
      >
        {kind === 'reply' && target?.root_id && target.name ? (
          <p className="rc-replying">Replying to {target.name}</p>
        ) : null}
      </Composer>
    );
  };
  const renderItem = (item: ReaderComment) => {
    const editing =
      piece.activeBox?.target === item.id &&
      piece.activeBox.kind === 'edit' &&
      !piece.drafts[draftKey('edit', item.id)]?.unavailable;
    const replying =
      piece.activeBox?.target === item.id &&
      piece.activeBox.kind === 'reply' &&
      !piece.drafts[draftKey('reply', item.id)]?.unavailable;
    const mine = !!piece.settings && item.author_id === piece.settings.account_id;
    const live = item.status === 'live';
    return (
      <div className={item.root_id ? 'rc-reply-row' : 'rc-comment-row'} key={item.id}>
        <div className={item.root_id ? 'rc-reply-inner' : undefined}>
          <article
            id={`comment-${item.id}`}
            tabIndex={-1}
            aria-label={
              live
                ? `${item.root_id ? 'Reply' : 'Comment'} by ${item.name}`
                : `Comment ${item.status}`
            }
          >
            {live ? (
              <>
                <div className="rc-item-heading">
                  <span className="rc-name">{item.name}</span>
                  <span className="rc-item-date">{commentDateLine(item)}</span>
                </div>
                {item.reply_to_name && item.reply_to_id !== item.root_id && (
                  <p className="rc-replying">Replying to {item.reply_to_name}</p>
                )}
                {editing ? (
                  <div className="rc-box rc-inline-card">{composer('edit', item)}</div>
                ) : (
                  <>
                    <p className="rc-body">{item.body}</p>
                    <div className="rc-item-actions">
                      <CommentButton
                        id={`${prefix}-reply-action-${item.id}`}
                        type="button"
                        kind="text"
                        label={user ? 'Reply' : 'Sign in to reply'}
                        locked={!!user && !piece.settings}
                        onClick={() => (user ? openBox('reply', item) : signIn(item.id))}
                      />
                      {mine && (
                        <>
                          <CommentButton
                            id={`${prefix}-edit-action-${item.id}`}
                            type="button"
                            kind="text"
                            label="Edit"
                            onClick={() => openBox('edit', item)}
                          />
                          <CommentButton
                            type="button"
                            kind="text"
                            label="Delete"
                            onClick={() =>
                              setDialog({
                                articleId,
                                store,
                                comment: item,
                                action: 'delete',
                                key: newKey(),
                                busy: false,
                                error: '',
                              })
                            }
                          />
                        </>
                      )}
                      {piece.settings?.is_admin && (
                        <CommentButton
                          type="button"
                          kind="text"
                          label="Remove"
                          onClick={() =>
                            setDialog({
                              articleId,
                              store,
                              comment: item,
                              action: 'remove',
                              key: newKey(),
                              busy: false,
                              error: '',
                            })
                          }
                        />
                      )}
                      <span role="status" className="rc-item-success">
                        {piece.messages[item.id] ?? ''}
                      </span>
                    </div>
                  </>
                )}
              </>
            ) : (
              <p className="rc-placeholder">
                {item.status === 'removed' ? 'Comment removed' : 'Comment deleted'}
              </p>
            )}
          </article>
          {replying && live && (
            <div className={item.root_id ? undefined : 'rc-reply-composer'}>
              <div className="rc-box rc-inline-card">{composer('reply', item)}</div>
            </div>
          )}
        </div>
      </div>
    );
  };
  const shown = visibleComments(piece.items);
  const activeTarget = piece.items.find((item) => item.id === piece.activeBox?.target);
  const unavailableBox =
    piece.activeBox &&
    (!activeTarget ||
      activeTarget.status !== 'live' ||
      piece.drafts[draftKey(piece.activeBox.kind, piece.activeBox.target)]?.unavailable)
      ? piece.activeBox
      : null;
  const roots = shown.filter((item) => !item.root_id);
  const loadedSet = new Set(piece.loadedRoots);
  const loadedRoots = roots.filter((root) => loadedSet.has(root.id));
  const extraRoots = roots.filter((root) => !loadedSet.has(root.id));
  const renderConversation = (root: ReaderComment) => (
    <li className="rc-conversation" key={root.id}>
      {renderItem(root)}
      {shown.filter((item) => item.root_id === root.id).map(renderItem)}
    </li>
  );
  const loadMore = piece.nextCursor ? (
    <li className="rc-more" key="load-more">
      {piece.listError ? (
        <div role="alert" className="rc-more-error">
          <p>Comments could not be loaded</p>
          <CommentButton
            id={`${prefix}-retry`}
            type="button"
            label="Try again"
            kind="outline"
            onClick={() => {
              void load(true);
            }}
          />
        </div>
      ) : (
        <CommentButton
          type="button"
          className="rc-post"
          label="Load more"
          busyLabel="Loading more…"
          kind="outline"
          busy={piece.loadingMore}
          onClick={() => {
            void load(true);
          }}
        />
      )}
      <span className="rc-sr-only" role="status">
        {piece.loadingMore ? 'Loading more…' : ''}
      </span>
    </li>
  ) : null;

  // The navigator retains older screens. Their drafts live in the account cache,
  // but only the active discussion may expose fragment targets or take focus.
  if (!focused) return null;

  return (
    <section
      ref={section}
      id="reader-comments"
      className="rc rc-region"
      aria-labelledby={headingId}
    >
      <style>{COMMENTS_CSS}</style>
      <div className="rc-grid">
        <div className="rc-title">
          <h2 id={headingId} tabIndex={-1}>
            Reader comments
          </h2>
          <p className="rc-disclaimer">Names are chosen by readers and are not verified</p>
        </div>
        <DiscussionRules />
        <div className="rc-discussion">
          <div className="rc-card rc-form-card">
            {!user ? (
              <CommentButton
                type="button"
                className="rc-primary"
                label="Sign in to comment"
                locked={authLoading}
                onClick={() => signIn(null)}
              />
            ) : !piece.settings ? (
              piece.settingsError ? (
                <div role="alert">
                  <p>Comment settings could not be loaded</p>
                  <CommentButton
                    type="button"
                    kind="outline"
                    label="Try again"
                    onClick={() => {
                      void loadSettings();
                    }}
                  />
                </div>
              ) : (
                <p role="status">Loading comment settings…</p>
              )
            ) : (
              <>
                {piece.settings.public_name && (
                  <>
                    {piece.nameEditing ? (
                      <div className="rc-inline-card">
                        <NameField
                          id={`${prefix}-name-edit`}
                          edit
                          value={piece.nameEditDraft}
                          onChange={(nameEditDraft) =>
                            store.patch(articleId, { nameEditDraft, nameError: '' })
                          }
                          readOnly={piece.nameBusy}
                          error={piece.nameError}
                        />
                        {piece.nameNotice && <CommentNotice>{piece.nameNotice}</CommentNotice>}
                        <div className="rc-actions">
                          <CommentButton
                            type="button"
                            label="Save name"
                            busyLabel="Saving…"
                            busy={piece.nameBusy}
                            locked={piece.preferencesBusy || composing}
                            onClick={() => {
                              void saveName();
                            }}
                          />
                          <CommentButton
                            type="button"
                            label="Cancel"
                            kind="outline"
                            locked={piece.nameBusy || !!nameRequests.get(articleId)}
                            onClick={() => {
                              store.patch(articleId, {
                                nameEditing: false,
                                nameNotice: '',
                                nameError: '',
                              });
                              focus(`${prefix}-change-name`);
                            }}
                          />
                        </div>
                      </div>
                    ) : (
                      <div className="rc-name-row">
                        <div>
                          <div className="rc-name-label">Public name</div>
                          <div className="rc-name">{piece.settings.public_name}</div>
                        </div>
                        <CommentButton
                          id={`${prefix}-change-name`}
                          type="button"
                          label="Change name"
                          kind="text"
                          locked={settingsLocked}
                          onClick={() => {
                            store.patch(articleId, {
                              nameEditing: true,
                              nameEditDraft: piece.settings!.public_name ?? '',
                              nameError: '',
                              nameNotice: '',
                              nameStatus: '',
                            });
                            focus(`${prefix}-name-edit`);
                          }}
                        />
                      </div>
                    )}
                    <p role="status" className="rc-name-status">
                      {piece.nameStatus}
                    </p>
                  </>
                )}
                {composer('comment', null)}
                <fieldset className="rc-emails">
                  <legend>Emails</legend>
                  <div className="rc-choices">
                    {(
                      [
                        ['reply_emails', 'Email me when someone replies to me'],
                        [
                          'article_updates',
                          'Email me about all new or edited comments and replies on this article',
                        ],
                      ] as const
                    ).map(([key, label]) => (
                      <label className="rc-choice" key={key}>
                        <input
                          type="checkbox"
                          checked={piece.settings![key]}
                          aria-disabled={settingsLocked}
                          onChange={(event) => {
                            if (!settingsLocked) void savePreference(key, event.target.checked);
                          }}
                        />
                        <span>{label}</span>
                      </label>
                    ))}
                  </div>
                  <p className="rc-preferences-status" role="status">
                    {piece.preferencesStatus}
                  </p>
                  {piece.preferencesError && (
                    <CommentNotice>{piece.preferencesError}</CommentNotice>
                  )}
                </fieldset>
              </>
            )}
          </div>
          <div className="rc-list" aria-busy={piece.loading || piece.loadingMore || piece.updating}>
            {unavailableBox && (
              <div className="rc-box rc-inline-card">
                {composer(
                  unavailableBox.kind,
                  {
                    id: unavailableBox.target,
                    root_id: unavailableBox.rootId,
                    name: null,
                    version: 0,
                  },
                  true,
                )}
              </div>
            )}
            <div className="rc-list-status">
              <span>{shown.length > 0 ? 'Oldest first' : ''}</span>
              <span role="status">{piece.updating ? 'Updating comments…' : ''}</span>
            </div>
            {!piece.loaded && !piece.listError && shown.length === 0 ? (
              <div className="rc-card rc-skeleton">
                <p role="status">Loading comments…</p>
                {[0, 1, 2].map((i) => (
                  <div key={i} aria-hidden="true" className="rc-skeleton-row" />
                ))}
              </div>
            ) : null}
            {!piece.loaded && piece.listError ? (
              <div className="rc-card rc-load-error" role="alert">
                <p>Comments could not be loaded</p>
                <CommentButton
                  id={`${prefix}-retry`}
                  type="button"
                  label="Try again"
                  kind="outline"
                  onClick={() => {
                    void load();
                  }}
                />
              </div>
            ) : null}
            {piece.loaded && !shown.length && !piece.nextCursor ? (
              <p className="rc-card rc-empty">No comments yet</p>
            ) : null}
            {(shown.length > 0 || piece.nextCursor) && (
              <ol className="rc-conversations">
                {loadedRoots.map(renderConversation)}
                {loadMore}
                {extraRoots.map(renderConversation)}
              </ol>
            )}
          </div>
        </div>
      </div>
      {dialog && dialog.articleId === articleId && dialog.store === store && (
        <CommentDialog
          comment={dialog.comment}
          action={dialog.action}
          busy={dialog.busy}
          error={dialog.error}
          onClose={() => {
            if (!dialogRef.current?.busy) setDialog(null);
          }}
          onConfirm={() => {
            void remove();
          }}
        />
      )}
    </section>
  );
}
