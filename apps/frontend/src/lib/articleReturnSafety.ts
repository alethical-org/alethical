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
    path === '/read' ||
    path === '/read/research' ||
    path === '/read/short-posts' ||
    path === '/read/guides' ||
    (path.startsWith('/read/sets/') && guideSetBySlug(path.slice('/read/sets/'.length))) ||
    TOPICS.some((topic) => path === `/read/topics/${topic.slug}`)
  )
    return path;
  return null;
}
