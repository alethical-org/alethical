import { describe, expect, it } from 'vitest';

import { moneyReportPageMetadata } from '../share';
import {
  PUBLISHED_REPORTS,
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
  listed: true,
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
  // Rule 13's publishing order separates posting from listing: a posted report
  // has a page at its own address, and only a LISTED report is one a reader can
  // find. These pins are what stop an unlisted report leaking into a surface
  // that would make it findable, so they move only when Eugene lists one.
  it('gives every posted report a page at its own address', () => {
    expect(PUBLISHED_REPORTS.length).toBeGreaterThan(0);
    for (const report of PUBLISHED_REPORTS) {
      expect(reportBySlug(report.slug)).toBe(report);
    }
  });

  it('keeps an unlisted report out of the shelf, the landing and the sitemap', () => {
    // publishedReports() is the single feed those three surfaces read.
    const listed = publishedReports();
    expect(listed.every((report) => report.listed)).toBe(true);
    for (const report of PUBLISHED_REPORTS.filter((report) => !report.listed)) {
      expect(listed).not.toContain(report);
    }
  });

  it('tells search engines to skip an unlisted report, and to index a listed one', () => {
    const unlisted = moneyReportPageMetadata({ ...SAMPLE_REPORT, listed: false });
    expect(unlisted.noindex).toBe(true);
    // No canonical while noindex: an unlisted page is not a copy of a real one.
    expect(unlisted.canonicalPath).toBe('');

    const listed = moneyReportPageMetadata(SAMPLE_REPORT);
    expect(listed.noindex).toBe(false);
    expect(listed.canonicalPath).toBe('/reports/sample-report');
  });

  it('names records it does not hold rather than dating them', () => {
    // Rule 13's publishing order, point 11.
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
