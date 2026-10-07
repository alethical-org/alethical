import { EVENT_INDEX } from './eventsIndex';

/** Event announcements are host information, separate from research and guides. */
export const EVENTS_PATH = '/blog/events';
export const EVENTS_TITLE = 'Events';
export const COALITION_CANDIDATES_URL = 'https://forwardcoalition.com/candidates';

export const PUBLISHED_EVENTS = [
  {
    ...EVENT_INDEX[0],
    name: 'The Forward Debate',
    tagline: 'Different views on the issues that matter to you',
    publishedOn: '2026-10-07',
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
    image: '/events/forward-debate-2026.webp',
    imageWidth: 1080,
    imageHeight: 1920,
    imageAlt:
      'The Forward Debate flyer with portraits of Trent Dilks and Aaron Brutger. Event details follow.',
    description:
      'Join Alethical for a free Minnesota Senate District 13 debate with Trent Dilks and Aaron Brutger on October 15, 2026, in Sauk Rapids.',
    introduction:
      'Join Alethical for The Forward Debate at Riverside Terrace in Sauk Rapids. Hear directly from 2 candidates running for Minnesota Senate District 13 in 2026:',
    candidates: [
      { name: 'Trent Dilks', status: 'DFL candidate' },
      { name: 'Aaron Brutger', status: 'Republican primary candidate' },
    ],
    paragraphs: [
      'Moderated by Angel Zierden, Alethical founder, the conversation will focus on issues that matter to voters, with no pre-approved questions.',
      'The evening is a chance to hear where the candidates stand, compare their ideas and consider how they would represent the district. Whether you have followed the race closely or are just getting to know the candidates, you’re welcome to attend.',
    ],
    invitation:
      'Bring your curiosity and a willingness to hear different views. RSVP so we can plan for the number of people attending, and share the invitation with someone who would like to join you.',
  },
] as const;

export type PublishedEvent = (typeof PUBLISHED_EVENTS)[number];
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
