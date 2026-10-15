import { EVENT_INDEX } from './eventsIndex';

/** Event announcements are host information, separate from research and guides. */
export const EVENTS_PATH = '/blog/events';
export const EVENTS_TITLE = 'Events';
export const COALITION_CANDIDATES_URL = 'https://forwardcoalition.com/candidates';

export const EVENTS = [
  {
    ...EVENT_INDEX[0],
    name: 'The Forward Debate',
    tagline: 'No pre-approved questions',
    publishedOn: '2026-10-07',
    updatedOn: '2026-10-15',
    startDate: '2026-10-15T18:00:00-05:00',
    endDate: '2026-10-15T20:00:00-05:00',
    dateLabel: 'Thursday, October 15, 2026',
    timeLabel: '6–8 PM Central',
    locationName: 'Riverside Terrace',
    streetAddress: '195 River Ave S',
    city: 'Sauk Rapids',
    region: 'MN',
    postalCode: '56379',
    signupUrl: 'https://luma.com/3w69g6dw',
    image: '/events/forward-debate-2026-oct15.webp',
    downloads: [
      {
        title: 'Forward Debate Candidate Guide',
        filename: 'SD13_Candidate_Guide.pdf',
        href: '/events/forward-debate-2026/SD13_Candidate_Guide.pdf',
        sizeLabel: '65 KB',
      },
      {
        title: 'Forward Debate Money Report',
        filename: 'Alethical_SD13_Money_Report_2026-10-15.pdf',
        href: '/events/forward-debate-2026/Alethical_SD13_Money_Report_2026-10-15.pdf',
        sizeLabel: '80 KB',
      },
    ],
    imageWidth: 1080,
    imageHeight: 1920,
    imageAlt:
      'The Forward Debate flyer featuring Trent Dilks, Aaron Brutger and moderator Angel Zierden, with Jared Gapinski also invited. Event details follow.',
    description:
      'Alethical hosts its first debate on October 15, 2026: Minnesota Senate District 13 candidates at Riverside Terrace in Sauk Rapids, 6–8 PM Central. Free admission.',
    introduction:
      'The Forward Debate brings Minnesota Senate District 13 candidates to Riverside Terrace in Sauk Rapids:',
    candidates: [
      { name: 'Trent Dilks', status: 'DFL-endorsed candidate' },
      { name: 'Aaron Brutger', status: 'Republican-endorsed write-in candidate' },
    ],
    paragraphs: [
      'Also invited: Jared Gapinski, Senate Republican primary winner.',
      'Angel Zierden, CEO and Founder of Alethical, moderates the debate. Alethical is hosting the event to give voters a chance to hear directly from the candidates and compare their views.',
    ],
    invitation:
      'Bring your curiosity and a willingness to hear different views. RSVP so we can plan for the number of people attending, and share the invitation with someone who would like to join you.',
  },
] as const;

export const PUBLISHED_EVENTS = EVENTS.filter((event) => event.published);

export type PublishedEvent = (typeof EVENTS)[number];
export const eventPath = (event: Pick<PublishedEvent, 'slug'>) => `${EVENTS_PATH}/${event.slug}`;
export const eventBySlug = (slug: string) => PUBLISHED_EVENTS.find((event) => event.slug === slug);
export const eventHasEnded = (event: Pick<PublishedEvent, 'endDate'>, now = Date.now()) =>
  new Date(event.endDate).getTime() <= now;

/** Upcoming first; keep completed events reachable at their original address. */
export function orderedEvents(now = Date.now()) {
  return [...PUBLISHED_EVENTS].sort((a, b) => {
    const endedA = eventHasEnded(a, now);
    const endedB = eventHasEnded(b, now);
    if (endedA !== endedB) return endedA ? 1 : -1;
    return (endedA ? -1 : 1) * (Date.parse(a.startDate) - Date.parse(b.startDate));
  });
}
