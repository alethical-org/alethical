import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useIsFocused } from '@react-navigation/native';
import { disposeEventReplay, mountEventReplay } from '../../lib/eventReplayPlayer';
import {
  registerStableEventRetirement,
  retireStableEventDocument,
  stableEventDocument,
  clearStableEventHeader,
} from '../../lib/stableEventDocument';
import { mountStableEventScroll } from '../../lib/stableEventScroll';
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
  const focused = useIsFocused();
  const path = event ? eventPath(event) : '/blog/events';
  const [stable, setStable] = useState(() => stableEventDocument(path));
  const [claimed, setClaimed] = useState(false);
  const restoration = useHistoryScrollRestoration(!stable, event?.slug ?? 'events', true);
  useDocumentTitle(event && eventPath(event), event && publishedEventMetadata(event).title);
  const main = useRef<HTMLElement>(null);
  const restoreHeaderFocus = useRef<(() => void) | null>(null);
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
  useLayoutEffect(() => {
    if (!stable) return;
    if (!focused || stable.dataset.eventPath !== path) {
      retireStableEventDocument(stable);
      setStable(null);
      setClaimed(false);
      return;
    }
    if (!claimed) {
      // Only the header fallback is replaced. The article and iframe never move.
      restoreHeaderFocus.current = clearStableEventHeader(stable);
      registerStableEventRetirement(stable, () => disposeEventReplay(stable));
      setClaimed(true);
    } else {
      restoreHeaderFocus.current?.();
      restoreHeaderFocus.current = null;
    }
  }, [stable, focused, path, claimed]);
  useEffect(() => {
    if (!stable || !focused) return;
    const detach = mountStableEventScroll(stable, path);
    registerStableEventRetirement(stable, () => {
      detach();
      disposeEventReplay(stable);
    });
    return () => {
      detach();
      if (window.location.pathname !== path) retireStableEventDocument(stable);
    };
  }, [stable, focused, path]);
  useEffect(() => {
    if (!focused) return;
    const root = (stable ?? main.current)?.querySelector<HTMLElement>('.replay-content');
    if (root) return mountEventReplay(root);
  }, [markup, stable, focused]);
  if (!focused) return null;
  if (stable) {
    if (!claimed) return null;
    const header = stable.querySelector<HTMLElement>('[data-event-nav]');
    const discussion = stable.querySelector<HTMLElement>('[data-event-discussion]');
    return (
      <>
        {header &&
          createPortal(
            <TopNav onHome={() => navigation.navigate('Tabs', { screen: 'Home' })} />,
            header,
          )}
        {discussion &&
          createPortal(
            <>
              {event && <ReaderComments articleId={event.articleId} />}
              <Footer
                onContact={() => navigation.navigate('ContactUs')}
                onPrivacy={() => navigation.navigate('Privacy')}
                onTerms={() => navigation.navigate('Terms')}
              />
            </>,
            discussion,
          )}
      </>
    );
  }
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
