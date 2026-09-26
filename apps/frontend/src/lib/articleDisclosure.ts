import type { ResearchInline } from './research';

export const ARTICLE_SOURCE_NOTE =
  'We report what the cited public sources support and identify known gaps and uncertainty. Contact us to report a possible error so we can review it and make corrections.';
export const ARTICLE_AI_NOTE = `AI helped prepare this article and can make mistakes. ${ARTICLE_SOURCE_NOTE}`;

/** Keep the approved closing copy and its correction link together in every output. */
export function articleDisclosureRuns(text: string, article?: string): ResearchInline[] {
  if (text !== ARTICLE_AI_NOTE && text !== ARTICLE_SOURCE_NOTE) {
    return [{ kind: 'text', text }];
  }
  const [before, after] = text.split('Contact us');
  return [
    { kind: 'text', text: before },
    {
      kind: 'internalLink',
      text: 'Contact us',
      href: article ? `/about/contact?article=${encodeURIComponent(article)}` : '/about/contact',
    },
    { kind: 'text', text: after },
  ];
}
