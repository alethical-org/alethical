import { Bill, BillAction, BillVersion, IndividualVote, VoteEvent } from '../data/types';
import { normalizeMotion } from './motionNormalize';

// Shared logic for the redesign Bill Detail page (screens/redesign/BillDetailScreen).
// Kept framework-free (pure functions) so it is unit-testable and reused by the tab
// components. Design intent: design_handoff_bill_profile_web / NEXT-bill-detail-spec.md.

export type StageTone = 'neutral' | 'green' | 'vetoed';

// 5-stage legislative progress derived from the status text — client-side so the
// rail's WHERE IT STANDS bar always agrees with the status label (same rule as the
// list card's ProgressBar, components/search/BillResultCard.tsx billStage).
// Stages: Introduced 0 · In Committee 1 · Passed House 2 · Passed Senate 3 · Signed 4.
export function billStage(status: string): { index: number; tone: StageTone } {
  const s = (status || '').toLowerCase();
  if (s.includes('veto')) return { index: 4, tone: 'vetoed' };
  if (s.includes('signed') || s.includes('law') || s.includes('enacted'))
    return { index: 4, tone: 'green' };
  if (s.includes('senate')) return { index: 3, tone: 'neutral' };
  if (s.includes('house')) return { index: 2, tone: 'neutral' };
  if (s.includes('committee')) return { index: 1, tone: 'neutral' };
  return { index: 0, tone: 'neutral' };
}

// Spell out the party code for the rail's labeled "Party" field. Independent is
// the fallback so an edge-case member never breaks the label (spec §Chief author).
export function partyFull(code: string | undefined): string {
  const c = (code || '').toUpperCase();
  if (c === 'DFL' || c === 'D') return 'Democratic-Farmer-Labor';
  if (c === 'R' || c === 'REPUBLICAN') return 'Republican';
  return 'Independent';
}

// SF -> Senate, HF -> House. Used for the rail section label ("SENATE BILL" /
// "HOUSE BILL"), which teaches SF=Senate / HF=House (spec §Rail "THIS BILL").
export function chamberBillLabel(identifier: string): string {
  const prefix = (identifier || '').trim().slice(0, 2).toUpperCase();
  if (prefix === 'SF') return 'SENATE BILL';
  if (prefix === 'HF') return 'HOUSE BILL';
  return 'BILL';
}

// Human status label shown first in WHERE IT STANDS. Keeps the product's plain
// vocabulary ("In Committee", "Signed into Law", "Vetoed").
export function stageLabel(status: string): string {
  const s = (status || '').toLowerCase();
  if (s.includes('veto')) return 'Vetoed';
  if (s.includes('signed') || s.includes('enacted')) return 'Signed into Law';
  if (s.includes('law')) return 'Signed into Law';
  if (s.includes('passed senate')) return 'Passed Senate';
  if (s.includes('passed house')) return 'Passed House';
  if (s.includes('committee')) return 'In Committee';
  if (s.includes('introduced') || s.includes('proposed')) return 'Introduced';
  return status || 'Introduced';
}

// ===========================================================================
// Actions timeline: normalize raw Minnesota Revisor status records into the
// design's curated, plain-language timeline (spec: NEXT-bill-detail-spec.md
// §Actions tab; issue #552). buildActionTimeline() is the single entry point;
// it is pure and framework-free so it can be unit-verified and (later) shared
// with mobile. All raw-phrasing knowledge lives in the ACTION_RULES table so
// titles stay consistent across bills.
// ===========================================================================

export type TimelineDot = 'green' | 'red' | 'vote' | 'plain' | 'scheduled';

type EventKind =
  | 'signing' // governor approval / secretary of state / chapter — collapsed to one
  | 'passage' // a chamber's floor passage / repassage (recorded vote when tallied)
  | 'reading' // bare "third reading" — folded into its passage cluster
  | 'effective' // statutory effective date (may be future → scheduled)
  | 'veto'
  | 'notAdopted'
  | 'motionFailed'
  | 'authorAdd' // "Author(s) added: …" — collapsed into one muted group row
  | 'chiefAuthor' // chief-author change — stays its own normal row (never grouped)
  | 'procedural'; // everything else (introduced, referral, committee report, motions…)

// A term shown in the timeline that the plain-language key should gloss. The
// key is built from the terms actually present (point 7), so every gloss below
// only appears when a row surfaces it.
const GLOSS: Record<string, string> = {
  Introduced: "a bill's formal introduction, by title, then assignment to a committee.",
  Referred: 'assigned to a committee for review.',
  're-referred': 'sent to another committee for more review.',
  'Committee report': 'a committee recommends what should happen to the bill.',
  'Second reading': 'a procedural step placing a bill on general orders for a floor vote.',
  'Third reading': 'the final floor vote to pass a bill in a chamber.',
  'Amended on the floor': 'the full chamber changed the bill text during a floor session.',
  Substituted: "a chamber took up the other chamber's companion bill in place of its own.",
  Recalled: 'the chamber pulled a bill back from the floor to send it to committee again.',
  Concurred: "one chamber accepted the other chamber's changes, avoiding a conference.",
  'Conference committee':
    'a small group from both chambers that reconciles the differing House and Senate versions.',
  Repassed: 'passed again after the two chambers reconciled their amendments.',
  'Presented to the Governor': 'the finished bill was delivered to the Governor to sign or veto.',
  'Signed by the Governor':
    'the Governor approved the bill; it becomes law as a numbered chapter of the session laws.',
  'Effective date': 'when the new law starts to apply.',
  Veto: 'the Governor rejected the bill; an override needs a two-thirds vote in each chamber.',
};

type Classified = { kind: EventKind; title: string };

// Ordered clerk-phrasing → plain-language rules. First match wins, so put the
// specific patterns before the general ones. `text` is the raw action_text;
// `desc` the raw action_description (a name list, committee name, date, or
// cross-reference). Rules return the plain-language title and the event kind;
// the plain-language key is derived separately (terms in GLOSS whose word
// appears in a shown title), so rules carry no gloss tags.
type Rule = {
  test: (low: string, desc: string) => boolean;
  build: (text: string, desc: string) => Classified;
};

