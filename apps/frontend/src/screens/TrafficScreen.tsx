import { NavigationProp, useNavigation } from '@react-navigation/native';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { useResponsive } from '../hooks/useResponsive';
import {
  formatTrafficWindowEnd,
  isPerformanceTotals,
  isSearchTotals,
  isTrafficTotals,
  isUptimeTotals,
  type PerformanceTotals,
  type SearchTotals,
  type TrafficTotals,
  type UptimeTotals,
} from '../lib/traffic';
import { useDocumentTitle } from '../navigation/documentTitle';
import { RootStackParamList } from '../navigation/types';
import { Container, Footer, PageBackground, TopNav } from '../theme/primitives';
import { theme } from '../theme/tokens';

const REFRESH_MS = 5 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;

type SourceState<T> = { kind: 'loading' } | { kind: 'ready'; totals: T } | { kind: 'unavailable' };

function useTrafficSource<T>(path: string, validate: (value: unknown) => value is T) {
  const [state, setState] = useState<SourceState<T>>({ kind: 'loading' });

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const response = await fetch(path, { headers: { Accept: 'application/json' } });
        const payload: unknown = response.ok ? await response.json() : null;
        if (!active || !validate(payload)) {
          if (active)
            setState((current) => (current.kind === 'ready' ? current : { kind: 'unavailable' }));
          return;
        }
        setState({ kind: 'ready', totals: payload });
      } catch {
        if (active)
          setState((current) => (current.kind === 'ready' ? current : { kind: 'unavailable' }));
      }
    };

    void load();
    const refresh = setInterval(() => void load(), REFRESH_MS);
    return () => {
      active = false;
      clearInterval(refresh);
    };
  }, [path, validate]);

  return state;
}

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

function formatDateRange(start: string, end: string) {
  return `${formatDate(start)} to ${formatDate(end)}`;
}

function fetchedMinutesAgo(fetchedAt: string, now: number) {
  return Math.max(0, Math.floor((now - Date.parse(fetchedAt)) / MINUTE_MS));
}

function exactChange(current: number, previous: number) {
  const change = current - previous;
  if (change === 0) return 'Same as the prior 28 finalized days.';
  return `${formatNumber(Math.abs(change))} ${change > 0 ? 'more' : 'fewer'} than the prior 28 finalized days.`;
}

function DisplayMetric({
  label,
  value,
  description,
}: {
  label: string;
  value: string;
  description?: string;
}) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <View style={styles.valueBox}>
        <Text style={styles.value}>{value}</Text>
      </View>
      {description ? <Text style={styles.metricDescription}>{description}</Text> : null}
    </View>
  );
}

