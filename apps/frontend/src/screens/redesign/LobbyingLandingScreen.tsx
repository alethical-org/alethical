import { useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { MoneyNameSearchField } from '../../components/campaignMoney/MoneyNameSearchField';
import { useLobbyingSummary } from '../../hooks/useLobbying';
import { useResponsive } from '../../hooks/useResponsive';
import {
  LOBBYING_DIRECTORY_COPY as copy,
  LOBBYING_SOURCE_URL,
  lobbyistLaneCount,
  lobbyingHeldYearsNote,
  principalLaneCount,
} from '../../lib/lobbyingDirectoryCopy';
import { centralDateLabel } from '../../lib/moneyLanding';
import { MONEY_SECTION_NAME } from '../../lib/moneySectionName';
import { lobbyingPageMetadata } from '../../lib/lobbyingMetadata';
import { useDocumentTitle } from '../../navigation/documentTitle';
import { externalLinkProps, linkProps, routePath } from '../../navigation/links';
import type { RootScreenProps } from '../../navigation/types';
import { Container, Footer, PageBackground, TopNav } from '../../theme/primitives';
import { theme as t } from '../../theme/tokens';

export function LobbyingLandingScreen({ navigation }: RootScreenProps<'LobbyingLanding'>) {
  const { isMobile, isTablet } = useResponsive();
  const summary = useLobbyingSummary();
  const data = summary.data?.state === 'reported' ? summary.data : null;
  const [query, setQuery] = useState('');
  const fontSize = isMobile ? 16 : isTablet ? 16 : 17;
  const body = { fontSize, lineHeight: fontSize * 1.5 };
  const h1Size = isMobile ? 32 : isTablet ? 44 : 56;
  const dekSize = isMobile ? 17 : isTablet ? 19 : 22;
  const cardPadding = isMobile
    ? { paddingVertical: 20, paddingHorizontal: 18 }
    : isTablet
      ? { paddingTop: 26, paddingHorizontal: 26, paddingBottom: 24 }
      : { paddingTop: 30, paddingHorizontal: 32, paddingBottom: 28 };
  const goSearch = () => navigation.navigate('MoneySearch', { q: query.trim() || undefined });
  const heldYears = lobbyingHeldYearsNote(data?.first_year);
  useDocumentTitle(
    routePath.lobbying(),
    lobbyingPageMetadata(routePath.lobbying(), copy.title).title,
  );

  return (
    <PageBackground>
      <ScrollView contentContainerStyle={styles.page}>
        <TopNav onHome={() => navigation.navigate('Tabs', { screen: 'Home' })} />
        <Container style={[styles.main, { paddingHorizontal: isMobile ? 20 : isTablet ? 32 : 56 }]}>
          <Pressable
            {...linkProps(routePath.money(), () => navigation.navigate('MoneyLanding'))}
            style={styles.back}
          >
            <Svg width={18} height={18} viewBox="0 0 24 24" aria-hidden>
              <Path d="M15 5 L8 12 L15 19" stroke="#4f5651" strokeWidth={2.2} fill="none" />
            </Svg>
            <Text style={styles.backText}>{MONEY_SECTION_NAME}</Text>
          </Pressable>
          <Text style={styles.eyebrow}>{copy.landingLabel}</Text>
          <Text
            accessibilityRole="header"
            aria-level={1}
            style={[styles.h1, { fontSize: h1Size, lineHeight: h1Size * 1.06 }]}
          >
            {copy.title}
          </Text>
          <Text style={[styles.intro, { fontSize: dekSize, lineHeight: dekSize * 1.5 }]}>
            {copy.intro}
          </Text>
          <View style={styles.search}>
            <MoneyNameSearchField
              value={query}
              onChangeText={setQuery}
              onSubmit={goSearch}
              placeholder={copy.search}
              submitLabel={copy.searchButton}
              showSubmitButton
              maxWidth={780}
              fieldHeight={isMobile ? 52 : isTablet ? 56 : 62}
              fieldFontSize={fontSize}
              stacked={isMobile}
            />
            <Text style={styles.searchNote}>{copy.searchNote}</Text>
          </View>
          <View style={[styles.lanes, isMobile && styles.column]}>
            {[
              {
                title: copy.lobbyists.title,
                body: copy.lobbyists.intro,
                count: lobbyistLaneCount(data?.registered_lobbyists),
                href: routePath.lobbyingLobbyists(),
                open: () => navigation.navigate('LobbyingLobbyists'),
              },
              {
                title: copy.principals.title,
                body: copy.principals.lane,
                count: principalLaneCount(data?.principals_reporting, data?.latest_reported_year),
                href: routePath.lobbyingPrincipals(),
                open: () => navigation.navigate('LobbyingPrincipals'),
              },
            ].map((lane) => (
              <Pressable
                key={lane.title}
                {...linkProps(lane.href, lane.open)}
                style={[styles.lane, isMobile && styles.stacked]}
              >
                <View style={styles.laneTitleRow}>
                  <Text
                    accessibilityRole="header"
                    aria-level={2}
                    style={[styles.laneTitle, { fontSize: isMobile ? 22 : isTablet ? 24 : 26 }]}
                  >
                    {lane.title}
                  </Text>
                  <Svg width={18} height={18} viewBox="0 0 24 24" aria-hidden>
                    <Path
                      d="M5 12 H19 M14 7 L19 12 L14 17"
                      fill="none"
                      stroke="#0f7a45"
                      strokeWidth={2.2}
                    />
                  </Svg>
                </View>
                <Text style={[styles.laneBody, body]}>{lane.body}</Text>
                {lane.count ? <Text style={styles.laneCount}>{lane.count}</Text> : null}
              </Pressable>
            ))}
          </View>
          {summary.isPending ? (
            <View role="status" aria-busy style={[styles.status, styles.card, cardPadding]}>
              <Text style={[styles.body, body]}>{copy.loading}</Text>
            </View>
          ) : !data ? (
            <View style={[styles.status, styles.card, cardPadding]}>
              <Text accessibilityRole="alert" style={[styles.body, body]}>
                {copy.unavailable}
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => void summary.refetch()}
                style={styles.retry}
              >
                <Text style={styles.retryText}>{copy.retry}</Text>
              </Pressable>
            </View>
          ) : null}
          <View style={[styles.information, isMobile && styles.column]}>
            {data?.copied_at ? (
              <View style={[styles.card, styles.infoCard, cardPadding, isMobile && styles.stacked]}>
                <Text style={styles.cardLabel}>{copy.copiedLabel}</Text>
                <Text style={styles.date}>{centralDateLabel(data.copied_at)}</Text>
                <Text style={styles.note}>{copy.copiedNote}</Text>
                <Text
                  {...externalLinkProps(
                    LOBBYING_SOURCE_URL,
                    () => void Linking.openURL(LOBBYING_SOURCE_URL),
                  )}
                  style={styles.sourceLink}
                >
                  {copy.sourceLabel} ↗
                </Text>
              </View>
            ) : null}
            <View style={[styles.card, styles.infoCard, cardPadding, isMobile && styles.stacked]}>
              <Text style={styles.cardLabel}>{copy.coverageLabel}</Text>
              <View role="list" style={styles.coverage}>
                {[copy.currentOnly, copy.annual, heldYears]
                  .filter((line): line is string => line != null)
                  .map((line) => (
                    <View role="listitem" key={line}>
                      <Text style={styles.coverageText}>{line}</Text>
                    </View>
                  ))}
              </View>
            </View>
          </View>
        </Container>
        <Footer />
      </ScrollView>
    </PageBackground>
  );
}