// Split a raw author name-list ("Dippel, Zeleznikar, and Bakeberg") into names,
// re-joining a trailing initial that a comma split off ("Lee, K." must stay one
// name, not become "Lee" + "K.").
function splitNames(desc: string): string[] {
  const parts = desc
    .replace(/\band\b/gi, ',')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (const p of parts) {
    if (/^[A-Z]\.?$/.test(p) && out.length) out[out.length - 1] += `, ${p}`;
    else out.push(p);
  }
  return out;
}

const ACTION_RULES: Rule[] = [
  {
    test: (l) => l.includes('veto'),
    build: () => ({ kind: 'veto', title: 'Vetoed by the Governor' }),
  },
  // --- Signing (all three source rows collapse into one enacted row) ---
  {
    test: (l) => /governor'?s? (?:action )?approval|governor approval/.test(l),
    build: () => ({ kind: 'signing', title: 'Signed by the Governor' }),
  },
  {
    test: (l) => l.includes('secretary of state'),
    build: () => ({ kind: 'signing', title: 'Filed with the Secretary of State' }),
  },
  {
    test: (l) => l === 'chapter number',
    build: () => ({ kind: 'signing', title: 'Signed into law' }),
  },
  {
    test: (l) => /present(?:ed|ment)/.test(l),
    build: () => ({
      kind: 'procedural',
      title: 'Presented to the Governor',
    }),
  },
  {
    test: (l) => l.startsWith('effective date'),
    build: (_t, desc) => {
      const isDate = /\d{1,2}\/\d{1,2}\/\d{2,4}/.test(desc);
      const title = desc && !isDate ? `Effective date — ${desc}` : 'Effective date';
      return { kind: 'effective', title };
    },
  },
  // --- Floor passage / repassage (recorded vote when it carries a tally) ---
  {
    test: (l) =>
      /bill was (?:re)?passed/.test(l) ||
      /third reading.*passed/.test(l) ||
      /\brepassed?\b/.test(l) ||
      /adopted .*report.*(?:and )?repassed/.test(l),
    build: (text) => {
      const asAmended = /as amended/i.test(text);
      const repass = /\brepass/i.test(text);
      return {
        kind: 'passage',
        // Chamber is filled in later from the tally size ("Passed the House …").
        title: `${repass ? 'Repassed' : 'Passed'}, third reading${asAmended ? ', as amended' : ''}`,
      };
    },
  },
  {
    // Bare "third reading" — folded into the adjacent passage cluster.
    test: (l) => /^third reading/.test(l),
    build: (text) => ({
      kind: 'reading',
      title: /as amended/i.test(text) ? 'Third reading, as amended' : 'Third reading',
    }),
  },
  // --- Authors ---
  {
    test: (l) => /chief author (?:stricken|changed|added)/.test(l),
    build: (text, desc) => {
      const low = text.toLowerCase();
      if (low.includes('stricken'))
        return {
          kind: 'chiefAuthor',
          title: desc ? `Chief author changed to ${desc}` : 'Chief author changed',
        };
      return {
        kind: 'chiefAuthor',
        title: desc ? `Chief author changed to ${desc}` : 'Chief author changed',
      };
    },
  },
  {
    test: (l) => /authors?\s+added/.test(l),
    build: (_t, desc) => ({
      kind: 'authorAdd',
      title: desc ? `Co-author added — ${splitNames(desc).join(', ')}` : 'Co-author added',
    }),
  },
  // --- Committee / referral / calendar ---
  {
    test: (l) => /motion to recall and re-?refer/.test(l),
    build: () => ({
      kind: 'procedural',
      title: 'Recalled and sent back to committee',
    }),
  },
  {
    test: (l) => /comm(?:ittee)? report/.test(l),
    build: (text) => {
      const asAmended = /amend/i.test(text);
      const reRefer = /re-?refer/i.test(text);
      const subst = /subst|substitut/i.test(text);
      let title = 'Committee report — recommends passing';
      if (asAmended) title += ', as amended';
      if (reRefer) title += ', then referred to another committee';
      if (subst) title = 'Committee report — companion bill substituted, sent to the floor';
      return { kind: 'procedural', title };
    },
  },
  {
    test: (l) => /re-?refer/.test(l),
    build: () => ({
      kind: 'procedural',
      title: 'Re-referred to another committee',
    }),
  },
  {
    test: (l) => /introduction and first reading/.test(l),
    build: () => ({
      kind: 'procedural',
      title: 'Introduced and referred to a committee',
    }),
  },
  {
    test: (l) => /^first reading|^introduced/.test(l),
    build: () => ({ kind: 'procedural', title: 'Introduced' }),
  },
  {
    test: (l) => /^referred to/.test(l),
    build: () => ({ kind: 'procedural', title: 'Referred to a committee' }),
  },
  {
    test: (l) => /^second reading/.test(l),
    build: () => ({ kind: 'procedural', title: 'Second reading' }),
  },
  // --- Floor amendments ---
  {
    test: (l) => /special order:?\s*amended|^amended$|^amendments? (?:offered|adopted)/.test(l),
    build: (text) => ({
      kind: 'procedural',
      title: /offered/i.test(text) ? 'Amendments offered on the floor' : 'Amended on the floor',
    }),
  },
  // --- Between-chamber reconciliation ---
  {
    test: (l) =>
      /not concur|refuses? to concur|not identical/.test(l) && /conference|substitut/.test(l),
    build: () => ({
      kind: 'procedural',
      title: 'Declined the other chamber’s changes — conference committee requested',
    }),
  },
  {
    test: (l) => /bills? not identical.*substitut/.test(l),
    build: () => ({
      kind: 'procedural',
      title: 'Companion bill substituted for this file',
    }),
  },
  {
    test: (l) => /concur/.test(l),
    build: () => ({
      kind: 'procedural',
      title: 'Concurred — accepted the other chamber’s changes',
    }),
  },
  {
    test: (l) => /conference committee|accedes|\bcc report\b|\bhcc\b|conferees/.test(l),
    build: (text) => {
      const low = text.toLowerCase();
      let title = 'Conference committee step';
      if (/conferees/.test(low)) title = 'Conference committee members named';
      else if (/accedes/.test(low)) title = 'Agreed to a conference committee';
      else if (/report/.test(low)) title = 'Conference committee report';
      return { kind: 'procedural', title };
    },
  },
  {
    test: (l) => /returned from (house|senate)/.test(l),
    build: (text) => {
      const from = /senate/i.test(text) ? 'Senate' : 'House';
      return {
        kind: 'procedural',
        title: `Returned from the ${from} with amendments`,
      };
    },
  },
  {
    test: (l) => /received from (house|senate)/.test(l),
    build: (text) => {
      const from = /house/i.test(text) ? 'House' : 'Senate';
      return { kind: 'procedural', title: `Received from the ${from}` };
    },
  },
  // --- Calendar / floor scheduling ---
  {
    test: (l) =>
      /rule 1\.21|placed on calendar|general (?:orders|register)|calendar for the day/.test(l),
    build: () => ({
      kind: 'procedural',
      title: 'Placed on the calendar for a floor vote',
    }),
  },
  // --- Motions ---
  {
    test: (l) =>
      /motion.*(?:not prevail|failed|lost|rejected)|(?:not prevail|failed|lost|rejected).*motion/.test(
        l,
      ),
    build: () => ({ kind: 'motionFailed', title: 'Motion failed' }),
  },
  {
    test: (l) => /motion for reconsideration/.test(l),
    build: (_t, desc) => ({
      kind: 'procedural',
      title: desc ? `Motion to reconsider the ${desc}` : 'Motion to reconsider',
    }),
  },
  {
    test: (l) => /motion prevailed|motion adopted|motion to/.test(l),
    build: () => ({ kind: 'procedural', title: 'Motion adopted' }),
  },
  {
    test: (l) => /not adopted/.test(l),
    build: () => ({ kind: 'notAdopted', title: 'Amendment not adopted' }),
  },
];

