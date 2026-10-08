import { ReaderComments } from '../../components/comments/ReaderComments';
import { ScrollView } from 'react-native';
import { useHistoryScrollRestoration } from '../../hooks/useHistoryScrollRestoration';
import { eventBySlug, eventPath } from '../../lib/events';
import { titleFor } from '../../lib/share';
import { useDocumentTitle } from '../../navigation/documentTitle';
import { renderEventArticle, renderEventsCollection } from '../../lib/eventMarkup';
import type { RootScreenProps } from '../../navigation/types';
import { Footer, PageBackground, TopNav } from '../../theme/primitives';

type Props = RootScreenProps<'Event'> | RootScreenProps<'Events'>;

export function EventScreen({ navigation, route }: Props) {
  const restoration = useHistoryScrollRestoration();
  const event = route.name === 'Event' ? eventBySlug(route.params.slug) : undefined;
  useDocumentTitle(event && eventPath(event), event && titleFor(event.title));
  return (
    <PageBackground>
      <ScrollView {...restoration} contentContainerStyle={{ flexGrow: 1 }}>
        <TopNav onHome={() => navigation.navigate('Tabs', { screen: 'Home' })} />
        <main
          dangerouslySetInnerHTML={{
            __html: event ? renderEventArticle(event) : renderEventsCollection(),
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
