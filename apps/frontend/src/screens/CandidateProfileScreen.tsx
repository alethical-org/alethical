import { CandidateClaimPanel } from '../components/candidates/CandidateClaimPanel';
import { lazy, Suspense, useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { CandidateProfileContent } from '../components/candidates/CandidateProfileContent';
import {
  CandidateButton,
  CandidateLink,
  CandidateNotice,
  candidateText,
} from '../components/candidates/CandidateControls';
import type { CandidateProfileRecord } from '../components/candidates/types';
import { isNotFoundError } from '../data/api';
import { candidateFlow, getCandidateProfile } from '../data/candidates';
import { candidatePreviewEnabled } from '../lib/candidateLookupAvailability';
import { useDocumentTitle } from '../navigation/documentTitle';
import type { RootScreenProps } from '../navigation/types';
import { Footer, PageBackground, TopNav } from '../theme/primitives';
import { NotFoundScreen } from './redesign/NotFoundScreen';

const Preview = __DEV__
  ? lazy(() =>
      import('./CandidatePreviewScreens').then((m) => ({ default: m.CandidateProfileScreen })),
    )
  : null;
type ProfileState =
  | { id: string; kind: 'loading' | 'error' | 'not-found' }
  | { id: string; kind: 'ready'; record: CandidateProfileRecord };

export function CandidateProfileScreen(props: RootScreenProps<'CandidateProfile'>) {
  const { navigation, route } = props;
  const id = route.params.candidateId;
  const fromSearch = Boolean(
    candidateFlow
      .getState()
      .displayed?.results.races.some((race) =>
        race.entries.some((entry) =>
          entry.kind === 'candidate'
            ? entry.candidate.id === id
            : entry.id === id || entry.members.some((member) => member.id === id),
        ),
      ),
  );
  const returnToCandidates = () => {
    if (!fromSearch) candidateFlow.clear();
    navigation.navigate('Candidates');
  };
  const illustrative = candidatePreviewEnabled() && /^preview-/.test(id);
  const [state, setState] = useState<ProfileState>({ id, kind: 'loading' });
  const [retry, setRetry] = useState(0);
  const current = state.id === id ? state : { id, kind: 'loading' as const };
  useEffect(() => {
    if (illustrative) return;
    const controller = new AbortController();
    setState({ id, kind: 'loading' });
    void getCandidateProfile(id, controller.signal).then(
      (record) => {
        if (!controller.signal.aborted) setState({ id, kind: 'ready', record });
      },
      (error: unknown) => {
        if (!controller.signal.aborted)
          setState({ id, kind: isNotFoundError(error) ? 'not-found' : 'error' });
      },
    );
    return () => controller.abort();
  }, [id, retry, illustrative]);
  useDocumentTitle(
    `/candidates/${id}`,
    current.kind === 'ready'
      ? `${current.record.candidate.name} | Alethical`
      : 'Candidate record | Alethical',
  );
  if (illustrative && Preview)
    return (
      <Suspense fallback={<Text accessibilityLiveRegion="polite">Loading preview…</Text>}>
        <Preview {...props} />
      </Suspense>
    );
  if (current.kind === 'not-found')
    return (
      <NotFoundScreen
        navigation={navigation as never}
        route={{ params: { path: `/candidates/${id}` } } as never}
      />
    );
  return (
    <PageBackground candidateSurface>
      <ScrollView contentContainerStyle={{ flexGrow: 1 }}>
        <TopNav candidateSurface onHome={() => navigation.navigate('Tabs', { screen: 'Home' })} />
        {current.kind === 'ready' ? (
          <CandidateProfileContent
            record={current.record}
            fromSearch={fromSearch}
            onBack={returnToCandidates}
            onOpenLegislator={(slug) =>
              navigation.navigate('LegislatorProfile', { legislatorId: slug })
            }
            onOpenProfile={(candidateId) =>
              navigation.navigate('CandidateProfile', { candidateId })
            }
          >
            <CandidateClaimPanel
              record={current.record}
              onClaim={() => navigation.navigate('CandidateClaim', { candidateId: id })}
              onManage={() => navigation.navigate('CandidateManage', { candidateId: id })}
              onAdmin={() => navigation.navigate('AdminCandidateClaims')}
            />
          </CandidateProfileContent>
        ) : (
          <View style={{ padding: 32, maxWidth: 760, width: '100%', alignSelf: 'center', flex: 1 }}>
            <CandidateLink
              internal
              url="/candidates"
              label={fromSearch ? 'Back to candidates' : 'Find my candidates'}
              onPress={returnToCandidates}
            />
            {current.kind === 'error' ? (
              <CandidateNotice error>
                <Text style={candidateText.strong}>Candidate record is unavailable</Text>
                <CandidateButton
                  label="Try again"
                  kind="outline"
                  onPress={() => setRetry((value) => value + 1)}
                />
              </CandidateNotice>
            ) : (
              <Text accessibilityLiveRegion="polite" style={candidateText.body}>
                Loading candidate record…
              </Text>
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
