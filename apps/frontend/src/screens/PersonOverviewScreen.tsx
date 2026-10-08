import { personPageMetadata } from '../lib/personMetadata';
import { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import {
  CandidateButton,
  CandidateLink,
  CandidateNotice,
  candidateText,
} from '../components/candidates/CandidateControls';
import { PersonOverviewContent } from '../components/candidates/PersonOverviewContent';
import { getPersonRecord, type PersonRecord } from '../data/personRecords';
import { isNotFoundError } from '../data/api';
import { useDocumentTitle } from '../navigation/documentTitle';
import type { RootScreenProps } from '../navigation/types';
import { Footer, PageBackground, TopNav } from '../theme/primitives';
import { NotFoundScreen } from './redesign/NotFoundScreen';

export function PersonOverviewScreen({ navigation, route }: RootScreenProps<'PersonOverview'>) {
  const { personId, fromCandidateId, fromLegislatorSlug } = route.params;
  const [state, setState] = useState<
    | { id: string; kind: 'loading' | 'error' | 'not-found'; record?: never }
    | { id: string; kind: 'ready'; record: PersonRecord }
  >({ id: personId, kind: 'loading' });
  const [retry, setRetry] = useState(0);
  const current = state.id === personId ? state : { id: personId, kind: 'loading' as const };
  useEffect(() => {
    const controller = new AbortController();
    setState({ id: personId, kind: 'loading' });
    void getPersonRecord(personId, controller.signal).then(
      (record) => {
        if (!controller.signal.aborted) setState({ id: personId, kind: 'ready', record });
      },
      (error) => {
        if (!controller.signal.aborted)
          setState({ id: personId, kind: isNotFoundError(error) ? 'not-found' : 'error' });
      },
    );
    return () => controller.abort();
  }, [personId, retry]);
  useDocumentTitle(
    `/people/${personId}`,
    current.kind === 'ready'
      ? personPageMetadata(current.record).title
      : 'Public record | Alethical',
  );
  const validCandidateReturn =
    current.kind === 'ready' &&
    fromCandidateId &&
    current.record.elections.some((item) => item.candidateId === fromCandidateId);
  const validLegislatorReturn =
    current.kind === 'ready' &&
    fromLegislatorSlug &&
    current.record.legislator?.slug === fromLegislatorSlug;
  const returnLabel = validCandidateReturn
    ? 'Back to election record'
    : validLegislatorReturn
      ? 'Back to legislator profile'
      : 'Find my candidates';
  const returnUrl = validCandidateReturn
    ? `/candidates/${fromCandidateId}`
    : validLegislatorReturn
      ? `/legislators/${fromLegislatorSlug}`
      : '/candidates';
  const onBack = () =>
    validCandidateReturn
      ? navigation.navigate('CandidateProfile', { candidateId: fromCandidateId! })
      : validLegislatorReturn
        ? navigation.navigate('LegislatorProfile', { legislatorId: fromLegislatorSlug! })
        : navigation.navigate('Candidates');
  if (current.kind === 'not-found')
    return (
      <NotFoundScreen
        navigation={navigation as never}
        route={{ params: { path: `/people/${personId}` } } as never}
      />
    );
  return (
    <PageBackground candidateSurface>
      <ScrollView contentContainerStyle={{ flexGrow: 1 }}>
        <TopNav candidateSurface onHome={() => navigation.navigate('Tabs', { screen: 'Home' })} />
        {current.kind === 'ready' ? (
          <PersonOverviewContent
            key={personId}
            record={current.record}
            returnLabel={returnLabel}
            returnUrl={returnUrl}
            onBack={onBack}
            onCandidate={(candidateId) => navigation.navigate('CandidateProfile', { candidateId })}
            onLegislator={(slug) =>
              navigation.navigate('LegislatorProfile', { legislatorId: slug })
            }
          />
        ) : (
          <View style={{ padding: 32, maxWidth: 760, width: '100%', alignSelf: 'center', flex: 1 }}>
            <CandidateLink
              internal
              label="Find my candidates"
              url="/candidates"
              onPress={() => navigation.navigate('Candidates')}
            />
            {current.kind === 'loading' ? (
              <Text accessibilityLiveRegion="polite" style={candidateText.body}>
                Loading person overview…
              </Text>
            ) : (
              <CandidateNotice error>
                <Text style={candidateText.strong}>Person overview is unavailable</Text>
                <CandidateButton
                  label="Try again"
                  kind="outline"
                  icon="none"
                  onPress={() => setRetry((value) => value + 1)}
                />
              </CandidateNotice>
            )}
          </View>
        )}
        <Footer
          candidateSurface
          onContact={() => navigation.navigate('ContactUs')}
          onPrivacy={() => navigation.navigate('Privacy')}
          onTerms={() => navigation.navigate('Terms')}
        />
      </ScrollView>
    </PageBackground>
  );
}
