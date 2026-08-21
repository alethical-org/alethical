import { describe, expect, it } from 'vitest';

import { moneyReportPageMetadata } from '../share';
import {
  PUBLISHED_REPORTS,
  indexedReports,
  publishedReports,
  reportBySlug,
  reportDateCapsLabel,
  reportDateLabel,
  reportDatesLine,
  reportShareDescription,
  type MoneyReport,
} from '../moneyReports';

// A populated report that exists ONLY here: nothing a reader can reach may show
// a figure or a claim from an unpublished report, so the populated states are
// exercised with obviously-fake sample content instead of the real text
// (Eugene's 19 Aug 2026 decision — build the page and its container only).
export const SAMPLE_REPORT: MoneyReport = {
  slug: 'sample-report',
  indexed: true,
  title: 'Sample report title',
  dek: 'A sample standfirst for tests.',
  authorLine: 'ALETHICAL RESEARCH · AUTHOR NAMED AT PUBLISH',
  publishedOn: '2026-08-17',
  recordsThrough: '2026-08-11',
  filingBodies: ['Minnesota Campaign Finance Board', 'Federal Election Commission'],
  shortVersion: [
    { kind: 'paragraph', runs: [{ kind: 'text', text: 'A sample opening paragraph.' }] },
  ],
  sections: [
    {
      anchor: 's1',
      heading: 'A sample section',
      railLabel: 'Sample section',
      blocks: [
        {
          kind: 'paragraph',
          runs: [
            { kind: 'text', text: 'A figure of ' },
            {
              kind: 'correctedFigure',
              was: '$2 sample',
              now: '$3 sample',
              datedLabel: 'CORRECTED SEP 2 2026',
            },
            { kind: 'text', text: ' appears here.' },
          ],
        },
      ],
      methodologyInset: {
        title: 'How we scored this',
        body: 'A sample method note stating its own records-through window.',
      },
    },
  ],
  sources: [
    {
      text: 'A sample source.',
      note: 'A sample clarifying note.',
      noteLink: { text: 'a sample outward link', href: 'https://example.com/' },
    },
  ],
  correction: {
    datedLabel: 'CORRECTED SEP 2 2026',
    note: 'A sample correction note. The earlier figure stays readable where it appears.',
  },
  newerFilingsNote: 'A sample newer-filings note, dated at the figure it moves.',
};

describe('the posted-report registry', () => {
  // Rule 13's publishing order: posting a report puts it on the site straight
  // away, and holding it back from SEARCH ENGINES is the separate, later step.
  // These pins are what keep those two apart, so neither can drag the other.
  it('puts every posted report on the site, at its address and on the shelf', () => {
    expect(PUBLISHED_REPORTS.length).toBeGreaterThan(0);
    // publishedReports() is what the shelf and the money landing's count read.
    expect(publishedReports()).toEqual(PUBLISHED_REPORTS);
    for (const report of PUBLISHED_REPORTS) {
      expect(reportBySlug(report.slug)).toBe(report);
    }
  });

  it('keeps a report out of the sitemap until its figures are checked', () => {
    // Written as an equality so the guard still does work on a day when every
    // posted report happens to be indexed.
    expect(indexedReports()).toEqual(PUBLISHED_REPORTS.filter((report) => report.indexed));
    expect(indexedReports().every((report) => report.indexed)).toBe(true);
  });

  it('tells search engines to skip a report until it is opened to them', () => {
    const held = moneyReportPageMetadata({ ...SAMPLE_REPORT, indexed: false });
    expect(held.noindex).toBe(true);
    // No canonical while noindex: a held page is not a copy of a real one.
    expect(held.canonicalPath).toBe('');

    const open = moneyReportPageMetadata(SAMPLE_REPORT);
    expect(open.noindex).toBe(false);
    expect(open.canonicalPath).toBe('/reports/sample-report');
  });

  it('names records it does not hold rather than dating them', () => {
    // Rule 13's publishing order.
    for (const report of PUBLISHED_REPORTS) {
      if (report.undatedRecordsNote === undefined) continue;
      expect(report.undatedRecordsNote.trim().length).toBeGreaterThan(0);
      expect(report.undatedRecordsNote).not.toContain(report.recordsThrough);
    }
  });
});

describe('report date labels', () => {
  it('formats an ISO date without shifting a day with the time zone', () => {
    // new Date('2026-08-17') is UTC midnight, which is 16 Aug in Minnesota —
    // the hand parser must not inherit that bug.
    expect(reportDateLabel('2026-08-17')).toBe('Aug 17, 2026');
    expect(reportDateLabel('2026-01-01')).toBe('Jan 1, 2026');
  });

  it('formats the mono-caps masthead form', () => {
    expect(reportDateCapsLabel('2026-08-17')).toBe('AUG 17 2026');
  });

  it('passes through a value it cannot parse rather than inventing a date', () => {
    expect(reportDateLabel('unknown')).toBe('unknown');
  });

  it('writes the masthead dates line from both dates', () => {
    expect(reportDatesLine(SAMPLE_REPORT)).toBe(
      'PUBLISHED AUG 17 2026 · RECORDS THROUGH AUG 11 2026',
    );
  });
});

describe('report share previews', () => {
  // Rule 13: report claims and derived labels appear in no social-share preview
  // or metadata — a preview carries the title and the two dates, nothing else.
  it('describes a report by its dates only', () => {
    expect(reportShareDescription(SAMPLE_REPORT)).toBe(
      'Published Aug 17, 2026 · records through Aug 11, 2026.',
    );
  });
});
