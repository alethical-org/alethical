/**
 * The published-research registry for the campaign money section
 * (`.claude/rules/grounded-answers.md` rule 13, signed reports).
 *
 * A signed report is the one surface allowed to add figures up across members,
 * cite filing bodies beyond Minnesota's Campaign Finance Board, and define
 * derived classifications — under rule 13's conditions. This file holds the
 * machinery for that surface. Posting a report means adding its entry to
 * `PUBLISHED_REPORTS`: the report page, the share preview, the shelf, the money
 * landing and the sitemap all read this registry. A report's `indexed` flag
 * decides only whether search engines may list it.
 *
 * Framework-free, in the style of lib/billDetail.ts: every sentence the report
 * chrome shows is decided by data in this shape, so tests can exercise the
 * populated states (masthead, correction, newer-filings banner) with sample
 * content that never ships on a route.
 */

import { MONEY_ONLY_GOES_ONE_WAY } from './reports/moneyOnlyGoesOneWay';

/** One run of report prose. Links are outward only in this phase — committee
 * record pages do not exist yet, and a link may not point at a page that is
 * not there. */
export type ReportInline =
  | { kind: 'text'; text: string }
  | { kind: 'bold'; text: string }
  | { kind: 'italic'; text: string }
  | { kind: 'externalLink'; text: string; href: string };

export type ReportBlock =
  | { kind: 'paragraph'; runs: ReportInline[] }
  | { kind: 'bullets'; items: ReportInline[][] }
  /** A small table the report's prose introduces. Plain strings: a table states
   * filed figures, so it carries no links, no emphasis and no derived label. */
  | { kind: 'table'; columns: string[]; rows: string[][] }
  /**
   * A short note qualifying a figure the prose has just given: where 2 official
   * records disagree, or where a figure comes from records we do not hold. Drawn
   * as the method box's twin, one family with `methodologyInset`, because both
   * are us showing our work rather than warning of a problem (Design, 27 Aug
   * 2026). The words carry the meaning; the box only helps a scanning reader
   * notice, so nothing is lost by a reader who cannot see the styling.
   */
  | { kind: 'note'; text: string };

export interface ReportSection {
  /** The section heading, exactly as the report's text writes it. The heading is
   * also what the section's link target is built from — see
   * `reportSectionAnchors` — so there is no second, hand-kept list to fall out of
   * step with it. */
  heading: string;
  /** The short label the contents rail shows for this section. */
  railLabel: string;
  blocks: ReportBlock[];
  /**
   * Layout-owned method inset drawn after this section's prose (rule 13: a
   * derived classification publishes its complete method beside its first use,
   * stating the window it was computed on).
   */
  methodologyInset?: { title: string; body: string };
}

/** One entry in the where-these-numbers-come-from block. */
export interface ReportSource {
  text: string;
  /** Clarifying sentence after the source name, in the same ink as the source. */
  note?: string;
  /** Outward link inside the note (e.g. to the FEC). Never an inward link the
   * site cannot honor yet. */
  noteLink?: { text: string; href: string };
}

export interface ReportCorrection {
  /** e.g. "CORRECTED SEP 2 2026" */
  datedLabel: string;
  /** One banner sentence saying what moved. The report's own text already holds
   * the corrected wording: rule 13 replaces a wrong figure rather than leaving it
   * readable with a line through it, so this banner is the only trace of the
   * change (Eugene, 25 Aug 2026). */
  note: string;
}

export interface MoneyReport {
  /** URL slug under /reports/. */
  slug: string;
  /**
   * Whether search engines may list the report. **Every published piece is
   * visible from the day it posts (Eugene, 25 Aug 2026)**, so this is `true` on
   * anything we publish and the field exists only to hold a piece back for a
   * reason Eugene names. It governs the sitemap row, the indexing tag and the
   * canonical link together, so all 3 follow from the one value.
   */
  indexed: boolean;
  title: string;
  /** Masthead and shelf standfirst. Never appears in share previews (rule 13:
   * share previews carry title and dates only). */
  dek: string;
  /**
   * The byline. Kept on the record, rendered nowhere since 20 Aug 2026: the
   * masthead now carries the 2 dates alone (rule 13's publishing order, point
   * 8), and a report published in Alethical's own name needs no byline because
   * the site is the author. A report signed by a person names them in its own
   * text. Never an invented name.
   */
  authorLine: string;
  /** ISO date the report was published, e.g. "2026-08-17". */
  publishedOn: string;
  /** ISO date the records run through, e.g. "2026-08-11". */
  recordsThrough: string;
  /**
   * Every filing body the report used. Kept on the record, rendered nowhere
   * since 20 Aug 2026: the sources block names the bodies in its own prose
   * (rule 13).
   */
  filingBodies: string[];
  /**
   * Set when the report draws a figure from records Alethical does not hold, so
   * that figure has no records-through date. Kept on the record, rendered
   * nowhere since 20 Aug 2026 (Eugene's call): the sources block names those
   * records and the years they cover instead (rule 13's publishing order, point
   * 11).
   */
  undatedRecordsNote?: string;
  /** The boxed opening summary ("SHORT VERSION"). */
  shortVersion: ReportBlock[];
  sections: ReportSection[];
  /** The where-these-numbers-come-from block. */
  sources: ReportSource[];
  /** Set when a figure was corrected after publication. */
  correction?: ReportCorrection;
  /**
   * Set when the Board has accepted filings newer than recordsThrough. The
   * banner is dated, never a silent edit (rule 13).
   */
  newerFilingsNote?: string;
}

