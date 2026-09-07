import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { redactTrafficUrl } from '../trafficUrl';

const source = (relative: string) => readFileSync(new URL(relative, import.meta.url), 'utf8');

describe('metrics first-load boundary', () => {
  it('gives both metrics routes one lazy download owner', () => {
    const loaders = source('../../navigation/screenChunks.ts');
    expect(loaders.match(/import\('\.\.\/screens\/metricsScreens'\)/g)).toHaveLength(2);
    expect(loaders).not.toContain("import('../screens/TrafficScreen')");
    expect(loaders).not.toContain("import('../screens/redesign/AdminSiteMetricsScreen')");
    const feature = source('../../screens/metricsScreens.ts');
    expect(feature).toContain("export { TrafficScreen } from './TrafficScreen'");
    expect(feature).toContain(
      "export { AdminSiteMetricsScreen } from './redesign/AdminSiteMetricsScreen'",
    );
  });
  it('keeps display-only requests out of the shared API module', () => {
    const shared = source('../../data/api.ts');
    const feature = source('../../data/siteMetricsApi.ts');
    // A nested async root would make validators shared with the screen chunk
    // and Metro would promote them back into the eager common bundle.
    expect(feature).not.toMatch(/await\s+import\(/);
    for (const name of [
      'getAccountSignupTotalsFromApi',
      'getSiteMetricRecordTotalsFromApi',
      'getLeadershipMetricsFromApi',
    ]) {
      expect(shared).not.toContain(name);
      expect(feature).toContain('function ' + name);
    }
    expect(shared).toContain('function getSiteMetricCollectionDecisionFromApi');
    expect(shared).toContain('function recordSiteMetricEventFromApi');
    expect(source('../../screens/redesign/AdminSiteMetricsScreen.tsx')).toContain(
      "from '../../data/siteMetricsApi'",
    );
  });
  it('does not make the small URL helper depend on report code', () => {
    expect(source('../trafficUrl.ts')).not.toMatch(/^import\s/m);
    expect(source('../traffic.ts')).toContain("export { redactTrafficUrl } from './trafficUrl'");
  });
  it.each([
    ['https://www.alethical.com/money?search=private#details', 'https://www.alethical.com/money'],
    ['/money/search?query=private#details', '/money/search'],
    ['/bills', '/bills'],
  ])('preserves URL privacy after extraction: %s', (input, expected) => {
    expect(redactTrafficUrl(input)).toBe(expected);
  });
  it('loads the global URL privacy helper without the display validators', () => {
    const collector = source('../../components/TrafficAnalytics.web.tsx');
    expect(collector).toContain("from '../lib/trafficUrl'");
    expect(collector).not.toContain("from '../lib/traffic'");
  });
});
