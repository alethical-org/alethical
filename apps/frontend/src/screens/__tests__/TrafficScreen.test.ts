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
    expect(SOURCE).toContain('Site metrics');
    expect(SOURCE).toContain("useDocumentTitle('/site-metrics', 'Site metrics | Alethical')");
    expect(SOURCE).toContain('Site metrics are loading.');
    expect(SOURCE).toContain('Recent traffic is temporarily unavailable.');
    expect(SOURCE).toContain('A newer reading has not come through yet');
    expect(SOURCE).toContain('Counted by Vercel');
  });

  it('keeps the public explanation short and puts freshness on 1 line', () => {
    expect(SOURCE).toContain('Public totals about how Alethical is used</Text>');
    expect(SOURCE).toContain('· Through {formatTrafficWindowEnd(totals.windowEndedAt)} ·');
    expect(SOURCE).not.toContain('Counted by Vercel · Fetched');
    expect(SOURCE).not.toContain('Each total ends at');
    expect(SOURCE).toContain('Collecting since {formatDate(totals.countingStartedAt)}');
    expect(SOURCE).not.toContain('Longer totals are still');
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
    expect(SOURCE).toContain('Can people reach Alethical?');
    expect(SOURCE).toContain('Speed and stability during real visits');
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

  it('turns phone panels into separated sections instead of cards', () => {
    expect(SOURCE).toContain('isMobile && styles.panelMobile');
    expect(SOURCE).toMatch(/panelMobile: \{[\s\S]*?borderWidth: 0,[\s\S]*?borderBottomWidth: 1/);
  });
});
