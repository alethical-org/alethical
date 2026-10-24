import { createRoot } from 'react-dom/client';
import { eventReplayBySlug } from '../../lib/eventReplayContent';
import { eventPath, type PublishedEvent } from '../../lib/events';
import { publicPageUrl } from '../../lib/share';
import { SharePopover } from '../billDetail/SharePopover';

/** Mount only the date-row control; the article and playing iframe stay untouched. */
export function mountEventShare(article: ParentNode, event: PublishedEvent): () => void {
  const slot = article.querySelector<HTMLElement>('[data-event-share]');
  if (!slot) return () => {};
  const root = createRoot(slot);
  root.render(
    <SharePopover
      article
      content={{
        subject: 'post',
        title: eventReplayBySlug(event.slug)?.title ?? event.title,
        description: '',
        url: publicPageUrl(eventPath(event)),
      }}
    />,
  );
  return () => root.unmount();
}
