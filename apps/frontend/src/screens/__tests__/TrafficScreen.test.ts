import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SOURCE = readFileSync(join(__dirname, '..', 'TrafficScreen.tsx'), 'utf8');

describe('public Site metrics page', () => {
  it('shows visitors and page views for the 3 accepted recent periods', () => {
    expect(SOURCE).toContain('Estimated visitors');
    expect(SOURCE).toContain('Page views');
    expect(SOURCE).toContain('LAST 24 HOURS');
    expect(SOURCE).toContain('LAST 7 DAYS');
    expect(SOURCE).toContain('LAST 30 DAYS');
    expect(SOURCE).toContain('may include the same person more than once');
  });

  it('has 1 top heading and the accepted loading and unavailable states', () => {
    expect(SOURCE.match(/aria-level=\{1\}/g)).toHaveLength(1);
    expect(SOURCE).toContain('Site Metrics');
    expect(SOURCE).toContain("useDocumentTitle('/site-metrics', 'Site Metrics | Alethical')");
    expect(SOURCE).toContain('Loading site metrics.');
    expect(SOURCE.match(/Loading site metrics\./g)).toHaveLength(1);
    expect(SOURCE).toContain('Recent traffic is temporarily unavailable.');
    expect(SOURCE).toContain('A newer reading has not come through yet');
    expect(SOURCE).toContain('Last accepted');
    expect(SOURCE).toContain('Counted by Vercel');
  });

  it('keeps the public explanation short and puts freshness on 1 line', () => {
    expect(SOURCE).toMatch(
      /How people find and use Alethical, and how well the site works\s*<\/Text>/,
    );
    expect(SOURCE).toContain('· Through {formatTrafficWindowEnd(totals.windowEndedAt)} ·');
    expect(SOURCE).not.toContain('Counted by Vercel · Fetched');
    expect(SOURCE).not.toContain('Each total ends at');
    expect(SOURCE).toContain('Collecting since {formatDate(totals.countingStartedAt)}');
    expect(SOURCE).not.toContain(
      'The 7-day and 30-day totals cover only the days collected so far',
    );
    expect(SOURCE).not.toContain('How we count');
    expect(SOURCE).not.toContain('Privacy policy');
    expect(SOURCE).not.toContain('styles.rule');
    expect(SOURCE).toContain('marginTop: 10');
  });

  it('shows Checkly percentages with no more than 2 decimal places', () => {
    expect(SOURCE).toMatch(
      /function percent\(value: number\) \{[\s\S]*?maximumFractionDigits: 2[\s\S]*?\}%/,
    );
    expect((97.973).toLocaleString('en-US', { maximumFractionDigits: 2 })).toBe('97.97');
    expect((100).toLocaleString('en-US', { maximumFractionDigits: 2 })).toBe('100');
  });

  it('uses green only for the 3 recent traffic totals', () => {
    expect(SOURCE).toMatch(
      /recentValue: \{[\s\S]*?color: theme\.colors\.brand\.display,[\s\S]*?fontFamily: theme\.typography\.ui,[\s\S]*?fontSize: 40/,
    );
    expect(SOURCE).toMatch(/metricRowValue: \{[\s\S]*?color: theme\.colors\.text\.primary/);
  });

  it('uses the shared shell and leaves the footer privacy route in place', () => {
    expect(SOURCE).toContain('<TopNav');
    expect(SOURCE).toContain('<Footer');
    expect(SOURCE).toContain("onPrivacy={() => navigation.navigate('Privacy')}");
  });

  it('loads each outside source separately so 1 failure cannot erase the rest', () => {
    expect(SOURCE).toContain("useTrafficSource('/api/traffic'");
    expect(SOURCE).toContain("useTrafficSource('/api/traffic-google?window=30'");
    expect(SOURCE).toContain("useTrafficSource('/api/traffic-bing'");
    expect(SOURCE).toContain("useTrafficSource('/api/traffic-uptime'");
    expect(SOURCE).toContain("useTrafficSource('/api/traffic-performance'");
  });

  it('names the 4 accepted sections and their panels in plain words', () => {
    expect(SOURCE).toContain('<SectionTitle>Recent traffic</SectionTitle>');
    expect(SOURCE).toContain('<SectionTitle>How people use Alethical</SectionTitle>');
    expect(SOURCE).toContain(
      '<SectionTitle qualifier="LAST 30 DAYS">Found in search</SectionTitle>',
    );
    expect(SOURCE).toContain(
      '<SectionTitle qualifier="LAST 30 DAYS">How well the site works</SectionTitle>',
    );
    expect(SOURCE).toContain('Can people reach Alethical?');
    expect(SOURCE).toContain('Speed and stability during real visits');
    expect(SOURCE).toContain("source: 'Google'");
    expect(SOURCE).toContain('<SearchPanel source="Bing"');
    expect(SOURCE).toContain('Appearances');
    expect(SOURCE).toContain('clicks per 100 appearances');
    expect(SOURCE).toContain('Main content appears');
  });

  it('includes the accepted activity groups and privacy limits', () => {
    expect(SOURCE).toContain('Where people go');
    expect(SOURCE).toContain('What people do');
    expect(SOURCE).toContain('What people explore');
    expect(SOURCE).toContain('Readers');
    expect(SOURCE).toContain('No search words, addresses, or districts');
    expect(SOURCE).toContain('Find My Legislator lookups with results');
    expect(SOURCE).toContain('Official source links opened');
    expect(SOURCE).toContain('aria-level={2}');
    expect(SOURCE).toContain('aria-level={3}');
    expect(SOURCE).toContain('<PanelTitle>Where people go</PanelTitle>');
    expect(SOURCE).toContain('<PanelTitle>What people explore</PanelTitle>');
    expect(SOURCE).toContain('<PanelTitle>What people do</PanelTitle>');
    expect(SOURCE).toContain('<PanelTitle>Readers</PanelTitle>');
  });

  it('keeps the 7 and 30 day activity choices in the address', () => {
    expect(SOURCE).toContain("get('range') === '30'");
    expect(SOURCE).toContain("url.searchParams.set('range', String(next))");
    expect(SOURCE).toContain('Last {value} days');
    expect(SOURCE).toContain('aria-pressed={selected}');
    expect(SOURCE).toContain('role="group"');
    expect(SOURCE).not.toContain('accessibilityRole="radiogroup"');
    expect(SOURCE).toContain('rangeButtonsShell');
    expect(SOURCE).toContain("rangeButtonSelected: { backgroundColor: '#ffffff'");
  });

  it('keeps honest low-sample and zero states', () => {
    expect(SOURCE).toContain('Building sample');
    expect(SOURCE).toContain('No page views in this range yet');
    expect(SOURCE).toContain('Not available');
    expect(SOURCE).not.toContain('64,892');
    expect(SOURCE).not.toContain('18,420');
  });

  it('compares search click rates with the previous equal 30 days', () => {
    expect(SOURCE).toContain('previousImpressions30d');
    expect(SOURCE).toContain('Up');
    expect(SOURCE).toContain('Down');
    expect(SOURCE).toContain('in the previous 30 days');
  });

  it('keeps every phone panel on the accepted tinted card surface', () => {
    expect(SOURCE).toContain('isMobile && styles.panelCardMobile');
    expect(SOURCE).not.toContain('mobileTreatment="closing"');
  });

  it('matches the accepted phone and destination layouts', () => {
    expect(SOURCE).toContain('isMobile && styles.recentMetricRowMobile');
    expect(SOURCE).toContain('isMobile ? undefined : styles.recentDivider');
    expect(SOURCE).toContain('styles.destinationGroup');
    expect(SOURCE).toContain('styles.destinationRowLine');
    expect(SOURCE).toContain('styles.barTrackMobile');
  });

  it('keeps the accepted search identities and compact supporting rate', () => {
    expect(SOURCE).toContain('<VendorLogo source={source}');
    expect(SOURCE).toContain('Search discovery from {source} is temporarily unavailable');
    expect(SOURCE).toContain('{sourceName} · Through {formatDate(totals.periodEndedOn)}');
    expect(SOURCE).toMatch(/vendorTitle: \{[\s\S]*?fontSize: 15/);
    expect(SOURCE).toMatch(/searchRateValue: \{[\s\S]*?fontSize: 16/);
  });

  it('puts the shared 30-day window in the health heading and keeps the sample rules', () => {
    expect(SOURCE).toContain('Checked by Checkly');
    expect(SOURCE).toContain('Measured by Cloudflare');
    expect(SOURCE).not.toContain('Checked by Checkly · Last 30 days');
    expect(SOURCE).not.toContain('Measured by Cloudflare · Last 30 days');
    expect(SOURCE).toContain('Percentages show how often Alethical passed automatic checks');
    expect(SOURCE).not.toContain('Percentages show how often Alethical passed automatic checks.');
    expect(SOURCE).toContain('OPEN VERCEL DASHBOARD');
    expect(SOURCE).toContain('OPEN CHECKLY DASHBOARD');
    expect(SOURCE).not.toContain('REAL VISITS · SLOWEST 1 IN 4');
    expect(SOURCE).toContain('buildingSample ? null : (');
  });

  it('hides the first table heading and explains a source cap only when it is reached', () => {
    expect(SOURCE).toContain('role="columnheader"');
    expect(SOURCE).toContain('role="rowheader"');
    expect(SOURCE).toContain('role="cell"');
    expect(SOURCE).toContain('const capped =');
    expect(SOURCE).toContain('{capped ? (');
  });

  it('keeps the accepted Explore table type, alignment, and right edge', () => {
    expect(SOURCE).toMatch(
      /tableLabel: \{[\s\S]*?fontFamily: theme\.typography\.ui,[\s\S]*?fontSize: 13,[\s\S]*?fontWeight: '600',[\s\S]*?textAlign: 'right'/,
    );
    expect(SOURCE).toMatch(/tableLabelMobile: \{ fontSize: 12/);
    expect(SOURCE).toMatch(
      /tableValue: \{[\s\S]*?fontSize: 24,[\s\S]*?fontWeight: '800',[\s\S]*?textAlign: 'right',[\s\S]*?fontVariant: \['tabular-nums'\]/,
    );
    expect(SOURCE).toMatch(/tableValueMobile: \{ fontSize: 22/);
    expect(SOURCE).toMatch(/tableName: \{ flex: 1, textAlign: 'left' \}/);
    expect(SOURCE).toMatch(/tableRow: \{[\s\S]*?paddingLeft: 14,[\s\S]*?paddingRight: 0/);
    expect(SOURCE).toMatch(/tableRowMobile: \{[\s\S]*?paddingLeft: 12,[\s\S]*?paddingVertical: 11/);
  });

  it('keeps destination bars proportional with the accepted desktop and phone geometry', () => {
    expect(SOURCE).toMatch(
      /destinationPercent: \{[\s\S]*?width: 38,[\s\S]*?fontFamily: theme\.typography\.mono,[\s\S]*?fontSize: 14,[\s\S]*?fontWeight: '700'/,
    );
    expect(SOURCE).toMatch(
      /barTrack: \{[\s\S]*?height: 12,[\s\S]*?borderRadius: 6,[\s\S]*?backgroundColor: '#e8ebe9'/,
    );
    expect(SOURCE).toMatch(/destinationRowLineMobile: \{ gap: 10 \}/);
    expect(SOURCE).toMatch(
      /destinationPercentMobile: \{ width: 34, fontSize: 13, lineHeight: 18 \}/,
    );
    expect(SOURCE).toMatch(/barTrackMobile: \{ height: 9, borderRadius: 5 \}/);
    expect(SOURCE).toMatch(/barFillMobile: \{ borderRadius: 5 \}/);
  });

  it('keeps the accepted ledger rhythm and search-card surface', () => {
    expect(SOURCE).toMatch(/metricRow: \{[\s\S]*?paddingVertical: 11/);
    expect(SOURCE).toMatch(/metricRowAvailability: \{ paddingVertical: 10 \}/);
    expect(SOURCE).toMatch(/metricRowValueAvailability: \{ fontSize: 18/);
    expect(SOURCE).toMatch(/speedRow: \{[\s\S]*?paddingVertical: 15/);
    expect(SOURCE).toMatch(
      /panelSearch: \{ paddingTop: 16, paddingHorizontal: 20, paddingBottom: 18 \}/,
    );
    expect(SOURCE).not.toContain('mobileTreatment="closing"');
    expect(SOURCE).toMatch(
      /metricRowCompactMobile: \{ paddingVertical: 0, borderBottomWidth: 0 \}/,
    );
    expect(SOURCE).toMatch(/plainRowsMobile: \{ paddingHorizontal: 12, gap: 14 \}/);
    expect(SOURCE).toMatch(/metricRowValueActionMobile: \{ fontSize: 19/);
    expect(SOURCE).toMatch(/metricRowValueAvailabilityMobile: \{ fontSize: 17/);
  });

  it('uses the numeric value treatment and column for every Building sample state', () => {
    expect(SOURCE).toMatch(/measurement:\s*totals\.lcpP75Ms == null \? null/);
    expect(SOURCE).toContain("verdict: speedVerdict('lcp', totals.lcpP75Ms)");
    expect(SOURCE).not.toContain(
      "verdict: speedVerdict('lcp', totals.lcpP75Ms) ?? 'Building sample'",
    );
    expect(SOURCE.match(/\{row\.measurement \?\? 'Building sample'\}/g)).toHaveLength(2);
    expect(SOURCE).toMatch(
      /speedVerdict: \{[\s\S]*?minWidth: 126,[\s\S]*?color: theme\.colors\.text\.secondary,[\s\S]*?fontSize: 13\.5,[\s\S]*?fontWeight: '400'/,
    );
    expect(SOURCE).toMatch(
      /speedValue: \{[\s\S]*?minWidth: 58,[\s\S]*?color: theme\.colors\.text\.primary,[\s\S]*?fontSize: 18,[\s\S]*?fontWeight: '800'/,
    );
    expect(SOURCE).toMatch(/speedRowMobile: \{ paddingVertical: 9, gap: 14 \}/);
    expect(SOURCE).toMatch(
      /speedResultMobile: \{ flexDirection: 'column', alignItems: 'flex-end', gap: 0 \}/,
    );
    expect(SOURCE).toMatch(
      /speedVerdictMobile: \{ minWidth: 0, fontSize: 12\.5, lineHeight: 17 \}/,
    );
    expect(SOURCE).toMatch(/speedValueMobile: \{ minWidth: 0, fontSize: 17, lineHeight: 22 \}/);
  });

  it('uses 4 sections, 3 rules, and the accepted heading hierarchy', () => {
    expect(SOURCE.match(/<View style=\{\[styles\.sectionRule/g)).toHaveLength(3);
    expect(SOURCE).toMatch(
      /sectionTitle: \{[\s\S]*?color: '#2b6377',[\s\S]*?fontFamily: theme\.typography\.ui,[\s\S]*?fontSize: 20,[\s\S]*?fontWeight: '800'/,
    );
    expect(SOURCE).toMatch(/sectionTitleMobile: \{ fontSize: 18/);
    expect(SOURCE).toMatch(
      /sectionQualifier: \{[\s\S]*?fontFamily: theme\.typography\.mono,[\s\S]*?fontSize: 12,[\s\S]*?fontWeight: '500'/,
    );
    expect(SOURCE).toMatch(/panelTitle: \{[\s\S]*?fontSize: 15\.5,[\s\S]*?fontWeight: '700'/);
    expect(SOURCE).toMatch(/panelTitleMobile: \{ fontSize: 15/);
  });

  it('shows only the 2 public availability checks selected by the accepted design', () => {
    expect(SOURCE).toContain('label="Homepage"');
    expect(SOURCE).toContain('label="Data service"');
    expect(SOURCE).not.toContain('label="Site Metrics page"');
  });
});
