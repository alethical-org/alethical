import { NavigationProp, useNavigation } from '@react-navigation/native';
import { useEffect, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { getSiteMetricRecordTotalsFromApi } from '../data/api';
import { LinkArrow } from '../components/LinkArrow';
import { useResponsive } from '../hooks/useResponsive';
import {
  formatTrafficWindowEnd,
  isPerformanceTotals,
  isSearchTotals,
  isSiteMetricRecordTotals,
  isTrafficTotals,
  isUptimeTotals,
  type PerformanceTotals,
  type SearchTotals,
  type SiteMetricActions,
  type SiteMetricRecordTotals,
  type TrafficBreakdown,
  type TrafficTotals,
  type UptimeTotals,
} from '../lib/traffic';
import { externalLinkProps } from '../navigation/links';
import { useDocumentTitle } from '../navigation/documentTitle';
import { RootStackParamList } from '../navigation/types';
import { useAuth } from '../providers/AuthProvider';
import { Container, Footer, PageBackground, TopNav } from '../theme/primitives';
import { theme } from '../theme/tokens';

const REFRESH_MS = 5 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const CHECKLY_PUBLIC_STATUS_URL = process.env.EXPO_PUBLIC_CHECKLY_STATUS_URL?.trim() ?? '';

const STAFF_LINKS = {
  vercel: 'https://vercel.com/dashboard',
  google: 'https://search.google.com/search-console',
  bing: 'https://www.bing.com/webmasters/',
  checkly: 'https://app.checklyhq.com/',
  cloudflare: 'https://dash.cloudflare.com/',
};

type ActivityRange = 7 | 30;
type SourceState<T> =
  { kind: 'loading' } | { kind: 'ready'; totals: T; stale: boolean } | { kind: 'unavailable' };

function useTrafficSource<T>(path: string, validate: (value: unknown) => value is T) {
  const [state, setState] = useState<SourceState<T>>({ kind: 'loading' });

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const response = await fetch(path, { headers: { Accept: 'application/json' } });
        const payload: unknown = response.ok ? await response.json() : null;
        if (!active || !validate(payload)) {
          if (active) {
            setState((current) =>
              current.kind === 'ready' ? { ...current, stale: true } : { kind: 'unavailable' },
            );
          }
          return;
        }
        setState({ kind: 'ready', totals: payload, stale: false });
      } catch {
        if (active) {
          setState((current) =>
            current.kind === 'ready' ? { ...current, stale: true } : { kind: 'unavailable' },
          );
        }
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

function useRecordTotals() {
  const [state, setState] = useState<SourceState<SiteMetricRecordTotals>>({ kind: 'loading' });

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const payload: unknown = await getSiteMetricRecordTotalsFromApi();
        if (!active || !isSiteMetricRecordTotals(payload)) {
          if (active) {
            setState((current) =>
              current.kind === 'ready' ? { ...current, stale: true } : { kind: 'unavailable' },
            );
          }
          return;
        }
        setState({ kind: 'ready', totals: payload, stale: false });
      } catch {
        if (active) {
          setState((current) =>
            current.kind === 'ready' ? { ...current, stale: true } : { kind: 'unavailable' },
          );
        }
      }
    };

    void load();
    const refresh = setInterval(() => void load(), REFRESH_MS);
    return () => {
      active = false;
      clearInterval(refresh);
    };
  }, []);

  return state;
}

function useTeamAccount() {
  const { isLoading, isSignedIn, user } = useAuth();
  const [teamAccount, setTeamAccount] = useState(false);

  useEffect(() => {
    if (isLoading) return;
    if (!isSignedIn || !user) {
      setTeamAccount(false);
      return;
    }
    const controller = new AbortController();
    setTeamAccount(false);
    void fetch('/api/traffic-collection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: user.id }),
      signal: controller.signal,
    })
      .then(async (response) => (response.ok ? ((await response.json()) as unknown) : null))
      .then((payload) => {
        const value = payload as { teamAccount?: unknown } | null;
        if (!controller.signal.aborted) setTeamAccount(value?.teamAccount === true);
      })
      .catch(() => {
        if (!controller.signal.aborted) setTeamAccount(false);
      });
    return () => controller.abort();
  }, [isLoading, isSignedIn, user]);

  return teamAccount;
}

