/** Only route identity belongs in the first app download; article copy loads on demand. */
export const EVENT_INDEX = [
  {
    slug: 'forward-debate-2026',
    // Revised flyer approved by the candidates; publication authorized on 15 October 2026.
    published: true,
    articleId: 'forward-debate-2026',
    title: 'The Forward Debate',
  },
] as const;

export const PUBLISHED_EVENT_INDEX = EVENT_INDEX.filter((event) => event.published);

export const eventIndexBySlug = (slug: string) =>
  PUBLISHED_EVENT_INDEX.find((event) => event.slug === slug);
