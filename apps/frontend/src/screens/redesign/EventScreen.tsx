import { useEffect, useMemo, useRef } from 'react';
import { mountEventReplay } from '../../lib/eventReplayPlayer';
import { publishedEventMetadata, renderEventArticle } from '../../lib/eventArticle';
import { ReaderComments } from '../../components/comments/ReaderComments';
import { ScrollView } from 'react-native';
import { useHistoryScrollRestoration } from '../../hooks/useHistoryScrollRestoration';
import { eventBySlug, eventPath } from '../../lib/events';
import { useDocumentTitle } from '../../navigation/documentTitle';
import { renderEventsCollection } from '../../lib/eventMarkup';
import type { RootScreenProps } from '../../navigation/types';
import { Footer, PageBackground, TopNav } from '../../theme/primitives';

type Props = RootScreenProps<'Event'> | RootScreenProps<'Events'>;

export function EventScreen({ navigation, route }: Props) {
  const event = route.name === 'Event' ? eventBySlug(route.params.slug) : undefined;
  const restoration = useHistoryScrollRestoration(true, event?.slug ?? 'events', true);
  useDocumentTitle(event && eventPath(event), event && publishedEventMetadata(event).title);
  const main = useRef<HTMLElement>(null);
  const markup = useMemo(
    () =>
      event
        ? renderEventArticle(event, Date.now(), {
            origin: typeof window !== 'undefined' ? window.location.origin : undefined,
            search: typeof window !== 'undefined' ? window.location.search : '',
          })
        : renderEventsCollection(),
    [event],
  );
  useEffect(() => {
    const root = main.current?.querySelector<HTMLElement>('.replay-content');
    if (root) return mountEventReplay(root);
  }, [markup]);
  return (
    <PageBackground>
      <ScrollView {...restoration} contentContainerStyle={{ flexGrow: 1 }}>
        <TopNav onHome={() => navigation.navigate('Tabs', { screen: 'Home' })} />
        <main
          ref={main}
          dangerouslySetInnerHTML={{
            __html: markup,
          }}
        />
        {event && <ReaderComments articleId={event.articleId} />}
        <Footer
          onContact={() => navigation.navigate('ContactUs')}
          onPrivacy={() => navigation.navigate('Privacy')}
          onTerms={() => navigation.navigate('Terms')}
        />
      </ScrollView>
    </PageBackground>
  );
}