function initialActivityRange(): ActivityRange {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return 7;
  return new URLSearchParams(window.location.search).get('range') === '30' ? 30 : 7;
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

function percent(value: number) {
  return `${value.toLocaleString('en-US', { maximumFractionDigits: 3 })}%`;
}

function clicksPerHundredValue(clicks: number, impressions: number) {
  return impressions === 0 ? null : (clicks / impressions) * 100;
}

function formatClicksPerHundred(value: number | null) {
  if (value == null) return 'Not available';
  return value.toLocaleString('en-US', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

function searchComparisonText(current: number | null, previous: number | null) {
  if (current == null || previous == null) {
    return 'Prior 30-day comparison is not available';
  }
  if (current === previous) return 'Same as the previous 30 days';
  return `${current > previous ? 'Up' : 'Down'} from ${formatClicksPerHundred(previous)} in the previous 30 days`;
}

function speedVerdict(kind: 'lcp' | 'inp' | 'cls', value: number | null) {
  if (value == null) return null;
  const [good, poor] = kind === 'lcp' ? [2500, 4000] : kind === 'inp' ? [200, 500] : [0.1, 0.25];
  if (value <= good) return 'Good';
  if (value <= poor) return 'Needs improvement';
  return 'Poor';
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <Text accessibilityRole="header" aria-level={2} style={styles.sectionTitle}>
      {children}
    </Text>
  );
}

function PanelTitle({ children }: { children: React.ReactNode }) {
  return (
    <Text accessibilityRole="header" aria-level={2} style={styles.eyebrow}>
      {children}
    </Text>
  );
}

function LoadingBar({ wide = false }: { wide?: boolean }) {
  return (
    <View
      aria-hidden
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.loadingBar, wide && styles.loadingBarWide]}
    />
  );
}

function Panel({ children, busy = false }: { children: React.ReactNode; busy?: boolean }) {
  const { isMobile } = useResponsive();
  return (
    <View aria-busy={busy} style={[styles.panel, isMobile && styles.panelMobile]}>
      {busy ? (
        <Text accessibilityLiveRegion="polite" style={styles.visuallyHidden}>
          Site metrics are loading.
        </Text>
      ) : null}
      {children}
    </View>
  );
}

function UnavailablePanel({ text }: { text: string }) {
  return (
    <Panel>
      <Text accessibilityLiveRegion="polite" style={styles.unavailableText}>
        {text}
      </Text>
    </Panel>
  );
}

function ActivityStatusPanel({
  title,
  loading,
  unavailableText,
}: {
  title: string;
  loading: boolean;
  unavailableText: string;
}) {
  return (
    <Panel busy={loading}>
      <PanelTitle>{title}</PanelTitle>
      {loading ? (
        <>
          <LoadingBar wide />
          <LoadingBar wide />
          <LoadingBar wide />
        </>
      ) : (
        <Text accessibilityLiveRegion="polite" style={styles.unavailableText}>
          {unavailableText}
        </Text>
      )}
    </Panel>
  );
}

function StaleNote({ stale }: { stale: boolean }) {
  return stale ? (
    <Text accessibilityLiveRegion="polite" style={styles.staleText}>
      A newer reading has not come through yet
    </Text>
  ) : null;
}

function StaffLink({ href, label, show }: { href: string; label: string; show: boolean }) {
  if (!show) return null;
  return (
    <Pressable {...externalLinkProps(href)} style={styles.staffLinkTarget}>
      <Text style={styles.staffLink}>{label} ↗</Text>
    </Pressable>
  );
}

function MetricRow({
  label,
  value,
  last = false,
}: {
  label: string;
  value: string;
  last?: boolean;
}) {
  return (
    <View style={[styles.metricRow, last && styles.metricRowLast]}>
      <Text style={styles.metricRowLabel}>{label}</Text>
      <Text style={styles.metricRowValue}>{value}</Text>
    </View>
  );
}

function RecentTraffic({ state, now }: { state: SourceState<TrafficTotals>; now: number }) {
  if (state.kind === 'unavailable') {
    return <UnavailablePanel text="Recent traffic is temporarily unavailable." />;
  }
  const cards = [
    { period: 'LAST 24 HOURS', visitors: 'estimatedVisitors24h', views: 'pageViews24h' },
    { period: 'LAST 7 DAYS', visitors: 'estimatedVisitors7d', views: 'pageViews7d' },
    { period: 'LAST 30 DAYS', visitors: 'estimatedVisitors30d', views: 'pageViews30d' },
  ] as const;
  const loading = state.kind === 'loading';
  const totals = state.kind === 'ready' ? state.totals : null;
  const collecting = totals
    ? Date.parse(totals.windowEndedAt) - Date.parse(totals.countingStartedAt) < 30 * DAY_MS
    : false;

  return (
    <>
      <View style={styles.recentGrid}>
        {cards.map((card) => (
          <View key={card.period} aria-busy={loading} style={styles.recentCard}>
            <Text style={styles.eyebrow}>{card.period}</Text>
            <Text style={styles.recentLabel}>Estimated visitors</Text>
            {loading ? (
              <LoadingBar wide />
            ) : (
              <Text style={styles.recentValue}>{formatNumber(totals?.[card.visitors] ?? 0)}</Text>
            )}
            <View style={styles.recentDivider} />
            <Text style={styles.recentLabel}>Page views</Text>
            {loading ? (
              <LoadingBar wide />
            ) : (
              <Text style={styles.recentValue}>{formatNumber(totals?.[card.views] ?? 0)}</Text>
            )}
          </View>
        ))}
      </View>
      {loading ? (
        <Text accessibilityLiveRegion="polite" style={styles.visuallyHidden}>
          Recent traffic is loading.
        </Text>
      ) : null}
      <Text style={styles.note}>
        Estimated visitors may include the same person more than once across days or devices
      </Text>
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
          <StaleNote stale={state.kind === 'ready' && state.stale} />
        </View>
      ) : null}
    </>
  );
}

