import {
  authorNameOnly,
  bienniumEyebrow,
  billOverviewUrl,
  chiefAuthor,
  partyFull,
  plainBillSummary,
  plainKeyPoints,
  stageLabel,
  statusLabel,
} from './billDetail';
import {
  legislatorDisplayName,
  legislatorDistrictLine,
  splitOfficeAddress,
} from './legislatorProfile';
import { billNumberFromId, escapeHtml } from './share';

/**
 * The short factual snapshot that ships INSIDE the first server response for a
 * bill or a legislator (issue #1325, release 2 — decisions doc §8C).
 *
 * Release 1 gave every address its own title and description. This gives it
 * something to read. A search engine frequently ignores a supplied description
 * and writes its result text from what is visible on the page, so a body that
 * arrives empty has nothing to offer it; a reader whose JavaScript fails gets
 * nothing at all; and a broken app looks exactly like a blank page.
 *
 * The hard rule this file exists to keep: **every string here is a string the
 * app itself then draws.** There is no robot-only wording to keep honest. That
 * is why the values below come from the very helpers the screens call
 * (`plainKeyPoints`, `stageLabel`, `chiefAuthor`, `partyFull`, …) rather than
 * from anything written for this file, and why `pageSnapshot.test.ts` renders
 * the real components and asserts each line appears in what they produce.
 *
 * One deliberate exception, and it says less rather than more: a bill with no
 * plain-language short title is headed by its number alone. The app's own
 * heading falls back to the bill's statutory title, which is a paragraph of
 * legal cross-references that `.claude/rules/grounded-answers.md` rule 10 keeps
 * off the page.
 */

export interface SnapshotFact {
  label: string;
  /** One entry per displayed line — an address is several lines, not one. */
  lines: string[];
}

export interface SnapshotLink {
  label: string;
  href: string;
}

export interface PageSnapshot {
  /** The page's `<h1>`. */
  heading: string;
  /** The identifying line beneath it, e.g. `HF 719 · 2025–26 LEGISLATIVE SESSION`. */
  subheading: string;
  /** Heading above the prose block, worded as the app labels it. */
  bodyHeading: string;
  /** Bullets when `bodyIsList`, otherwise paragraphs. */
  body: string[];
  facts: SnapshotFact[];
  bodyIsList: boolean;
  links: SnapshotLink[];
}

