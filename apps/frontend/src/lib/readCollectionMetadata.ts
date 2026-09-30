import { guideCollectionItems } from './readCollectionSelection';
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
    canonicalPath: hasPosts ? readCollectionPagePath('/blog/short-posts', page) : '',
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
    canonicalPath: hasPieces ? readCollectionPagePath(`/blog/topics/${topic}`, page) : '',
    noindex: !hasPieces,
  });
}

export function readingCollectionMetadata(
  kind: 'research' | 'guides' | 'set',
  page = 1,
  setSlug = 'how-the-money-works',
): PageMetadata {
  const group = guideCollectionItems().find(
    (item) => item.kind === 'group' && item.slug === setSlug,
  );
  const title =
    kind === 'research'
      ? 'Research reports'
      : kind === 'guides'
        ? 'Guides'
        : group?.kind === 'group'
          ? group.name
          : 'Guides';
  const base = kind === 'set' ? `/blog/sets/${setSlug}` : `/blog/${kind}`;
  const subject = page > 1 ? `${title}, page ${page}` : title;
  return pageMetadata({
    title: titleFor(subject),
    socialTitle: subject,
    description:
      kind === 'research'
        ? 'Alethical research reports about Minnesota public records.'
        : 'Guides to reading Minnesota public records.',
    canonicalPath: readCollectionPagePath(base, page),
  });
}