const DESTINATIONS = [
  ['home', 'Home'],
  ['billSearch', 'Bill search'],
  ['billProfiles', 'Bill profiles'],
  ['legislatorSearch', 'Legislator search'],
  ['legislatorProfiles', 'Legislator profiles'],
  ['findMyLegislator', 'Find My Legislator'],
  ['other', 'Other'],
] as const;

function DestinationPanel({ breakdown }: { breakdown: TrafficBreakdown }) {
  const total = Object.values(breakdown.destinationPageViews).reduce(
    (sum, value) => sum + value,
    0,
  );
  return (
    <Panel>
      <PanelTitle>WHERE PEOPLE GO</PanelTitle>
      {total === 0 ? (
        <Text style={styles.zeroText}>No page views in this range yet</Text>
      ) : (
        <>
          <View style={styles.destinationRows}>
            {DESTINATIONS.map(([key, label]) => {
              const share = (breakdown.destinationPageViews[key] / total) * 100;
              return (
                <View key={key} style={styles.destinationRow}>
                  <View style={styles.destinationLabelRow}>
                    <Text style={styles.metricRowLabel}>{label}</Text>
                    <Text style={styles.destinationPercent}>{Math.round(share)}%</Text>
                  </View>
                  <View aria-hidden style={styles.barTrack}>
                    <View style={[styles.barFill, { width: `${share}%` }]} />
                  </View>
                </View>
              );
            })}
          </View>
          <Text style={styles.panelNote}>
            Percentages show shares of page views, not visitors. Searches with results are counted
            separately.
          </Text>
        </>
      )}
    </Panel>
  );
}

function distinctValue(value: { count: number; capped: boolean }) {
  return value.capped ? `${formatNumber(value.count)}+` : formatNumber(value.count);
}

function ExplorePanel({ breakdown }: { breakdown: TrafficBreakdown }) {
  return (
    <Panel>
      <PanelTitle>WHAT PEOPLE EXPLORE</PanelTitle>
      <View style={styles.tableHeader}>
        <Text
          style={[styles.tableLabel, styles.tableName]}
          accessibilityRole="header"
          aria-level={3}
        >
          Profiles
        </Text>
        <Text style={styles.tableLabel} accessibilityRole="header" aria-level={3}>
          Profile views
        </Text>
        <Text style={styles.tableLabel} accessibilityRole="header" aria-level={3}>
          Different profiles
        </Text>
      </View>
      {[
        ['Bills', breakdown.billProfiles],
        ['Legislators', breakdown.legislatorProfiles],
      ].map(([label, totals], index) => {
        const profile = totals as TrafficBreakdown['billProfiles'];
        return (
          <View
            key={label as string}
            style={[styles.tableRow, index === 1 && styles.metricRowLast]}
          >
            <Text style={[styles.metricRowLabel, styles.tableName]}>{label as string}</Text>
            <Text style={styles.tableValue}>{formatNumber(profile.pageViews)}</Text>
            <Text style={styles.tableValue}>{distinctValue(profile.differentProfilesViewed)}</Text>
          </View>
        );
      })}
      <Text style={styles.panelNote}>
        Profile views include repeat views. Each different profile is counted once.
      </Text>
      <Text style={styles.panelNote}>
        Shows 100+ when the source cannot list more different profiles
      </Text>
    </Panel>
  );
}

