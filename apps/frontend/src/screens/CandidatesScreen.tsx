import { candidateDate, candidateElectionLabel } from '../lib/candidatePublicCopy';
import { CANDIDATE_LOOKUP_COPY } from '../lib/candidatePublicCopy';
import { lazy, Suspense, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Platform, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { useResponsive } from '../hooks/useResponsive';
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
  const scroll = useRef<ScrollView>(null);
  const [headerHeight, setHeaderHeight] = useState(0);
  const { height } = useWindowDimensions();
  const { isDesktop } = useResponsive();
  const focused = useIsFocused();
  useEffect(() => {
    if (!focused) return;
    const frame = requestAnimationFrame(() =>
      scroll.current?.scrollTo({ y: candidateFlow.getState().scrollOffset, animated: false }),
    );
    return () => cancelAnimationFrame(frame);
  }, [focused]);
  const displayed = useSyncExternalStore(
    candidateFlow.subscribe,
    candidateFlow.getState,
    candidateFlow.getState,
  ).displayed;
  useDocumentTitle(
    '/candidates',
    displayed?.results.resultsAvailable
      ? `Election results · ${candidateElectionLabel(displayed.election)} · ${candidateDate(displayed.election.date)} | Alethical`
      : 'Find My Candidates | Alethical',
  );
  if (__DEV__ && candidatePreviewEnabled() && Preview)
    return (
      <Suspense fallback={<Text accessibilityLiveRegion="polite">Loading preview…</Text>}>
        <Preview {...props} />
      </Suspense>
    );
  return (
    <PageBackground candidateSurface>
      <ScrollView
        ref={scroll}
        // Browser scroll anchoring can move phone results after our saved
        // position is restored. Keep the explicit return position instead.
        style={Platform.OS === 'web' ? ({ overflowAnchor: 'none' } as object) : undefined}
        contentContainerStyle={{ flexGrow: 1 }}
        scrollEventThrottle={100}
        onScroll={(event) => candidateFlow.setScrollOffset(event.nativeEvent.contentOffset.y)}
      >
        <View
          // Keep the header's dropdowns above the following search/results content.
          style={{ zIndex: 60 }}
          onLayout={(event) => setHeaderHeight(event.nativeEvent.layout.height)}
        >
          <TopNav candidateSurface onHome={() => navigation.navigate('Tabs', { screen: 'Home' })} />
        </View>
        <View style={isDesktop ? { minHeight: Math.max(0, height - headerHeight) } : undefined}>
          <CandidateSearchContent
            services={candidateSearchServices}
            flow={candidateFlow}
            active={focused}
            initialAddress={candidateFlow.getState().draftAddress}
            privacyDisclosure={CANDIDATE_LOOKUP_COPY.privacy}
            imageSource={require('../../assets/mn-outline-candidates.svg')}
            onOpenProfile={(candidateId) =>
              navigation.navigate('CandidateProfile', { candidateId })
            }
          />
        </View>
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
