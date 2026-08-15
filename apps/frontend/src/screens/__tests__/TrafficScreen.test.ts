import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SOURCE = readFileSync(join(__dirname, '..', 'TrafficScreen.tsx'), 'utf8');

describe('public Traffic page', () => {
  it('shows only the 3 accurate page-view totals and their trailing periods', () => {
    expect(SOURCE).not.toContain('Estimated visitors');
    expect(SOURCE.match(/label="Page views"/g)).toHaveLength(6);
    expect(SOURCE).toContain('LAST 24 HOURS');
    expect(SOURCE).toContain('LAST 7 DAYS');
    expect(SOURCE).toContain('LAST 30 DAYS');
    expect(SOURCE).not.toContain('Every page opened during');
  });

  it('has 1 top heading and the accepted loading and unavailable states', () => {
    expect(SOURCE.match(/aria-level=\{1\}/g)).toHaveLength(1);
    expect(SOURCE).toContain('Traffic totals are loading.');
    expect(SOURCE).toContain('Traffic totals are temporarily unavailable.');
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

  it('uses the interface face and display-green token for every numeric total', () => {
    expect(SOURCE).toMatch(
      /value: \{[\s\S]*?color: theme\.colors\.brand\.display,[\s\S]*?fontFamily: theme\.typography\.ui,[\s\S]*?fontSize: 40,[\s\S]*?lineHeight: 40,[\s\S]*?fontWeight: '800',[\s\S]*?letterSpacing: -1,[\s\S]*?fontVariant: \['tabular-nums'\],[\s\S]*?\}/,
    );
    expect(SOURCE).toContain('valueBox: { height: 46');
  });

  it('uses the shared shell and leaves the footer privacy route in place', () => {
    expect(SOURCE).toContain('<TopNav');
    expect(SOURCE).toContain('<Footer');
    expect(SOURCE).toContain("onPrivacy={() => navigation.navigate('Privacy')}");
  });

  it('loads each outside source separately so 1 failure cannot erase the rest', () => {
    expect(SOURCE).toContain("useTrafficSource('/api/traffic'");
    expect(SOURCE).toContain("useTrafficSource('/api/traffic-google'");
    expect(SOURCE).toContain("useTrafficSource('/api/traffic-bing'");
    expect(SOURCE).toContain("useTrafficSource('/api/traffic-uptime'");
    expect(SOURCE).toContain("useTrafficSource('/api/traffic-performance'");
  });

  it('names search discovery, availability, and real-reader speed in plain words', () => {
    expect(SOURCE).toContain('Found in search');
    expect(SOURCE).toContain('Can people reach Alethical?');
    expect(SOURCE).toContain('Speed during real visits');
    expect(SOURCE).toContain('Shown in Google results');
    expect(SOURCE).toContain('Visits from Bing results');
    expect(SOURCE).toContain('Main website available');
    expect(SOURCE).toContain('Main content appeared');
  });
});