function ActionsPanel({ actions }: { actions: SiteMetricActions }) {
  const rows = [
    ['Bill searches with results', actions.billSearchesWithResults],
    ['Legislator searches with results', actions.legislatorSearchesWithResults],
    ['Find My Legislator lookups with results', actions.findMyLegislatorWithResults],
    ['Official source links opened', actions.officialSourceLinksOpened],
    ['New bill watches', actions.newBillWatches],
  ] as const;
  return (
    <Panel>
      <PanelTitle>WHAT PEOPLE DO</PanelTitle>
      <View style={styles.plainRows}>
        {rows.map(([label, value], index) => (
          <MetricRow
            key={label}
            label={label}
            value={formatNumber(value)}
            last={index === rows.length - 1}
          />
        ))}
      </View>
      <Text style={styles.panelNote}>
        No search words, addresses, or districts are included in these analytics.
      </Text>
    </Panel>
  );
}

function ReadersPanel({ totals }: { totals: SiteMetricRecordTotals['readers'] }) {
  return (
    <Panel>
      <PanelTitle>READERS</PanelTitle>
      <View style={styles.plainRows}>
        <MetricRow label="Registered readers" value={formatNumber(totals.registeredReaders)} />
        <MetricRow label="Current bill watches" value={formatNumber(totals.currentBillWatches)} />
        <MetricRow
          label="Different bills currently watched"
          value={formatNumber(totals.differentBillsCurrentlyWatched)}
          last
        />
      </View>
      <Text style={styles.panelNote}>
        Current totals; the date range does not apply. Bill watches count each reader&apos;s watch;
        different bills count each bill once.
      </Text>
    </Panel>
  );
}

function SearchPanel({
  source,
  state,
  now,
  teamAccount,
}: {
  source: 'Google' | 'Bing';
  state: SourceState<SearchTotals>;
  now: number;
  teamAccount: boolean;
}) {
  if (state.kind === 'unavailable') {
    return (
      <Panel>
        <Text style={styles.vendorTitle}>{source}</Text>
        <Text accessibilityLiveRegion="polite" style={styles.unavailableText}>
          {source} search data is temporarily unavailable.
        </Text>
      </Panel>
    );
  }
  if (state.kind === 'loading') {
    return (
      <Panel busy>
        <Text style={styles.vendorTitle}>{source}</Text>
        <LoadingBar wide />
        <LoadingBar wide />
        <LoadingBar />
      </Panel>
    );
  }
  const totals = state.totals;
  const currentRate = clicksPerHundredValue(totals.clicks30d, totals.impressions30d);
  const previousRate = clicksPerHundredValue(
    totals.previousClicks30d,
    totals.previousImpressions30d,
  );
  const sourceName = source === 'Google' ? 'Google Search Console' : 'Bing Webmaster Tools';
  const dashboard = source === 'Google' ? STAFF_LINKS.google : STAFF_LINKS.bing;
  return (
    <Panel>
      <Text style={styles.vendorTitle}>{source}</Text>
      <View style={styles.searchPair}>
        <View style={styles.searchPairMetric}>
          <Text style={styles.metricRowLabel}>Appearances</Text>
          <Text style={styles.searchPairValue}>{formatNumber(totals.impressions30d)}</Text>
        </View>
        <View style={styles.searchPairMetric}>
          <Text style={styles.metricRowLabel}>Clicks</Text>
          <Text style={styles.searchPairValue}>{formatNumber(totals.clicks30d)}</Text>
        </View>
      </View>
      <View style={styles.searchRate}>
        <Text style={styles.searchRateValue}>{formatClicksPerHundred(currentRate)}</Text>
        <Text style={styles.metricRowLabel}>clicks per 100 appearances</Text>
      </View>
      <Text style={styles.panelNote}>{searchComparisonText(currentRate, previousRate)}</Text>
      <Text style={styles.source}>
        {sourceName} · {formatDateRange(totals.periodStartedOn, totals.periodEndedOn)} · Fetched{' '}
        {fetchedMinutesAgo(totals.fetchedAt, now)} minutes ago
      </Text>
      <StaleNote stale={state.stale} />
      <StaffLink href={dashboard} label={`OPEN ${sourceName.toUpperCase()}`} show={teamAccount} />
    </Panel>
  );
}

