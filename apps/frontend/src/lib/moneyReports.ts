/**
 * The published-research registry for the campaign money section
 * (`.claude/rules/grounded-answers.md` rule 13, signed reports).
 *
 * A signed report is the one surface allowed to add figures up across members,
 * cite filing bodies beyond Minnesota's Campaign Finance Board, and define
 * derived classifications — under rule 13's conditions. This file holds the
 * machinery for that surface. Posting a report means adding its entry to
 * `PUBLISHED_REPORTS`: the report page, the share preview, the shelf, the money
 * landing and the sitemap all read this registry. A report's `listed` flag
 * decides which of those it reaches, so posting and listing stay separate.
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
  | { kind: 'externalLink'; text: string; href: string }
  | {
      /**
       * A corrected figure (rule 13: a corrected figure stays readable — struck
       * through and dated — while leaving metadata entirely). The earlier figure
       * renders struck through, the current one beside it, then the dated label.
       */
      kind: 'correctedFigure';
      was: string;
      now: string;
      /** e.g. "CORRECTED SEP 2 2026" */
      datedLabel: string;
    };

export type ReportBlock =
  | { kind: 'paragraph'; runs: ReportInline[] }
  | { kind: 'bullets'; items: ReportInline[][] }
  /** A small table the report's prose introduces. Plain strings: a table states
   * filed figures, so it carries no links, no emphasis and no derived label. */
  | { kind: 'table'; columns: string[]; rows: string[][] };

export interface ReportSection {
  /** Anchor id, unique in the report — the contents rail jumps to it. */
  anchor: string;
  /** The section heading, exactly as the report's text writes it. */
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
  /** Muted clarifying sentence after the source name. */
  note?: string;
  /** Outward link inside the note (e.g. to the FEC). Never an inward link the
   * site cannot honor yet. */
  noteLink?: { text: string; href: string };
}

export interface ReportCorrection {
  /** e.g. "CORRECTED SEP 2 2026" */
  datedLabel: string;
  /** One banner sentence saying what moved. The figure itself also carries a
   * correctedFigure run where it appears. */
  note: string;
}

export interface MoneyReport {
  /** URL slug under /reports/. */
  slug: string;
  /**
   * Whether the report is listed publicly (rule 13's publishing order). An
   * unlisted report renders at its own address for anyone given the link and is
   * absent from the shelf, the landing, the sitemap and search engines. Listing
   * is Eugene's decision, made once the figure check has resolved.
   */
  listed: boolean;
  title: string;
  /** Masthead and shelf standfirst. Never appears in share previews (rule 13:
   * share previews carry title and dates only). */
  dek: string;
  /**
   * The byline line, mono caps. A report Alethical publishes in its own name is
   * authored by "ALETHICAL" (rule 13's publishing order, point 8); a report
   * signed by a person carries that person's name. Never an invented name.
   */
  authorLine: string;
  /** ISO date the report was published, e.g. "2026-08-17". */
  publishedOn: string;
  /** ISO date the records run through, e.g. "2026-08-11". */
  recordsThrough: string;
  /** Every filing body the report used, named in the masthead (rule 13). */
  filingBodies: string[];
  /**
   * Set when the report draws a figure from records Alethical does not hold, so
   * that figure has no records-through date. The masthead names it rather than
   * leaving it blank or lending it another figure's date (rule 13's publishing
   * order, point 11).
   */
  undatedRecordsNote?: string;
  /** The boxed opening summary ("THE SHORT VERSION"). */
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
 * Every posted report, newest first. A posted report has a page at its own
 * address; whether it is *listed* is a separate flag, so the two halves of rule
 * 13's publishing order stay separate in code as well as in prose.
 */
export const PUBLISHED_REPORTS: MoneyReport[] = [MONEY_ONLY_GOES_ONE_WAY];

/**
 * The reports a reader can find without the link: the shelf, the money landing
 * and the sitemap all read this, so an unlisted report is absent from every one
 * of them by construction rather than by each caller remembering.
 */
export function publishedReports(): MoneyReport[] {
  return PUBLISHED_REPORTS.filter((report) => report.listed);
}

/**
 * Every posted report, listed or not. The router, the document title, the report
 * screen and the page function read this, because an unlisted report still
 * renders for anyone given its address.
 */
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

/**
 * What a share preview may carry for a report: its title and its two dates,
 * nothing else (rule 13 — report claims and derived labels appear in no
 * social-share preview or metadata).
 */
export function reportShareDescription(
  report: Pick<MoneyReport, 'publishedOn' | 'recordsThrough'>,
): string {
  return `Published ${reportDateLabel(report.publishedOn)} · records through ${reportDateLabel(report.recordsThrough)}.`;
}
