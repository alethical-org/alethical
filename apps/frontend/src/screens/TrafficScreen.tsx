import { NavigationProp, useNavigation } from '@react-navigation/native';
import { useEffect, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Path, RadialGradient, Stop } from 'react-native-svg';

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
  | { kind: 'loading' }
  | { kind: 'ready'; totals: T; stale: boolean }
  | { kind: 'unavailable'; checkedAt: number };

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
              current.kind === 'ready'
                ? { ...current, stale: true }
                : { kind: 'unavailable', checkedAt: Date.now() },
            );
          }
          return;
        }
        setState({ kind: 'ready', totals: payload, stale: false });
      } catch {
        if (active) {
          setState((current) =>
            current.kind === 'ready'
              ? { ...current, stale: true }
              : { kind: 'unavailable', checkedAt: Date.now() },
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
              current.kind === 'ready'
                ? { ...current, stale: true }
                : { kind: 'unavailable', checkedAt: Date.now() },
            );
          }
          return;
        }
        setState({ kind: 'ready', totals: payload, stale: false });
      } catch {
        if (active) {
          setState((current) =>
            current.kind === 'ready'
              ? { ...current, stale: true }
              : { kind: 'unavailable', checkedAt: Date.now() },
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

function ageText(timestamp: string | number, now: number) {
  const ageMinutes = Math.max(
    0,
    Math.floor(
      (now - (typeof timestamp === 'number' ? timestamp : Date.parse(timestamp))) / MINUTE_MS,
    ),
  );
  if (ageMinutes < 1) return 'just now';
  if (ageMinutes < 60) return `${ageMinutes} ${ageMinutes === 1 ? 'minute' : 'minutes'} ago`;
  const hours = Math.floor(ageMinutes / 60);
  return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
}

function percent(value: number) {
  return `${value.toLocaleString('en-US', { maximumFractionDigits: 2 })}%`;
}

function formatMeasure(value: number, maximumFractionDigits: number) {
  return value.toLocaleString('en-US', { maximumFractionDigits });
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

function SectionTitle({ children, qualifier }: { children: React.ReactNode; qualifier?: string }) {
  const { isMobile } = useResponsive();
  return (
    <View style={styles.sectionHeading}>
      <Text
        accessibilityRole="header"
        aria-level={2}
        style={[styles.sectionTitle, isMobile && styles.sectionTitleMobile]}
      >
        {children}
      </Text>
      {qualifier ? (
        <Text style={[styles.sectionQualifier, isMobile && styles.sectionQualifierMobile]}>
          {qualifier}
        </Text>
      ) : null}
    </View>
  );
}

function PanelTitle({ children }: { children: React.ReactNode }) {
  const { isMobile } = useResponsive();
  return (
    <Text
      accessibilityRole="header"
      aria-level={3}
      style={[styles.panelTitle, isMobile && styles.panelTitleMobile]}
    >
      {children}
    </Text>
  );
}

function InformationIcon() {
  return (
    <Svg aria-hidden width={19} height={19} viewBox="0 0 24 24" style={styles.infoIcon}>
      <Circle cx={12} cy={12} r={9} stroke="#6f756f" strokeWidth={2} fill="none" />
      <Path d="M12 7.5V13" stroke="#6f756f" strokeWidth={2} strokeLinecap="round" />
      <Circle cx={12} cy={16.3} r={1.15} fill="#6f756f" />
    </Svg>
  );
}

function VendorLogo({ source, mobile }: { source: 'Google' | 'Bing'; mobile: boolean }) {
  const size = mobile ? 18 : 20;
  if (source === 'Google') {
    return (
      <Svg aria-hidden width={size} height={size} viewBox="0 0 24 24">
        <Path
          fill="#4285F4"
          d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.58c2.08-1.92 3.27-4.74 3.27-8.09Z"
        />
        <Path
          fill="#34A853"
          d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.58-2.77c-.98.66-2.23 1.06-3.7 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"
        />
        <Path
          fill="#FBBC05"
          d="M5.84 14.09A6.6 6.6 0 0 1 5.49 12c0-.73.13-1.43.35-2.09V7.07H2.18A11 11 0 0 0 1 12c0 1.77.42 3.44 1.18 4.93l2.85-2.22.81-.62Z"
        />
        <Path
          fill="#EA4335"
          d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15A10.56 10.56 0 0 0 12 1 11 11 0 0 0 2.18 7.07l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38Z"
        />
      </Svg>
    );
  }
  return (
    <Svg aria-hidden width={size} height={size} viewBox="0 0 24 24">
      <Defs>
        <RadialGradient id="bingA" cx="94%" cy="78%" r="144%">
          <Stop offset="0" stopColor="#00CACC" />
          <Stop offset="1" stopColor="#048FCE" />
        </RadialGradient>
        <RadialGradient id="bingB" cx="14%" cy="71%" r="149%">
          <Stop offset="0" stopColor="#00BBEC" />
          <Stop offset="1" stopColor="#2756A9" />
        </RadialGradient>
        <LinearGradient id="bingC" x1="50%" x2="50%" y1="0" y2="100%">
          <Stop offset="0" stopColor="#00BBEC" />
          <Stop offset="1" stopColor="#2756A9" />
        </LinearGradient>
      </Defs>
      <Path
        d="M11.97 7.569a.92.92 0 0 0-.805.863c-.013.195-.01.209.43 1.347 1 2.59 1.242 3.214 1.283 3.302.099.213.237.413.41.592.134.138.222.212.37.311.26.176.39.224 1.405.527.989.295 1.529.49 1.994.723.603.302 1.024.644 1.29 1.051.191.292.36.815.434 1.342.029.206.029.661 0 .847a2.491 2.491 0 0 1-.376 1.026c-.1.151-.065.126.081-.058.415-.52.838-1.408 1.054-2.213a6.728 6.728 0 0 0 .102-3.012 6.626 6.626 0 0 0-3.291-4.53 104.157 104.157 0 0 0-1.322-.698l-.254-.133a737.941 737.941 0 0 1-1.575-.827c-.548-.29-.78-.406-.846-.426a1.376 1.376 0 0 0-.29-.045l-.093.01Z"
        fill="url(#bingA)"
      />
      <Path
        d="M13.164 17.24a4.385 4.385 0 0 0-.202.125 511.45 511.45 0 0 0-1.795 1.115 163.087 163.087 0 0 1-.989.614l-.463.288a99.198 99.198 0 0 1-1.502.941c-.326.2-.704.334-1.09.387-.18.024-.52.024-.7 0a2.807 2.807 0 0 1-1.318-.538 3.665 3.665 0 0 1-.543-.545 2.837 2.837 0 0 1-.506-1.141 2.161 2.161 0 0 0-.041-.182c-.008-.008.006.138.032.33.027.199.085.487.147.733.482 1.907 1.85 3.457 3.705 4.195a6.31 6.31 0 0 0 1.658.412c.22.025.844.035 1.074.017 1.054-.08 1.972-.393 2.913-.992a325.28 325.28 0 0 1 .937-.596l.384-.244.684-.435.234-.149.009-.005.025-.017.013-.007.172-.11.597-.38c.76-.481.987-.65 1.34-.998.148-.146.37-.394.381-.425.002-.007.042-.068.088-.136a2.49 2.49 0 0 0 .373-1.023 4.181 4.181 0 0 0 0-.847 4.336 4.336 0 0 0-.318-1.137c-.224-.472-.7-.9-1.383-1.245a2.972 2.972 0 0 0-.406-.181c-.01 0-.646.392-1.413.87a7089.171 7089.171 0 0 0-1.658 1.031l-.439.274Z"
        fill="url(#bingB)"
      />
      <Path
        d="m4.003 14.946.004 3.33.042.193c.134.604.366 1.04.77 1.445a2.701 2.701 0 0 0 1.955.814c.536 0 1-.135 1.479-.43l.703-.435.556-.346V8.003c0-2.306-.004-3.675-.012-3.782a2.734 2.734 0 0 0-.797-1.765c-.145-.144-.268-.24-.637-.496A1780.102 1780.102 0 0 1 5.762.362C5.406.115 5.38.098 5.271.059a.943.943 0 0 0-1.254.696C4.003.818 4 1.659 4 6.223v5.394h0l.003 3.329Z"
        fill="url(#bingC)"
      />
    </Svg>
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

function Panel({
  children,
  busy = false,
  surface = 'default',
  testID,
}: {
  children: React.ReactNode;
  busy?: boolean;
  surface?: 'default' | 'search';
  testID?: string;
}) {
  const { isMobile } = useResponsive();
  return (
    <View
      testID={testID}
      aria-busy={busy}
      style={[
        styles.panel,
        surface === 'search' && styles.panelSearch,
        isMobile && styles.panelCardMobile,
      ]}
    >
      {children}
    </View>
  );
}

function UnavailablePanel({
  text,
  title,
  source,
  checkedAt,
  now,
}: {
  text: string;
  title?: string;
  source?: string;
  checkedAt?: number;
  now?: number;
}) {
  return (
    <Panel>
      {title ? <PanelTitle>{title}</PanelTitle> : null}
      <View style={styles.unavailableRow}>
        <InformationIcon />
        <Text accessibilityLiveRegion="polite" style={styles.unavailableText}>
          {text}
        </Text>
      </View>
      {source && checkedAt != null && now != null ? (
        <Text style={styles.source}>
          {source} · Checked {ageText(checkedAt, now)}
        </Text>
      ) : null}
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

function StaleNote({ stale, fetchedAt, now }: { stale: boolean; fetchedAt: string; now: number }) {
  return stale ? (
    <>
      <Text style={styles.staleText}>A newer reading has not come through yet</Text>
      <Text accessibilityLiveRegion="polite" style={styles.visuallyHidden}>
        Site metrics are from {ageText(fetchedAt, now)}. A newer reading has not come through yet.
      </Text>
    </>
  ) : null;
}

function StaffLink({ href, label, show }: { href: string; label: string; show: boolean }) {
  if (!show) return null;
  return (
    <Pressable {...externalLinkProps(href)} style={styles.staffLinkTarget}>
      <View style={styles.staffLinkContent}>
        <Text style={styles.staffLink}>{label}</Text>
        <LinkArrow color="#5b30d6" style={styles.staffLinkArrow} />
      </View>
    </Pressable>
  );
}

function MetricRow({
  label,
  value,
  last = false,
  treatment = 'standard',
  compactMobile = false,
  mobileValueSize = 20,
  testID,
}: {
  label: string;
  value: string;
  last?: boolean;
  treatment?: 'standard' | 'availability';
  compactMobile?: boolean;
  mobileValueSize?: 19 | 20;
  testID?: string;
}) {
  const { isMobile } = useResponsive();
  return (
    <View
      testID={testID}
      style={[
        styles.metricRow,
        treatment === 'availability' && styles.metricRowAvailability,
        isMobile && treatment === 'availability' && styles.metricRowAvailabilityMobile,
        isMobile && compactMobile && styles.metricRowCompactMobile,
        last && styles.metricRowLast,
      ]}
    >
      <Text
        style={[
          styles.metricRowLabel,
          isMobile &&
            (compactMobile || treatment === 'availability') &&
            styles.metricRowLabelMobile,
        ]}
      >
        {label}
      </Text>
      <Text
        style={[
          styles.metricRowValue,
          treatment === 'availability' && styles.metricRowValueAvailability,
          isMobile && treatment === 'availability' && styles.metricRowValueAvailabilityMobile,
          isMobile && compactMobile && mobileValueSize === 19 && styles.metricRowValueActionMobile,
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

function RecentTraffic({
  state,
  now,
  teamAccount,
}: {
  state: SourceState<TrafficTotals>;
  now: number;
  teamAccount: boolean;
}) {
  if (state.kind === 'unavailable') {
    return (
      <UnavailablePanel
        text="Recent traffic is temporarily unavailable."
        source="Vercel"
        checkedAt={state.checkedAt}
        now={now}
      />
    );
  }
  const { isMobile } = useResponsive();
  const cards = [
    { period: 'LAST 24 HOURS', visitors: 'estimatedVisitors24h', views: 'pageViews24h' },
    { period: 'LAST 7 DAYS', visitors: 'estimatedVisitors7d', views: 'pageViews7d' },
    { period: 'LAST 30 DAYS', visitors: 'estimatedVisitors30d', views: 'pageViews30d' },
  ] as const;
  const loading = state.kind === 'loading';
  const totals = state.kind === 'ready' ? state.totals : null;
  const stale = state.kind === 'ready' && state.stale;
  const collecting = totals
    ? Date.parse(totals.windowEndedAt) - Date.parse(totals.countingStartedAt) < 30 * DAY_MS
    : false;

  return (
    <>
      <View style={styles.recentGrid}>
        {cards.map((card) => (
          <View
            key={card.period}
            aria-busy={loading}
            style={[styles.recentCard, isMobile && styles.recentCardMobile]}
          >
            <Text style={styles.eyebrow}>{card.period}</Text>
            <View style={isMobile && styles.recentMetricRowMobile}>
              <View style={styles.recentMetric}>
                <Text style={[styles.recentLabel, isMobile && styles.recentLabelMobile]}>
                  Estimated visitors
                </Text>
                {loading ? (
                  <LoadingBar wide />
                ) : (
                  <Text style={[styles.recentValue, isMobile && styles.recentValueMobile]}>
                    {formatNumber(totals?.[card.visitors] ?? 0)}
                  </Text>
                )}
              </View>
              <View style={isMobile ? styles.recentMetricRight : undefined}>
                <View style={isMobile ? undefined : styles.recentDivider} />
                <Text style={[styles.recentLabel, isMobile && styles.recentLabelMobile]}>
                  Page views
                </Text>
                {loading ? (
                  <LoadingBar wide />
                ) : (
                  <Text style={[styles.recentValue, isMobile && styles.recentValueMobile]}>
                    {formatNumber(totals?.[card.views] ?? 0)}
                  </Text>
                )}
              </View>
            </View>
          </View>
        ))}
      </View>
      {totals ? (
        <View style={styles.sourceCluster}>
          <View style={styles.recentSourceRow}>
            <Text style={styles.sourceInline}>
              Counted by Vercel · Through {formatTrafficWindowEnd(totals.windowEndedAt)} ·{' '}
              {stale
                ? `Last accepted ${ageText(totals.fetchedAt, now)}`
                : `Checked ${ageText(totals.fetchedAt, now)}`}
            </Text>
            {collecting ? (
              <Text style={styles.collecting}>
                Collecting since {formatDate(totals.countingStartedAt)}
              </Text>
            ) : null}
          </View>
          <Text style={styles.note}>
            Estimated visitors may include the same person more than once across days or devices
          </Text>
          <StaleNote stale={stale} fetchedAt={totals.fetchedAt} now={now} />
          <StaffLink href={STAFF_LINKS.vercel} label="OPEN VERCEL DASHBOARD" show={teamAccount} />
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
  const { isMobile } = useResponsive();
  const total = Object.values(breakdown.destinationPageViews).reduce(
    (sum, value) => sum + value,
    0,
  );
  const row = ([key, label]: (typeof DESTINATIONS)[number]) => {
    const share = (breakdown.destinationPageViews[key] / total) * 100;
    return (
      <View
        key={key}
        style={[styles.destinationRowLine, isMobile && styles.destinationRowLineMobile]}
      >
        <Text
          style={[
            styles.metricRowLabel,
            styles.destinationName,
            isMobile && styles.destinationNameMobile,
          ]}
        >
          {label}
        </Text>
        <View
          testID={`site-metrics-destination-${key}-bar`}
          aria-hidden
          style={[styles.barTrack, isMobile && styles.barTrackMobile]}
        >
          <View
            style={[styles.barFill, isMobile && styles.barFillMobile, { width: `${share}%` }]}
          />
        </View>
        <Text style={[styles.destinationPercent, isMobile && styles.destinationPercentMobile]}>
          {Math.round(share)}%
        </Text>
      </View>
    );
  };
  return (
    <Panel testID="site-metrics-destinations">
      <PanelTitle>Where people go</PanelTitle>
      {total === 0 ? (
        <Text style={styles.zeroText}>No page views in this range yet</Text>
      ) : (
        <>
          <View style={styles.destinationRows}>
            <View style={[styles.destinationOuter, isMobile && styles.destinationOuterMobile]}>
              {row(DESTINATIONS[0])}
            </View>
            <View style={[styles.destinationGroup, isMobile && styles.destinationGroupMobile]}>
              {row(DESTINATIONS[1])}
              {row(DESTINATIONS[2])}
            </View>
            <View style={[styles.destinationGroup, isMobile && styles.destinationGroupMobile]}>
              {row(DESTINATIONS[3])}
              {row(DESTINATIONS[4])}
              {row(DESTINATIONS[5])}
            </View>
            <View style={[styles.destinationOuter, isMobile && styles.destinationOuterMobile]}>
              {row(DESTINATIONS[6])}
            </View>
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
  const { isMobile } = useResponsive();
  const capped =
    breakdown.billProfiles.differentProfilesViewed.capped ||
    breakdown.legislatorProfiles.differentProfilesViewed.capped;
  return (
    <Panel testID="site-metrics-explore">
      <PanelTitle>What people explore</PanelTitle>
      <View role="table">
        <View role="row" style={[styles.tableHeader, isMobile && styles.tableHeaderMobile]}>
          <View style={styles.tableBlankHeader}>
            <Text role="columnheader" style={styles.visuallyHidden}>
              Section
            </Text>
          </View>
          <Text
            testID="site-metrics-explore-views-header"
            role="columnheader"
            style={[styles.tableLabel, isMobile && styles.tableLabelMobile]}
          >
            Profile views
          </Text>
          <Text
            testID="site-metrics-explore-different-header"
            role="columnheader"
            style={[styles.tableLabel, isMobile && styles.tableLabelMobile]}
          >
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
              role="row"
              key={label as string}
              style={[
                styles.tableRow,
                isMobile && styles.tableRowMobile,
                index === 1 && styles.metricRowLast,
              ]}
            >
              <Text role="rowheader" style={[styles.metricRowLabel, styles.tableName]}>
                {label as string}
              </Text>
              <Text
                testID={`site-metrics-explore-${String(label).toLowerCase()}-views`}
                role="cell"
                style={[styles.tableValue, isMobile && styles.tableValueMobile]}
              >
                {formatNumber(profile.pageViews)}
              </Text>
              <Text
                testID={`site-metrics-explore-${String(label).toLowerCase()}-different`}
                role="cell"
                style={[styles.tableValue, isMobile && styles.tableValueMobile]}
              >
                {distinctValue(profile.differentProfilesViewed)}
              </Text>
            </View>
          );
        })}
      </View>
      <Text style={styles.panelNote}>
        Profile views include repeat views. Each different profile is counted once.
      </Text>
      {capped ? (
        <Text style={styles.panelNote}>
          Shows 100+ when the source cannot list more different profiles
        </Text>
      ) : null}
    </Panel>
  );
}

function ActionsPanel({ actions }: { actions: SiteMetricActions }) {
  const { isMobile } = useResponsive();
  const rows = [
    ['Bill searches with results', actions.billSearchesWithResults],
    ['Legislator searches with results', actions.legislatorSearchesWithResults],
    ['Find My Legislator lookups with results', actions.findMyLegislatorWithResults],
    ['Official source links opened', actions.officialSourceLinksOpened],
    ['New bill watches', actions.newBillWatches],
  ] as const;
  return (
    <Panel>
      <PanelTitle>What people do</PanelTitle>
      <View style={[styles.plainRows, isMobile && styles.plainRowsMobile]}>
        {rows.map(([label, value], index) => (
          <MetricRow
            key={label}
            testID={`site-metrics-action-row-${index}`}
            label={label}
            value={formatNumber(value)}
            last={index === rows.length - 1}
            compactMobile
            mobileValueSize={19}
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
  const { isMobile } = useResponsive();
  return (
    <Panel>
      <PanelTitle>Readers</PanelTitle>
      <View style={[styles.plainRows, isMobile && styles.plainRowsMobile]}>
        <MetricRow
          testID="site-metrics-reader-row-0"
          label="Registered readers"
          value={formatNumber(totals.registeredReaders)}
          compactMobile
        />
        <MetricRow
          testID="site-metrics-reader-row-1"
          label="Current bill watches"
          value={formatNumber(totals.currentBillWatches)}
          compactMobile
        />
        <MetricRow
          testID="site-metrics-reader-row-2"
          label="Different bills currently watched"
          value={formatNumber(totals.differentBillsCurrentlyWatched)}
          last
          compactMobile
        />
      </View>
      <Text style={styles.panelNote}>
        Current totals; the date range does not apply. Bill watches count each reader&apos;s watch;
        different bills count each bill once.
      </Text>
    </Panel>
  );
}

function VendorHeading({ source }: { source: 'Google' | 'Bing' }) {
  const { isMobile } = useResponsive();
  return (
    <View style={styles.vendorHeading}>
      <VendorLogo source={source} mobile={isMobile} />
      <Text style={[styles.vendorTitle, isMobile && styles.vendorTitleMobile]}>{source}</Text>
    </View>
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
    const sourceName = source === 'Google' ? 'Google Search Console' : 'Bing Webmaster Tools';
    return (
      <Panel surface="search" testID={`site-metrics-search-${source.toLowerCase()}`}>
        <VendorHeading source={source} />
        <View style={styles.unavailableRow}>
          <InformationIcon />
          <Text accessibilityLiveRegion="polite" style={styles.unavailableText}>
            Search discovery from {source} is temporarily unavailable
          </Text>
        </View>
        <Text style={styles.source}>
          {sourceName} · Checked {ageText(state.checkedAt, now)}
        </Text>
      </Panel>
    );
  }
  if (state.kind === 'loading') {
    return (
      <Panel busy surface="search" testID={`site-metrics-search-${source.toLowerCase()}`}>
        <VendorHeading source={source} />
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
    <Panel surface="search" testID={`site-metrics-search-${source.toLowerCase()}`}>
      <VendorHeading source={source} />
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
        {sourceName} · Through {formatDate(totals.periodEndedOn)}
        {state.stale ? ` · Last accepted ${ageText(totals.fetchedAt, now)}` : ''}
      </Text>
      <StaleNote stale={state.stale} fetchedAt={totals.fetchedAt} now={now} />
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
    return (
      <UnavailablePanel
        title="Can people reach Alethical?"
        text="Availability data is temporarily unavailable."
        source="Checkly"
        checkedAt={state.checkedAt}
        now={now}
      />
    );
  }
  if (state.kind === 'loading') {
    return (
      <Panel busy>
        <PanelTitle>Can people reach Alethical?</PanelTitle>
        <LoadingBar wide />
        <LoadingBar wide />
      </Panel>
    );
  }
  const totals = state.totals;
  return (
    <Panel testID="site-metrics-availability">
      <PanelTitle>Can people reach Alethical?</PanelTitle>
      <View style={styles.availabilityRows}>
        <MetricRow
          testID="site-metrics-availability-row-0"
          label="Homepage"
          value={percent(totals.websiteAvailability30d)}
          treatment="availability"
        />
        <MetricRow
          testID="site-metrics-availability-row-1"
          label="Data service"
          value={percent(totals.apiAvailability30d)}
          treatment="availability"
          last
        />
      </View>
      <Text style={styles.panelNote}>
        Percentages show how often Alethical passed automatic checks
      </Text>
      <Text style={styles.source}>
        Checked by Checkly
        {state.stale ? ` · Last accepted ${ageText(totals.fetchedAt, now)}` : ''}
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
      <StaleNote stale={state.stale} fetchedAt={totals.fetchedAt} now={now} />
      <StaffLink href={STAFF_LINKS.checkly} label="OPEN CHECKLY DASHBOARD" show={teamAccount} />
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
    return (
      <UnavailablePanel
        title="Speed and stability during real visits"
        text="Speed and stability data is temporarily unavailable."
        source="Cloudflare"
        checkedAt={state.checkedAt}
        now={now}
      />
    );
  }
  if (state.kind === 'loading') {
    return (
      <Panel busy>
        <PanelTitle>Speed and stability during real visits</PanelTitle>
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
      measurement: totals.lcpP75Ms == null ? null : `${formatMeasure(totals.lcpP75Ms / 1000, 2)} s`,
      verdict: speedVerdict('lcp', totals.lcpP75Ms),
    },
    {
      label: 'Responds after an action',
      measurement: totals.inpP75Ms == null ? null : `${formatNumber(totals.inpP75Ms)} ms`,
      verdict: speedVerdict('inp', totals.inpP75Ms),
    },
    {
      label: 'Layout stays still',
      measurement: totals.clsP75 == null ? null : formatMeasure(totals.clsP75, 3),
      verdict: speedVerdict('cls', totals.clsP75),
    },
  ];
  const buildingSample = rows.some((row) => row.measurement == null);
  return (
    <Panel testID="site-metrics-performance">
      <PanelTitle>Speed and stability during real visits</PanelTitle>
      <View style={styles.speedRows}>
        {rows.map((row, index) => (
          <View
            key={row.label}
            testID={`site-metrics-speed-row-${index}`}
            style={[
              styles.speedRow,
              isMobile && styles.speedRowMobile,
              index === rows.length - 1 && styles.metricRowLast,
            ]}
          >
            <Text style={[styles.metricRowLabel, isMobile && styles.metricRowLabelMobile]}>
              {row.label}
            </Text>
            <View
              testID={`site-metrics-speed-result-${index}`}
              style={[styles.speedResult, isMobile && styles.speedResultMobile]}
            >
              {isMobile ? (
                <>
                  <Text
                    testID={`site-metrics-speed-value-${index}`}
                    style={[styles.speedValue, styles.speedValueMobile]}
                  >
                    {row.measurement ?? 'Building sample'}
                  </Text>
                  {row.verdict ? (
                    <Text
                      testID={`site-metrics-speed-verdict-${index}`}
                      style={[styles.speedVerdict, styles.speedVerdictMobile]}
                    >
                      {row.verdict}
                    </Text>
                  ) : null}
                </>
              ) : (
                <>
                  <Text testID={`site-metrics-speed-verdict-${index}`} style={styles.speedVerdict}>
                    {row.verdict ?? ''}
                  </Text>
                  <Text testID={`site-metrics-speed-value-${index}`} style={styles.speedValue}>
                    {row.measurement ?? 'Building sample'}
                  </Text>
                </>
              )}
            </View>
          </View>
        ))}
      </View>
      {buildingSample ? null : (
        <Text style={styles.panelNote}>
          At least 75% of measured visits performed this well or better.
        </Text>
      )}
      {buildingSample ? (
        <Text style={styles.panelNote}>Not enough real visits have been measured yet</Text>
      ) : null}
      <Text style={styles.source}>
        Measured by Cloudflare
        {state.stale ? ` · Last accepted ${ageText(totals.fetchedAt, now)}` : ''}
      </Text>
      <StaleNote stale={state.stale} fetchedAt={totals.fetchedAt} now={now} />
      <StaffLink
        href={STAFF_LINKS.cloudflare}
        label="OPEN CLOUDFLARE DASHBOARD"
        show={teamAccount}
      />
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
  useDocumentTitle('/site-metrics', 'Site Metrics | Alethical');

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
  const loading = [traffic, records, google, bing, uptime, performance].some(
    (state) => state.kind === 'loading',
  );

  return (
    <PageBackground>
      <ScrollView contentContainerStyle={styles.page}>
        <TopNav onHome={() => navigation.navigate('Tabs', { screen: 'Home' })} />
        <Container aria-busy={loading} style={[styles.main, isMobile && styles.mainMobile]}>
          {loading ? (
            <Text accessibilityLiveRegion="polite" style={styles.visuallyHidden}>
              Loading site metrics.
            </Text>
          ) : null}
          <Text
            accessibilityRole="header"
            aria-level={1}
            style={[styles.title, isMobile && styles.titleMobile]}
          >
            Site Metrics
          </Text>
          <Text style={styles.purpose}>
            How people find and use Alethical, and how well the site works
          </Text>

          <View style={[styles.sectionBlock, isMobile && styles.sectionBlockMobile]}>
            <SectionTitle>Recent traffic</SectionTitle>
            <View style={[styles.sectionContent, isMobile && styles.sectionContentMobile]}>
              <RecentTraffic state={traffic} now={now} teamAccount={teamAccount} />
            </View>
          </View>

          <View style={[styles.sectionRule, isMobile && styles.sectionRuleMobile]} />
          <View
            style={[
              styles.sectionHeadingActionRow,
              isMobile && styles.sectionHeadingActionRowMobile,
            ]}
          >
            <SectionTitle>How people use Alethical</SectionTitle>
            <View
              role="group"
              aria-label="Activity range"
              style={[styles.rangeGroup, isMobile && styles.rangeGroupMobile]}
            >
              <Text style={[styles.rangeLabel, isMobile && styles.rangeLabelMobile]}>
                Activity range
              </Text>
              <View style={[styles.rangeButtonsShell, isMobile && styles.rangeButtonsShellMobile]}>
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
                          style={[
                            styles.rangeButtonText,
                            selected && styles.rangeButtonTextSelected,
                          ]}
                        >
                          Last {value} days
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
              <Text accessibilityLiveRegion="polite" style={styles.visuallyHidden}>
                Showing the last {range} days
              </Text>
            </View>
          </View>

          <View
            style={[
              styles.activityGrid,
              isMobile && styles.activityGridMobile,
              isMobile && styles.singleColumn,
            ]}
          >
            <View style={!isMobile ? styles.destinationCell : undefined}>
              {breakdown ? (
                <DestinationPanel breakdown={breakdown} />
              ) : (
                <ActivityStatusPanel
                  title="Where people go"
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
                  title="What people explore"
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
                  title="What people do"
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
                  title="Readers"
                  loading={records.kind === 'loading'}
                  unavailableText="Reader totals are temporarily unavailable."
                />
              )}
            </View>
          </View>
          {records.kind === 'ready' ? (
            <StaleNote stale={records.stale} fetchedAt={records.totals.fetchedAt} now={now} />
          ) : null}

          <View style={[styles.sectionRule, isMobile && styles.sectionRuleMobile]} />
          <SectionTitle qualifier="LAST 30 DAYS">Found in search</SectionTitle>
          <View
            style={[
              styles.pairedGrid,
              styles.sectionGrid,
              isMobile && styles.sectionGridMobile,
              isMobile && styles.singleColumn,
            ]}
          >
            <SearchPanel source="Google" state={google} now={now} teamAccount={teamAccount} />
            <SearchPanel source="Bing" state={bing} now={now} teamAccount={teamAccount} />
          </View>

          <View style={[styles.sectionRule, isMobile && styles.sectionRuleMobile]} />
          <SectionTitle qualifier="LAST 30 DAYS">How well the site works</SectionTitle>
          <View
            testID="site-metrics-closing-grid"
            style={[
              styles.pairedGrid,
              styles.sectionGrid,
              isMobile && styles.healthGridMobile,
              isMobile && styles.singleColumn,
            ]}
          >
            <AvailabilityPanel state={uptime} now={now} teamAccount={teamAccount} />
            <PerformancePanel state={performance} now={now} teamAccount={teamAccount} />
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
  titleMobile: { fontSize: 32, lineHeight: 38, letterSpacing: -0.8 },
  purpose: {
    marginTop: 14,
    color: '#4f5651',
    fontFamily: theme.typography.body,
    fontSize: 18,
    lineHeight: 28,
  },
  sectionBlock: { marginTop: 38 },
  sectionBlockMobile: { marginTop: 24 },
  sectionHeading: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', gap: 10 },
  sectionTitle: {
    color: '#2b6377',
    fontFamily: theme.typography.ui,
    fontSize: 20,
    lineHeight: 25,
    fontWeight: '800',
    letterSpacing: -0.24,
  },
  sectionTitleMobile: { fontSize: 18, lineHeight: 23, letterSpacing: -0.216 },
  sectionQualifier: {
    color: '#6f756f',
    fontFamily: theme.typography.mono,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '500',
    letterSpacing: 0.72,
  },
  sectionQualifierMobile: { fontSize: 11, lineHeight: 16, letterSpacing: 0.66 },
  sectionContent: { marginTop: 12 },
  sectionContentMobile: { marginTop: 10 },
  sectionHeadingActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 24,
  },
  sectionHeadingActionRowMobile: { flexDirection: 'column', alignItems: 'stretch', gap: 14 },
  sectionRule: {
    height: 1,
    marginTop: 40,
    marginBottom: 30,
    backgroundColor: 'rgba(17,21,15,0.1)',
  },
  sectionRuleMobile: { marginTop: 26, marginBottom: 22 },
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
    boxShadow: '0 6px 18px rgba(17, 21, 15, 0.04)',
  },
  recentCardMobile: {
    flexBasis: '100%',
    borderRadius: 14,
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 18,
    boxShadow: '0 4px 14px rgba(17, 21, 15, 0.04)',
  },
  eyebrow: {
    color: '#6f756f',
    fontFamily: theme.typography.mono,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '700',
    letterSpacing: 1.32,
  },
  panelTitle: {
    color: theme.colors.text.primary,
    fontFamily: theme.typography.ui,
    fontSize: 15.5,
    lineHeight: 21,
    fontWeight: '700',
  },
  panelTitleMobile: { fontSize: 15, lineHeight: 20 },
  recentLabel: {
    marginTop: 14,
    color: '#4f5651',
    fontFamily: theme.typography.ui,
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '700',
  },
  recentLabelMobile: { marginTop: 0, fontSize: 14, lineHeight: 20 },
  recentValue: {
    marginTop: 5,
    color: theme.colors.brand.display,
    fontFamily: theme.typography.ui,
    fontSize: 40,
    lineHeight: 44,
    fontWeight: '800',
    letterSpacing: -1,
    fontVariant: ['tabular-nums'],
  },
  recentDivider: { height: 1, marginTop: 12, backgroundColor: 'rgba(17,21,15,0.08)' },
  note: {
    marginTop: 8,
    color: '#4f5651',
    fontFamily: theme.typography.body,
    fontSize: 14.5,
    lineHeight: 22,
  },
  sourceCluster: { marginTop: 18, paddingLeft: 16 },
  recentSourceRow: {
    minHeight: 20,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  sourceInline: {
    flexShrink: 1,
    color: '#4f5651',
    fontFamily: theme.typography.mono,
    fontSize: 12,
    lineHeight: 19,
    fontWeight: '500',
  },
  source: {
    marginTop: 10,
    color: '#6f756f',
    fontFamily: theme.typography.mono,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '500',
  },
  collecting: {
    marginLeft: 'auto',
    color: theme.colors.omnibus.text,
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
  rangeGroup: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 14 },
  rangeGroupMobile: { width: '100%' },
  rangeLabel: {
    color: theme.colors.text.secondary,
    fontFamily: theme.typography.ui,
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '600',
  },
  rangeLabelMobile: { fontSize: 14.5, lineHeight: 20 },
  rangeButtonsShell: {
    padding: 3,
    backgroundColor: '#f1f3f2',
    borderWidth: 1,
    borderColor: 'rgba(17,21,15,0.1)',
    borderRadius: 11,
  },
  rangeButtonsShellMobile: { width: '100%', marginTop: 9 },
  rangeButtons: { flexDirection: 'row', gap: 3, alignSelf: 'flex-start' },
  rangeButtonsMobile: { width: '100%' },
  rangeButton: {
    minHeight: 40,
    minWidth: 132,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
    borderWidth: 0,
    borderRadius: 9,
    backgroundColor: 'transparent',
  },
  rangeButtonMobile: { minHeight: 44, flex: 1 },
  rangeButtonSelected: { backgroundColor: '#ffffff' },
  rangeButtonText: {
    color: theme.colors.text.secondary,
    fontFamily: theme.typography.ui,
    fontSize: 14.5,
    lineHeight: 20,
    fontWeight: '700',
  },
  rangeButtonTextSelected: { color: '#11150f' },
  activityGrid: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
    gap: 16,
    marginTop: 24,
    alignItems: 'stretch',
  } as never,
  activityGridMobile: { marginTop: 20 },
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
  sectionGrid: { marginTop: 12 },
  sectionGridMobile: { marginTop: 10 },
  healthGridMobile: { marginTop: 12 },
  singleColumn: { display: 'flex', gap: 12 },
  panel: {
    flex: 1,
    minWidth: 0,
    backgroundColor: '#fbfcfb',
    borderWidth: 1,
    borderColor: 'rgba(17,21,15,0.09)',
    borderRadius: 14,
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 20,
  },
  panelSearch: { paddingTop: 16, paddingHorizontal: 20, paddingBottom: 18 },
  panelCardMobile: {
    borderRadius: 13,
    paddingHorizontal: 16,
    paddingTop: 15,
    paddingBottom: 17,
  },
  plainRows: { marginTop: 12, paddingHorizontal: 14 },
  plainRowsMobile: { paddingHorizontal: 12, gap: 14 },
  availabilityRows: { marginTop: 12 },
  metricRow: {
    paddingVertical: 11,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(17,21,15,0.07)',
  },
  metricRowAvailability: { paddingVertical: 10 },
  metricRowAvailabilityMobile: { paddingVertical: 9, gap: 14 },
  metricRowLast: { borderBottomWidth: 0 },
  metricRowCompactMobile: { paddingVertical: 0, borderBottomWidth: 0 },
  metricRowLabel: {
    flexShrink: 1,
    color: '#2c322c',
    fontFamily: theme.typography.body,
    fontSize: 14.5,
    lineHeight: 21,
  },
  metricRowLabelMobile: { fontSize: 14, lineHeight: 20 },
  metricRowValue: {
    color: theme.colors.text.primary,
    fontFamily: theme.typography.ui,
    fontSize: 20,
    lineHeight: 24,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  metricRowValueAvailability: { fontSize: 18, lineHeight: 23 },
  metricRowValueAvailabilityMobile: { fontSize: 17, lineHeight: 22 },
  metricRowValueActionMobile: { fontSize: 19, lineHeight: 23 },
  panelNote: {
    marginTop: 10,
    color: '#4f5651',
    fontFamily: theme.typography.body,
    fontSize: 13.5,
    lineHeight: 20,
  },
  destinationRows: { marginTop: 18, gap: 15 },
  destinationOuter: { paddingLeft: 14 },
  destinationGroup: {
    gap: 12,
    paddingLeft: 12,
    borderLeftWidth: 2,
    borderLeftColor: '#dfe5e1',
  },
  destinationOuterMobile: { paddingLeft: 12 },
  destinationGroupMobile: { gap: 8, paddingLeft: 10 },
  destinationRowLine: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  destinationRowLineMobile: { gap: 10 },
  destinationName: { width: 138, flexGrow: 0, flexShrink: 0 },
  destinationNameMobile: { width: 118, fontSize: 13.5, lineHeight: 18 },
  destinationPercent: {
    width: 38,
    flexGrow: 0,
    flexShrink: 0,
    textAlign: 'right',
    color: theme.colors.text.primary,
    fontFamily: theme.typography.mono,
    fontSize: 14,
    lineHeight: 21,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  destinationPercentMobile: { width: 34, fontSize: 13, lineHeight: 18 },
  barTrack: {
    flex: 1,
    height: 12,
    overflow: 'hidden',
    borderRadius: 6,
    backgroundColor: '#e8ebe9',
  },
  barTrackMobile: { height: 9, borderRadius: 5 },
  barFill: { height: '100%', borderRadius: 6, backgroundColor: theme.colors.brand.display },
  barFillMobile: { borderRadius: 5 },
  zeroText: {
    marginTop: 14,
    paddingHorizontal: 12,
    color: '#2c322c',
    fontFamily: theme.typography.body,
    fontSize: 14.5,
    lineHeight: 22,
  },
  tableHeader: {
    marginTop: 16,
    paddingLeft: 14,
    paddingRight: 0,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(17,21,15,0.1)',
  },
  tableHeaderMobile: { marginTop: 10, paddingLeft: 12 },
  tableLabel: {
    flex: 1,
    paddingBottom: 9,
    color: '#6f756f',
    fontFamily: theme.typography.ui,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
    textAlign: 'right',
  },
  tableLabelMobile: { fontSize: 12, lineHeight: 17, paddingBottom: 8 },
  tableName: { flex: 1, textAlign: 'left' },
  tableBlankHeader: { flex: 1, paddingBottom: 9 },
  tableRow: {
    paddingLeft: 14,
    paddingRight: 0,
    paddingVertical: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(17,21,15,0.07)',
  },
  tableRowMobile: { paddingLeft: 12, paddingVertical: 11 },
  tableValue: {
    flex: 1,
    color: theme.colors.text.primary,
    fontFamily: theme.typography.ui,
    fontSize: 24,
    lineHeight: 29,
    fontWeight: '800',
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  tableValueMobile: { fontSize: 22, lineHeight: 27 },
  vendorHeading: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  vendorTitle: {
    color: '#11150f',
    fontFamily: theme.typography.ui,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '800',
  },
  vendorTitleMobile: { fontSize: 14.5, lineHeight: 19 },
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
    fontSize: 16,
    lineHeight: 21,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  speedRow: {
    paddingVertical: 15,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(17,21,15,0.07)',
  },
  speedRowMobile: { paddingVertical: 9, gap: 14 },
  speedRows: { marginTop: 12 },
  speedResult: { flexDirection: 'row', alignItems: 'baseline', gap: 12, flexShrink: 0 },
  speedResultMobile: { flexDirection: 'column', alignItems: 'flex-end', gap: 0 },
  speedVerdict: {
    minWidth: 126,
    textAlign: 'right',
    color: theme.colors.text.secondary,
    fontFamily: theme.typography.body,
    fontSize: 13.5,
    lineHeight: 18,
    fontWeight: '400',
  },
  speedVerdictMobile: { minWidth: 0, fontSize: 12.5, lineHeight: 17 },
  speedValue: {
    minWidth: 58,
    textAlign: 'right',
    color: theme.colors.text.primary,
    fontFamily: theme.typography.ui,
    fontSize: 18,
    lineHeight: 23,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  speedValueMobile: { minWidth: 0, fontSize: 17, lineHeight: 22 },
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
  staffLinkContent: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  staffLinkArrow: { width: 14, height: 14, top: 0 },
  staffLink: {
    color: '#5b30d6',
    fontFamily: theme.typography.mono,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
  unavailableText: {
    flex: 1,
    color: '#11150f',
    fontFamily: theme.typography.ui,
    fontSize: 16,
    lineHeight: 23,
    fontWeight: '600',
  },
  unavailableRow: {
    minHeight: 92,
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 11,
  },
  infoIcon: { marginTop: 1, flexShrink: 0 },
  recentMetric: { minWidth: 0 },
  recentMetricRowMobile: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 16,
  },
  recentMetricRight: { minWidth: 0, alignItems: 'flex-end' },
  recentValueMobile: { fontSize: 33, lineHeight: 40 },
  loadingBar: { width: 72, height: 18, marginTop: 16, borderRadius: 6, backgroundColor: '#e8ebe9' },
  loadingBarWide: { width: 110, height: 22 },
  visuallyHidden: { position: 'absolute', width: 1, height: 1, opacity: 0 },
});
