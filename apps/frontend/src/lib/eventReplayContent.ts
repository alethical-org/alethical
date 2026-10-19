import type { EventReplay } from './eventReplay';

/** Publish real assets here independently after accepting Claude's matching final export. */
const replays: Record<string, EventReplay> = {
  'forward-debate-2026': {
    title: 'The Forward Debate',
    searchTitle: 'Trent Dilks & Aaron Brutger: The Forward Debate',
    introduction:
      'Alethical hosted The Forward Debate for Minnesota Senate District 13 at Riverside Terrace in Sauk Rapids on October 15, 2026.',
  },
};
export function eventReplayBySlug(slug: string): EventReplay | undefined {
  return replays[slug];
}
