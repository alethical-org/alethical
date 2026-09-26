import { apiRequest, ApiError, publicApiRequest } from './api';

export interface ReaderComment {
  id: string;
  article_id: string;
  author_id: string | null;
  name: string | null;
  body: string | null;
  root_id: string | null;
  reply_to_id: string | null;
  reply_to_name: string | null;
  posted_at: string;
  edited_at: string | null;
  status: 'live' | 'deleted' | 'removed';
  version: number;
}

export interface CommentSettings {
  account_id: string;
  public_name: string | null;
  reply_emails: boolean;
  article_updates: boolean;
  profile_version: number;
  follow_version: number;
  is_admin: boolean;
}

export interface CommentPage {
  items: ReaderComment[];
  next_cursor: string | null;
}

export interface CommentWriteResult {
  comment: ReaderComment | null;
  settings: CommentSettings | null;
}

export interface CommentRequestIdentity {
  request_key: string;
  expected_account_id: string;
}

export interface CommentWrite extends CommentRequestIdentity {
  body: string;
  reply_to_id?: string | null;
  public_name?: string;
  expected_profile_version?: number;
}

export type StopCommentEmailChoice = 'replies' | 'article';
export interface CommentEmailStopState {
  article_id: string;
  article_title: string;
  article_path: string;
  link_choice: StopCommentEmailChoice;
  reply_emails: boolean;
  article_updates: boolean;
}

type Detail<T> = { data: T };
const articlePath = (articleId: string) => `/comments/articles/${encodeURIComponent(articleId)}`;

// A bounded wait is an unknown write outcome, never proof that nothing saved.
// Callers retain the original request key until the status endpoint resolves it.
async function bounded<T>(run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    return await run(controller.signal);
  } finally {
    clearTimeout(timeout);
  }
}

async function privateRequest<T>(token: string, path: string, body?: object): Promise<T> {
  return bounded(async (signal) => {
    const result = await apiRequest<Detail<T>>(
      path,
      {
        method: body ? 'POST' : 'GET',
        body: body ? JSON.stringify(body) : undefined,
        cache: 'no-store',
        signal,
      },
      token,
    );
    return result.data;
  });
}

export function readComments(articleId: string, cursor?: string | null): Promise<CommentPage> {
  const path = `${articlePath(articleId)}${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`;
  return bounded(
    async (signal) => (await publicApiRequest<Detail<CommentPage>>(path, signal)).data,
  );
}

export function readCommentConversation(articleId: string, id: string): Promise<CommentPage> {
  return bounded(
    async (signal) =>
      (
        await publicApiRequest<Detail<CommentPage>>(
          `${articlePath(articleId)}/conversation/${encodeURIComponent(id)}`,
          signal,
        )
      ).data,
  );
}

export function readCommentSettings(token: string, articleId: string): Promise<CommentSettings> {
  return privateRequest(token, `/me/comments/settings?article_id=${encodeURIComponent(articleId)}`);
}

export function postComment(
  token: string,
  articleId: string,
  body: CommentWrite,
): Promise<CommentWriteResult> {
  return privateRequest(token, articlePath(articleId), body);
}

export function changeComment(
  token: string,
  articleId: string,
  id: string,
  action: 'edit' | 'delete' | 'remove',
  body: CommentRequestIdentity & { expected_version: number; body?: string },
): Promise<CommentWriteResult> {
  return privateRequest(
    token,
    `${articlePath(articleId)}/${encodeURIComponent(id)}/${action}`,
    body,
  );
}

export function saveCommentName(
  token: string,
  body: CommentRequestIdentity & {
    article_id: string;
    expected_version: number;
    public_name: string;
  },
): Promise<CommentWriteResult> {
  return privateRequest(token, '/me/comments/name', body);
}

export function saveCommentPreferences(
  token: string,
  body: CommentRequestIdentity & {
    article_id: string;
    reply_emails?: boolean;
    article_updates?: boolean;
    expected_profile_version: number;
    expected_follow_version: number;
  },
): Promise<CommentWriteResult> {
  return privateRequest(token, '/me/comments/preferences', body);
}

export function checkCommentRequest(
  token: string,
  articleId: string,
  key: string,
): Promise<{
  state: 'saved' | 'not_found';
  result: CommentWriteResult | null;
}> {
  return privateRequest(
    token,
    `/me/comments/requests/${encodeURIComponent(key)}?article_id=${encodeURIComponent(articleId)}`,
  );
}

export function commentOutcomeUnknown(error: unknown): boolean {
  return !(error instanceof ApiError) || error.status >= 500 || error.status === 408;
}

async function stopRequest(path: string, body: object): Promise<CommentEmailStopState> {
  const base = process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, '');
  if (!base) throw new Error('Comment emails are unavailable');
  return bounded(async (signal) => {
    const response = await fetch(`${base}/api/v1${path}`, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      signal,
    });
    if (!response.ok)
      throw new ApiError(response.status, 'Comment email choices could not be loaded');
    return ((await response.json()) as Detail<CommentEmailStopState>).data;
  });
}

export const inspectCommentEmailStop = (token: string) =>
  stopRequest('/comments/email-stop/inspect', { token });
export const stopCommentEmails = (token: string, choice: StopCommentEmailChoice) =>
  stopRequest('/comments/email-stop', { token, choice });
