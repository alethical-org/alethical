import { useEffect, useState, type ReactNode } from 'react';
import { Platform, ScrollView, StyleSheet, Text, View, type TextStyle } from 'react-native';
import { GoBackLink } from '../components/GoBackLink';
import { PageContextLabel } from '../components/PageContextLabel';
import { CandidateButton, candidateText } from '../components/candidates/CandidateControls';
import type { CandidateProfileRecord } from '../components/candidates/types';
import { getCandidateProfile } from '../data/candidates';
import { useResponsive } from '../hooks/useResponsive';
import {
  CANDIDATE_FEATURE_COMMITMENTS,
  CANDIDATE_FEATURE_GROUPS,
  CANDIDATE_FEATURES_COPY as copy,
  candidateFeaturesContext,
  candidateFeaturesPath,
  type CandidateFeatureItem,
} from '../lib/candidateFeatures';
import { candidateOfficeLabel } from '../lib/candidatePublicCopy';
import { useDocumentTitle } from '../navigation/documentTitle';
import type { RootScreenProps } from '../navigation/types';
import { Footer, PageBackground, TopNav } from '../theme/primitives';

const web = (style: object) => (Platform.OS === 'web' ? (style as TextStyle) : undefined);

function FeatureItem({ item, size }: { item: CandidateFeatureItem; size: number }) {
  return (
    <View>
      <Text
        accessibilityRole="header"
        aria-level={3}
        style={[styles.itemTitle, { fontSize: size, lineHeight: size * 1.3 }]}
      >
        {item.title}
      </Text>
      <Text style={[styles.itemBody, web({ textWrap: 'pretty' })]}>{item.body}</Text>
    </View>
  );
}

/** Two columns where the band allows, each item keeping its own rule above it. */
function ItemGrid({ columns, children }: { columns: number; children: ReactNode[] }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 36, rowGap: 28 }}>
      {children.map((child, index) => (
        <View
          key={index}
          style={[
            styles.item,
            columns === 2
              ? (web({ width: 'calc(50% - 18px)' }) ?? { width: '48%' })
              : { width: '100%' },
          ]}
        >
          {child}
        </View>
      ))}
    </View>
  );
}

