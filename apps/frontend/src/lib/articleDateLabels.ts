/** Date and share wording travels with article screens, not the startup address index. */
import type { PieceIndexEntry } from './researchIndex';

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
export function isoDateLabel(isoDate: string): string {
  const match = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return isoDate;
  const month = MONTH_LABELS[Number(match[2]) - 1];
  if (!month) return isoDate;
  return `${month} ${Number(match[3])}, ${match[1]}`;
}

/**
 * The mono-caps card form: "AUG 20, 2026". The comma is Design's, and it is the
 * only place the 2 forms differ: a card's date sits inside a sentence of mono
 * caps beside the minutes, where the comma is what stops the day and the year
 * running together.
 */
export function isoDateCommaCapsLabel(isoDate: string): string {
  return isoDateLabel(isoDate).toUpperCase();
}

/** The mono-caps masthead form: "AUG 17 2026". */
export function isoDateCapsLabel(isoDate: string): string {
  const match = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return isoDate.toUpperCase();
  const month = MONTH_LABELS[Number(match[2]) - 1];
  if (!month) return isoDate.toUpperCase();
  return `${month.toUpperCase()} ${Number(match[3])} ${match[1]}`;
}

/** What search metadata and prepared share text may carry: the piece's two dates. */
export function researchShareDescription(
  piece: Pick<PieceIndexEntry, 'publishedOn' | 'recordsThrough'>,
): string {
  return `Published ${isoDateLabel(piece.publishedOn)} · records through ${isoDateLabel(piece.recordsThrough)}.`;
}

const FULL_MONTH_LABELS = [
  'JANUARY',
  'FEBRUARY',
  'MARCH',
  'APRIL',
  'MAY',
  'JUNE',
  'JULY',
  'AUGUST',
  'SEPTEMBER',
  'OCTOBER',
  'NOVEMBER',
  'DECEMBER',
] as const;

/**
 * "2026-08-27" → "AUGUST 2026". Month and year only: the day a guide was written
 * is precision nobody needs about a piece that explains a standing rule, and
 * parsed by hand for the same reason `isoDateLabel` is, so the label cannot shift
 * a month with the reader's time zone.
 */
export function isoMonthYearCapsLabel(isoDate: string): string {
  const match = isoDate.match(/^(\d{4})-(\d{2})/);
  if (!match) return isoDate.toUpperCase();
  const month = FULL_MONTH_LABELS[Number(match[2]) - 1];
  if (!month) return isoDate.toUpperCase();
  return `${month} ${match[1]}`;
}

/**
 * "PUBLISHED AUGUST 2026" until somebody re-checks the piece, "CHECKED MARCH 2027"
 * from then on. Same slot, 1 word swapped, and never 2 dates (§4.4).
 */
export function pieceWrittenLine(
  piece: Pick<PieceIndexEntry, 'publishedOn' | 'checkedOn'>,
): string {
  return piece.checkedOn
    ? `CHECKED ${isoMonthYearCapsLabel(piece.checkedOn)}`
    : `PUBLISHED ${isoMonthYearCapsLabel(piece.publishedOn)}`;
}

/** The sentence-case form of the same slot, for a share preview and a page description. */
export function pieceWrittenSentence(
  piece: Pick<PieceIndexEntry, 'publishedOn' | 'checkedOn'>,
): string {
  const line = pieceWrittenLine(piece);
  const [word, ...rest] = line.split(' ');
  const month = rest[0] ? `${rest[0][0]}${rest[0].slice(1).toLowerCase()}` : '';
  return `${word[0]}${word.slice(1).toLowerCase()} ${[month, rest[1]].filter(Boolean).join(' ')}.`;
}

/** What a piece's own page metadata and prepared share text may carry: its dates. */
export function pieceShareDescription(
  piece: Pick<PieceIndexEntry, 'traits' | 'publishedOn' | 'recordsThrough' | 'checkedOn'>,
): string {
  return piece.traits.research ? researchShareDescription(piece) : pieceWrittenSentence(piece);
}