function AvailabilityPanel({
  state,
  now,
  teamAccount,
}: {
  state: SourceState<UptimeTotals>;
  now: number;
  teamAccount: boolean;
}) {
  if (state.kind === 'unavailable') {
    return <UnavailablePanel text="Availability data is temporarily unavailable." />;
  }
  if (state.kind === 'loading') {
    return (
      <Panel busy>
        <LoadingBar wide />
        <LoadingBar wide />
        <LoadingBar wide />
      </Panel>
    );
  }
  const totals = state.totals;
  return (
    <Panel>
      <Text style={styles.eyebrow}>LAST 30 DAYS</Text>
      <MetricRow label="Homepage" value={percent(totals.websiteAvailability30d)} />
      <MetricRow label="Site Metrics page" value={percent(totals.trafficPageAvailability30d)} />
      <MetricRow label="Data service" value={percent(totals.apiAvailability30d)} last />
      <Text style={styles.panelNote}>
        Percentages show how often Alethical passed automatic checks.
      </Text>
      {CHECKLY_PUBLIC_STATUS_URL ? (
        <Pressable
          {...externalLinkProps(CHECKLY_PUBLIC_STATUS_URL)}
          style={styles.publicLinkTarget}
        >
          <View style={styles.publicLinkContent}>
            <Text style={styles.publicLink}>See detailed availability</Text>
            <LinkArrow color="#0f7a45" style={styles.publicLinkArrow} />
          </View>
        </Pressable>
      ) : null}
      <Text style={styles.source}>
        Checkly · Fetched {fetchedMinutesAgo(totals.fetchedAt, now)} minutes ago
      </Text>
      <StaleNote stale={state.stale} />
      <StaffLink href={STAFF_LINKS.checkly} label="OPEN CHECKLY" show={teamAccount} />
    </Panel>
  );
}

function PerformancePanel({
  state,
  now,
  teamAccount,
}: {
  state: SourceState<PerformanceTotals>;
  now: number;
  teamAccount: boolean;
}) {
  const { isMobile } = useResponsive();
  if (state.kind === 'unavailable') {
    return <UnavailablePanel text="Speed and stability data is temporarily unavailable." />;
  }
  if (state.kind === 'loading') {
    return (
      <Panel busy>
        <LoadingBar wide />
        <LoadingBar wide />
        <LoadingBar wide />
      </Panel>
    );
  }
  const totals = state.totals;
  const rows = [
    {
      label: 'Main content appears',
      value:
        totals.lcpP75Ms == null ? 'Building sample' : `${(totals.lcpP75Ms / 1000).toFixed(2)} s`,
      verdict: speedVerdict('lcp', totals.lcpP75Ms),
    },
    {
      label: 'Responds after an action',
      value: totals.inpP75Ms == null ? 'Building sample' : `${formatNumber(totals.inpP75Ms)} ms`,
      verdict: speedVerdict('inp', totals.inpP75Ms),
    },
    {
      label: 'Layout stays still',
      value: totals.clsP75 == null ? 'Building sample' : totals.clsP75.toFixed(3),
      verdict: speedVerdict('cls', totals.clsP75),
    },
  ];
  const buildingSample = rows.some((row) => row.verdict == null);
  return (
    <Panel>
      <Text style={styles.eyebrow}>REAL VISITS · SLOWEST 1 IN 4</Text>
      {rows.map((row, index) => (
        <View
          key={row.label}
          style={[styles.speedRow, index === rows.length - 1 && styles.metricRowLast]}
        >
          <Text style={styles.metricRowLabel}>{row.label}</Text>
          <View style={[styles.speedResult, !isMobile && styles.speedResultDesktop]}>
            <Text style={styles.speedValue}>{row.value}</Text>
            {row.verdict ? (
              <Text style={[styles.speedVerdict, !isMobile && styles.speedVerdictDesktop]}>
                {row.verdict}
              </Text>
            ) : null}
          </View>
        </View>
      ))}
      <Text style={styles.panelNote}>
        At least 75% of measured visits performed this well or better.
      </Text>
      {buildingSample ? (
        <Text style={styles.panelNote}>Not enough real visits have been measured yet</Text>
      ) : null}
      <Text style={styles.source}>
        Cloudflare browser sample · {formatDateRange(totals.periodStartedOn, totals.periodEndedOn)}{' '}
        · Fetched {fetchedMinutesAgo(totals.fetchedAt, now)} minutes ago
      </Text>
      <StaleNote stale={state.stale} />
      <StaffLink href={STAFF_LINKS.cloudflare} label="OPEN CLOUDFLARE" show={teamAccount} />
    </Panel>
  );
}

