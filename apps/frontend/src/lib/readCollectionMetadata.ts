import { TOPICS, type TopicSlug } from './researchIndex';
import { pageMetadata, titleFor, type PageMetadata } from './share';

/** Numbered writing collections have their own canonical address per page. */
export function readCollectionPagePath(base: string, page: number): string {
  return page > 1 ? `${base}?page=${page}` : base;
}

export function shortPostsPageMetadata(page = 1, hasPosts = true): PageMetadata {
  const subject = page > 1 ? `Short posts, page ${page}` : 'Short posts';
  return pageMetadata({
    title: titleFor(subject),
    socialTitle: subject,
    description: `Short posts about Minnesota public records, newest first.${page > 1 ? ` Page ${page}.` : ''}`,
    canonicalPath: hasPosts ? readCollectionPagePath('/read/short-posts', page) : '',
    noindex: !hasPosts,
  });
}

export function readTopicPageMetadata(topic: TopicSlug, page = 1, hasPieces = true): PageMetadata {
  const label = TOPICS.find((entry) => entry.slug === topic)?.label ?? topic;
  const subject = page > 1 ? `${label}, page ${page}` : label;
  return pageMetadata({
    title: titleFor(subject),
    socialTitle: subject,
    description: `Published writing about ${label.toLowerCase()} in Minnesota.${page > 1 ? ` Page ${page}.` : ''}`,
    canonicalPath: hasPieces ? readCollectionPagePath(`/read/topics/${topic}`, page) : '',
    noindex: !hasPieces,
  });
}
