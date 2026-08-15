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
    expect(SOURCE).toContain('The 7-day and 30-day totals cover only the days collected so far');
    expect(SOURCE).not.toContain('How we count');
    expect(SOURCE).not.toContain('Privacy policy');
    expect(SOURCE).not.toContain('styles.rule');
    expect(SOURCE).toContain('marginTop: 10');
  });

  it('uses green only for the 3 recent traffic totals', () => {
    expect(SOURCE).toMatch(
      /recentValue: \{[\s\S]*?color: '#149d5b',[\s\S]*?fontFamily: theme\.typography\.ui,[\s\S]*?fontSize: 40/,
    );
    expect(SOURCE).toMatch(/metricRowValue: \{[\s\S]*?color: '#11150f'/);
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

  it('names search discovery, availability, and real-reader speed in plain words', () => {
    expect(SOURCE).toContain('Found in search · Last 30 days');
    expect(SOURCE).toContain('CAN PEOPLE REACH ALETHICAL?');
    expect(SOURCE).toContain('SPEED AND STABILITY DURING REAL VISITS');
    expect(SOURCE).toContain("source: 'Google'");
    expect(SOURCE).toContain('<SearchPanel source="Bing"');
    expect(SOURCE).toContain('Appearances');
    expect(SOURCE).toContain('clicks per 100 appearances');
    expect(SOURCE).toContain('Main content appears');
  });

  it('includes the accepted activity groups and privacy limits', () => {
    expect(SOURCE).toContain('WHERE PEOPLE GO');
    expect(SOURCE).toContain('WHAT PEOPLE DO');
    expect(SOURCE).toContain('WHAT PEOPLE EXPLORE');
    expect(SOURCE).toContain('READERS');
    expect(SOURCE).toContain('No search words, addresses, or districts');
    expect(SOURCE).toContain('Find My Legislator lookups with results');
    expect(SOURCE).toContain('Official source links opened');
    expect(SOURCE.match(/aria-level=\{2\}/g)?.length).toBeGreaterThanOrEqual(2);
    expect(SOURCE).toContain('<PanelTitle>WHERE PEOPLE GO</PanelTitle>');
    expect(SOURCE).toContain('<PanelTitle>WHAT PEOPLE EXPLORE</PanelTitle>');
    expect(SOURCE).toContain('<PanelTitle>WHAT PEOPLE DO</PanelTitle>');
    expect(SOURCE).toContain('<PanelTitle>READERS</PanelTitle>');
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

  it('keeps phone activity and search cards while flattening only the closing pair', () => {
    expect(SOURCE).toContain("mobileTreatment = 'card'");
    expect(SOURCE).toContain("mobileTreatment === 'closing'");
    expect(SOURCE).toMatch(
      /panelClosingMobile: \{[\s\S]*?borderWidth: 0,[\s\S]*?borderBottomWidth: 1/,
    );
    expect(SOURCE).toContain('<Panel mobileTreatment="closing"');
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

  it('uses the accepted closing-panel copy and sample rules', () => {
    expect(SOURCE).toContain('Checked by Checkly · Last 30 days');
    expect(SOURCE).toContain('Measured by Cloudflare · Last 30 days');
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
});