const styles = StyleSheet.create({
  page: { flexGrow: 1 },
  main: { paddingTop: 28, paddingBottom: 40, flexGrow: 1 },
  back: {
    alignSelf: 'flex-start',
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  backText: { fontFamily: t.typography.body, fontSize: 16, fontWeight: '600', color: '#4f5651' },
  eyebrow: {
    marginTop: 14,
    fontFamily: t.typography.body,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 2.6,
    color: '#0f7a45',
    fontVariant: ['tabular-nums'],
  },
  h1: {
    marginTop: 12,
    fontFamily: t.typography.title,
    fontWeight: '800',
    letterSpacing: -1.5,
    color: '#11150f',
  },
  intro: { marginTop: 16, maxWidth: 860, fontFamily: t.typography.body, color: '#4f5651' },
  search: { marginTop: 30, maxWidth: 780 },
  searchNote: {
    marginTop: 12,
    marginLeft: 14,
    fontFamily: t.typography.body,
    fontSize: 15,
    lineHeight: 22.5,
    color: '#6b716b',
  },
  lanes: { marginTop: 36, maxWidth: 780, flexDirection: 'row', gap: 16 },
  column: { flexDirection: 'column' },
  stacked: { flexGrow: 0, flexShrink: 0, flexBasis: 'auto' },
  lane: {
    flex: 1,
    minWidth: 0,
    paddingVertical: 24,
    paddingHorizontal: 22,
    borderWidth: 1,
    borderColor: 'rgba(17,21,15,0.10)',
    borderRadius: 18,
    backgroundColor: '#fff',
    boxShadow: '0 10px 30px rgba(17,21,15,0.08)',
  },
  laneTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  laneTitle: {
    flexShrink: 1,
    color: '#11150f',
    fontFamily: t.typography.title,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  laneBody: { marginTop: 10, fontFamily: t.typography.body, color: '#4f5651' },
  laneCount: {
    marginTop: 'auto',
    paddingTop: 16,
    fontFamily: t.typography.body,
    fontVariant: ['tabular-nums'],
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.9,
    color: '#0f7a45',
  },
  information: { marginTop: 36, maxWidth: 1200, flexDirection: 'row', gap: 16 },
  card: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: 'rgba(17,21,15,0.08)',
    borderRadius: 16,
    boxShadow: '0 8px 24px rgba(17,21,15,0.05)',
  },
  infoCard: { flex: 1, minWidth: 0 },
  cardLabel: {
    color: '#4f5651',
    fontFamily: t.typography.mono,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.4,
  },
  date: {
    marginTop: 10,
    color: '#11150f',
    fontFamily: t.typography.body,
    fontVariant: ['tabular-nums'],
    fontSize: 25,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  note: {
    marginTop: 12,
    color: '#6b716b',
    fontFamily: t.typography.body,
    fontVariant: ['tabular-nums'],
    fontSize: 15,
    lineHeight: 22.5,
  },
  sourceLink: {
    alignSelf: 'flex-start',
    minHeight: 44,
    paddingTop: 12,
    paddingBottom: 10,
    color: '#0f7a45',
    fontFamily: t.typography.body,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '700',
  },
  coverage: { marginTop: 14, gap: 8 },
  coverageText: {
    color: '#4f5651',
    fontFamily: t.typography.body,
    fontVariant: ['tabular-nums'],
    fontSize: 16,
    lineHeight: 24,
  },
  status: { marginTop: 24, maxWidth: 780 },
  body: { color: '#4f5651', fontFamily: t.typography.body },
  retry: { minHeight: 44, alignSelf: 'flex-start', justifyContent: 'center', marginTop: 12 },
  retryText: { color: '#0f7a45', fontFamily: t.typography.body, fontSize: 16, fontWeight: '700' },
});
