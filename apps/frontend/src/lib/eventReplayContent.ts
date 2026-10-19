import type { EventReplay } from './eventReplay';
import forwardDebate from './eventReplayData/forwardDebate2026.json';

/** Publish real assets here independently after accepting Claude's matching final export. */
const replays: Record<string, EventReplay> = {
  'forward-debate-2026': {
    title: 'The Forward Debate',
    searchTitle: 'Trent Dilks & Aaron Brutger: The Forward Debate',
    introduction:
      'Alethical hosted The Forward Debate for Minnesota Senate District 13 at Riverside Terrace in Sauk Rapids on October 15, 2026.',
    exportId: forwardDebate.exportId,
    duration: forwardDebate.duration,
    video: {
      id: 'y66-Wf9bNio',
      exportId: forwardDebate.exportId,
      publishedAt: '2026-10-19T11:13:45-07:00',
    },
    captions: { exportId: forwardDebate.exportId, uploaded: true },
    chapters: { exportId: forwardDebate.exportId, items: forwardDebate.chapters },
    transcript: { exportId: forwardDebate.exportId, turns: forwardDebate.turns },
    thumbnail: {
      url: 'https://www.alethical.com/forward-debate-2026-thumbnail.jpg',
      alt: 'The Forward Debate, Minnesota Senate District 13, October 15, 2026: moderator Angel Zierden with Trent Dilks and Aaron Brutger',
      width: 1280,
      height: 720,
    },
  },
};
export function eventReplayBySlug(slug: string): EventReplay | undefined {
  return replays[slug];
}
