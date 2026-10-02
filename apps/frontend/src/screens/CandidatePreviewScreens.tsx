import { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, Text, View, StyleSheet, useWindowDimensions } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { useResponsive } from '../hooks/useResponsive';
import type { CandidateFlow } from '../components/candidates/candidateFlow';
import { CandidateSearchContent, CandidateProfileContent } from '../components/candidates';
import { CandidateButton } from '../components/candidates/CandidateControls';
import { candidatePreviewEnabled } from '../lib/candidateLookupAvailability';
import { useDocumentTitle } from '../navigation/documentTitle';
import type { RootScreenProps } from '../navigation/types';
import { Footer, PageBackground, TopNav } from '../theme/primitives';
import { theme } from '../theme/tokens';
import { NotFoundScreen } from './redesign/NotFoundScreen';
import { CandidateClaimPanel } from '../components/candidates/CandidateClaimPanel';
import {
  profilePreviewServices,
  previewProfile,
  type ProfilePerson,
  type ProfilePhoto,
  type ProfileCampaign,
  type ProfileReport,
} from '../dev/candidateProfilePreview';
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
      <Text style={styles.reviewTitle}>ILLUSTRATIVE DATA</Text>
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
          label="Clear address"
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
  flow,
  search = false,
}: {
  navigation: RootScreenProps<'Candidates'>['navigation'];
  children: React.ReactNode;
  flow?: CandidateFlow;
  search?: boolean;
}) {
  const scroll = useRef<ScrollView>(null);
  const [headerHeight, setHeaderHeight] = useState(0);
  const { height } = useWindowDimensions();
  const { isDesktop } = useResponsive();
  const focused = useIsFocused();
  useEffect(() => {
    if (!focused || !flow || !search) return;
    const frame = requestAnimationFrame(() =>
      scroll.current?.scrollTo({ y: flow.getState().scrollOffset, animated: false }),
    );
    return () => cancelAnimationFrame(frame);
  }, [focused, flow, search]);
  return (
    <PageBackground candidateSurface>
      <ScrollView
        ref={scroll}
        contentContainerStyle={{ flexGrow: 1 }}
        scrollEventThrottle={100}
        onScroll={
          search && flow
            ? (event) => flow.setScrollOffset(event.nativeEvent.contentOffset.y)
            : undefined
        }
      >
        <View
          style={{ zIndex: 60 }}
          onLayout={(event) => setHeaderHeight(event.nativeEvent.layout.height)}
        >
          <TopNav candidateSurface onHome={() => navigation.navigate('Tabs', { screen: 'Home' })} />
        </View>
        <View
          style={
            search && isDesktop ? { minHeight: Math.max(0, height - headerHeight) } : undefined
          }
        >
          {children}
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
    <PreviewFrame navigation={navigation} flow={preview?.candidatePreviewFlow} search>
      {preview ? (
        <>
          <PreviewControls preview={preview} />
          <CandidateSearchContent
            privacyDisclosure="Your address stays in this browser and is not sent to mapping services"
            services={preview.candidatePreviewServices}
            flow={preview.candidatePreviewFlow}
            imageSource={require('../../assets/mn-outline-candidates.svg')}
            onOpenProfile={(candidateId) =>
              navigation.navigate('CandidateProfile', { candidateId })
            }
          />
        </>
      ) : (
        <Text accessibilityLiveRegion="polite">Loading preview…</Text>
      )}
    </PreviewFrame>
  );
}
export function CandidateProfileScreen({ navigation, route }: RootScreenProps<'CandidateProfile'>) {
  const preview = usePreview();
  const [person, setPerson] = useState<ProfilePerson>('no connection');
  const [photo, setPhoto] = useState<ProfilePhoto>('missing');
  const [campaign, setCampaign] = useState<ProfileCampaign>('published');
  const [report, setReport] = useState<ProfileReport>('success');
  const [account, setAccount] = useState<'public' | 'loading' | 'approved' | 'pending' | 'error'>(
    'public',
  );
  const [entry, setEntry] = useState('search');
  const [recordState, setRecordState] = useState('ready');
  const [slow, setSlow] = useState(false);
  const fixtureServices = useMemo(
    () => profilePreviewServices(campaign, report, slow),
    [campaign, report, slow],
  );
  const base = preview?.candidatePreviewProfile(route.params.candidateId);
  const record = base ? previewProfile(base, person, photo, recordState === 'old') : undefined;
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
        <Text style={styles.reviewTitle}>ILLUSTRATIVE DATA · SAFE LOCAL CONTROLS</Text>
        <View style={styles.controls}>
          <label>
            Person{' '}
            <select
              aria-label="Person"
              value={person}
              onChange={(e) => setPerson(e.target.value as ProfilePerson)}
            >
              {[
                'no connection',
                'reelection',
                'different office',
                'former',
                'service unknown',
                'ticket',
                'long name',
              ].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </label>
          <label>
            Photo{' '}
            <select
              aria-label="Photo"
              value={photo}
              onChange={(e) => setPhoto(e.target.value as ProfilePhoto)}
            >
              {['missing', 'loaded', 'failed'].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </label>
          <label>
            Campaign{' '}
            <select
              aria-label="Campaign"
              value={campaign}
              onChange={(e) => setCampaign(e.target.value as ProfileCampaign)}
            >
              {['published', 'absent', 'failure'].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </label>
          <label>
            Report response{' '}
            <select
              aria-label="Report response"
              value={report}
              onChange={(e) => setReport(e.target.value as ProfileReport)}
            >
              {['success', 'failure', 'limited', 'changed', 'removed'].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </label>
          <label>
            Account{' '}
            <select
              aria-label="Account"
              value={account}
              onChange={(e) => setAccount(e.target.value as typeof account)}
            >
              {['public', 'loading', 'approved', 'pending', 'error'].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </label>
          <label>
            Entry{' '}
            <select aria-label="Entry" value={entry} onChange={(e) => setEntry(e.target.value)}>
              {['search', 'direct'].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </label>
          <label>
            Record{' '}
            <select
              aria-label="Record"
              value={recordState}
              onChange={(e) => setRecordState(e.target.value)}
            >
              {['ready', 'old'].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </label>
          <label>
            <input type="checkbox" checked={slow} onChange={(e) => setSlow(e.target.checked)} />{' '}
            Slow response
          </label>
        </View>
      </View>
      {record ? (
        <CandidateProfileContent
          record={record}
          fromSearch={entry === 'search'}
          onOpenLegislator={(slug) =>
            navigation.navigate('LegislatorProfile', { legislatorId: slug })
          }
          onBack={() => navigation.navigate('Candidates')}
          onOpenProfile={(candidateId) => navigation.navigate('CandidateProfile', { candidateId })}
        >
          <CandidateClaimPanel
            key={`${campaign}:${report}:${account}:${slow}`}
            record={record}
            services={fixtureServices}
            previewAccount={account}
            onClaim={() =>
              account === 'error'
                ? setAccount('public')
                : navigation.navigate('CandidateClaim', { candidateId: record.candidate.id })
            }
            onManage={() =>
              navigation.navigate('CandidateManage', { candidateId: record.candidate.id })
            }
            onAdmin={() => navigation.navigate('AdminCandidateClaims')}
          />
        </CandidateProfileContent>
      ) : (
        <Text accessibilityLiveRegion="polite">Loading preview…</Text>
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