function Metric({
  label,
  value,
  description,
}: {
  label: string;
  value: number;
  description?: string;
}) {
  return <DisplayMetric label={label} value={formatNumber(value)} description={description} />;
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

function Card({ period, children }: { period: string; children: React.ReactNode }) {
  return (
    <View style={styles.card}>
      <Text style={styles.period}>{period}</Text>
      {children}
    </View>
  );
}

function CardRow({ children }: { children: React.ReactNode }) {
  const { isMobile } = useResponsive();
  return <View style={isMobile ? styles.cardsMobile : styles.cards}>{children}</View>;
}

function Unavailable({ text, source }: { text: string; source: string }) {
  return (
    <>
      <View accessibilityLiveRegion="polite" style={styles.unavailable}>
        <Text style={styles.unavailableText}>{text}</Text>
      </View>
      <Text style={styles.source}>{source}</Text>
    </>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <Text accessibilityRole="header" aria-level={2} style={styles.sectionTitle}>
      {children}
    </Text>
  );
}

function TrafficCards({ state, now }: { state: SourceState<TrafficTotals>; now: number }) {
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
  const collecting = totals
    ? Date.parse(totals.windowEndedAt) - Date.parse(totals.countingStartedAt) < 30 * DAY_MS
    : false;

  return (
    <>
      {loading ? <Text style={styles.visuallyHidden}>Traffic totals are loading.</Text> : null}
      <View accessibilityLiveRegion="polite">
        <CardRow>
          <Card period="LAST 24 HOURS">
            {loading ? (
              <LoadingMetric label="Page views" />
            ) : (
              <Metric label="Page views" value={totals?.pageViews24h ?? 0} />
            )}
          </Card>
          <Card period="LAST 7 DAYS">
            {loading ? (
              <LoadingMetric label="Page views" />
            ) : (
              <Metric label="Page views" value={totals?.pageViews7d ?? 0} />
            )}
          </Card>
          <Card period="LAST 30 DAYS">
            {loading ? (
              <LoadingMetric label="Page views" />
            ) : (
              <Metric label="Page views" value={totals?.pageViews30d ?? 0} />
            )}
          </Card>
        </CardRow>
      </View>
      {totals ? (
        <View style={styles.sourceCluster}>
          <Text style={styles.source}>
            Counted by Vercel · Through {formatTrafficWindowEnd(totals.windowEndedAt)} · Checked{' '}
            {fetchedMinutesAgo(totals.fetchedAt, now)} minutes ago
          </Text>
          {collecting ? (
            <Text style={styles.collecting}>
              Collecting since {formatDate(totals.countingStartedAt)}
            </Text>
          ) : null}
        </View>
      ) : null}
    </>
  );
}

function SearchCards({
  state,
  source,
  now,
}: {
  state: SourceState<SearchTotals>;
  source: 'Google' | 'Bing';
  now: number;
}) {
  if (state.kind === 'unavailable') {
    return (
      <Unavailable
        text={`${source} search data is temporarily unavailable.`}
        source={source === 'Google' ? 'Google Search Console' : 'Bing Webmaster Tools'}
      />
    );
  }
  const loading = state.kind === 'loading';
  const totals = state.kind === 'ready' ? state.totals : null;
  const sourceName = source === 'Google' ? 'Google Search Console' : 'Bing Webmaster Tools';
  const shownLabel = source === 'Google' ? 'Shown in Google results' : 'Shown in Bing results';
  const visitsLabel =
    source === 'Google' ? 'Visits from Google results' : 'Visits from Bing results';

  return (
    <>
      <View accessibilityLiveRegion="polite">
        <CardRow>
          <Card period="28 FINALIZED DAYS">
            {loading ? (
              <LoadingMetric label={shownLabel} />
            ) : (
              <Metric
                label={shownLabel}
                value={totals?.impressions28d ?? 0}
                description={exactChange(
                  totals?.impressions28d ?? 0,
                  totals?.previousImpressions28d ?? 0,
                )}
              />
            )}
          </Card>
          <Card period="28 FINALIZED DAYS">
            {loading ? (
              <LoadingMetric label={visitsLabel} />
            ) : (
              <Metric
                label={visitsLabel}
                value={totals?.clicks28d ?? 0}
                description={exactChange(totals?.clicks28d ?? 0, totals?.previousClicks28d ?? 0)}
              />
            )}
          </Card>
        </CardRow>
      </View>
      {totals ? (
        <View style={styles.sourceCluster}>
          <Text style={styles.source}>
            {sourceName} · Fetched {fetchedMinutesAgo(totals.fetchedAt, now)} minutes ago
          </Text>
          <Text style={styles.clarifier}>
            Finalized dates: {formatDateRange(totals.periodStartedOn, totals.periodEndedOn)}.
          </Text>
        </View>
      ) : null}
    </>
  );
}

function UptimeCards({ state, now }: { state: SourceState<UptimeTotals>; now: number }) {
  if (state.kind === 'unavailable') {
    return (
      <Unavailable
        text="Availability data is temporarily unavailable."
        source="Checked from North Virginia by Checkly"
      />
    );
  }
  const loading = state.kind === 'loading';
  const totals = state.kind === 'ready' ? state.totals : null;
  const percent = (value: number) =>
    `${value.toLocaleString('en-US', { maximumFractionDigits: 3 })}%`;

  return (
    <>
      <View accessibilityLiveRegion="polite">
        <CardRow>
          <Card period="LAST 30 DAYS">
            {loading ? (
              <LoadingMetric label="Main website available" />
            ) : (
              <DisplayMetric
                label="Main website available"
                value={percent(totals?.websiteAvailability30d ?? 0)}
                description="The home page answered the outside check."
              />
            )}
          </Card>
          <Card period="LAST 30 DAYS">
            {loading ? (
              <LoadingMetric label="Traffic page available" />
            ) : (
              <DisplayMetric
                label="Traffic page available"
                value={percent(totals?.trafficPageAvailability30d ?? 0)}
                description="This public page answered the outside check."
              />
            )}
          </Card>
          <Card period="LAST 30 DAYS">
            {loading ? (
              <LoadingMetric label="Data service ready" />
            ) : (
              <DisplayMetric
                label="Data service ready"
                value={percent(totals?.apiAvailability30d ?? 0)}
                description="The service and its database answered the outside check."
              />
            )}
          </Card>
        </CardRow>
      </View>
      {totals ? (
        <Text style={styles.source}>
          Checked from North Virginia by Checkly · Fetched{' '}
          {fetchedMinutesAgo(totals.fetchedAt, now)} minutes ago
        </Text>
      ) : null}
    </>
  );
}

function PerformanceCards({ state, now }: { state: SourceState<PerformanceTotals>; now: number }) {
  if (state.kind === 'unavailable') {
    return (
      <Unavailable
        text="Page speed data is temporarily unavailable."
        source="Measured by Cloudflare Web Analytics"
      />
    );
  }
  const loading = state.kind === 'loading';
  const totals = state.kind === 'ready' ? state.totals : null;
  const pending = 'Building sample';

  return (
    <>
      <View accessibilityLiveRegion="polite">
        <CardRow>
          <Card period="28 DAYS · SLOWEST 1 IN 4">
            {loading ? (
              <LoadingMetric label="Main content appeared" />
            ) : (
              <DisplayMetric
                label="Main content appeared"
                value={
                  totals?.lcpP75Ms == null ? pending : `${(totals.lcpP75Ms / 1000).toFixed(2)} s`
                }
                description="Time until the main content was visible. Lower is better."
              />
            )}
          </Card>
          <Card period="28 DAYS · SLOWEST 1 IN 4">
            {loading ? (
              <LoadingMetric label="Page reacted" />
            ) : (
              <DisplayMetric
                label="Page reacted"
                value={totals?.inpP75Ms == null ? pending : `${formatNumber(totals.inpP75Ms)} ms`}
                description="Time from a click or tap until the page reacted. Lower is better."
              />
            )}
          </Card>
          <Card period="28 DAYS · SLOWEST 1 IN 4">
            {loading ? (
              <LoadingMetric label="Page stayed still" />
            ) : (
              <DisplayMetric
                label="Page stayed still"
                value={totals?.clsP75 == null ? pending : totals.clsP75.toFixed(3)}
                description="How much content moved unexpectedly while loading. Lower is better."
              />
            )}
          </Card>
        </CardRow>
      </View>
      {totals ? (
        <View style={styles.sourceCluster}>
          <Text style={styles.source}>
            Cloudflare browser sample, Chromium only · Fetched{' '}
            {fetchedMinutesAgo(totals.fetchedAt, now)} minutes ago
          </Text>
          <Text style={styles.clarifier}>
            {formatDateRange(totals.periodStartedOn, totals.periodEndedOn)}. A score appears after
            50 measured visits.
          </Text>
        </View>
      ) : null}
    </>
  );
}

export function TrafficScreen() {
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const { isMobile } = useResponsive();
  const traffic = useTrafficSource('/api/traffic', isTrafficTotals);
  const google = useTrafficSource('/api/traffic-google', isSearchTotals);
  const bing = useTrafficSource('/api/traffic-bing', isSearchTotals);
  const uptime = useTrafficSource('/api/traffic-uptime', isUptimeTotals);
  const performance = useTrafficSource('/api/traffic-performance', isPerformanceTotals);
  const [now, setNow] = useState(Date.now());
  useDocumentTitle('/traffic', 'Traffic | Alethical');

  useEffect(() => {
    const clock = setInterval(() => setNow(Date.now()), MINUTE_MS);
    return () => clearInterval(clock);
  }, []);

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
            <TrafficCards state={traffic} now={now} />
          </View>

          <View style={styles.section}>
            <SectionTitle>Found in search</SectionTitle>
            <Text style={styles.vendorTitle}>Google</Text>
            <SearchCards state={google} source="Google" now={now} />
            <Text style={[styles.vendorTitle, styles.vendorTitleSpaced]}>Bing</Text>
            <SearchCards state={bing} source="Bing" now={now} />
          </View>

          <View style={styles.section}>
            <SectionTitle>Can people reach Alethical?</SectionTitle>
            <UptimeCards state={uptime} now={now} />
          </View>

          <View style={styles.section}>
            <SectionTitle>Speed during real visits</SectionTitle>
            <PerformanceCards state={performance} now={now} />
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
  section: { marginTop: 42 },
  sectionTitle: {
    marginBottom: 18,
    color: theme.colors.ink,
    fontFamily: theme.typography.title,
    fontSize: 25,
    lineHeight: 32,
    fontWeight: '800',
    letterSpacing: -0.35,
  },
  vendorTitle: {
    marginBottom: 10,
    color: theme.colors.mutedInk,
    fontFamily: theme.typography.ui,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '700',
  },
  vendorTitleSpaced: { marginTop: 26 },
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
    marginBottom: 8,
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
  metricDescription: {
    marginTop: 8,
    color: theme.colors.mutedInk,
    fontFamily: theme.typography.body,
    fontSize: 14.5,
    lineHeight: 22,
  },
  loadingBar: { width: 84, height: 24, borderRadius: 7, backgroundColor: theme.colors.surfaceAlt },
  visuallyHidden: { position: 'absolute', width: 1, height: 1, opacity: 0 },
  unavailable: {
    minHeight: 118,
    justifyContent: 'center',
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
  clarifier: {
    marginTop: 6,
    color: theme.colors.text.muted,
    fontFamily: theme.typography.body,
    fontSize: 13.5,
    lineHeight: 20,
  },
});
