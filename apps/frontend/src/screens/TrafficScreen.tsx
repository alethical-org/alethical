import { NavigationProp, useNavigation } from '@react-navigation/native';
import { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { useResponsive } from '../hooks/useResponsive';
import { formatTrafficWindowEnd, isTrafficTotals, type TrafficTotals } from '../lib/traffic';
import { useDocumentTitle } from '../navigation/documentTitle';
import { RootStackParamList } from '../navigation/types';
import { Container, Footer, PageBackground, TopNav } from '../theme/primitives';
import { theme } from '../theme/tokens';

const REFRESH_MS = 5 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;

type TrafficState =
  { kind: 'loading' } | { kind: 'ready'; totals: TrafficTotals } | { kind: 'unavailable' };

function formatNumber(value: number) {
  return new Intl.NumberFormat('en-US').format(value);
}

function formatDate(iso: string) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(iso));
}

function fetchedMinutesAgo(fetchedAt: string, now: number) {
  return Math.max(0, Math.floor((now - Date.parse(fetchedAt)) / MINUTE_MS));
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <View style={styles.valueBox}>
        <Text style={styles.value}>{formatNumber(value)}</Text>
      </View>
    </View>
  );
}

function LoadingMetric({ label }: { label: string }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <View style={styles.valueBox}>
        <View
          aria-hidden
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={styles.loadingBar}
        />
      </View>
    </View>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <View style={styles.card}>{children}</View>;
}

function TrafficCards({ state }: { state: TrafficState }) {
  const { isMobile } = useResponsive();

  if (state.kind === 'unavailable') {
    return (
      <>
        <View accessibilityLiveRegion="polite" style={styles.unavailable}>
          <Text style={styles.unavailableText}>Traffic totals are temporarily unavailable.</Text>
        </View>
        <Text style={styles.source}>Counted by Vercel</Text>
      </>
    );
  }

  const loading = state.kind === 'loading';
  const totals = state.kind === 'ready' ? state.totals : null;
  const cardRowStyle = isMobile ? styles.cardsMobile : styles.cards;

  return (
    <>
      {loading ? <Text style={styles.visuallyHidden}>Traffic totals are loading.</Text> : null}
      <View accessibilityLiveRegion="polite" style={cardRowStyle}>
        <Card>
          <Text style={styles.period}>LAST 24 HOURS</Text>
          {loading ? (
            <LoadingMetric label="Page views" />
          ) : (
            <Metric label="Page views" value={totals?.pageViews24h ?? 0} />
          )}
        </Card>

        <Card>
          <Text style={styles.period}>LAST 7 DAYS</Text>
          {loading ? (
            <LoadingMetric label="Page views" />
          ) : (
            <Metric label="Page views" value={totals?.pageViews7d ?? 0} />
          )}
        </Card>

        <Card>
          <Text style={styles.period}>LAST 30 DAYS</Text>
          {loading ? (
            <LoadingMetric label="Page views" />
          ) : (
            <Metric label="Page views" value={totals?.pageViews30d ?? 0} />
          )}
        </Card>
      </View>
    </>
  );
}