function clean(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function fact(label: string, value: string | null | undefined): SnapshotFact[] {
  const lines = (value ?? '')
    .split('\n')
    .map((line) => clean(line))
    .filter(Boolean);
  return lines.length ? [{ label, lines }] : [];
}

// --- Bill ---

export interface BillSnapshotSource {
  id: string;
  session?: { name?: string | null } | null;
  current_status?: string | null;
  status_key?: string | null;
  official_url?: string | null;
  chief_sponsors?:
    | {
        name?: string | null;
        role?: string | null;
        slug?: string | null;
        chamber?: string | null;
        source_chamber?: string | null;
      }[]
    | null;
  ai_analysis?: {
    short_title?: string | null;
    summary?: string | null;
    key_points?: string[] | null;
  } | null;
}

/** `house` / `HF 719` → `House`. The same normalisation the app's mapper applies. */
function billChamber(value: string): 'House' | 'Senate' {
  const normalized = value.trim().toLowerCase();
  return normalized === 'house' || normalized.startsWith('hf') ? 'House' : 'Senate';
}

/**
 * A sponsor's chamber stays absent when the record does not carry one, because
 * `chiefAuthor` filters to the bill's own chamber only when it can, and guessing
 * here would pick a different author than the profile shows.
 */
function sponsorChamber(value: string | null | undefined): 'House' | 'Senate' | undefined {
  return value?.trim() ? billChamber(value) : undefined;
}

export function billPageSnapshot(bill: BillSnapshotSource): PageSnapshot {
  const identifier = billNumberFromId(bill.id);
  const shortTitle = clean(bill.ai_analysis?.short_title);
  const eyebrow = bienniumEyebrow(bill.id, bill.session?.name ?? undefined);
  const keyPoints = plainKeyPoints(bill.ai_analysis?.key_points ?? undefined);
  const summary = plainBillSummary(bill.ai_analysis?.summary ?? null);

  const sponsors = (bill.chief_sponsors ?? []).map((sponsor) => ({
    name: sponsor.name ?? '',
    role: sponsor.role ?? '',
    slug: sponsor.slug ?? undefined,
    chamber: sponsorChamber(sponsor.chamber ?? sponsor.source_chamber),
  }));
  const author = chiefAuthor({ sponsors, chamber: billChamber(identifier) });
  const authorName = author ? authorNameOnly(author.name) : '';

  const overview = billOverviewUrl(bill.official_url ?? undefined);

  return {
    heading: shortTitle || identifier,
    subheading: [identifier, eyebrow].filter(Boolean).join(' · '),
    bodyHeading: keyPoints.length ? 'Key points' : 'Summary',
    body: keyPoints.length ? keyPoints : summary ? [summary] : [],
    bodyIsList: keyPoints.length > 0,
    facts: [
      ...fact('Where it stands', stageLabel(statusLabel(bill.status_key, bill.current_status))),
      ...fact('Chief author', authorName),
    ],
    links: [
      ...(overview ? [{ label: 'Bill overview', href: overview }] : []),
      ...(author?.slug && authorName
        ? [{ label: authorName, href: `/legislators/${encodeURIComponent(author.slug)}` }]
        : []),
      { label: 'Bills', href: '/bills' },
    ],
  };
}

// --- Legislator ---

export interface LegislatorSnapshotSource {
  full_name?: string | null;
  current_service?: {
    chamber?: string | null;
    party?: string | null;
    district?: { code?: string | null } | null;
    phone?: string | null;
    office_address?: string | null;
    profile_url?: string | null;
  } | null;
  committees?: { name?: string | null; role?: string | null }[] | null;
}

export function legislatorPageSnapshot(legislator: LegislatorSnapshotSource): PageSnapshot {
  const service = legislator.current_service ?? {};
  const chamber = (service.chamber ?? '').toLowerCase() === 'house' ? 'House' : 'Senate';
  const displayName = legislatorDisplayName(legislator.full_name ?? '', chamber);
  const districtLine = legislatorDistrictLine(chamber, service.district?.code ?? undefined);
  const committees = (legislator.committees ?? [])
    .map((committee) => {
      const name = clean(committee.name);
      const role = clean(committee.role);
      return name && role ? `${name} (${role})` : name;
    })
    .filter(Boolean);
  const office = splitOfficeAddress(service.office_address ?? '');

  return {
    heading: displayName,
    subheading: [districtLine, partyFull(service.party ?? undefined)].filter(Boolean).join(' · '),
    bodyHeading: 'Committees',
    body: committees.length ? committees : ['No current committee assignments on record.'],
    bodyIsList: committees.length > 0,
    facts: [
      ...fact('Leadership', office.leadership),
      ...fact('Capitol office', office.address),
      ...fact('Phone', service.phone),
    ],
    links: [
      ...(service.profile_url
        ? [{ label: `Official ${chamber} profile`, href: service.profile_url }]
        : []),
      { label: 'Legislators', href: '/legislators' },
    ],
  };
}

// --- Rendering ---

/**
 * The snapshot as HTML. Every value is escaped: 10,471 AI-written summaries are
 * 10,471 chances for one stray character to break the markup.
 *
 * The class names are styled by the static block in
 * `apps/frontend/public/index.html`, so a page carries no per-address CSS.
 */
export function renderPageSnapshot(snapshot: PageSnapshot): string {
  const body = snapshot.body.length
    ? snapshot.bodyIsList
      ? `<ul class="ps-list">${snapshot.body.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`
      : snapshot.body.map((item) => `<p class="ps-prose">${escapeHtml(item)}</p>`).join('')
    : '';

  const facts = snapshot.facts.length
    ? `<dl class="ps-facts">${snapshot.facts
        .map(
          (item) =>
            `<dt>${escapeHtml(item.label)}</dt><dd>${item.lines.map((line) => escapeHtml(line)).join('<br />')}</dd>`,
        )
        .join('')}</dl>`
    : '';

  const links = snapshot.links.length
    ? `<nav class="ps-links">${snapshot.links
        .map((link) => `<a href="${escapeHtml(link.href)}">${escapeHtml(link.label)}</a>`)
        .join('')}</nav>`
    : '';

  return [
    '<div class="page-snapshot">',
    '<div class="ps-inner">',
    `<h1>${escapeHtml(snapshot.heading)}</h1>`,
    snapshot.subheading ? `<p class="ps-sub">${escapeHtml(snapshot.subheading)}</p>` : '',
    body ? `<h2>${escapeHtml(snapshot.bodyHeading)}</h2>${body}` : '',
    facts,
    links,
    '</div>',
    '</div>',
  ]
    .filter(Boolean)
    .join('');
}

/**
 * The markers inside `<div id="root">` in `apps/frontend/public/index.html`.
 *
 * The snapshot goes INSIDE the app's own mount point on purpose. React clears
 * that element's existing children on its first render, so the app replacing the
 * snapshot is the same single browser paint as the app appearing — there is no
 * moment where both are on screen, and no extra script to run. It also means a
 * failed or blocked program leaves the snapshot standing, which is the whole
 * point of putting real text there.
 */
export const SNAPSHOT_MARKER_START = '<!--alethical:page-snapshot-->';
export const SNAPSHOT_MARKER_END = '<!--/alethical:page-snapshot-->';

export function injectPageSnapshot(shellHtml: string, snapshotHtml: string): string {
  const start = shellHtml.indexOf(SNAPSHOT_MARKER_START);
  const end = shellHtml.indexOf(SNAPSHOT_MARKER_END);
  if (start < 0 || end < 0 || end < start) {
    throw new Error('page shell is missing its snapshot markers');
  }
  return (
    shellHtml.slice(0, start + SNAPSHOT_MARKER_START.length) + snapshotHtml + shellHtml.slice(end)
  );
}