/** What a claimed candidate profile will offer. Every feature is on the roadmap. */
export function CandidateFeaturesScreen({
  navigation,
  route,
}: RootScreenProps<'CandidateFeatures'>) {
  const { isMobile, isDesktop } = useResponsive();
  const contextId = candidateFeaturesContext(route.params?.candidateId);
  useDocumentTitle(candidateFeaturesPath(contextId), `${copy.heading} | Alethical`);
  const [context, setContext] = useState<{
    id: string;
    state: 'loading' | 'ready' | 'none';
    record?: CandidateProfileRecord;
  } | null>(null);
  useEffect(() => {
    if (!contextId) return;
    const controller = new AbortController();
    setContext({ id: contextId, state: 'loading' });
    void getCandidateProfile(contextId, controller.signal).then(
      (record) => {
        if (!controller.signal.aborted) setContext({ id: contextId, state: 'ready', record });
      },
      () => {
        // A context that cannot be confirmed is treated as a direct visit.
        if (!controller.signal.aborted) setContext({ id: contextId, state: 'none' });
      },
    );
    return () => controller.abort();
  }, [contextId]);
  const current = contextId && context?.id === contextId ? context : null;
  const record = current?.state === 'ready' ? current.record : null;
  const resolving = Boolean(contextId) && (!current || current.state === 'loading');
  const fromClaim = Boolean(record);
  const claimPath = record ? `/candidates/${record.candidate.id}/claim` : null;
  const toClaim = () =>
    record && navigation.navigate('CandidateClaim', { candidateId: record.candidate.id });
  const h1 = isMobile ? 34 : isDesktop ? 52 : 44;
  const h2 = isMobile ? 21 : isDesktop ? 24 : 22;
  const h3 = isMobile ? 17 : 18;
  const sub = isMobile ? 21 : isDesktop ? 26 : 24;
  const lead = isMobile ? 17 : isDesktop ? 19 : 18;
  const button = (label: string, href: string, onPress: () => void) => (
    <CandidateButton
      label={label}
      href={href}
      icon="none"
      fontSize={17}
      textStyle={{ lineHeight: 22.1 }}
      onPress={onPress}
      style={{
        minHeight: 52,
        paddingHorizontal: 24,
        paddingVertical: 14,
        flexShrink: 0,
        alignSelf: isMobile ? 'stretch' : 'flex-start',
      }}
    />
  );
  return (
    <PageBackground candidateSurface>
      <ScrollView contentContainerStyle={{ flexGrow: 1 }}>
        <TopNav candidateSurface onHome={() => navigation.navigate('Tabs', { screen: 'Home' })} />
        <View
          style={{
            paddingHorizontal: isMobile ? 20 : isDesktop ? 40 : 32,
            paddingTop: isMobile ? 16 : isDesktop ? 24 : 22,
            paddingBottom: 64,
          }}
        >
          <View
            style={{ width: '100%', maxWidth: isDesktop ? 1120 : undefined, alignSelf: 'center' }}
          >
            <GoBackLink
              href={claimPath ?? '/candidates'}
              onPress={() => (record ? toClaim() : navigation.navigate('Candidates'))}
              mobile={isMobile}
              pressedColor="#000000"
              style={{ minHeight: 44, marginBottom: 0 }}
            />
            <PageContextLabel
              style={{
                marginTop: isMobile ? 6 : 14,
                color: '#0f7a45',
                fontFamily: candidateText.body.fontFamily,
                fontSize: isMobile ? 12 : 13,
                fontWeight: '700',
                letterSpacing: 2.4,
              }}
            >
              {copy.label}
            </PageContextLabel>
            <Text
              accessibilityRole="header"
              aria-level={1}
              style={[
                candidateText.title,
                {
                  marginTop: 14,
                  fontSize: h1,
                  lineHeight: h1 * 1.05,
                  letterSpacing: h1 * -0.025,
                },
                web({ textWrap: 'balance' }),
              ]}
            >
              {copy.heading}
            </Text>
            <View style={{ marginTop: isMobile ? 20 : isDesktop ? 28 : 24, maxWidth: 720 }}>
              <Text
                accessibilityRole="header"
                aria-level={2}
                style={[
                  candidateText.title,
                  { fontSize: sub, lineHeight: sub * 1.2, letterSpacing: sub * -0.015 },
                  web({ textWrap: 'balance' }),
                ]}
              >
                {copy.subheading}
              </Text>
              <Text
                style={[
                  candidateText.body,
                  { marginTop: 12, fontSize: lead, lineHeight: lead * 1.55, color: '#2c322c' },
                  web({ textWrap: 'pretty' }),
                ]}
              >
                {copy.intro}
              </Text>
            </View>
            {record && claimPath && !record.electionEnded ? (
              <View
                style={[
                  styles.claimCard,
                  isMobile
                    ? { flexDirection: 'column', alignItems: 'stretch', padding: 18 }
                    : {
                        flexDirection: 'row',
                        alignItems: 'center',
                        paddingTop: 18,
                        paddingBottom: 18,
                        paddingLeft: 22,
                        paddingRight: 20,
                      },
                ]}
              >
                <View style={{ flexShrink: 1, minWidth: 0, gap: 2 }}>
                  <Text style={[styles.claimName, web({ overflowWrap: 'anywhere' })]}>
                    {record.candidate.name}
                  </Text>
                  <Text style={[styles.claimOffice, web({ overflowWrap: 'anywhere' })]}>
                    {candidateOfficeLabel(record.office, record.votingArea)}
                  </Text>
                </View>
                {button(copy.continueClaim, claimPath, toClaim)}
              </View>
            ) : null}
            <View
              style={{
                marginTop: isMobile ? 40 : isDesktop ? 64 : 52,
                gap: isMobile ? 40 : isDesktop ? 56 : 48,
              }}
            >
              {CANDIDATE_FEATURE_GROUPS.map((group) => (
                <View
                  key={group.id}
                  role="region"
                  aria-labelledby={`candidate-features-${group.id}`}
                  style={
                    isDesktop
                      ? { flexDirection: 'row', alignItems: 'flex-start', columnGap: 48 }
                      : { gap: isMobile ? 14 : 18 }
                  }
                >
                  <Text
                    nativeID={`candidate-features-${group.id}`}
                    accessibilityRole="header"
                    aria-level={2}
                    style={[
                      styles.groupHeading,
                      { fontSize: h2, lineHeight: h2 * 1.2, letterSpacing: h2 * -0.01 },
                      isDesktop && { width: 260, flexShrink: 0 },
                    ]}
                  >
                    {group.heading}
                  </Text>
                  <View style={isDesktop ? { flex: 1, minWidth: 0 } : undefined}>
                    <ItemGrid columns={isMobile ? 1 : 2}>
                      {group.items.map((item) => (
                        <FeatureItem key={item.title} item={item} size={h3} />
                      ))}
                    </ItemGrid>
                  </View>
                </View>
              ))}
            </View>
            <View
              role="region"
              aria-labelledby="candidate-features-how"
              style={[
                styles.how,
                {
                  marginTop: isMobile ? 44 : isDesktop ? 64 : 52,
                  paddingTop: isMobile ? 22 : isDesktop ? 30 : 26,
                  paddingHorizontal: isMobile ? 18 : isDesktop ? 32 : 28,
                  paddingBottom: isMobile ? 24 : isDesktop ? 32 : 28,
                },
              ]}
            >
              <Text
                nativeID="candidate-features-how"
                accessibilityRole="header"
                aria-level={2}
                style={[
                  styles.groupHeading,
                  { fontSize: h2, lineHeight: h2 * 1.2, letterSpacing: h2 * -0.01 },
                ]}
              >
                {copy.howHeading}
              </Text>
              <View
                style={{
                  marginTop: 20,
                  flexDirection: isDesktop ? 'row' : 'column',
                  columnGap: 32,
                  rowGap: 24,
                }}
              >
                {CANDIDATE_FEATURE_COMMITMENTS.map((item) => (
                  <View key={item.title} style={isDesktop ? { flex: 1, minWidth: 0 } : undefined}>
                    <FeatureItem item={item} size={h3} />
                  </View>
                ))}
              </View>
            </View>
            {!fromClaim && !resolving ? (
              <View
                style={{
                  marginTop: isMobile ? 36 : isDesktop ? 48 : 40,
                  alignItems: isMobile ? 'stretch' : 'flex-start',
                }}
              >
                {button(copy.findCandidates, '/candidates', () =>
                  navigation.navigate('Candidates'),
                )}
              </View>
            ) : null}
          </View>
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

const styles = StyleSheet.create({
  claimCard: {
    marginTop: 28,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: 'rgba(17,21,15,0.1)',
    borderRadius: 14,
    justifyContent: 'space-between',
    columnGap: 24,
    rowGap: 14,
  },
  claimName: { ...candidateText.strong, fontSize: 17, lineHeight: 22.1, fontWeight: '800' },
  claimOffice: { ...candidateText.body, fontSize: 15.5, lineHeight: 22.475 },
  groupHeading: { ...candidateText.title },
  item: { paddingTop: 16, borderTopWidth: 1, borderTopColor: 'rgba(17,21,15,0.12)' },
  itemTitle: { ...candidateText.strong, fontWeight: '800' },
  itemBody: { ...candidateText.body, marginTop: 6, fontSize: 16, lineHeight: 24.8 },
  how: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: 'rgba(17,21,15,0.1)',
    borderRadius: 16,
    ...(Platform.OS === 'web' ? ({ boxShadow: '0 8px 24px rgba(17,21,15,0.05)' } as object) : {}),
  },
});
