import { TOPICS, guideSetBySlug } from './researchIndex';

/** Accept only a local, published reading list as an article's return address. */
export function safeArticleReturnPath(href: string): string | null {
  if (!href.startsWith('/') || href.startsWith('//') || href.includes('\\')) return null;
  let url: URL;
  try {
    url = new URL(href, 'https://www.alethical.com');
  } catch {
    return null;
  }
  if (url.origin !== 'https://www.alethical.com' || url.hash) return null;
  const path = url.pathname;
  if (
    path === '/blog' ||
    path === '/blog/research' ||
    path === '/blog/short-posts' ||
    path === '/blog/guides' ||
    (path.startsWith('/blog/sets/') && guideSetBySlug(path.slice('/blog/sets/'.length))) ||
    TOPICS.some((topic) => path === `/blog/topics/${topic.slug}`)
  )
    return path;
  return null;
}
