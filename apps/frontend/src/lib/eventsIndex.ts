/** Only route identity belongs in the first app download; article copy loads on demand. */
export const EVENT_INDEX = [
  {
    slug: 'forward-debate-2026',
    articleId: 'forward-debate-2026',
    title: 'The Forward Debate: Minnesota Senate District 13 in Sauk Rapids',
  },
] as const;

export const eventIndexBySlug = (slug: string) => EVENT_INDEX.find((event) => event.slug === slug);
