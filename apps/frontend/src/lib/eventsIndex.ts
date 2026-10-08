/** Only route identity belongs in the first app download; article copy loads on demand. */
export const EVENT_INDEX = [
  {
    slug: 'forward-debate-2026',
    // Held for refinements and candidate approval. Republishing requires explicit editorial approval.
    published: false,
    articleId: 'forward-debate-2026',
    title: 'The Forward Debate: Minnesota Senate District 13 in Sauk Rapids',
  },
] as const;

export const PUBLISHED_EVENT_INDEX = EVENT_INDEX.filter((event) => event.published);

export const eventIndexBySlug = (slug: string) =>
  PUBLISHED_EVENT_INDEX.find((event) => event.slug === slug);