// Humanize an unmatched raw label defensively: strip clerk prefixes/codes so a
// row never leaks "Comm report:" / "Rule 45" / "subst." even without a rule.
function humanizeFallback(text: string): string {
  let s = text
    .replace(/^comm(?:ittee)?\s+report:?\s*/i, 'Committee report — ')
    .replace(/\brule\s+\d+[.\d]*[- ]?/gi, '')
    .replace(/\bsubst\.?\b/gi, 'substituted')
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (s) s = s.charAt(0).toUpperCase() + s.slice(1);
  return s || text;
}

function classify(text: string, desc: string): Classified {
  const low = (text || '').toLowerCase();
  for (const rule of ACTION_RULES) {
    if (rule.test(low, desc || '')) return rule.build(text, desc || '');
  }
  return { kind: 'procedural', title: humanizeFallback(text) };
}

// House ≈ 134 seats, Senate 67 — a full-chamber floor-passage tally is decisive:
// total > 100 → House, otherwise Senate. Committee/motion counts never label a
// row, so this is only ever asked of a recorded passage vote (point 3).
function chamberFromTally(tally: string | undefined): 'House' | 'Senate' | undefined {
  if (!tally) return undefined;
  const m = tally.match(/(\d+)\D+(\d+)/);
  if (!m) return undefined;
  const total = Number(m[1]) + Number(m[2]);
  if (total > 100) return 'House';
  if (total > 0) return 'Senate';
  return undefined;
}

export interface TimelineRow {
  id: string;
  date: string; // display date ("MAY 12, 2026"), or '' when the source had none
  dateRange?: string; // author groups spanning multiple days
  title: string;
  dot: TimelineDot;
  muted: boolean; // author-group treatment (quiet annotation, not a milestone)
  tally?: string; // en-dashed "134–0"; only real passage votes carry one
  authors?: string[]; // collapsed co-author names (author-group rows)
  showVotes: boolean;
  rollIdx: number | null;
}

type Norm = Classified & {
  idx: number;
  actionNumber: number;
  block: number; // chamber block (increments when action_number drops)
  rawDate: string;
  tally?: string;
  chapter?: string;
  authors?: string[];
  endDate?: string;
};

