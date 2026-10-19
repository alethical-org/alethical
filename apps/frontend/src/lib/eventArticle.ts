import { renderEventArticle as renderAnnouncement } from './eventMarkup';
import { eventPageMetadata } from './eventMetadata';
import { replayPageMetadata } from './eventReplay';
import { eventReplayBySlug } from './eventReplayContent';
import { renderEventReplay } from './eventReplayMarkup';
import type { PublishedEvent } from './events';

export function renderEventArticle(
  event: PublishedEvent,
  now = Date.now(),
  options: { origin?: string; search?: string } = {},
): string {
  const replay = eventReplayBySlug(event.slug);
  return replay ? renderEventReplay(event, replay, options) : renderAnnouncement(event, now);
}
export function publishedEventMetadata(event: PublishedEvent, now = Date.now()) {
  const replay = eventReplayBySlug(event.slug);
  return replay ? replayPageMetadata(event, replay, now) : eventPageMetadata(event, now);
}