export function TrafficScreen() {
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const { isMobile } = useResponsive();
  const [state, setState] = useState<TrafficState>({ kind: 'loading' });
  const [now, setNow] = useState(Date.now());
  useDocumentTitle('/traffic', 'Traffic | Alethical');

  useEffect(() => {
    let active = true;

    const load = async () => {
      try {
        const response = await fetch('/api/traffic', { headers: { Accept: 'application/json' } });
        const payload: unknown = response.ok ? await response.json() : null;
        if (!active || !isTrafficTotals(payload)) {
          if (active)
            setState((current) => (current.kind === 'ready' ? current : { kind: 'unavailable' }));
          return;
        }
        setState({ kind: 'ready', totals: payload });
        setNow(Date.now());
      } catch {
        if (active)
          setState((current) => (current.kind === 'ready' ? current : { kind: 'unavailable' }));
      }
    };

    void load();
    const refresh = setInterval(() => void load(), REFRESH_MS);
    const clock = setInterval(() => setNow(Date.now()), MINUTE_MS);
    return () => {
      active = false;
      clearInterval(refresh);
      clearInterval(clock);
    };
  }, []);

  const totals = state.kind === 'ready' ? state.totals : null;
  const collecting = useMemo(
    () =>
      totals
        ? Date.parse(totals.windowEndedAt) - Date.parse(totals.countingStartedAt) < 30 * DAY_MS
        : false,
    [totals],
  );

  return (
    <PageBackground>
      <ScrollView contentContainerStyle={styles.page}>
        <TopNav onHome={() => navigation.navigate('Tabs', { screen: 'Home' })} />
        <Container style={[styles.main, isMobile && styles.mainMobile]}>
          <Text
            accessibilityRole="header"
            aria-level={1}
            style={[styles.title, isMobile && styles.titleMobile]}
          >
            Traffic
          </Text>
          <Text style={styles.purpose}>Public totals about how Alethical is used</Text>

          <View style={styles.totalsRegion}>
            <TrafficCards state={state} />
            {totals ? (
              <View style={styles.sourceCluster}>
                <Text style={styles.source}>
                  Counted by Vercel · Through {formatTrafficWindowEnd(totals.windowEndedAt)} ·
                  Checked {fetchedMinutesAgo(totals.fetchedAt, now)} minutes ago
                </Text>
                {collecting ? (
                  <Text style={styles.collecting}>
                    Collecting since {formatDate(totals.countingStartedAt)}
                  </Text>
                ) : null}
              </View>
            ) : null}
          </View>
        </Container>
        <Footer
          onPrivacy={() => navigation.navigate('Privacy')}
          onTerms={() => navigation.navigate('Terms')}
        />
      </ScrollView>
    </PageBackground>
  );
}

const styles = StyleSheet.create({
  page: { flexGrow: 1, backgroundColor: theme.colors.surface },
  main: { width: '100%', maxWidth: 1184, alignSelf: 'center', paddingTop: 72, paddingBottom: 72 },
  mainMobile: { paddingTop: 44, paddingBottom: 48 },
  title: {
    color: theme.colors.ink,
    fontFamily: theme.typography.title,
    fontSize: 44,
    lineHeight: 48,
    fontWeight: '800',
    letterSpacing: -1.1,
  },
  titleMobile: { fontSize: 36, lineHeight: 40, letterSpacing: -0.8 },
  purpose: {
    marginTop: 14,
    color: theme.colors.mutedInk,
    fontFamily: theme.typography.body,
    fontSize: 18,
    lineHeight: 28,
  },
  totalsRegion: { marginTop: 40 },
  cards: { flexDirection: 'row', gap: 16 },
  cardsMobile: { gap: 16 },
  card: {
    flex: 1,
    minWidth: 0,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 16,
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 22,
    shadowColor: theme.colors.ink,
    shadowOpacity: 0.04,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
  },
  period: {
    color: theme.colors.text.muted,
    fontFamily: theme.typography.mono,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '700',
    letterSpacing: 1.3,
  },
  metric: { flex: 1, minWidth: 0 },
  metricLabel: {
    color: theme.colors.ink,
    fontFamily: theme.typography.ui,
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '800',
    letterSpacing: -0.15,
  },
  valueBox: { height: 46, justifyContent: 'center', marginTop: 8 },
  value: {
    color: theme.colors.brand.display,
    fontFamily: theme.typography.ui,
    fontSize: 40,
    lineHeight: 40,
    fontWeight: '800',
    letterSpacing: -1,
    fontVariant: ['tabular-nums'],
  },
  loadingBar: { width: 84, height: 24, borderRadius: 7, backgroundColor: theme.colors.surfaceAlt },
  visuallyHidden: { position: 'absolute', width: 1, height: 1, opacity: 0 },
  unavailable: {
    minHeight: 150,
    justifyContent: 'center',
    marginTop: 0,
    paddingHorizontal: 20,
    paddingVertical: 26,
    backgroundColor: theme.colors.surfaceAlt,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 14,
  },
  unavailableText: {
    color: theme.colors.ink,
    fontFamily: theme.typography.ui,
    fontSize: 16,
    lineHeight: 23,
    fontWeight: '600',
  },
  sourceCluster: { marginTop: 12, paddingLeft: 17 },
  source: {
    marginTop: 12,
    color: theme.colors.mutedInk,
    fontFamily: theme.typography.mono,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '500',
  },
  collecting: {
    marginTop: 10,
    color: theme.colors.mutedInk,
    fontFamily: theme.typography.body,
    fontSize: 13.5,
    lineHeight: 20,
  },
});