// Build the curated Actions timeline (newest first) from the raw feed.
// Pipeline: classify each row → collapse (authors, passage clusters, signing)
// → dedupe identical cross-chamber rows → order newest-first (dateless rows
// inherit a neighbor's date, never a fabricated displayed date) → render rows.
export function buildActionTimeline(
  actions: BillAction[],
  votes: VoteEvent[],
  now: Date,
): { rows: TimelineRow[]; glossary: Array<{ term: string; def: string }> } {
  // 1. Classify, preserving source order (chamber-grouped, ascending #). A DROP
  //    in action_number marks a new chamber, tracked as `block`.
  let block = 0;
  let prevNum = Number.NEGATIVE_INFINITY;
  const norm: Norm[] = actions.map((a, idx) => {
    const text = a.actionText ?? a.description ?? '';
    const desc = a.actionDescription ?? '';
    const c = classify(text, desc);
    const num = a.actionNumber ?? idx;
    if (num < prevNum) block += 1;
    prevNum = num;
    const chapMatch = desc.match(/chapter\s+(\d+)/i) || (/^\d+$/.test(desc) ? [null, desc] : null);
    return {
      ...c,
      idx,
      actionNumber: num,
      block,
      rawDate: a.date || '',
      tally: a.tally,
      chapter: c.kind === 'signing' && chapMatch ? (chapMatch[1] as string) : undefined,
    };
  });

  // 2a. Collapse contiguous author-add runs into one group row (point 4). A run
  //     is broken by any non-authorAdd row OR a chamber-block change (so a chief-
  //     author change never folds in, and a run never spans two chambers). A
  //     single add stays a one-name row.
  const grouped: Norm[] = [];
  for (let i = 0; i < norm.length; i++) {
    const item = norm[i];
    if (item.kind !== 'authorAdd') {
      grouped.push(item);
      continue;
    }
    const names: string[] = [];
    const startDate = item.rawDate;
    let endDate = item.rawDate;
    let j = i;
    // A run must be consecutive by action_number: a GAP means a real row sat
    // between the adds (even one the API dropped, e.g. a committee report with
    // no committee name), so the two adds are NOT contiguous and must not merge.
    let expectNum = item.actionNumber;
    while (
      j < norm.length &&
      norm[j].kind === 'authorAdd' &&
      norm[j].block === item.block &&
      norm[j].actionNumber === expectNum
    ) {
      const nm = (actions[norm[j].idx].actionDescription ?? '').trim();
      if (nm) names.push(...splitNames(nm));
      endDate = norm[j].rawDate || endDate;
      expectNum = norm[j].actionNumber + 1;
      j++;
    }
    grouped.push({ ...item, authors: names, rawDate: startDate, endDate });
    i = j - 1;
  }

  // 2b. Collapse floor-passage clusters (point 2): all reading / passage rows in
  //     the same chamber block on the same date become ONE passage row, keeping
  //     the recorded tally and labeling the chamber from it. (Not source-adjacent
  //     — a no-roll "House…repassed bill" summary and its tallied companion sit
  //     apart in the feed but are the same event.)
  const passKey = (r: Norm) => `${r.block}|${r.rawDate}`;
  const passRep = new Map<string, Norm>();
  for (const item of grouped) {
    if (item.kind !== 'passage' && item.kind !== 'reading') continue;
    const key = passKey(item);
    const prev = passRep.get(key);
    const tally = item.tally || prev?.tally;
    const repass = /repass/i.test(item.title) || /repass/i.test(prev?.title ?? '');
    const amended = /as amended/i.test(item.title) || /as amended/i.test(prev?.title ?? '');
    const chamber = chamberFromTally(tally);
    const verb = repass ? 'Repassed' : 'Passed';
    // Keep the earliest source row as the anchor (order/idx), prefer a tallied base.
    const base = prev && prev.idx < item.idx ? prev : item;
    passRep.set(key, {
      ...base,
      kind: 'passage',
      title: `${verb}${chamber ? ` the ${chamber}` : ''}, third reading${amended ? ', as amended' : ''}`,
      tally,
    });
  }
  const emitted = new Set<string>();
  const collapsedPassage: Norm[] = [];
  for (const item of grouped) {
    if (item.kind === 'passage' || item.kind === 'reading') {
      const key = passKey(item);
      if (!emitted.has(key)) {
        emitted.add(key);
        collapsedPassage.push(passRep.get(key)!);
      }
      continue;
    }
    collapsedPassage.push(item);
  }

  // 2c. Collapse ALL signing rows (they recur once per chamber journal) into a
  //     single enacted row "Signed by the Governor · Chapter N" (point 2).
  const signings = collapsedPassage.filter((r) => r.kind === 'signing');
  const merged = collapsedPassage.filter((r) => r.kind !== 'signing');
  if (signings.length) {
    const chapter = signings.map((s) => s.chapter).find(Boolean);
    // Anchor to the latest signing date (the governor-approval moment).
    const anchor = signings.reduce((a, b) =>
      (parseActionDate(b.rawDate)?.getTime() ?? 0) > (parseActionDate(a.rawDate)?.getTime() ?? 0)
        ? b
        : a,
    );
    merged.push({
      ...anchor,
      kind: 'signing',
      title: chapter ? `Signed by the Governor · Chapter ${chapter}` : 'Signed by the Governor',
    });
  }

  // 2d. Dedupe identical (title, date) rows the two chamber journals both record
  //     — "Presented to the Governor", conference-committee steps, etc. (point 2).
  const seenRow = new Set<string>();
  const deduped = merged.filter((r) => {
    const k = `${r.title}|${r.rawDate}`;
    if (seenRow.has(k)) return false;
    seenRow.add(k);
    return true;
  });

  // 3. Order newest-first. Dateless rows inherit the nearest dated neighbor in
  //    their chamber block, exactly like orderActionsForTimeline — used only for
  //    ordering, never displayed.
  const withKeys = assignOrderKeys(deduped);
  withKeys.sort((x, y) => y.key - x.key || x.item.idx - y.item.idx);

  // 4. Render rows.
  const rows: TimelineRow[] = withKeys.map(({ item }) => {
    const d = parseActionDate(item.rawDate);
    const upcoming = !!d && d > now;
    const hasTally = item.kind === 'passage' && !!item.tally;
    const rollIdx = hasTally
      ? rollIndexForAction({ tally: item.tally } as BillAction, votes)
      : null;
    // A passage row that maps to a recorded VoteEvent is titled via the SHARED
    // motionNormalize map (owned by the Votes tab, #557) so a given roll call
    // reads identically in both places (#560). Mirror the Votes card's exact
    // "{Chamber} · {title}" form — which also keeps the chamber label point 3
    // (#552) requires. Fall back to the tally-size chamber when the DB chamber
    // is absent. Unmatched passages keep the local ACTION_RULES title.
    let title = item.title;
    if (item.kind === 'passage' && rollIdx != null && votes[rollIdx]) {
      const v = votes[rollIdx];
      const norm = normalizeMotion({
        motionText: v.motion,
        resultText: v.result,
        chamber: v.chamber,
      });
      const chamber = v.chamber ?? chamberFromTally(item.tally);
      title = chamber ? `${chamber} · ${norm.title}` : norm.title;
    }
    return {
      id: `${item.idx}-${item.actionNumber}`,
      date: formatMonoDate(item.rawDate),
      dateRange:
        item.endDate && item.endDate !== item.rawDate
          ? `${formatMonoDate(item.rawDate)} – ${formatMonoDate(item.endDate)}`
          : undefined,
      title,
      dot: dotForRow(item.kind, upcoming, hasTally),
      muted: item.kind === 'authorAdd',
      tally: hasTally ? item.tally!.replace(/-/g, '–') : undefined,
      authors: item.kind === 'authorAdd' ? item.authors : undefined,
      showVotes: hasTally && !upcoming && rollIdx != null,
      rollIdx,
    };
  });

  // 5. Plain-language key = the glossary terms whose word actually appears in a
  //    shown title, sorted (point 7 — every glossed term appears in the feed and
  //    the substring test guarantees no term is glossed that isn't shown).
  const glossary = Object.keys(GLOSS)
    .filter((term) => rows.some((r) => r.title.toLowerCase().includes(term.toLowerCase())))
    .sort((a, b) => a.localeCompare(b))
    .map((term) => ({ term: term === 're-referred' ? 'Re-referred' : term, def: GLOSS[term] }));

  return { rows, glossary };
}

