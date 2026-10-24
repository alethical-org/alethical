import {
  TOPICS,
  guideSetBySlug,
  guideSetSlug,
  pieceIndexBySlug,
  type TopicSlug,
} from './researchIndex';
import { safeArticleReturnPath } from './articleReturnSafety';
import { currentWebHistoryEntry, replaceWebHistoryPath } from '../navigation/webHistory';

export type ArticleReturnContext = {
  href: string;
  depth?: number;
  sessionId?: string;
  entryId?: string;
};

/** A return destination may be one of the published reading lists, never an outside URL. */
export function articleReturnDestination(href: string): { href: string; label: string } | null {
  const path = safeArticleReturnPath(href);
  if (!path) return null;
  if (path === '/blog') return { href, label: 'Back to Blog' };
  if (path === '/blog/research') return { href, label: 'Back to Research reports' };
  if (path === '/blog/short-posts') return { href, label: 'Back to Short posts' };
  if (path === '/blog/guides') return { href, label: 'Back to Guides' };
  const set = path.startsWith('/blog/sets/')
    ? guideSetBySlug(path.slice('/blog/sets/'.length))
    : undefined;
  if (set) return { href, label: `Back to ${set}` };
  const topic = TOPICS.find((item) => path === `/blog/topics/${item.slug}`);
  return topic ? { href, label: `Back to ${topic.label}` } : null;
}

/** Keep the current list's address and browser entry before opening the article. */
export function captureArticleReturn(href: string): ArticleReturnContext | undefined {
  if (!articleReturnDestination(href)) return undefined;
  const entry = typeof window !== 'undefined' ? currentWebHistoryEntry() : null;
  const actual =
    typeof window !== 'undefined' ? `${window.location.pathname}${window.location.search}` : '';
  const sameList = safeArticleReturnPath(actual) === safeArticleReturnPath(href);
  const samePage =
    sameList &&
    (new URL(actual, 'https://alethical.invalid').searchParams.get('page') ?? '1') ===
      (new URL(href, 'https://alethical.invalid').searchParams.get('page') ?? '1');
  if (!entry || !samePage) return { href };
  // Bookmark the chosen item on the existing list entry before leaving it, so
  // ordinary Back and copied return links carry exactly the same address.
  if (actual !== href) replaceWebHistoryPath(href);
  return { href, depth: entry.depth, sessionId: entry.sessionId, entryId: entry.entryId };
}

export function articleReturnLink(context: ArticleReturnContext | undefined) {
  return articleReturnDestination(context?.href ?? '') ?? { href: '/blog', label: 'Back to Blog' };
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
  if (kind === 'read') return '/blog';
  const setSlug = guideSetSlug(pieceIndexBySlug(slug)?.set?.name ?? 'How the money works');
  const base =
    kind === 'archive'
      ? '/blog/short-posts'
      : kind === 'topic'
        ? `/blog/topics/${topic}`
        : kind === 'research'
          ? '/blog/research'
          : kind === 'guides'
            ? '/blog/guides'
            : `/blog/sets/${setSlug}`;
  const params = new URLSearchParams();
  if (page && page !== '1') params.set('page', page);
  params.set('post', slug);
  return `${base}?${params}`;
}