/**
 * The reports shelf's own fixed wording, in one place because 3 surfaces draw it:
 * the shelf screen, the shelf's search description in lib/share.ts, and the text
 * served in the first response before any JavaScript runs
 * (lib/pageSnapshot.ts). A second copy is how a served page and a rendered page
 * start disagreeing, which is worse than either one being wrong alone.
 */
export const MONEY_REPORTS_SHELF_HEADING = 'Campaign money reports';
export const MONEY_REPORTS_SHELF_INTRO =
  'Our own research, in plain language, drawn from the filings Minnesota campaigns, parties and funds make with the state.';
export const MONEY_REPORTS_SHELF_EMPTY_TITLE = 'Nothing published yet.';
export const MONEY_REPORTS_SHELF_EMPTY_BODY =
  'When we publish research on these records, it appears here, dated and carrying the date its records run through.';

/**
 * One run of report prose as a reader sees it: the runs joined, because the
 * screen draws them as neighbouring texts inside one paragraph. Emphasis and an
 * outward link contribute their words and nothing else, so this is the same
 * sentence in both places.
 */
export function reportRunsText(runs: ReportInline[]): string {
  return runs.map((run) => run.text).join('');
}

/** Every source line as the sources block draws it: the entry, its note, its link text. */
export function reportSourceText(source: ReportSource): string {
  // The link's own words are deliberately absent: a snapshot renders them as a real
  // anchor beside this sentence, so including them here would print them twice.
  return [source.text, source.note].filter(Boolean).join(' ');
}

/**
 * Every posted report, newest first. Posting puts a report on the site, so this
 * is what the reports shelf, the money landing and every address-based reader
 * show. Whether a search engine may list it is the separate `indexed` flag.
 */
export const PUBLISHED_REPORTS: MoneyReport[] = [MONEY_ONLY_GOES_ONE_WAY];

/** Every posted report: the reports shelf and the money landing's count. */
export function publishedReports(): MoneyReport[] {
  return PUBLISHED_REPORTS;
}

/**
 * The reports a search engine may list. Only the sitemap reads this, so a report
 * still waiting on its figure check is out of the sitemap by construction rather
 * than by the sitemap remembering to check.
 */
export function indexedReports(): MoneyReport[] {
  return PUBLISHED_REPORTS.filter((report) => report.indexed);
}

/**
 * The link target for one section heading: the heading's own words, lowercased,
 * with punctuation dropped and spaces turned into hyphens.
 *
 * Built from the words rather than the section's position, because a shared
 * `/reports/{slug}#{anchor}` link has to survive a section being inserted above
 * it — a positional `#s3` would silently start pointing at a different section
 * (rule 13 is explicit that a posted report's addresses are stable). Apostrophes
 * and quote marks are removed rather than hyphenated, so "the candidate's
 * behalf" reads as `the-candidates-behalf` and not `the-candidate-s-behalf`.
 */
export function reportSectionAnchor(heading: string): string {
  const slug = heading
    .toLowerCase()
    .replace(/['\u2018\u2019"\u201c\u201d]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'section';
}

/**
 * Every section's link target, in document order, aligned index-for-index with
 * the sections passed in. Two headings that slug the same way get a numeric
 * suffix (`-2`, `-3`) in document order, so an id never names two places.
 *
 * The contents rail and the article both read this one list, which is why the
 * rail cannot drift out of step with the headings it points at.
 */
export function reportSectionAnchors(sections: Pick<ReportSection, 'heading'>[]): string[] {
  const used = new Map<string, number>();
  return sections.map((section) => {
    const base = reportSectionAnchor(section.heading);
    const seen = used.get(base) ?? 0;
    used.set(base, seen + 1);
    return seen === 0 ? base : `${base}-${seen + 1}`;
  });
}

export function reportBySlug(slug: string): MoneyReport | undefined {
  return PUBLISHED_REPORTS.find((report) => report.slug === slug);
}

const MONTH_LABELS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/**
 * "2026-08-17" → "Aug 17, 2026". Parsed by hand so the label cannot shift a day
 * with the reader's time zone, which `new Date(iso)` (UTC midnight) would do.
 */
export function reportDateLabel(isoDate: string): string {
  const match = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return isoDate;
  const month = MONTH_LABELS[Number(match[2]) - 1];
  if (!month) return isoDate;
  return `${month} ${Number(match[3])}, ${match[1]}`;
}

/** The mono-caps masthead form: "AUG 17 2026". */
export function reportDateCapsLabel(isoDate: string): string {
  const match = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return isoDate.toUpperCase();
  const month = MONTH_LABELS[Number(match[2]) - 1];
  if (!month) return isoDate.toUpperCase();
  return `${month.toUpperCase()} ${Number(match[3])} ${match[1]}`;
}

/** "PUBLISHED AUG 17 2026 · RECORDS THROUGH AUG 11 2026" — shelf and masthead. */
export function reportDatesLine(report: Pick<MoneyReport, 'publishedOn' | 'recordsThrough'>) {
  return `PUBLISHED ${reportDateCapsLabel(report.publishedOn)} · RECORDS THROUGH ${reportDateCapsLabel(report.recordsThrough)}`;
}

/** What search metadata and prepared share text may carry: the report's two dates. */
export function reportShareDescription(
  report: Pick<MoneyReport, 'publishedOn' | 'recordsThrough'>,
): string {
  return `Published ${reportDateLabel(report.publishedOn)} · records through ${reportDateLabel(report.recordsThrough)}.`;
}

/** The quiet identity line shown inside the Share panel. */
export function reportSharePanelDescription(report: Pick<MoneyReport, 'publishedOn'>): string {
  return `Published ${reportDateLabel(report.publishedOn)}`;
}