function dotForRow(kind: EventKind, upcoming: boolean, hasTally: boolean): TimelineDot {
  if (upcoming && (kind === 'signing' || kind === 'effective')) return 'scheduled';
  if (kind === 'signing' || kind === 'effective') return 'green';
  if (kind === 'veto' || kind === 'notAdopted' || kind === 'motionFailed') return 'red';
  // Only a passage that carries a recorded tally gets the black vote dot; a
  // tally-less "repassed" summary line renders procedural (point 6).
  if (kind === 'passage' && hasTally) return 'vote';
  return 'plain';
}

// Two-pass date inheritance (chamber-block aware) shared with
// orderActionsForTimeline — kept local to operate on the collapsed rows.
function assignOrderKeys<T extends { actionNumber: number; rawDate: string; idx: number }>(
  items: T[],
): Array<{ item: T; key: number }> {
  const n = items.length;
  const times = items.map((it) => parseActionDate(it.rawDate)?.getTime() ?? null);
  const key = new Array<number>(n).fill(NaN);
  let lastDated: number | null = null;
  let prevNum = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < n; i++) {
    const num = items[i].actionNumber;
    if (num < prevNum) lastDated = null;
    prevNum = num;
    if (times[i] != null) {
      key[i] = times[i]!;
      lastDated = times[i]!;
    } else if (lastDated != null) {
      key[i] = lastDated + 1;
    }
  }
  let nextDated: number | null = null;
  let nextNum = Number.POSITIVE_INFINITY;
  for (let i = n - 1; i >= 0; i--) {
    const num = items[i].actionNumber;
    if (num > nextNum) nextDated = null;
    nextNum = num;
    if (times[i] != null) nextDated = times[i]!;
    else if (Number.isNaN(key[i])) key[i] = nextDated != null ? nextDated - 1 : 0;
  }
  return items.map((item, i) => ({ item, key: key[i] }));
}

// Human eyebrow "SENATE · 2025–2026 LEGISLATIVE SESSION". The session biennium is
// derived from the bill id's year segment (94-2025-SF334 → 2025 → 2025–2026), since
// the detail payload carries no session label ("legislative" kept — educational).
export function bienniumEyebrow(chamber: string, billId: string): string {
  const m = (billId || '').match(/^\d+-(\d{4})-/);
  const year = m ? Number(m[1]) : NaN;
  const ch = (chamber || '').toUpperCase();
  if (!Number.isNaN(year)) {
    const start = year % 2 === 1 ? year : year - 1;
    return `${ch} · ${start}–${start + 1} LEGISLATIVE SESSION`;
  }
  return `${ch} · LEGISLATIVE SESSION`;
}

// The chief-author block renders the honorific as the grey ROW LABEL for the name
// (spelled out in full — never "Sen."/"Rep." here), so this returns the label text.
// Falls back to a neutral "Author" when the chamber is unknown, so the name row is
// never mislabeled with a chamber it doesn't have.
export function authorTitleLabel(chamber: string | undefined): string {
  if (chamber === 'Senate') return 'Senator';
  if (chamber === 'House') return 'Representative';
  return 'Author';
}

// The name is the row *value* and the only green link, so strip any honorific the
// served name may already carry ("Sen. Omar Fateh" -> "Omar Fateh") — the title
// lives in the label now.
export function authorNameOnly(name: string): string {
  return (name || '').trim().replace(/^(sen\.|rep\.|senator|representative)\.?\s+/i, '');
}

// The district row spells out the chamber in its LABEL ("Senate District" /
// "House District"), so the chamber is taught in plain words there rather than as an
// "SD" prefix on the value. Neutral "District" when the chamber is unknown.
export function districtRowLabel(chamber: string | undefined): string {
  if (chamber === 'Senate') return 'Senate District';
  if (chamber === 'House') return 'House District';
  return 'District';
}

// The bill-author sponsorship rows carry a placeholder district ("S-unknown" /
// "*-unknown", the two-row roster/author topology) — treat those as unknown so the
// rail hides the field instead of showing a broken value.
export function isKnownDistrict(district: string | undefined): boolean {
  return !!district && !/unknown/i.test(district);
}

// Format the district *value* for the CHIEF AUTHOR block. The chamber is carried by
// the row label (districtRowLabel), so the value is just the bare district number —
// "62" for a senator, "26A" for a House member (House codes carry the A/B letter,
// Senate codes are numeric). When the member's represented city is ingested (#551)
// it reads "Minneapolis (62)" / "Winona (26A)"; absent a city, the code alone is
// shown, so the block never displays a guessed city (grounded-answers). The served
// value is the district *label* ("District 51" / "SD 51" / "District 15B"); the
// number is parsed out. Falls back to the raw label when no code can be parsed, so
// an already-formatted or unexpected value is never mangled.
export function formatAuthorDistrict(
  district: string | undefined,
  city?: string | undefined,
): string {
  const label = (district || '').trim();
  const match = label.match(/(\d+[A-Za-z]?)/);
  if (!match) return label;
  const code = match[1].toUpperCase();
  const trimmedCity = (city || '').trim();
  return trimmedCity ? `${trimmedCity} (${code})` : code;
}

