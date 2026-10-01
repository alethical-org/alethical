import { lazy, Suspense } from 'react';
import { ScrollView, Text } from 'react-native';
import { CandidateSearchContent } from '../components/candidates/CandidateSearchContent';
import { candidateFlow, candidateSearchServices } from '../data/candidates';
import { candidatePreviewEnabled } from '../lib/candidateLookupAvailability';
import { useDocumentTitle } from '../navigation/documentTitle';
import type { RootScreenProps } from '../navigation/types';
import { Footer, PageBackground, TopNav } from '../theme/primitives';

const Preview = __DEV__
  ? lazy(() => import('./CandidatePreviewScreens').then((m) => ({ default: m.CandidatesScreen })))
  : null;

export function CandidatesScreen(props: RootScreenProps<'Candidates'>) {
  const { navigation } = props;
  useDocumentTitle('/candidates', 'Find My Candidates | Alethical');
  if (__DEV__ && candidatePreviewEnabled() && Preview)
    return (
      <Suspense fallback={<Text accessibilityLiveRegion="polite">Loading preview…</Text>}>
        <Preview {...props} />
      </Suspense>
    );
  return (
    <PageBackground>
      <ScrollView contentContainerStyle={{ flexGrow: 1 }}>
        <TopNav onHome={() => navigation.navigate('Tabs', { screen: 'Home' })} />
        <CandidateSearchContent
          services={candidateSearchServices}
          flow={candidateFlow}
          initialAddress={candidateFlow.getState().draftAddress}
          privacyDisclosure="Address lookup uses Minnesota Secretary of State and Minnesota mapping services"
          imageSource={require('../../assets/mn-outline-candidates.svg')}
          onOpenProfile={(candidateId) => navigation.navigate('CandidateProfile', { candidateId })}
        />
        <Footer
          onContact={() => navigation.navigate('ContactUs')}
          onPrivacy={() => navigation.navigate('Privacy')}
          onTerms={() => navigation.navigate('Terms')}
        />
      </ScrollView>
    </PageBackground>
  );
}
