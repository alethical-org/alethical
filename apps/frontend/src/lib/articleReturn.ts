import {
  TOPICS,
  guideSetBySlug,
  guideSetSlug,
  pieceIndexBySlug,
  type TopicSlug,
} from './researchIndex';
import { safeArticleReturnPath } from './articleReturnSafety';
import { currentWebHistoryEntry } from '../navigation/webHistory';

export type ArticleReturnContext = {
  href: string;
  depth?: number;
  sessionId?: string;
};

/** A return destination may be one of the published reading lists, never an outside URL. */
export function articleReturnDestination(href: string): { href: string; label: string } | null {
  const path = safeArticleReturnPath(href);
  if (!path) return null;
  if (path === '/read') return { href, label: 'Back to Read' };
  if (path === '/read/research') return { href, label: 'All research reports' };
  if (path === '/read/short-posts') return { href, label: 'All short posts' };
  if (path === '/read/guides') return { href, label: 'All guides' };
  const set = path.startsWith('/read/sets/')
    ? guideSetBySlug(path.slice('/read/sets/'.length))
    : undefined;
  if (set) return { href, label: `Back to ${set}` };
  const topic = TOPICS.find((item) => path === `/read/topics/${item.slug}`);
  return topic ? { href, label: `Back to ${topic.label}` } : null;
}

/** Keep the current list's address and browser entry before opening the article. */
export function captureArticleReturn(href: string): ArticleReturnContext | undefined {
  if (!articleReturnDestination(href)) return undefined;
  const entry = typeof window !== 'undefined' ? currentWebHistoryEntry() : null;
  return { href, depth: entry?.depth, sessionId: entry?.sessionId };
}

export function articleReturnLink(context: ArticleReturnContext | undefined) {
  return articleReturnDestination(context?.href ?? '') ?? { href: '/read', label: 'Back to Read' };
}

/** The source travels in the actual link, so opening a new tab keeps its return link. */
export function articleHrefWithReturn(articleHref: string, sourceHref: string): string {
  if (!articleReturnDestination(sourceHref)) return articleHref;
  const separator = articleHref.includes('?') ? '&' : '?';
  return `${articleHref}${separator}from=${encodeURIComponent(sourceHref)}`;
}

export function articleReturnHref(
  kind: 'read' | 'archive' | 'topic' | 'research' | 'guides' | 'set',
  slug: string,
  page?: string,
  topic?: TopicSlug,
) {
  if (kind === 'read') return '/read';
  const setSlug = guideSetSlug(pieceIndexBySlug(slug)?.set?.name ?? 'How the money works');
  const base =
    kind === 'archive'
      ? '/read/short-posts'
      : kind === 'topic'
        ? `/read/topics/${topic}`
        : kind === 'research'
          ? '/read/research'
          : kind === 'guides'
            ? '/read/guides'
            : `/read/sets/${setSlug}`;
  const params = new URLSearchParams();
  if (page && page !== '1') params.set('page', page);
  params.set('post', slug);
  return `${base}?${params}`;
}