// Parse a date string that may be ISO ("2025-05-30"), a display date
// ("MAY 30, 2025" / "May 30, 2025"), or empty. Returns null when unparseable.
export function parseActionDate(value: string | undefined | null): Date | null {
  if (!value) return null;
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const d = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

// Order actions newest-first for the Actions timeline, keeping DATELESS rows
// adjacent to their sequence neighbors instead of stranding them at the top or
// bottom. Used by both the web (ActionsTab) and mobile (BillDetailScreen)
// timelines so they stay in sync.
//
// The API delivers actions grouped by chamber, each group ascending by
// action_number (backend Bill.actions order_by). action_number is per-chamber,
// so a DROP in actionNumber marks a new chamber. Dated rows sort by their own
// date. A dateless row inherits the date of the nearest dated row that PRECEDES
// it in its chamber's sequence (or the nearest FOLLOWING one, if it leads the
// chamber) — e.g. a "conference committee discharged" step or the "Effective
// date" milestone lands in the right day-cluster rather than at the epoch floor.
// The inherited date is used ONLY for ordering; the row's date column stays
// blank — we never fabricate a displayed date. A hair (+1ms) lifts a dateless
// row just above its same-day cluster, matching reverse-chron order (it happened
// after the dated row it follows). Rows with equal keys keep source order.
export function orderActionsForTimeline<T extends BillAction>(actions: T[]): T[] {
  const n = actions.length;
  const times = actions.map((a) => parseActionDate(a.date)?.getTime() ?? null);
  const key = new Array<number>(n).fill(NaN);

  // Forward pass: carry the last real date seen within the current chamber.
  let lastDated: number | null = null;
  let prevNum = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < n; i++) {
    const num = actions[i].actionNumber ?? i;
    if (num < prevNum) lastDated = null; // action_number dropped → new chamber
    prevNum = num;
    if (times[i] != null) {
      key[i] = times[i]!;
      lastDated = times[i]!;
    } else if (lastDated != null) {
      key[i] = lastDated + 1; // just above its day-cluster (it happened after)
    }
  }
  // Backward pass: a dateless row leading its chamber (no dated row precedes it)
  // borrows the nearest FOLLOWING date, minus a hair (it happened before it).
  let nextDated: number | null = null;
  let nextNum = Number.POSITIVE_INFINITY;
  for (let i = n - 1; i >= 0; i--) {
    const num = actions[i].actionNumber ?? i;
    if (num > nextNum) nextDated = null; // walking back into an earlier chamber
    nextNum = num;
    if (times[i] != null) nextDated = times[i]!;
    else if (Number.isNaN(key[i])) key[i] = nextDated != null ? nextDated - 1 : 0;
  }

  return actions
    .map((a, i) => ({ a, i, k: key[i] }))
    .sort((x, y) => y.k - x.k || x.i - y.i) // newest first; stable by source order
    .map((e) => e.a);
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

// Uppercase mono date for the timeline / meta ("MAY 30, 2025"). Falls back to the
// raw string when it can't be parsed so nothing is ever dropped silently.
export function formatMonoDate(value: string | undefined | null): string {
  const d = parseActionDate(value);
  if (!d) return (value || '').toUpperCase();
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

// Mixed-case date for prose ("Aug 1, 2025").
export function formatNiceDate(value: string | undefined | null): string {
  const d = parseActionDate(value);
  if (!d) return value || '';
  const m = MONTHS[d.getMonth()];
  return `${m.charAt(0)}${m.slice(1).toLowerCase()} ${d.getDate()}, ${d.getFullYear()}`;
}

// PASSED / FAILED from the roll's result text. Motion outcome, not bill outcome —
// a passed roll on a later-vetoed bill still reads PASSED (spec §Vetoed bills).
export function rollPassed(result: string): boolean {
  const s = (result || '').toLowerCase();
  if (s.includes('not') || s.includes('fail') || s.includes('lost') || s.includes('reject'))
    return false;
  return s.includes('pass') || s.includes('adopt') || s.includes('prevail') || s.includes('agree');
}

// --- Roll-call party blocks + crossover (spec §Votes) ---
// Production-correct derivation from REAL per-member votes joined to the roster's
// party. Crossover = a member voting against their OWN party's majority on THAT
// vote (majority computed per party from the actual votes, never hardcoded).

export type MemberVote = {
  legislatorId: string;
  name: string;
  party: 'DFL' | 'R' | 'I';
  vote: 'YES' | 'NO' | 'ABSENT';
  crossover: boolean;
};

export type PartyBlock = {
  party: 'DFL' | 'R' | 'I';
  label: string;
  seats: number;
  yes: number;
  no: number;
  absent: number;
  members: MemberVote[];
};

const PARTY_LABEL: Record<'DFL' | 'R' | 'I', string> = {
  DFL: 'Democratic-Farmer-Labor',
  R: 'Republican',
  I: 'Independent',
};

function normalizeParty(p: string | undefined): 'DFL' | 'R' | 'I' {
  const c = (p || '').toUpperCase();
  if (c === 'R' || c === 'REPUBLICAN') return 'R';
  if (c === 'DFL' || c === 'D' || c === 'DEMOCRAT' || c.includes('DEMOCRAT')) return 'DFL';
  return 'I';
}

// Group per-member votes into party blocks and mark crossovers against each
// party's own majority. Party + name are carried inline on each roll-call record
// (the /legislators list doesn't serve party), so no roster join is needed.
// Returns blocks ordered DFL, Republican, then any Independents (only when non-empty).
export function buildPartyBlocks(votes: IndividualVote[]): PartyBlock[] {
  const members: MemberVote[] = votes.map((v) => ({
    legislatorId: v.legislatorId,
    name: v.name || 'Unknown',
    party: normalizeParty(v.party),
    vote: v.vote,
    crossover: false,
  }));

  const parties: Array<'DFL' | 'R' | 'I'> = ['DFL', 'R', 'I'];
  const blocks: PartyBlock[] = parties.map((party) => {
    const mem = members.filter((m) => m.party === party);
    const yes = mem.filter((m) => m.vote === 'YES').length;
    const no = mem.filter((m) => m.vote === 'NO').length;
    const absent = mem.filter((m) => m.vote === 'ABSENT').length;
    // Majority side among this party's *voting* members; ties → no crossover flags.
    const majority: 'YES' | 'NO' | null = yes > no ? 'YES' : no > yes ? 'NO' : null;
    mem.forEach((m) => {
      if (majority && (m.vote === 'YES' || m.vote === 'NO') && m.vote !== majority) {
        m.crossover = true;
      }
    });
    return {
      party,
      label: PARTY_LABEL[party],
      seats: mem.length,
      yes,
      no,
      absent,
      members: mem.sort((a, b) => a.name.localeCompare(b.name)),
    };
  });

  // DFL + Republican always shown when present; Independents only when non-empty.
  return blocks.filter((b) => (b.party === 'I' ? b.seats > 0 : true));
}

// Dev-only sum-check (spec §Validation guard): each block's Yes+No+absent must
// equal its seats, and the party Yes totals must equal the recorded Yea. Surfaces
// impossible combinations instead of silently rendering a bad split.
export function validateRoll(
  blocks: PartyBlock[],
  breakdownYes: number,
  breakdownNo: number,
): void {
  if (!__DEV__) return;
  const yes = blocks.reduce((n, b) => n + b.yes, 0);
  const no = blocks.reduce((n, b) => n + b.no, 0);
  if (yes !== breakdownYes || no !== breakdownNo) {
    // eslint-disable-next-line no-console
    console.warn('[bill-detail] roll split mismatch', {
      blockYes: yes,
      blockNo: no,
      recordedYes: breakdownYes,
      recordedNo: breakdownNo,
    });
  }
}

// Does the bill's status make it enacted law (state-aware official-link wording)?
export function isLaw(status: string): boolean {
  const s = (status || '').toLowerCase();
  return s.includes('signed') || s.includes('enacted') || s.includes('law');
}

// State-aware document-link label (spec §Official-link naming rules). Verb is
// always "Read"; "Bill overview" is the only status-page link (owned elsewhere).
export function readLabel(status: string): string {
  return isLaw(status) ? 'Read the full law' : 'Read the bill text';
}

// First sentence of a block of prose (used for card teasers).
export function firstSentence(text: string | null | undefined): string {
  const s = (text ?? '').trim();
  if (!s) return '';
  const m = s.match(/^.*?[.!?](?=\s|$)/);
  return (m ? m[0] : s).trim();
}

// Present an AI bill summary as a clean, plain-language line: drop the leading
// bill-code / "The bill" preamble (the identifier already shows in the amber
// badge) and remove Minnesota Statutes citations, which read as legalese in a
// short summary (grounded-answers: bill summaries are plain-language, with no
// bill-number prefix and no statute citations). Conservative by design — it
// strips only those two things rather than re-authoring the sentence, so it
// can't introduce a claim the source didn't make. Pass `firstSentenceOnly` for
// one-line teasers (e.g. the legislator profile's chief-authored bill cards).
export function plainBillSummary(
  text: string | null | undefined,
  opts: { firstSentenceOnly?: boolean } = {},
): string {
  let s = (text ?? '').trim();
  if (!s) return '';
  if (opts.firstSentenceOnly) s = firstSentence(s);

  // 1. Remove Minnesota Statutes citations, absorbing a leading connective
  //    ("in / to / under / of / by amending / amends …") so a clause like
  //    "amends Minnesota Statutes …, section 297A.67, subdivision 40, to
  //    exempt …" collapses to "to exempt …".
  s = s.replace(
    /(?:\b(?:in|to|under|of|by amending|amending|amends|amend|the)\s+)*Minnesota Statutes\b(?:,?\s*\d{4})?(?:,?\s*(?:sections?|chapters?)\s+[\dA-Za-z.]+(?:\s+to\s+[\dA-Za-z.]+)?(?:,?\s*subdivisions?\s+[\dA-Za-z.]+)?(?:,?\s*paragraphs?\s+\([^)]*\))?)*/gi,
    ' ',
  );
  // Bare "section 297A.67, subdivision 40" without a "Minnesota Statutes" lead.
  s = s.replace(
    /,?\s*\b(?:sections?|chapters?)\s+\d[\dA-Za-z.]*(?:,?\s*subdivisions?\s+[\dA-Za-z.]+)?/gi,
    ' ',
  );

  // 2. Drop a leading bill-code preamble: optional "The/This bill|act", then an
  //    optional "HF/SF [No.] ####" code. Run the code strip twice so a
  //    "The bill HF 577 appropriates …" (code between "bill" and the verb) is
  //    fully removed once the "The bill" lead is gone.
  s = s.replace(/^\s*(?:the|this)\s+(?:bill|act|legislation)\s+/i, '');
  for (let i = 0; i < 2; i++) {
    s = s.replace(
      /^\s*(?:h\.?\s?f\.?|s\.?\s?f\.?|h\.?\s?r\.?|s\.?\s?r\.?)\s*(?:no\.?\s*)?\d+\s*/i,
      '',
    );
  }

  // 3. Clean artifacts the strips can leave, then collapse whitespace.
  s = s
    .replace(/\bamend(?:s|ing)?\s+to\b/gi, 'to') // "amends to exempt" → "to exempt"
    .replace(/^\s*(?:,|;|:|\bto\b)\s+/i, '') // orphaned leading connective
    .replace(/\s+([,.;:])/g, '$1')
    .replace(/,\s*,/g, ',')
    .replace(/\(\s*\)/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s,;:]+/, '')
    .trim();

  // 4. Capitalize the leading word (the verb now heads the sentence).
  if (s) s = s.charAt(0).toUpperCase() + s.slice(1);
  return s;
}