export function TrafficScreen() {
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const { isMobile } = useResponsive();
  const traffic = useTrafficSource('/api/traffic', isTrafficTotals);
  const records = useRecordTotals();
  const google = useTrafficSource('/api/traffic-google?window=30', isSearchTotals);
  const bing = useTrafficSource('/api/traffic-bing', isSearchTotals);
  const uptime = useTrafficSource('/api/traffic-uptime', isUptimeTotals);
  const performance = useTrafficSource('/api/traffic-performance', isPerformanceTotals);
  const teamAccount = useTeamAccount();
  const [range, setRange] = useState<ActivityRange>(initialActivityRange);
  const [now, setNow] = useState(Date.now());
  useDocumentTitle('/site-metrics', 'Site metrics | Alethical');

  useEffect(() => {
    const clock = setInterval(() => setNow(Date.now()), MINUTE_MS);
    return () => clearInterval(clock);
  }, []);

  const selectRange = (next: ActivityRange) => {
    setRange(next);
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.set('range', String(next));
      window.history.replaceState(window.history.state, '', url);
    }
  };

  const breakdown =
    traffic.kind === 'ready'
      ? range === 7
        ? traffic.totals.trafficBreakdown7d
        : traffic.totals.trafficBreakdown30d
      : null;
  const actions =
    records.kind === 'ready'
      ? range === 7
        ? records.totals.actions7d
        : records.totals.actions30d
      : null;

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
            Site metrics
          </Text>
          <Text style={styles.purpose}>Public totals about how Alethical is used</Text>

          <View style={styles.sectionBlock}>
            <SectionTitle>Recent traffic</SectionTitle>
            <RecentTraffic state={traffic} now={now} />
            <StaffLink href={STAFF_LINKS.vercel} label="OPEN VERCEL" show={teamAccount} />
          </View>

          <View style={styles.sectionRule} />
          <View
            accessibilityRole="radiogroup"
            aria-label="Activity range"
            style={styles.rangeGroup}
          >
            <Text style={styles.rangeLabel}>Activity range</Text>
            <View style={[styles.rangeButtons, isMobile && styles.rangeButtonsMobile]}>
              {[7, 30].map((value) => {
                const selected = range === value;
                return (
                  <Pressable
                    key={value}
                    accessibilityRole="button"
                    aria-pressed={selected}
                    onPress={() => selectRange(value as ActivityRange)}
                    style={[
                      styles.rangeButton,
                      isMobile && styles.rangeButtonMobile,
                      selected && styles.rangeButtonSelected,
                    ]}
                  >
                    <Text
                      style={[styles.rangeButtonText, selected && styles.rangeButtonTextSelected]}
                    >
                      Last {value} days
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Text accessibilityLiveRegion="polite" style={styles.visuallyHidden}>
              Showing the last {range} days
            </Text>
          </View>

          <View style={[styles.activityGrid, isMobile && styles.singleColumn]}>
            <View style={!isMobile ? styles.destinationCell : undefined}>
              {breakdown ? (
                <DestinationPanel breakdown={breakdown} />
              ) : (
                <ActivityStatusPanel
                  title="WHERE PEOPLE GO"
                  loading={traffic.kind === 'loading'}
                  unavailableText="Destination totals are temporarily unavailable."
                />
              )}
            </View>
            <View style={!isMobile ? styles.exploreCell : undefined}>
              {breakdown ? (
                <ExplorePanel breakdown={breakdown} />
              ) : (
                <ActivityStatusPanel
                  title="WHAT PEOPLE EXPLORE"
                  loading={traffic.kind === 'loading'}
                  unavailableText="Profile totals are temporarily unavailable."
                />
              )}
            </View>
            <View style={!isMobile ? styles.actionsCell : undefined}>
              {actions ? (
                <ActionsPanel actions={actions} />
              ) : (
                <ActivityStatusPanel
                  title="WHAT PEOPLE DO"
                  loading={records.kind === 'loading'}
                  unavailableText="Recorded actions are temporarily unavailable."
                />
              )}
            </View>
            <View style={!isMobile ? styles.readersCell : undefined}>
              {records.kind === 'ready' ? (
                <ReadersPanel totals={records.totals.readers} />
              ) : (
                <ActivityStatusPanel
                  title="READERS"
                  loading={records.kind === 'loading'}
                  unavailableText="Reader totals are temporarily unavailable."
                />
              )}
            </View>
          </View>
          {traffic.kind === 'ready' ? <StaleNote stale={traffic.stale} /> : null}
          {records.kind === 'ready' ? <StaleNote stale={records.stale} /> : null}

          <View style={styles.sectionRule} />
          <SectionTitle>Found in search · Last 30 days</SectionTitle>
          <View style={[styles.pairedGrid, isMobile && styles.singleColumn]}>
            <SearchPanel source="Google" state={google} now={now} teamAccount={teamAccount} />
            <SearchPanel source="Bing" state={bing} now={now} teamAccount={teamAccount} />
          </View>

          <View style={styles.sectionRule} />
          <View style={[styles.pairedGrid, isMobile && styles.singleColumn]}>
            <View>
              <SectionTitle>Can people reach Alethical?</SectionTitle>
              <AvailabilityPanel state={uptime} now={now} teamAccount={teamAccount} />
            </View>
            <View>
              <SectionTitle>Speed and stability during real visits</SectionTitle>
              <PerformancePanel state={performance} now={now} teamAccount={teamAccount} />
            </View>
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
    color: '#4f5651',
    fontFamily: theme.typography.body,
    fontSize: 18,
    lineHeight: 28,
  },
  sectionBlock: { marginTop: 40 },
  sectionTitle: {
    marginBottom: 16,
    color: '#6f756f',
    fontFamily: theme.typography.mono,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '700',
    letterSpacing: 1.32,
    textTransform: 'uppercase',
  },
  sectionRule: {
    height: 1,
    marginTop: 40,
    marginBottom: 30,
    backgroundColor: 'rgba(17,21,15,0.1)',
  },
  recentGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
  recentCard: {
    flexGrow: 1,
    flexBasis: 260,
    minWidth: 0,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: 'rgba(17,21,15,0.1)',
    borderRadius: 16,
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 22,
    shadowColor: theme.colors.ink,
    shadowOpacity: 0.04,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
  },
  eyebrow: {
    color: '#6f756f',
    fontFamily: theme.typography.mono,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '700',
    letterSpacing: 1.32,
  },
  recentLabel: {
    marginTop: 14,
    color: '#4f5651',
    fontFamily: theme.typography.ui,
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '700',
  },
  recentValue: {
    marginTop: 5,
    color: '#149d5b',
    fontFamily: theme.typography.ui,
    fontSize: 40,
    lineHeight: 44,
    fontWeight: '800',
    letterSpacing: -1,
    fontVariant: ['tabular-nums'],
  },
  recentDivider: { height: 1, marginTop: 12, backgroundColor: 'rgba(17,21,15,0.08)' },
  note: {
    marginTop: 9,
    paddingLeft: 16,
    color: '#4f5651',
    fontFamily: theme.typography.body,
    fontSize: 14.5,
    lineHeight: 22,
  },
  sourceCluster: { marginTop: 10, paddingLeft: 16 },
  source: {
    marginTop: 10,
    color: '#6f756f',
    fontFamily: theme.typography.mono,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '500',
  },
  collecting: {
    marginTop: 7,
    color: '#8f5a12',
    fontFamily: theme.typography.body,
    fontSize: 13.5,
    lineHeight: 20,
  },
  staleText: {
    marginTop: 7,
    color: '#8f5a12',
    fontFamily: theme.typography.body,
    fontSize: 13.5,
    lineHeight: 20,
  },
  rangeGroup: { gap: 12 },
  rangeLabel: {
    color: '#11150f',
    fontFamily: theme.typography.ui,
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '700',
  },
  rangeButtons: { flexDirection: 'row', gap: 8, alignSelf: 'flex-start' },
  rangeButtonsMobile: { width: '100%' },
  rangeButton: {
    minHeight: 40,
    minWidth: 132,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
    borderWidth: 1,
    borderColor: 'rgba(17,21,15,0.16)',
    borderRadius: 999,
    backgroundColor: theme.colors.surface,
  },
  rangeButtonMobile: { minHeight: 44, flex: 1 },
  rangeButtonSelected: { backgroundColor: '#11150f', borderColor: '#11150f' },
  rangeButtonText: {
    color: '#2c322c',
    fontFamily: theme.typography.ui,
    fontSize: 14.5,
    lineHeight: 20,
    fontWeight: '700',
  },
  rangeButtonTextSelected: { color: '#ffffff' },
  activityGrid: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
    gap: 16,
    marginTop: 24,
    alignItems: 'stretch',
  } as never,
  destinationCell: { gridColumn: 1, gridRow: 1 } as never,
  exploreCell: { gridColumn: 1, gridRow: 2 } as never,
  actionsCell: { gridColumn: 2, gridRow: 1 } as never,
  readersCell: { gridColumn: 2, gridRow: 2 } as never,
  pairedGrid: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
    gap: 16,
    alignItems: 'stretch',
  } as never,
  singleColumn: { display: 'flex', gap: 14 },
  panel: {
    flex: 1,
    minWidth: 0,
    backgroundColor: '#fbfcfb',
    borderWidth: 1,
    borderColor: 'rgba(17,21,15,0.09)',
    borderRadius: 14,
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 21,
  },
  panelMobile: {
    borderWidth: 0,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(17,21,15,0.1)',
    borderRadius: 0,
    paddingHorizontal: 0,
    paddingTop: 0,
    paddingBottom: 24,
    backgroundColor: 'transparent',
    shadowOpacity: 0,
  },
  plainRows: { marginTop: 8, paddingHorizontal: 14 },
  metricRow: {
    minHeight: 47,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(17,21,15,0.07)',
  },
  metricRowLast: { borderBottomWidth: 0 },
  metricRowLabel: {
    flexShrink: 1,
    color: '#2c322c',
    fontFamily: theme.typography.body,
    fontSize: 14.5,
    lineHeight: 21,
  },
  metricRowValue: {
    color: '#11150f',
    fontFamily: theme.typography.ui,
    fontSize: 20,
    lineHeight: 24,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  panelNote: {
    marginTop: 10,
    color: '#4f5651',
    fontFamily: theme.typography.body,
    fontSize: 13.5,
    lineHeight: 20,
  },
  destinationRows: { marginTop: 8, paddingHorizontal: 14 },
  destinationRow: { marginBottom: 11 },
  destinationLabelRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  destinationPercent: {
    color: '#11150f',
    fontFamily: theme.typography.ui,
    fontSize: 14.5,
    lineHeight: 21,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  barTrack: {
    height: 5,
    marginTop: 5,
    overflow: 'hidden',
    borderRadius: 3,
    backgroundColor: '#e4e9e5',
  },
  barFill: { height: 5, borderRadius: 3, backgroundColor: '#149d5b' },
  zeroText: {
    marginTop: 14,
    paddingHorizontal: 12,
    color: '#2c322c',
    fontFamily: theme.typography.body,
    fontSize: 14.5,
    lineHeight: 22,
  },
  tableHeader: {
    minHeight: 42,
    marginTop: 8,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(17,21,15,0.1)',
  },
  tableLabel: {
    flex: 1,
    paddingBottom: 8,
    color: '#6f756f',
    fontFamily: theme.typography.mono,
    fontSize: 10.5,
    lineHeight: 15,
    fontWeight: '700',
    textAlign: 'right',
  },
  tableName: { textAlign: 'left' },
  tableRow: {
    minHeight: 52,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(17,21,15,0.07)',
  },
  tableValue: {
    flex: 1,
    color: '#11150f',
    fontFamily: theme.typography.ui,
    fontSize: 22,
    lineHeight: 26,
    fontWeight: '800',
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  vendorTitle: {
    marginBottom: 8,
    color: '#11150f',
    fontFamily: theme.typography.title,
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '800',
  },
  searchPair: { marginTop: 10, flexDirection: 'row', gap: 32 },
  searchPairMetric: { minWidth: 0, flexShrink: 1 },
  searchPairValue: {
    marginTop: 4,
    color: '#11150f',
    fontFamily: theme.typography.ui,
    fontSize: 24,
    lineHeight: 28,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  searchRate: {
    minHeight: 54,
    marginTop: 4,
    paddingTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(17,21,15,0.1)',
  },
  searchRateValue: {
    color: '#11150f',
    fontFamily: theme.typography.ui,
    fontSize: 24,
    lineHeight: 28,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  speedRow: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(17,21,15,0.07)',
  },
  speedResult: { alignItems: 'flex-end', flexShrink: 0 },
  speedResultDesktop: { flexDirection: 'row-reverse', alignItems: 'baseline', gap: 12 },
  speedVerdict: {
    color: '#11150f',
    fontFamily: theme.typography.body,
    fontSize: 13.5,
    lineHeight: 18,
    fontWeight: '700',
  },
  speedVerdictDesktop: { minWidth: 126, textAlign: 'right' },
  speedValue: {
    color: '#11150f',
    fontFamily: theme.typography.ui,
    fontSize: 18,
    lineHeight: 23,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  publicLinkTarget: { minHeight: 44, alignSelf: 'flex-start', justifyContent: 'center' },
  publicLinkContent: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  publicLinkArrow: { width: 16, height: 16, top: 0 },
  publicLink: {
    color: '#0f7a45',
    fontFamily: theme.typography.ui,
    fontSize: 14.5,
    lineHeight: 20,
    fontWeight: '700',
  },
  staffLinkTarget: { minHeight: 44, alignSelf: 'flex-start', justifyContent: 'center' },
  staffLink: {
    color: '#5b30d6',
    fontFamily: theme.typography.mono,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
  unavailableText: {
    minHeight: 92,
    textAlignVertical: 'center',
    color: '#11150f',
    fontFamily: theme.typography.ui,
    fontSize: 16,
    lineHeight: 23,
    fontWeight: '600',
  },
  loadingBar: { width: 72, height: 18, marginTop: 16, borderRadius: 6, backgroundColor: '#e8ebe9' },
  loadingBarWide: { width: 110, height: 22 },
  visuallyHidden: { position: 'absolute', width: 1, height: 1, opacity: 0 },
});
