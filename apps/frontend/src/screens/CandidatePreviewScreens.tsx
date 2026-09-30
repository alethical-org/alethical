import { useEffect, useState } from 'react';
import { ScrollView, Text, View, StyleSheet } from 'react-native';
import { CandidateSearchContent, CandidateProfileContent } from '../components/candidates';
import { CandidateButton } from '../components/candidates/CandidateControls';
import { candidatePreviewEnabled } from '../lib/candidateLookupAvailability';
import { useDocumentTitle } from '../navigation/documentTitle';
import type { RootScreenProps } from '../navigation/types';
import { Footer, PageBackground, TopNav } from '../theme/primitives';
import { theme } from '../theme/tokens';
import { NotFoundScreen } from './redesign/NotFoundScreen';
import type * as Preview from '../dev/candidatePreview';

// This module is lazy loaded, and illustrative records are imported only in a
// flagged development build. No public API, account or address storage exists.
function usePreview() {
  const [preview, setPreview] = useState<typeof Preview | null>(null);
  useEffect(() => {
    if (!__DEV__ || !candidatePreviewEnabled()) return;
    let active = true;
    import('../dev/candidatePreview').then((value) => {
      if (active) setPreview(value);
    });
    return () => {
      active = false;
    };
  }, []);
  return preview;
}
function PreviewControls({ preview }: { preview: typeof Preview }) {
  const [scenario, setScenario] = useState(preview.candidatePreviewSettings.scenario);
  const [slow, setSlow] = useState(preview.candidatePreviewSettings.slow);
  return (
    <View style={styles.review}>
      <Text style={styles.reviewTitle}>PRIVATE DRAFT · ILLUSTRATIVE DATA</Text>
      <Text style={styles.reviewText}>
        These example names test the design. They are not candidate records.
      </Text>
      <View style={styles.controls}>
        <label>
          Review state{' '}
          <select
            aria-label="Review state"
            value={scenario}
            onChange={(event) => {
              const value = event.target.value as Preview.PreviewScenario;
              preview.candidatePreviewSettings.scenario = value;
              setScenario(value);
            }}
          >
            {[
              'full',
              'partial',
              'empty',
              'ambiguous',
              'no-match',
              'outside-minnesota',
              'rate-limited',
              'failure',
            ].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={slow}
            onChange={(event) => {
              preview.candidatePreviewSettings.slow = event.target.checked;
              setSlow(event.target.checked);
            }}
          />{' '}
          Slow request
        </label>
        <CandidateButton
          kind="text"
          label="Clear private address"
          onPress={() => {
            preview.candidatePreviewFlow.clear();
            window.location.assign('/candidates');
          }}
        />
      </View>
    </View>
  );
}
function PreviewFrame({
  navigation,
  children,
}: {
  navigation: RootScreenProps<'Candidates'>['navigation'];
  children: React.ReactNode;
}) {
  return (
    <PageBackground>
      <ScrollView contentContainerStyle={{ flexGrow: 1 }}>
        <TopNav onHome={() => navigation.navigate('Tabs', { screen: 'Home' })} />
        {children}
        <Footer
          onContact={() => navigation.navigate('ContactUs')}
          onPrivacy={() => navigation.navigate('Privacy')}
          onTerms={() => navigation.navigate('Terms')}
        />
      </ScrollView>
    </PageBackground>
  );
}
export function CandidatesScreen({ navigation }: RootScreenProps<'Candidates'>) {
  const preview = usePreview();
  useDocumentTitle('/candidates', 'Find My Candidates | Alethical');
  if (!candidatePreviewEnabled())
    return (
      <NotFoundScreen
        navigation={navigation as never}
        route={{ params: { path: '/candidates' } } as never}
      />
    );
  return (
    <PreviewFrame navigation={navigation}>
      {preview ? (
        <>
          <PreviewControls preview={preview} />
          <CandidateSearchContent
            privacyDisclosure="Private preview: your address stays in this browser and is not sent to mapping services"
            services={preview.candidatePreviewServices}
            flow={preview.candidatePreviewFlow}
            imageSource={require('../../assets/mn-outline-candidates.svg')}
            onOpenProfile={(candidateId) =>
              navigation.navigate('CandidateProfile', { candidateId })
            }
          />
        </>
      ) : (
        <Text accessibilityLiveRegion="polite">Loading private preview…</Text>
      )}
    </PreviewFrame>
  );
}
export function CandidateProfileScreen({ navigation, route }: RootScreenProps<'CandidateProfile'>) {
  const preview = usePreview();
  const record = preview?.candidatePreviewProfile(route.params.candidateId);
  useDocumentTitle(
    `/candidates/${route.params.candidateId}`,
    record ? `${record.candidate.name} | Alethical` : 'Candidate record | Alethical',
  );
  if (!candidatePreviewEnabled() || (preview && !record))
    return (
      <NotFoundScreen
        navigation={navigation as never}
        route={{ params: { path: `/candidates/${route.params.candidateId}` } } as never}
      />
    );
  return (
    <PreviewFrame navigation={navigation as never}>
      <View style={styles.review}>
        <Text style={styles.reviewTitle}>PRIVATE DRAFT · ILLUSTRATIVE DATA</Text>
      </View>
      {record ? (
        <CandidateProfileContent
          record={record}
          onBack={() => navigation.navigate('Candidates')}
          onOpenProfile={(candidateId) => navigation.navigate('CandidateProfile', { candidateId })}
        />
      ) : (
        <Text accessibilityLiveRegion="polite">Loading private preview…</Text>
      )}
    </PreviewFrame>
  );
}
const styles = StyleSheet.create({
  review: { backgroundColor: '#fff4ce', paddingHorizontal: 24, paddingVertical: 14, gap: 8 },
  reviewTitle: {
    fontFamily: theme.typography.body,
    fontWeight: '700',
    color: '#11150f',
    fontSize: 14,
  },
  reviewText: { fontFamily: theme.typography.body, color: '#4f5651', fontSize: 14 },
  controls: { flexDirection: 'row', flexWrap: 'wrap', gap: 20, alignItems: 'center' },
});