// Clean AI key points for display the same way plainBillSummary cleans a summary:
// strip Minnesota Statutes citations and any bill-number prefix so no key point
// reads as a bare "Amends Minnesota Statutes 2024, section 120B.123 …" line
// (grounded-answers: key points are plain-language statements of what the bill
// does — extends rule 9 beyond the summary). A point that is ONLY a citation has no
// plain-language effect left once the citation is stripped, so it collapses to
// empty and is dropped — we never fabricate the effect the source didn't state.
// The durable fix is at ingestion (the enrichment prompt); this is the interim
// display cleaner, mirroring plainBillSummary's role for summaries.
export function plainKeyPoints(points: string[] | undefined): string[] {
  return (points ?? [])
    .map((point) => plainBillSummary(point))
    .filter((point) => /[a-z]/i.test(point));
}

// The chief author sponsor (role chief_author), else the first sponsor.
export function chiefAuthor(bill: Bill) {
  const sponsors = bill.sponsors ?? [];
  return sponsors.find((s) => s.role === 'chief_author') ?? sponsors[0];
}

// Count of co-authors: prefer the served coAuthorCount, else count co_author roles.
export function coAuthorCount(bill: Bill): number {
  if (typeof bill.coAuthorCount === 'number') return bill.coAuthorCount;
  return (bill.sponsors ?? []).filter((s) => s.role === 'co_author').length;
}

