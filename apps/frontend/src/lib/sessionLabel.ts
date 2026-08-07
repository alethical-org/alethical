// One copy convention for every legislative-year range shown on screen.
//
// The API sends the session number and both years. Old cached responses may only
// carry the formal name, so every formatter can still read that name without
// making callers reimplement the range rule.

export interface SessionDisplaySource {
  name?: string;
  sessionNumber?: number;
  yearStart?: number;
  yearEnd?: number;
}

type SessionDisplayInput = string | SessionDisplaySource;

export function formatLegislativeYearRange(yearStart: number, yearEnd: number): string {
  if (yearStart === yearEnd) return String(yearStart);
  return `${yearStart}–${String(yearEnd).slice(-2)}`;
}

export function normalizeLegislativeYearRanges(value: string): string {
  return value.replace(/\b(20\d{2})\s*[-–]\s*(20\d{2})\b/g, (_match, start, end) =>
    formatLegislativeYearRange(Number(start), Number(end)),
  );
}

function sessionName(session: SessionDisplayInput): string {
  return typeof session === 'string' ? session : (session.name ?? '');
}

function sessionYears(session: SessionDisplayInput): [number, number] | null {
  if (typeof session !== 'string' && session.yearStart != null && session.yearEnd != null) {
    return [session.yearStart, session.yearEnd];
  }
  const match = sessionName(session).match(/\b(20\d{2})\b(?:\s*[-–]\s*(20\d{2}))?/);
  return match ? [Number(match[1]), Number(match[2] ?? match[1])] : null;
}

function ordinal(value: number): string {
  const mod100 = value % 100;
  const suffix =
    mod100 >= 11 && mod100 <= 13
      ? 'th'
      : value % 10 === 1
        ? 'st'
        : value % 10 === 2
          ? 'nd'
          : value % 10 === 3
            ? 'rd'
            : 'th';
  return `${value}${suffix}`;
}

export function formatSessionLabel(session: SessionDisplayInput): string {
  const name = sessionName(session);
  const years = sessionYears(session);
  if (!years) return normalizeLegislativeYearRanges(name);
  const range = formatLegislativeYearRange(years[0], years[1]);

  // A special session is a separate session whose bill numbers start over, so
  // those words must stay visible instead of collapsing into the biennium label.
  const special = name.match(/\b(\w+)\s+special session\b/i);
  if (special) return `${range} ${special[1]} Special Session`;
  return `${range} Legislative Session`;
}

export function formatLegislatureLabel(session: SessionDisplayInput): string {
  const name = sessionName(session);
  const years = sessionYears(session);
  const number =
    typeof session === 'string'
      ? Number(name.match(/\b(\d+)(?:st|nd|rd|th)\s+Legislature\b/i)?.[1])
      : (session.sessionNumber ??
        Number(name.match(/\b(\d+)(?:st|nd|rd|th)\s+Legislature\b/i)?.[1]));

  if (years && Number.isFinite(number)) {
    return `${ordinal(number)} Legislature (${formatLegislativeYearRange(years[0], years[1])})`;
  }
  return normalizeLegislativeYearRanges(name)
    .replace(/\s+Regular Session\s*$/i, '')
    .trim();
}

export const SESSION_LABEL_FALLBACK = 'Legislative Session';