// Link an action row to the recorded roll call it reports, by matching the action's
// tally (roll_call_text, e.g. "62-0") to a VoteEvent's yes–no. Returns the vote
// index or null. Tally-matching is reliable even though VoteEvent.occurred_at is
// often null (date-matching would fail); an action whose tally has no ingested
// VoteEvent (e.g. a roll the corpus didn't capture) correctly returns null, so
// "View votes →" only appears where there is a roll to open.
export function rollIndexForAction(action: BillAction, votes: VoteEvent[]): number | null {
  if (!votes.length) return null;
  const tally = (action.tally || '').replace(/[–—]/g, '-').replace(/\s/g, '');
  if (!tally) return null;
  const i = votes.findIndex((v) => `${v.breakdown.yes}-${v.breakdown.no}` === tally);
  return i >= 0 ? i : null;
}

// --- Versions tab ordering (spec §Versions) ---

// The bill's actual introduction date, taken from the earliest "Introduction and
// first reading" action across chambers. The introduced text version's own
// document_date is unreliable — the source feed sometimes stamps it with a later
// revision date (HF 1141's introduced row arrived dated months after the fact) —
// so "As introduced" binds to this action date instead.
export function introductionDate(actions: BillAction[]): string | null {
  const dates = actions
    .filter((a) => /^introduction and first reading/i.test(a.description))
    .map((a) => a.date)
    .filter((d): d is string => !!d)
    .sort(); // ISO YYYY-MM-DD sorts chronologically
  return dates[0] ?? null;
}

// Order the Versions tab strictly newest-first by each version's date, de-duplicated
// by friendly label (the feed sometimes emits two rows for one stage — e.g. the
// "current" alias pointer and the real engrossment file both read "1st unofficial
// engrossment"). Binds the real introduction date onto "As introduced" first so it
// lands as the oldest row.
//
// Dedup keeps ONE row per label, preferring the real record over the API's
// `version_code="current"` alias pointer: the pointer's document_date is a stale
// "last-touched" stamp, not the real posting date, so keeping it renders the wrong
// date and sorts the row too high (#475). Only when a label has no real row does
// the pointer survive — it's then the sole representation of that text. Among
// equally-preferred rows, the earliest date wins (the real posting date).
export function orderBillVersions(versions: BillVersion[], actions: BillAction[]): BillVersion[] {
  const intro = introductionDate(actions);
  const dated = intro
    ? versions.map((v) => (/^as introduced$/i.test(v.label) ? { ...v, date: intro } : v))
    : versions;

  const best = new Map<string, BillVersion>();
  for (const v of dated) {
    const key = v.label.toLowerCase();
    const incumbent = best.get(key);
    best.set(key, incumbent ? preferredVersion(v, incumbent) : v);
  }

  return [...best.values()].sort((a, b) => {
    const da = parseActionDate(a.date)?.getTime() ?? -Infinity;
    const db = parseActionDate(b.date)?.getTime() ?? -Infinity;
    return db - da; // newest first; undated rows sink to the bottom
  });
}

// Pick the row to keep between two same-label versions: a real record beats the
// "current" alias pointer; otherwise the earliest-dated row wins (its date is the
// real posting date, and undated rows lose so a dated real row is kept).
function preferredVersion(a: BillVersion, b: BillVersion): BillVersion {
  if (!!a.isCurrentPointer !== !!b.isCurrentPointer) {
    return a.isCurrentPointer ? b : a;
  }
  const ta = parseActionDate(a.date)?.getTime() ?? Infinity;
  const tb = parseActionDate(b.date)?.getTime() ?? Infinity;
  return ta <= tb ? a : b;
}

// A neutral track marker for versions that aren't official engrossments, so the
// strict newest-first list doesn't read as one broken ordinal sequence: unofficial
// engrossments and the conference-committee report each carry their own numbering
// (revisor lists them in separate sections), so an unofficial "1st" can legitimately
// sort above an official "2nd". Official engrossments, "As introduced", and the
// Session Law row get no tag (null). Rendered as neutral grey meta, never amber.
export function versionTrackTag(label: string): 'UNOFFICIAL' | 'CONFERENCE' | null {
  if (/unofficial/i.test(label)) return 'UNOFFICIAL';
  if (/conference committee report/i.test(label)) return 'CONFERENCE';
  return null;
}
