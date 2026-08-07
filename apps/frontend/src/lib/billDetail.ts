import {
  Bill,
  BillAction,
  BillSponsor,
  BillVersion,
  Citation,
  EffectiveSchedule,
  IndividualVote,
  VoteEvent,
} from '../data/types';
import { citationSectionAnchor } from './billText';
import { normalizeMotion } from './motionNormalize';
import { formatSessionLabel, type SessionDisplaySource } from './sessionLabel';

// Shared logic for the redesign Bill Detail page (screens/redesign/BillDetailScreen).
// Kept framework-free (pure functions) so it is unit-testable and reused by the tab
// components. Design intent: design_handoff_bill_profile_web / NEXT-bill-detail-spec.md.

export type StageTone = 'neutral' | 'green' | 'vetoed';

// 5-stage legislative progress derived from the status text — client-side so the
// rail's WHERE IT STANDS bar always agrees with the status label (same rule as the
// list card's ProgressBar, components/search/BillResultCard.tsx billStage).
// Stages: Introduced 0 · In Committee 1 · Passed one chamber 2 · Passed both 3 · Signed 4.
export function billStage(status: string): { index: number; tone: StageTone } {
  const s = (status || '').toLowerCase();
  if (s.includes('veto')) return { index: 4, tone: 'vetoed' };
  if (s.includes('signed') || s.includes('law') || s.includes('enacted'))
    return { index: 4, tone: 'green' };
  if (s.includes('both')) return { index: 3, tone: 'neutral' };
  if (s.includes('senate') || s.includes('house')) return { index: 2, tone: 'neutral' };
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

export type EventKind =
  | 'signing' // governor approval / secretary of state / chapter — collapsed to one
  | 'passage' // a chamber's floor passage / repassage (recorded vote when tallied)
  | 'reading' // bare "third reading" — folded into its passage cluster
  | 'effective' // statutory effective date (may be future → scheduled)
  | 'veto'
  | 'notAdopted'
  | 'motionFailed'
  | 'authorAdd' // "Author(s) added: …" — collapsed into one grouped row
  | 'chiefAuthor' // chief-author change — stays its own normal row (never grouped)
  | 'crossReference' // "See also HF 2446" — a pointer, not a step this bill took
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
  // The one row on a pointer bill's page that needed explaining was the only row
  // with no definition (#757). It says what the record states — a pointer — and
  // deliberately stops there: the source never says whether the language was
  // absorbed, partly absorbed, or merely related (#744), so neither may this.
  'See also':
    "the Legislature's record points from this bill to another file or chapter. It does not say how the two are related.",
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

// The source writes a referral as a phrase plus a separate value: the text ends on
// "referred to" / "re-referred to" and the committee arrives in committee_name.
// Shared with the API mapping (data/api.ts), which applies the same completion to
// the mobile timeline's labels — one regex so the two can't drift apart.
export const TRAILING_REFERRAL = /[,\s]*(?:and\s+)?(?:re-?)?refer(?:red)?\s+to\s*$/i;

// Same shape, different verb: a deadline or interim-disposition return hands the
// bill back to a committee named in committee_name ("Rule 47, returned to").
export const TRAILING_RETURN = /[,\s]*(?:bill\s+)?return(?:ed)?\s+to\s*$/i;

// STANDING RULE: no action row ends on a preposition. Every rule above that builds
// a title from a phrase plus a value spells out its own fallback, and this is the
// net under all of them (including the raw-label fallback): a dangling title takes
// the source's value when there is one, and otherwise loses the clause that was
// waiting on that value — never the preposition on its own. Both normalizers run
// it: this file's timeline titles, and the API mapping's labels (data/api.ts).
const TRAILING_PREPOSITION = /[,\s]+(?:to|for|with|from|by|of|in|on|and)\s*$/i;

export function completeDanglingTitle(title: string, target: string): string {
  if (!TRAILING_PREPOSITION.test(title)) return title;
  if (target) return `${title} ${target}`;
  const withoutPreposition = title.replace(TRAILING_PREPOSITION, '');
  const lastClause = withoutPreposition.lastIndexOf(',');
  const kept =
    lastClause > 0
      ? withoutPreposition.slice(0, lastClause)
      : withoutPreposition.replace(/\s+\S+$/, '');
  const dropped = kept.trim() || withoutPreposition.trim();
  // Dropping one clause can uncover another dangling word: "Withdrawn and
  // re-referred to" loses "re-referred" and lands on "Withdrawn and", which breaks
  // the same rule this function exists to enforce. So repeat until the tail is a
  // real word. Only reachable when the record has no target to name, which is why
  // it went unnoticed — every production referral carries its committee (#812).
  return dropped === title ? dropped : completeDanglingTitle(dropped, '');
}

// The clerk's two referral phrasings, rewritten the way a person says them. The
// home page's Bill Activity card has read them this way all along; keeping the map
// here lets the same rewrite carry the committee's real name (below) instead of
// stopping at the generic word.
const STATUS_PLAIN_STEM: Record<string, string> = {
  'introduction and first reading, referred to': 'Introduced and referred to',
  'referred to': 'Referred to',
};

// The same standing rule, applied to the bill's CURRENT STATUS rather than to a
// timeline row (#812). `bill.current_status` is the source's action text verbatim,
// so it inherits the same dangling preposition — 6,078 of 10,517 production bills
// end on one — even though the matching action row carries the committee in
// committee_name.
//
// This is a narrower fix than the raw count suggests, because every surface that
// builds its latest-action line from the ACTIONS already completes the phrase
// (`latestActionEntry`, since #599): over 100 real bills, 74 had a dangling status
// and 0 produced a dangling line. What this changes is the surfaces that read the
// STATUS instead — the home page's Bill Activity card, and the latest-action rail's
// fallback for a bill whose actions are absent. There, "Referred to committee"
// becomes "Referred to Judiciary and Public Safety": complete either way, but the
// second names the committee we already hold rather than a generic word.
//
// Nothing is inferred. The committee is looked up by matching the status against
// the action rows the same payload already carries. A status with no matching
// action keeps today's generic "committee" for the two known referral wordings, and
// any other wording falls through to completeDanglingTitle's own fallback, which
// drops the unfinished clause rather than name a target the record does not have.
export function completeStatusText(
  status: string | null | undefined,
  actions?: readonly { action_text?: string | null; committee_name?: string | null }[] | null,
): string | undefined {
  const text = (status || '').trim();
  if (!text) return undefined;
  if (!TRAILING_PREPOSITION.test(text)) return text;
  const key = text.toLowerCase();
  const match = (actions || []).find(
    (action) => (action.action_text || '').trim().toLowerCase() === key,
  );
  const committee = (match?.committee_name || '').trim();
  const stem = STATUS_PLAIN_STEM[key];
  if (stem) return completeDanglingTitle(stem, committee || 'committee');
  return completeDanglingTitle(text, committee);
}

// Ordered clerk-phrasing → plain-language rules. First match wins, so put the
// specific patterns before the general ones. `text` is the raw action_text;
// `desc` the raw action_description (a name list, committee name, date, or
// cross-reference). Rules return the plain-language title and the event kind;
// the plain-language key is derived separately (terms in GLOSS whose word
// appears in a shown title), so rules carry no gloss tags.
type Rule = {
  test: (low: string, desc: string) => boolean;
  // `committee` is the source's committee_name (#599) when present, else '' —
  // referral/re-refer rules name it in the title, falling back to the generic
  // "…a committee" wording when absent. Never inferred.
  build: (text: string, desc: string, committee: string) => Classified;
};

// "HF719" → "HF 719", so a cross-referenced file reads the way the rest of the
// product writes a bill number. Leaves any surrounding words alone ("First Special
// Session, SF17" → "First Special Session, SF 17").
function spaceFileNumbers(value: string): string {
  return value.trim().replace(/\b(HF|SF)\s*0*(\d+)/gi, (_m, prefix, digits) => {
    return `${prefix.toUpperCase()} ${digits}`;
  });
}

// The cross-reference target, ready to sit after "See also". 50 production rows put
// the verb in the value as well as the label — action_text "See" with
// action_description "See First Special Session, HF5" — so prepending blindly gave
// "See also See First Special Session, HF 5". Drop a leading See / See Also from the
// target. Everything after it keeps the source's own FACTS verbatim — the file
// number, chapter, section and date are never re-interpreted — but a plain
// misspelling in the source's wording is corrected downstream by
// fixSourceMisspellings, because this row is a label we author, not a quotation.
function crossReferenceTarget(desc: string): string {
  return spaceFileNumbers(desc.trim().replace(/^see(\s+also)?[\s,:.-]*/i, ''));
}

// Split a raw author name-list ("Dippel, Zeleznikar, and Bakeberg") into names,
// re-joining a trailing initial that the separator split off ("Lee, K." must stay
// one name, not become "Lee" + "K.").
//
// The clerk uses BOTH separators, sometimes in one string: 329 production rows are
// semicolon-delimited ("Fateh; Clark", "Hanson, J.; Pursell; Virnig; and Bahner"),
// because the semicolon is what keeps a "Surname, Initial." pair together. Splitting
// on commas alone made "Fateh; Clark" a single name whose row then read "Co-author
// added" for two people. And the re-join must accept a MULTI-initial suffix: the
// House distinguishes its two Andersons as "Anderson, P. E." and "Anderson, P. H.",
// which a single-letter test left as a bare "P. E." standing in for a person.
function splitNames(desc: string): string[] {
  const parts = desc
    .replace(/\band\b/gi, ',')
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (const p of parts) {
    if (/^[A-Z]\.?(?:\s+[A-Z]\.?)*$/.test(p) && out.length) out[out.length - 1] += `, ${p}`;
    else out.push(p);
  }
  return out;
}

/** One name on an author row: what to print, plus the profile it links to when the
 *  clerk's surname resolved to exactly one of this bill's authors. */
export interface TimelineAuthor {
  /** The legislator's full name when resolved, else the clerk's own string. */
  label: string;
  /** Only set when the match was unambiguous, so a surface can trust the link. */
  legislatorId?: string;
  /** Readable profile-URL segment carried through from the matched sponsor, so
   *  the timeline links to /legislators/{slug} rather than the UUID. */
  slug?: string;
}

// Fold accents and case so the clerk's ASCII spelling still matches the roster's
// ("Perez-Vega" → "Pérez-Vega"). Also drops the honorific the Senate roster carries
// on every name ("Senator Erin K. Maye Quade").
function nameKey(value: string): string {
  return authorNameOnly(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

// The clerk writes a bare surname ("Skraba"), or a surname plus the initials that
// separate two members who share it ("Lee, F.", "Anderson, P. E."). Split those apart.
function parseClerkName(raw: string): { surname: string; initial: string } {
  const at = raw.lastIndexOf(',');
  if (at === -1) return { surname: nameKey(raw), initial: '' };
  const tail = raw.slice(at + 1).trim();
  if (!/^[A-Z]\.?(?:\s+[A-Z]\.?)*$/.test(tail)) return { surname: nameKey(raw), initial: '' };
  return { surname: nameKey(raw.slice(0, at)), initial: tail[0].toLowerCase() };
}

// Resolve one clerk-written name against the bill's own author list, so the timeline
// can print "Roger Skraba" and link to his profile instead of the bare "Skraba" the
// record holds. Match on the surname the roster name ENDS with, because a surname can
// be two words ("Maye Quade", "Johnson Stewart", "Van Binsbergen") and the roster
// stores no separate surname field.
//
// Ambiguity NEVER guesses. When two authors on the bill share the surname and the
// clerk's initials cannot separate them (both Andersons are "P."), the row keeps the
// clerk's own string, unlinked — an honest "this is what the record says" rather than
// a link to a person who may not be the one who signed on.
function resolveAuthor(raw: string, sponsors: BillSponsor[]): TimelineAuthor {
  const { surname, initial } = parseClerkName(raw);
  if (!surname) return { label: raw };
  const matches = sponsors.filter((s) => {
    const key = nameKey(s.name);
    return key === surname || key.endsWith(` ${surname}`);
  });
  // The initials only ever narrow: when they match nobody on this bill they were
  // distinguishing the member from someone who is not an author here, so a lone
  // surname match still stands.
  const narrowed = initial ? matches.filter((s) => nameKey(s.name).startsWith(initial)) : matches;
  const pick = narrowed.length === 1 ? narrowed[0] : matches.length === 1 ? matches[0] : null;
  if (!pick?.legislatorId) return { label: raw };
  return { label: authorNameOnly(pick.name), legislatorId: pick.legislatorId, slug: pick.slug };
}

/** The words that lead an author-add row, shared by the timeline title and both
 *  platforms' renderers so the three cannot word it differently. */
export function authorAddPrefix(count: number): string {
  return count > 1 ? `${count} co-authors added — ` : 'Co-author added — ';
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
    // The title here is the no-name fallback only: an authorAdd row's real title is
    // rebuilt from its resolved `authors` in the emit step, so a full name shown on
    // the row can never disagree with the title read out to a screen reader.
    test: (l) => /authors?\s+added/.test(l),
    build: (_t, desc) => ({
      kind: 'authorAdd',
      title: desc ? `Co-author added — ${splitNames(desc).join(', ')}` : 'Co-author added',
    }),
  },
  {
    // The mirror of "Authors added": a name comes OFF the bill. The name is in
    // action_description on all 298 production rows, and the clerk's "stricken"
    // dropped it entirely before this rule existed (the row read a bare "Author
    // stricken", which also gave no hint that anything was removed).
    //
    // Deliberately NOT kind 'authorAdd': that kind is what the run-collapse step
    // merges into one "N co-authors added" row, so a removal tagged with it gets
    // swallowed by the adds either side of it and the removed name is then listed
    // as ADDED. A removal is its own row, always.
    test: (l) => /^authors?\s+stricken/.test(l),
    build: (_t, desc) => ({
      kind: 'procedural',
      title: desc ? `Co-author removed — ${splitNames(desc).join(', ')}` : 'Co-author removed',
    }),
  },
  {
    // "Author changed" carries a clerk sentence in action_description ("Hollins be
    // shown as Chief Author", "Franson made chief author", "Bahner be shown as
    // second author"). Take the name verbatim from the front of that sentence and
    // say what changed; the row printed a bare "Author changed" before, dropping
    // the name the record held (15 production rows).
    test: (l) => /^authors?\s+changed/.test(l),
    build: (_t, desc) => {
      const name = desc.match(/^(.+?)\s+(?:be\s+shown\s+as|shown\s+as|made)\s+/i)?.[1] ?? desc;
      if (!name) return { kind: 'chiefAuthor', title: 'Author changed' };
      return /chief\s+author/i.test(desc)
        ? { kind: 'chiefAuthor', title: `Chief author changed to ${name}` }
        : { kind: 'chiefAuthor', title: `Author order changed — ${name}` };
    },
  },
  // --- Cross-references ---
  {
    // The source's pointer rows: a bare "See" / "See Also", plus the clerk variants
    // "See Senate file in House" and "(Non-revisor companion)". What is pointed at
    // sits in action_description on all 1,227 production rows, yet the timeline
    // printed just "See", which tells a reader nothing and does not even hint that
    // there is another file to look at.
    //
    // The target is quoted as the source states it and never re-interpreted: 682
    // rows name a file, 465 a special-session file, and 65 an enacted chapter and
    // section ("Chapter 36, Article 4., Section 8."). Saying where the language
    // "ended up" would assert more than the record does. (That reading is #559's:
    // PR #736 fixed the bare "See" in this same builder from the mobile side, and
    // this rule replaces it — adding the two clerk variants it did not cover and
    // spacing file numbers the way the rest of the product writes them.)
    // The test requires a target that survives crossReferenceTarget, so a row whose
    // description is nothing but the verb falls through to the raw-label fallback
    // rather than becoming a bare "See also" — which would be the very defect this
    // rule exists to remove. No production row does that today.
    test: (l, desc) =>
      !!crossReferenceTarget(desc || '') &&
      (/^see\b/.test(l) || /^\(non-revisor companion\)/.test(l)),
    build: (_t, desc) => ({
      kind: 'crossReference',
      title: `See also ${crossReferenceTarget(desc)}`,
    }),
  },
  // --- Committee / referral / calendar ---
  {
    test: (l) => /motion to recall and re-?refer/.test(l),
    build: (_t, _d, committee) => ({
      kind: 'procedural',
      title: committee
        ? `Recalled and sent back to ${committee}`
        : 'Recalled and sent back to committee',
    }),
  },
  {
    test: (l) => /comm(?:ittee)? report/.test(l),
    build: (text, _desc, committee) => {
      const asAmended = /amend/i.test(text);
      const reRefer = /re-?refer/i.test(text);
      const subst = /subst|substitut/i.test(text);
      let title = 'Committee report — recommends passing';
      if (asAmended) title += ', as amended';
      if (reRefer)
        title += committee
          ? `, then referred to ${committee}`
          : ', then referred to another committee';
      if (subst) title = 'Committee report — companion bill substituted, sent to the floor';
      return { kind: 'procedural', title };
    },
  },
  {
    test: (l) => /re-?refer/.test(l),
    build: (_t, _d, committee) => ({
      kind: 'procedural',
      title: committee ? `Re-referred to ${committee}` : 'Re-referred to another committee',
    }),
  },
  {
    test: (l) => /introduction and first reading/.test(l),
    build: (text, _d, committee) => {
      // The House combines intro + referral in one action ("…first reading,
      // referred to X"); the Senate files them separately — a bare "Introduction
      // and first reading" row, then a distinct "Referred to" row. Only name a
      // referral here when the source actually did one on THIS row (the text says
      // "referred to", or a committee is attached); otherwise it's just the
      // introduction, and the separate "Referred to {committee}" row carries the
      // committee (#599 follow-up — don't invent a referral on the Senate intro).
      if (!/referred to/i.test(text) && !committee) {
        return { kind: 'procedural', title: 'Introduced' };
      }
      return {
        kind: 'procedural',
        title: committee
          ? `Introduced and referred to ${committee}`
          : 'Introduced and referred to a committee',
      };
    },
  },
  {
    test: (l) => /^first reading|^introduced/.test(l),
    build: () => ({ kind: 'procedural', title: 'Introduced' }),
  },
  {
    // The other chamber takes up this file: first reading there, then either a
    // referral to one of ITS committees (the committee arrives in committee_name,
    // not in the text) or a hand-off for comparison against the companion. Reads
    // "First reading of the Senate file, …" rather than the clerk's noun-pile
    // "Senate file first reading" (36 + 33 production rows).
    test: (l) => /^(?:senate|house) file first reading/.test(l),
    build: (text, _d, committee) => {
      const chamber = /^senate/i.test(text.trim()) ? 'Senate' : 'House';
      const opening = `First reading of the ${chamber} file`;
      if (/referred for comparison/i.test(text)) {
        return { kind: 'procedural', title: `${opening}, sent for comparison` };
      }
      return {
        kind: 'procedural',
        title: committee ? `${opening}, referred to ${committee}` : opening,
      };
    },
  },
  {
    // Sent to the Chief Clerk to be compared against the companion file, which the
    // source names in action_description ("SF3210" — present on every one of these
    // rows in production). Must sit ahead of the referral rule below: this is not a
    // committee referral and must not read as one ("Referred to a committee" is
    // what it used to say).
    test: (l) => /^referred to chief clerk/.test(l),
    build: (_t, desc) => ({
      kind: 'procedural',
      title: desc
        ? `Referred to the Chief Clerk for comparison with ${desc}`
        : 'Referred to the Chief Clerk for comparison',
    }),
  },
  {
    // Any referral whose text ends on "referred to" — a bare "Referred to", and
    // also the ones that carry a rule or resolution prefix ("Rule 47, referred
    // to", "Pursuant to Senate Concurrent Resolution No. 6, referred to"). The
    // prefix is clerk bookkeeping; what happened is the referral.
    test: (l) => /^referred to|referred to\s*$/.test(l),
    build: (_t, _d, committee) => ({
      kind: 'procedural',
      title: committee ? `Referred to ${committee}` : 'Referred to a committee',
    }),
  },
  {
    // Interim disposition and deadline returns ("Rule 47, returned to", "House
    // rule 4.20, interim disposition of bills, returned to").
    test: (l) => /returned to\s*$/.test(l),
    build: (_t, _d, committee) => ({
      kind: 'procedural',
      title: committee ? `Returned to ${committee}` : 'Returned to committee',
    }),
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
  {
    // "Special Order: Rule 45 amendment stricken" (14 rows). The raw-label fallback
    // strips the rule number and left "Special Order: amendment stricken".
    test: (l) => /^special order.*amendment.*stricken/.test(l),
    build: () => ({ kind: 'procedural', title: 'Floor amendment removed' }),
  },
  {
    // A bare "Special Order" (87 rows) told the reader nothing. It is the chamber
    // moving a bill ahead of the regular calendar to be taken up on the floor.
    test: (l) => /^special order$/.test(l),
    build: () => ({ kind: 'procedural', title: 'Moved up for a floor vote' }),
  },
  // --- Set aside / taken back up ---
  {
    // "Laid on table" / "Bill laid on table in House" (41 rows). "On the table" is
    // legislative idiom for parked, and reads to everyone else as the opposite of
    // what it means (a bill "on the table" sounds like it is being discussed).
    test: (l) => /^(?:bill |motion )?laid on (?:the )?table/.test(l),
    build: (text) => ({
      kind: 'procedural',
      title: /^motion/i.test(text.trim()) ? 'Motion set aside' : 'Set aside',
    }),
  },
  {
    test: (l) => /^taken from (?:the )?table/.test(l),
    build: () => ({ kind: 'procedural', title: 'Taken back up' }),
  },
  {
    // "HF indefinitely postponed" (36 rows). The source names no file number here,
    // so the row says which chamber's companion without inventing a number.
    //
    // Stays 'procedural', NOT 'notAdopted': the red dot means "not adopted" in the
    // legend, and this happened to the COMPANION file. A red dot here would read as
    // this bill having been killed.
    test: (l) => /^(hf|sf) indefinitely postponed/.test(l),
    build: (text) => ({
      kind: 'procedural',
      title: `${/^hf/i.test(text.trim()) ? 'House' : 'Senate'} companion bill set aside indefinitely`,
    }),
  },
  {
    // "HF substituted in committee" (96 rows) with the file in action_description:
    // the companion took this file's place, so the committee worked from that one.
    test: (l, desc) => !!desc && /^(hf|sf) substituted in committee/.test(l),
    build: (_t, desc) => ({
      kind: 'procedural',
      title: `Replaced in committee by companion ${spaceFileNumbers(desc)}`,
    }),
  },
  // --- Procedural objections and suspended rules ---
  {
    // "ruled well taken" means the chair agreed with the objection; "not well
    // taken" means the chair disagreed. Neither reads as English (14 rows).
    test: (l) => /point of order/.test(l),
    build: (text) => ({
      kind: 'procedural',
      title: /not well taken/i.test(text)
        ? 'Procedural objection raised and overruled'
        : 'Procedural objection raised and upheld',
    }),
  },
  {
    // "Urgency declared rules suspended" / "Rules suspended, urgency declared" (4).
    test: (l) => /urgency declared|rules suspended/.test(l),
    build: () => ({ kind: 'procedural', title: 'Normal rules set aside to move quickly' }),
  },
  {
    // "Rule 12.10:  report of votes in committee" (6 rows). The raw-label fallback
    // stripped the rule number and left a title starting with a colon.
    test: (l) => /report of votes in committee/.test(l),
    build: () => ({ kind: 'procedural', title: 'Committee vote record filed' }),
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
    // Covers the "Bills identical, SF substituted on General Register" wording too
    // (28 rows), which printed raw clerk text — "General Register" is the Senate's
    // floor queue and means nothing to a reader. The identical / not-identical
    // distinction is clerk bookkeeping; what happened is the substitution.
    test: (l) => /bills? (?:not )?identical.*substitut/.test(l),
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
  // The bare "See" / "See Also" rule that #736 added here is gone: the broader
  // cross-reference rule further up (search "Cross-references") now matches those
  // rows first, so this one was unreachable. Two rules for one input is how a rules
  // list starts lying about what it does — its reasoning is carried up there.
];

// Humanize an unmatched raw label defensively: strip clerk prefixes/codes so a
// row never leaks "Comm report:" / "Rule 45" / "subst." even without a rule.
function humanizeFallback(text: string): string {
  let s = text
    .replace(/^comm(?:ittee)?\s+report:?\s*/i, 'Committee report — ')
    .replace(/\brule\s+\d+[.\d]*[- ]?/gi, '')
    .replace(/\bsubst\.?\b/gi, 'substituted')
    .replace(/\s{2,}/g, ' ')
    // Stripping a leading rule number leaves the punctuation that followed it, so a
    // row could open on ":" or "," ("Rule 12.10: report of votes" → ": report of
    // votes"). Drop any leading punctuation the strip orphaned.
    .replace(/^[\s,;:.—-]+/, '')
    .replace(/\s+([,;:])/g, '$1')
    .trim();
  if (s) s = s.charAt(0).toUpperCase() + s.slice(1);
  return s || text;
}

// Plain misspellings in the source, corrected in the titles we author.
//
// These rows are NOT a quotation surface — we already rewrite every one of them
// ("Introduction and first reading" -> "Introduced", "Comm report: To pass as
// amended" -> "Committee report — recommends passing, as amended"). Leaving a
// clerk's typo standing inside a sentence we wrote ourselves does not make us
// faithful to the record; it just reads as our own sloppiness, since a reader has
// no way to tell whose mistake it is. Verbatim fidelity is owed by the Bill Text
// tab and by citation excerpts, which quote the statute; it is not owed by a
// plain-language label.
//
// The line this must not cross: correct WORDS, never FACTS. A file number,
// chapter, section, date or tally stays exactly as the record states it, because
// changing one of those changes what the record says. "Frist" is not a word, it
// sits where "First" belongs in a known session name, and there is nothing else it
// could mean — so no information is lost and no claim is introduced.
//
// Deliberately an explicit list rather than a spell-checker: every entry is a
// misspelling someone has confirmed in production, so it can be audited. Searched
// the corpus for 17 likely clerk typos; "Frist" is the only one present (2 rows,
// 94-2025-SF115 and 94-2025-SF1405, both naming the 2025 First Special Session).
const SOURCE_MISSPELLINGS: [RegExp, string][] = [[/\bFrist\b/g, 'First']];

function fixSourceMisspellings(title: string): string {
  return SOURCE_MISSPELLINGS.reduce((s, [wrong, right]) => s.replace(wrong, right), title);
}

function classify(text: string, desc: string, committee: string): Classified {
  const low = (text || '').toLowerCase();
  const matched = ACTION_RULES.find((rule) => rule.test(low, desc || ''));
  const classified: Classified = matched
    ? matched.build(text, desc || '', committee || '')
    : { kind: 'procedural', title: humanizeFallback(text) };
  return {
    ...classified,
    title: fixSourceMisspellings(completeDanglingTitle(classified.title, committee || '')),
  };
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
  kind: EventKind; // the classified event kind (lets callers reword per surface)
  dot: TimelineDot;
  tally?: string; // en-dashed "134–0"; only real passage votes carry one
  /** Collapsed co-author names (author-group rows), each already resolved to a full
   *  name + profile link where the bill's own author list made that unambiguous. */
  authors?: TimelineAuthor[];
  showVotes: boolean;
  rollIdx: number | null;
  /** Sub-line under the title — how many sections start on this row's date (#715). */
  meta?: string;
  /** Quiet UNDATED note about the sections that state no date (#715). It carries no
   *  dot and no date of its own, because placing it on a day would mean picking one
   *  of the two Minn. Stat. 645.02 candidates. */
  note?: string;
  /** Bills named in this row's title that we serve a page for, resolved to a
   *  bill_key by the API. Surfaces render each `code` where it appears in `title`
   *  as a link to `/bills/{id}`; anything unresolved is absent and stays plain text
   *  (#745). Use `titleSegments(row)` rather than matching codes by hand.
   *
   *  A link that also carries `title` / `status` gets its own sub-line under the
   *  row, naming what that bill is and where it got to (#757) — see
   *  `crossReferenceTargets(row)`. */
  links?: { code: string; id: string; title?: string; status?: string }[];
  /** The latest moment this row's event could have happened, in epoch milliseconds.
   *  For comparing a row against a reader's last visit (`changesSince`) — NEVER
   *  displayed, and never a claim about a time the record does not state.
   *
   *  A dated row uses the END of its day: the Legislature dates an action to a day
   *  and not a time, so measuring from the start of that day would silently hide a
   *  step filed later the same day someone last looked. A dateless row falls back
   *  to when we first saw the action (`firstSeenAt`) — the only honest marker an
   *  undated entry has, and a stable one, because ingestion upserts actions on
   *  (bill, action number, chamber) and never deletes them. Undefined when the row
   *  has neither. */
  latestPossibleAtMs?: number;
}

/** One piece of a rendered title: plain text, or text that links to a bill page. */
export interface TitleSegment {
  text: string;
  billId?: string;
}

// Split a row's title around the bill codes it links to, so a surface can render
// "See also HF 2446, HF 2115" with just the two codes pressable. Shared by web and
// mobile so the two cannot disagree about what is clickable. A row with no links
// (every row that is not a cross-reference, and every cross-reference whose target
// we do not serve) comes back as one plain segment — the caller needs no special
// case for it.
export function titleSegments(row: TimelineRow): TitleSegment[] {
  if (!row.links?.length) return [{ text: row.title }];
  // Longest code first, so "HF 21150" can never be matched by "HF 2115".
  const byLength = [...row.links].sort((a, b) => b.code.length - a.code.length);
  const segments: TitleSegment[] = [];
  let rest = row.title;
  // Walk left to right, always taking the earliest code still ahead of us, so the
  // segments come out in reading order however the links were ordered.
  for (;;) {
    let next: { at: number; link: { code: string; id: string } } | null = null;
    for (const link of byLength) {
      const at = rest.indexOf(link.code);
      if (at !== -1 && (next === null || at < next.at)) next = { at, link };
    }
    if (!next) break;
    if (next.at > 0) segments.push({ text: rest.slice(0, next.at) });
    segments.push({ text: next.link.code, billId: next.link.id });
    rest = rest.slice(next.at + next.link.code.length);
  }
  if (rest) segments.push({ text: rest });
  return segments;
}

type Norm = Classified & {
  idx: number;
  actionNumber: number;
  block: number; // chamber block (increments when action_number drops)
  rawDate: string;
  tally?: string;
  chapter?: string;
  authors?: TimelineAuthor[];
  endDate?: string;
  meta?: string;
  note?: string;
  links?: { code: string; id: string; title?: string; status?: string }[];
};

/** One "See also" target that we hold enough about to describe: its code, what
 *  the bill is, and where it got to. */
export interface CrossReferenceTarget {
  code: string;
  billId: string;
  title: string;
  status?: string;
}

/** The targets of a pointer row that we can say something about, for the sub-lines
 *  under it (#757).
 *
 *  A bare "See also HF 2446, HF 2115" gave a reader no reason to follow either
 *  code. These lines answer that: what the other bill is, and whether it became
 *  law. Every value is a record we hold about the TARGET — its short title and its
 *  status — so none of it claims the two bills are related in any particular way,
 *  which the source row never states (#744).
 *
 *  A target we hold no short title for is left out entirely rather than shown as a
 *  code with a blank beside it, which is why this can return fewer entries than
 *  `row.links` (or none at all, for the 465 special-session and 65 chapter-and-
 *  section rows that resolve to no bill we serve). */
export function crossReferenceTargets(row: TimelineRow): CrossReferenceTarget[] {
  return (row.links ?? [])
    .filter((link) => !!link.title)
    .map((link) => ({
      code: link.code,
      billId: link.id,
      title: link.title as string,
      status: link.status,
    }));
}

/** Fixed UI copy for a phased law's rail caption. Owned by the layout, never
 *  generated — and true by construction: the value is the EARLIEST date the law
 *  states, so every other section necessarily starts later (#715). */
export const PHASED_CAPTION = 'Phased — some sections later';

/** Fixed UI copy for the rail caption on a bill whose newest record entry is a
 *  pointer to somewhere else (#757).
 *
 *  1,190 such bills carry the status "Introduced", which on its own reads as an
 *  ordinary proposal still waiting its turn — when in fact the record's own last
 *  word about the bill is "look over there". Someone checking whether their issue
 *  went anywhere deserves to be told that, right where the status is.
 *
 *  It says only what the record states, which is why it does not say "folded into"
 *  or "became law as part of": the source names a target, never a mechanism (#744).
 *  Owned by the layout, never generated. Shown next to the LATEST ACTION value,
 *  which already quotes the target the record names. */
export const POINTER_CAPTION =
  'The record’s last entry points somewhere else, not to a further step for this bill. It does not say how the two are related.';

// The rail's EFFECTIVE value for a signed law, or null when it falls back to the
// honest LATEST ACTION treatment. Shared by the web facts rail and the mobile
// status card so the two platforms cannot drift. "From {date}" leads with the
// earliest date a phased law states about itself; "Various dates" covers the
// laws where even that is not provable (a stated date falling after one of the
// two Minn. Stat. 645.02 candidates, so an undated section may start first).
export function effectiveRailValue(bill: Bill): { value: string; phased: boolean } | null {
  const schedule = bill.effectiveSchedule;
  if (schedule?.kind === 'phased') {
    return {
      value: schedule.value ? `From ${formatNiceDate(schedule.value)}` : 'Various dates',
      phased: true,
    };
  }
  const single = schedule?.value ?? bill.effectiveDate;
  return single ? { value: formatNiceDate(single), phased: false } : null;
}

// The two Minn. Stat. 645.02 candidates read as prose in the undated note: the
// shared year is stated once ("July 1 or Aug 1, 2026"). Both candidates always
// fall in the same year by construction, so the year only ever needs saying once.
function candidatePhrase(candidates: string[]): string | null {
  if (candidates.length !== 2) return null;
  const first = candidates[0].replace(/,\s*\d{4}$/, '');
  return `${first} or ${formatNiceDate(candidates[1])}`;
}

/** One effective-date entry for the Actions timeline, newest first (#715).
 *  Shared by the web timeline and the mobile list so both platforms show the same
 *  rows, titles and note — they render the same data, never their own copy. */
export interface EffectiveTimelineEntry {
  /** Display date ("May 28, 2026"); both platforms format it themselves. */
  date: string;
  title: string;
  /** Sub-line counting the sections that state THIS date (phased laws only). */
  meta?: string;
  /** The undated note, on the oldest row only. */
  note?: string;
}

// A single-date law gets one "Law effective" row and no per-section meta line:
// every section shares the date, so there is nothing to count. A phased law gets
// one row per date it states about itself, the oldest labelled "First provisions
// effective" — that row is the anchor the undated note hangs off. Every count
// here comes from sections that state their OWN date; none rests on an inferred
// one, and the counts need not sum to the total (a section can carry a clause
// that states only a coverage window, which is neither a date nor silence).
export function effectiveTimelineEntries(schedule: EffectiveSchedule): EffectiveTimelineEntry[] {
  const oldest = schedule.rows.length - 1;
  const phrase = candidatePhrase(schedule.defaultCandidates);
  return schedule.rows.map((row, i) => ({
    date: row.date,
    title:
      schedule.kind === 'single'
        ? 'Law effective'
        : i === oldest
          ? 'First provisions effective'
          : 'More provisions effective',
    meta:
      schedule.kind === 'single'
        ? undefined
        : `${row.sections} of ${schedule.totalSections} sections${
            // NOT "the day after the Governor signed": "final enactment" runs from
            // the Secretary of State filing, which trails the signature on 5 of the
            // 128 enacted bills in the corpus (HF 4987 was signed May 14, filed May
            // 15, effective May 16), so the signing wording would be a day out.
            row.fromEnactment ? ', the day after the law was filed with the state' : ''
          }`,
    // "N of the M sections", never "the other N": the two differ whenever a
    // section states only a coverage window, and "the other" would then be false.
    note:
      schedule.kind === 'phased' && i === oldest && schedule.undatedSections > 0 && phrase
        ? `${schedule.undatedSections} of the ${schedule.totalSections} sections state ` +
          `no date. Under state law they start ${phrase}.`
        : undefined,
  }));
}

// The same entries, wrapped for the web timeline's ordering pipeline. Real dates,
// so they sort newest-first and pick up the SCHEDULED treatment like any action.
function effectiveNormRows(schedule: EffectiveSchedule, existing: Norm[]): Norm[] {
  const entries = effectiveTimelineEntries(schedule);
  const baseIdx = existing.reduce((max, r) => Math.max(max, r.idx), 0) + 1;
  const block = existing.reduce((max, r) => Math.max(max, r.block), 0);
  const actionNumber = existing.reduce((max, r) => Math.max(max, r.actionNumber), 0) + 1;
  const oldest = entries.length - 1;
  return entries.map((entry, i) => ({
    kind: 'effective' as EventKind,
    title: entry.title,
    idx: baseIdx + (oldest - i),
    actionNumber,
    block,
    rawDate: entry.date,
    meta: entry.meta,
    note: entry.note,
  }));
}

// Build the curated Actions timeline (newest first) from the raw feed.
// Pipeline: classify each row → collapse (authors, passage clusters, signing)
// → dedupe identical cross-chamber rows → order newest-first (dateless rows
// inherit a neighbor's date, never a fabricated displayed date) → render rows.
export function buildActionTimeline(
  actions: BillAction[],
  votes: VoteEvent[],
  now: Date,
  schedule?: EffectiveSchedule,
  /** The bill's author list, so an author row can print full names and link to
   *  profiles. Omit it and the rows keep the clerk's bare surnames, unlinked. */
  sponsors?: BillSponsor[],
): { rows: TimelineRow[]; glossary: Array<{ term: string; def: string }> } {
  // 1. Classify, preserving source order (chamber-grouped, ascending #). A DROP
  //    in action_number marks a new chamber, tracked as `block`.
  let block = 0;
  let prevNum = Number.NEGATIVE_INFINITY;
  const norm: Norm[] = actions.map((a, idx) => {
    const text = a.actionText ?? a.description ?? '';
    const desc = a.actionDescription ?? '';
    const c = classify(text, desc, a.committee ?? '');
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
      // Keyed off the resolved links themselves, not off the matched rule: the API
      // only resolves them for "See"-type rows, and a row whose title ends up
      // quoting no file number simply renders none. Deliberately NOT a new
      // EventKind — `procedural` is what drives this row's dot and keeps it out of
      // every collapse step, and re-kinding it to steer rendering is how a row ends
      // up in the wrong group (the authorAdd/#737 trap).
      links: a.crossReferences,
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
    const names: TimelineAuthor[] = [];
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
      if (nm) names.push(...splitNames(nm).map((raw) => resolveAuthor(raw, sponsors ?? [])));
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

  // 2e. Replace the source's single "Effective date" row with the resolved
  //     schedule (#715). That row carries the Revisor's published date, which is
  //     unreliable for a law whose sections start on different days — it prints
  //     the earliest for SF 334 and the latest for HF 3827, either way reading as
  //     the whole law's date. The bill text wins, so the source row is dropped and
  //     one row per date the law states about ITSELF takes its place. Dates are
  //     real, so these rows pick up the existing newest-first ordering and the
  //     SCHEDULED treatment (dashed dot, grey title, badge) with no new logic.
  const scheduled = schedule
    ? [...deduped.filter((r) => r.kind !== 'effective'), ...effectiveNormRows(schedule, deduped)]
    : deduped;

  // 3. Order newest-first. Dateless rows inherit the nearest dated neighbor in
  //    their chamber block, exactly like orderActionsForTimeline — used only for
  //    ordering, never displayed.
  const withKeys = assignOrderKeys(scheduled);
  withKeys.sort((x, y) => y.key - x.key || x.item.idx - y.item.idx);

  // 4. Render rows. Schedule rows carry their own title/meta/note already.
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
    // An author row's title is rebuilt from the resolved names, so the sentence a
    // screen reader hears is the same one the eye sees — full names where we have
    // them, and the same count the row shows.
    if (item.kind === 'authorAdd' && item.authors?.length) {
      title = authorAddPrefix(item.authors.length) + item.authors.map((a) => a.label).join(', ');
    }
    return {
      id: `${item.idx}-${item.actionNumber}`,
      date: formatMonoDate(item.rawDate),
      kind: item.kind,
      dateRange:
        item.endDate && item.endDate !== item.rawDate
          ? `${formatMonoDate(item.rawDate)} – ${formatMonoDate(item.endDate)}`
          : undefined,
      title,
      dot: dotForRow(item.kind, upcoming, hasTally),
      tally: hasTally ? item.tally!.replace(/-/g, '–') : undefined,
      authors: item.kind === 'authorAdd' ? item.authors : undefined,
      showVotes: hasTally && !upcoming && rollIdx != null,
      rollIdx,
      meta: item.meta,
      note: item.note,
      // Kept only when the code is actually visible in the rendered title, so a
      // surface can trust that every link it is handed has somewhere to attach.
      links: item.links?.filter((l) => title.includes(l.code)),
      // An author group spans days, so its latest moment is the END of the run —
      // measuring from the first name added would treat later names as already
      // seen. Every other row has a single date, where endDate is unset.
      latestPossibleAtMs: latestPossibleMoment(
        item.endDate || item.rawDate,
        actions[item.idx]?.firstSeenAt,
      ),
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

// Significance of an event kind, for picking a day's headline beat (below).
// Enacted/veto milestones outrank floor passage, which outranks the procedural
// steps (amendments, motions, referrals) and author bookkeeping around it.
const KIND_SIGNIFICANCE: Record<EventKind, number> = {
  signing: 7,
  effective: 7,
  veto: 7,
  passage: 6,
  reading: 6,
  notAdopted: 3,
  motionFailed: 3,
  // Above the procedural steps and the author bookkeeping, below every real
  // outcome (a passage, a signing, a veto, a failed vote). A pointer is the
  // record's terminal word about a bill, and it is dateless — so it shares the
  // dateless group with any other dateless row, where the tie used to be broken by
  // position. Replaying all 1,204 production pointer bills through this function,
  // ranking it level with `procedural` handed the group to a dateless "Referred to
  // Rules and Administration" on 13 of them, which left them reading as ordinary
  // proposals with no pointer caption at all (#757). Ranks 2, 3 and 4 all produce
  // the identical 1,195, so this takes the smallest one that does the job.
  crossReference: 2,
  chiefAuthor: 2,
  procedural: 1,
  authorAdd: 0,
};

// The bill's most-recent curated action — its plain-language label AND the real
// date of that same action — worded compactly for a result card's "Latest action:"
// line. Reuses the exact Actions-tab pipeline (buildActionTimeline) so the card and
// the tab agree on how an action reads. The tab lists newest-day-first but keeps
// source order WITHIN a day, so its top row can be an early beat of the newest day
// (e.g. "Amended on the floor") rather than that day's headline (e.g. the floor
// passage). The card wants the headline, so it surfaces the most significant beat
// of the newest day: a passage / signing / veto outranks the procedural steps
// around it. Those milestone kinds get a short phrasing that COMPLEMENTS the status
// pill instead of echoing it ("Passed the House", "Signed by the Governor", "Vetoed
// by the Governor"); every other kind keeps the tab's plain-language title. The
// `date` is the picked row's own date (humanized "Mon D, YYYY"), never the bill's
// generic latest-action timestamp — so a signed bill dates to when the governor
// signed, not to a later dateless/scheduled row. Votes aren't passed (cards don't
// load them), so passage rows keep their ACTION_RULES title and the chamber comes
// from the tally size. Returns null with no actions.
export function latestActionEntry(
  actions: BillAction[],
  now: Date,
  /** Pass the bill's author list on a surface that has one, so an author row reads
   *  with the same full names the Actions timeline shows. Without it the row keeps
   *  the clerk's surnames — which is what a list card gets, since the list endpoint
   *  serves only the chief author. */
  sponsors?: BillSponsor[],
): { label: string; date: string; kind: EventKind } | null {
  const { rows } = buildActionTimeline(actions, [], now, undefined, sponsors);
  const row = headlineRow(rows);
  if (!row) return null;
  return { label: compactRowLabel(row), date: formatNiceDate(row.date), kind: row.kind };
}

// The one row that speaks for a set of timeline rows. Enacted status is terminal
// and dominates: a signed bill reads as law however its feed is dated (the
// "Chapter number" signing row is often dateless, so it may not fall on the
// literal newest day). Grounded-answers rule 7 — enacted law must never read as a
// pending step ("Co-author added"). The signing row is collapsed to one, anchored
// to the governor-approval date. Otherwise the newest day's headline beat: the tab
// keeps source order within a day, so pick the most significant kind rather than
// the first-listed one. Null for an empty set.
function headlineRow(rows: TimelineRow[]): TimelineRow | null {
  if (!rows.length) return null;
  const signing = rows.find((r) => r.kind === 'signing');
  if (signing) return signing;
  const newestDay = rows[0].date;
  return rows
    .filter((r) => r.date === newestDay)
    .reduce((best, r) => (KIND_SIGNIFICANCE[r.kind] >= KIND_SIGNIFICANCE[best.kind] ? r : best));
}

// How a timeline row reads in a one-line summary beside a status pill. Milestone
// kinds get a short phrasing that COMPLEMENTS the status rather than echoing it
// ("Passed the House", "Signed by the Governor", "Vetoed by the Governor"); every
// other kind keeps the Actions tab's plain-language title. Shared by the card's
// "Latest action:" line and the tracked page's change block, so one event can
// never be described two different ways on two surfaces (#1009).
function compactRowLabel(row: TimelineRow): string {
  if (row.kind === 'signing') return 'Signed by the Governor';
  if (row.kind === 'passage') {
    const verb = /^repass/i.test(row.title) ? 'Repassed' : 'Passed';
    const chamber = /\bSenate\b/.test(row.title)
      ? 'Senate'
      : /\bHouse\b/.test(row.title)
        ? 'House'
        : null;
    return chamber ? `${verb} the ${chamber}` : `${verb} on third reading`;
  }
  if (row.kind === 'veto') return 'Vetoed by the Governor';
  // An author group states its COUNT and stops. This is a one-line summary beside
  // a status pill, and 30 production bills have a run of 24 or more names as their
  // newest action — HF 683 adds 31 in one go. The names belong on the Actions
  // timeline, which lists them behind a "+N more" toggle and links each one.
  // (The row's own title used to name whichever member happened to be first, which
  // read as "one person signed on" for a row that was really 31.)
  if (row.kind === 'authorAdd' && (row.authors?.length ?? 0) > 1) {
    return `${row.authors!.length} co-authors added`;
  }
  return row.title;
}

/** What a bill did since a reader last looked at their tracked list (#1009). */
export interface BillChanges {
  /** The change to lead with, worded exactly as the card's "Latest action:" line
   *  would word that same event. */
  label: string;
  /** Humanized date of that change ("Mar 18, 2026"), or '' when the record states
   *  none. Never a borrowed or inferred date — an undated step is reported with no
   *  date rather than dropped or dated by guess. */
  date: string;
  kind: EventKind;
  /** How many OTHER changes happened in the same window. The headline sentence
   *  alone would imply nothing else did. */
  earlierCount: number;
}

// The latest moment an event could have happened, in epoch ms — see
// TimelineRow.latestPossibleAtMs for why a dated row measures from the END of its
// day and an undated one falls back to when we first saw it.
function latestPossibleMoment(rawDate: string, firstSeenAt?: string): number | undefined {
  const dated = parseActionDate(rawDate);
  if (dated) return dated.getTime() + DAY_MS - 1;
  const seen = firstSeenAt ? new Date(firstSeenAt) : null;
  return seen && !isNaN(seen.getTime()) ? seen.getTime() : undefined;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Everything this bill did since `since`, or null if it did nothing.
 *
 *  Runs the SAME pipeline the Actions tab and the card's "Latest action:" line run
 *  (`buildActionTimeline`), so the tracked page can never phrase an event a second
 *  way. Two things it deliberately does not do:
 *
 *  - It does not read the feed's order as chronological. Actions arrive grouped by
 *    chamber, and `action_number` is per-chamber, so a bill's House block can
 *    precede its earlier Senate block. Every comparison is against the action's own
 *    date, never its position.
 *  - It does not count raw action rows. `buildActionTimeline` first collapses an
 *    author run, a floor-passage cluster and the repeated signing rows into one
 *    entry each and drops the duplicate rows both chamber journals record, so a
 *    busy day is reported as the handful of things that actually happened.
 *
 *  Cross-reference rows are left out: "See also HF 2446" is a pointer to another
 *  bill, not a step this one took. */
export function changesSince(actions: BillAction[], since: Date, now: Date): BillChanges | null {
  const { rows } = buildActionTimeline(actions, [], now);
  const cutoff = since.getTime();
  const changed = rows.filter(
    (r) =>
      r.kind !== 'crossReference' && r.latestPossibleAtMs != null && r.latestPossibleAtMs > cutoff,
  );
  const row = headlineRow(changed);
  if (!row) return null;
  return {
    label: compactRowLabel(row),
    date: formatNiceDate(row.date),
    kind: row.kind,
    earlierCount: changed.length - 1,
  };
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

// Web eyebrow "2025–26 LEGISLATIVE SESSION". Built from the session the API serves
// for the bill (`sessionLabel`), not derived from its id: a special session is its own
// session, so no arithmetic on the id can name it, and reading the served value means
// the eyebrow cannot disagree with the session filter (#746). "Legislative" is kept —
// it is educational.
//
// The id fallback stays for the pre-load render and for anything served without a
// session. It reads the biennium out of the id's year segment
// (94-2025-SF334 → 2025 → 2025–26), and now returns "" rather than a bare
// "LEGISLATIVE SESSION" when it cannot: on `94-2025s1-HF5` the segment is "2025s1", so
// the old regex missed and every special-session page showed a session eyebrow that
// named no session at all.
//
// No chamber prefix: on web the rail already states it three times (the "SENATE
// BILL" section label, the SF/HF code badge, and the Senator / Senate District
// rows), so a fourth statement is redundant. Mobile has no rail and so keeps the
// full "SENATE · 2025 FIRST SPECIAL SESSION" form, built inline in
// screens/redesign/BillDetailScreen — deliberately not shared with this helper.
export function bienniumEyebrow(billId: string, session?: string | SessionDisplaySource): string {
  const served = typeof session === 'string' ? session.trim() : (session?.name ?? '').trim();
  if (served && served !== 'Current session') {
    // "94th Legislature (2025) First Special Session" → "2025 FIRST SPECIAL SESSION";
    // "94th Legislature (2025 - 2026) Regular Session" → "2025–26 LEGISLATIVE SESSION".
    return formatSessionLabel(session ?? served).toUpperCase();
  }
  const m = (billId || '').match(/^\d+-(\d{4})-/);
  const year = m ? Number(m[1]) : NaN;
  if (!Number.isNaN(year)) {
    const start = year % 2 === 1 ? year : year - 1;
    return `${start}–${String(start + 1).slice(-2)} LEGISLATIVE SESSION`;
  }
  return '';
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

// The source line's "Updated {date}" segment: when we last pulled THIS bill from
// the Legislature (#861). One helper so every surface that closes with a source
// line — both bill-detail screens and the Ask answer page — shows the same value
// from the same field, which is the whole point of one date per page
// (docs/design/ui-copy-guide.md § Dates on a page).
//
// Two nearby values are deliberately NOT used. `bill.updatedAt` is the
// Legislature's last action on the bill: a real fact, already stated in the meta
// rows as "Latest action", and labelling it "Updated" told the reader our copy was
// that old. The corpus-wide max ingestion time covers every bill at once, so it can
// post-date the record it stamps — on Jul 31 2026 it would have claimed Jul 30 for
// 10,414 bills last pulled Jul 14 or 15.
//
// Returns '' when the bill carries no pull date, and `billSourceText` then drops the
// segment — never a substitute date, because a wrong date is worse than no date.
// A value that won't parse is treated the same way: formatNiceDate passes an
// unparseable string through unchanged, which would print "Updated Unknown" at the
// foot of the page, so the date has to parse before it earns the label.
export function pulledLabel(bill: Pick<Bill, 'lastPulledAt'>): string {
  if (!parseActionDate(bill.lastPulledAt)) return '';
  return `Updated ${formatNiceDate(bill.lastPulledAt)}`;
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
  /** Readable profile-URL segment carried through from the roll-call record, so
   *  the member chip links to /legislators/{slug} rather than the UUID. */
  slug?: string;
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
    slug: v.slug,
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
//
// Takes the document being linked to, NOT the bill's status: the wording and the
// destination are then decided in one place and cannot disagree. Driving it off
// status let them drift — a bill whose status reads as law but whose Session Law
// chapter has not been ingested would say "Read the full law" and open a draft.
// Nothing in production does that today (all 146 enacted bills carry a chapter),
// but the status value is a heuristic with a known over-reach (#270), and the
// Versions tab already labels each row from the row itself.
export function readLabel(linksToTheLaw: boolean): string {
  return linksToTheLaw ? 'Read the full law' : 'Read the bill text';
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

  // 1. Remove a statute citation ONLY where removing it cannot break the sentence:
  //    a leading amendatory clause, or a parenthetical aside. Both are positions
  //    where the citation is scaffolding, not content.
  //
  //    This used to strip citations ANYWHERE in the sentence, which was right for
  //    the pre-#520 phrasing it was written against ("Amends Minnesota Statutes
  //    2024, section 120B.123, to require …") and actively wrong for the
  //    plain-language text the corpus now stores, where a citation left in the prose
  //    is load-bearing. Replayed against all 10,471 production summaries, the old
  //    rule damaged 9 of the 10 it touched:
  //
  //      "formed under chapter 116A to the definition"  -> "formed under to the definition"
  //      "like Section 8 vouchers"                      -> "like vouchers"
  //      "a federal change to section 179 expensing"    -> "a federal change to expensing"
  //      "Renames … throughout Minnesota Statutes."     -> "Renames … throughout."
  //      "previously pointed to chapter 119B, but …"    -> "previously pointed to, but …"
  //
  //    "Section 8" and "section 179" are the *names* of a housing program and a
  //    federal tax provision; the others are the object of a preposition the
  //    sentence still needs. A display cleaner may not re-author a sentence, and
  //    breaking its grammar is a form of re-authoring — so it now declines these.
  //    Rule 9's own text anticipates this: the residual citations are "almost all
  //    recodification/repeal bills whose substance *is* that reference."
  const withoutLeadClause = s.replace(
    /^\s*(?:the|this)?\s*(?:bill|act|legislation)?\s*(?:amends?|amending|modifies|modifying)\s+Minnesota Statutes\b(?:,?\s*\d{4})?(?:,?\s*(?:sections?|chapters?)\s+[\dA-Za-z.]+(?:\s+to\s+[\dA-Za-z.]+)?)*(?:,?\s*subdivisions?\s+[\dA-Za-z.]+)*(?:,?\s*paragraphs?\s+\([^)]*\))*,?\s*(?=to\s+\w)/i,
    '',
  );
  // Whether the clause above was actually removed. Step 3's leading-connective
  // cleanup is only correct when it was: that "to" is the tail of a clause we cut,
  // not the reader's own opening word. Stripping it unconditionally turned the key
  // point "To qualify, the inspector general must have …" into "Qualify, the
  // inspector general must have …" (found by the corpus replay).
  const cutLeadClause = withoutLeadClause !== s;
  s = withoutLeadClause;
  // A citation kept in parentheses is an aside — "(chapter 127)" — so it and its
  // brackets come out together and the sentence around them is untouched.
  s = s.replace(
    /\s*\((?:Minnesota Statutes\b[^)]*|(?:sections?|chapters?)\s+\d[\dA-Za-z.]*[^)]*)\)/gi,
    '',
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
    // Orphaned leading connective. A leading "to" only counts as orphaned when we
    // just cut the clause it hung off; punctuation is always safe to drop.
    .replace(cutLeadClause ? /^\s*(?:,|;|:|\bto\b)\s+/i : /^\s*[,;:]\s+/, '')
    // Close up space before punctuation — but NOT before a decimal point, or
    // ", .22 caliber tube feeders" became ",.22 caliber tube feeders" on the two
    // large-capacity-magazine bills (found by the corpus replay).
    .replace(/\s+([,;:])/g, '$1')
    .replace(/\s+\.(?!\d)/g, '.')
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
// does — extends rule 9 beyond the summary). Where a point is nothing but a citation
// the cleaner CAN remove — a parenthetical aside, a leading amendatory clause — it
// collapses to empty and is dropped, rather than having an effect invented for it.
// A point whose citation is load-bearing prose is left as written, because since
// #754 the cleaner only strips a citation where removing it cannot break the
// sentence; "Amends Minnesota Statutes 2024, section 120B.123." survives intact.
// The durable fix at ingestion landed in July 2026 (#520 — the full corpus was
// re-enriched to plain language at source); this cleaner is retained as
// defense-in-depth, mirroring plainBillSummary's role for summaries: it no-ops on
// the now-clean text and still catches the ~0.9% residual statutory-reference points
// and any future bill shown before its enrichment runs.
export function plainKeyPoints(points: string[] | undefined): string[] {
  return (points ?? [])
    .map((point) => plainBillSummary(point))
    .filter((point) => /[a-z]/i.test(point));
}

// "From the bill" citation chip label — one format on every surface:
//
//     Sec. 4 · License classes          (heading present)
//     Art. 1, Sec. 2 · Appropriations   (article-structured / omnibus bill)
//     Sec. 14                           (no usable heading — number alone)
//
// The stored label is the ingest-time citation_label ("SF 334, Sec. 2." /
// "SF 334, Section 1." / "SF 334, Sec. 14. TRANSFER."), so this drops the bill
// code (the page is about one bill and the code already sits in the rail's amber
// badge), always abbreviates to "Sec.", drops the terminal period (a chip is a
// label, not a sentence), and downcases the shouted statutory heading to a
// sentence-case topic. The durable fix is at source (_chip_label in
// alethical/pipeline/ai_enrichment.py emits this shape); this mirrors
// plainBillSummary's role — it no-ops on an already-clean label and still fixes
// every bill enriched before that change.
export function citationChipLabel(label: string, sectionTopic?: string): string {
  const withTopic = (out: string) => {
    // The served topic fills in only what normalizing the label didn't already
    // produce. Composing here rather than server-side is what keeps one
    // normalizer: the stored label's shape varies by when the bill was enriched
    // ("SF 334, Sec. 14. TRANSFER." vs "Sec. 14 · Transfer"), so appending on the
    // server doubled the topic onto labels that already carried it.
    //
    // One exception: a stored topic CUT OFF mid-word is not a topic the label
    // "already produced", it is a broken one, and the served topic is the same
    // heading read whole. So the ellipsis loses to the served value, and where
    // there is no served value the fragment is dropped rather than shown — the
    // number alone is the feature's designed empty state. 2,033 of the 4,269
    // production chips whose topic came from the stored label were cut off at 40
    // characters ("Sec. 1 · Wright technical center; capital improv…"), and 2,003
    // of those have a complete served topic waiting ("Wright technical center").
    const topic = (sectionTopic ?? '').trim();
    const truncated = / · .*…$/.test(out);
    const base = truncated ? out.replace(/ · .*$/, '') : out;
    if (!/^(?:Art\. [\w.-]+, )?Sec\. [\w.-]+$/.test(base)) return out;
    if (!topic) return base;
    if (!truncated && out.includes(' · ')) return out;
    return `${base} · ${topic}`;
  };

  let s = (label ?? '').trim();
  if (!s) return '';

  // Already canonical (the shape _chip_label now stores at source) — leave it be,
  // so this cleaner no-ops rather than re-formatting its own output.
  if (/^(?:Art\. [\w.-]+, )?Sec\. [\w.-]+(?: · \S.*)?$/.test(s)) return withTopic(s);

  // Drop a leading bill code ("SF 334, " / "H.F. No. 12 — ").
  s = s.replace(
    /^\s*(?:h\.?\s?f\.?|s\.?\s?f\.?|h\.?\s?r\.?|s\.?\s?r\.?)\s*(?:no\.?\s*)?\d+\s*[,:—-]?\s*/i,
    '',
  );

  // Article prefix, when the bill is article-structured: "ARTICLE 1," → "Art. 1,".
  let article = '';
  const art = s.match(/^\s*art(?:icle)?\.?\s+([\w.]+?)\.?\s*[,:]?\s*/i);
  if (art) {
    article = `Art. ${art[1]}, `;
    s = s.slice(art[0].length);
    // An article HEADING can sit between the article number and the section
    // ("ARTICLE 1, EDUCATION FINANCE, Sec. 2. …") — drop everything up to the
    // section token; the section's own heading is the topic we show.
    const secAt = s.search(/\bsec(?:tion)?\.?\s+[\w.-]/i);
    if (secAt > 0) s = s.slice(secAt);
  }

  // Section number, then whatever follows is the statutory heading.
  const sec = s.match(/^\s*sec(?:tion)?\.?\s+([\w.-]+?)\.?(?:\s+(.*))?$/i);
  if (!sec) {
    // Not a recognizable "Sec. N" label — show it as-is, minus a trailing period.
    return `${article}${s.replace(/\.\s*$/, '')}`.trim();
  }

  const number = `Sec. ${sec[1]}`;
  const topic = sentenceCaseHeading(sec[2] ?? '');
  // No dangling middot when a section has no usable heading.
  return topic ? `${article}${number} · ${topic}` : withTopic(`${article}${number}`);
}

// One chip per cited section, for surfaces that show the section label alone.
//
// Citations are served per key point (#377), so a bill whose key points all draw
// on the same section carries one citation each — HF 4301 serves 6 citations
// resolving to only 2 sections, and the mobile strip printed "Sec. 1 · Drinking
// water regionalization planning and assistance grants" five times, every copy
// jumping to the same passage.
//
// Two chips are duplicates only when a reader cannot tell them apart AND they go
// to the same place, so the key is the rendered label plus the destination, and
// the first occurrence wins (served order is preserved). The destination is the
// section ANCHOR, not the bare id: section_id_text is not unique within a version
// (#763/#854), so keying on the id alone would collapse two genuinely different
// sections that share one. The label half is what a reader actually compares, so
// it stays in the key too — an unresolved citation (empty sectionId, chip
// disabled) then keys on the label alone, which is all there is to see.
//
// Excerpt-carrying surfaces (the web "From the bill" cards) must NOT use this —
// there each citation quotes a different passage, so the repeats carry meaning.
export function citationsBySection(citations: Citation[]): Citation[] {
  const seen = new Set<string>();
  return citations.filter((c) => {
    const key = `${citationChipLabel(c.label, c.sectionTopic)} ${citationSectionAnchor(c)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Turn a shouted statutory heading into a short sentence-case topic: "TRANSFER."
// → "Transfer". Only re-cases and trims — never re-authors, so the chip can't
// claim something the source heading didn't say. An ALL-CAPS heading downcases
// whole; a heading that already carries mixed case is left alone (its own
// capitalization is the author's).
function sentenceCaseHeading(raw: string): string {
  let s = (raw ?? '').trim().replace(/[.;:,\s]+$/, '');
  if (!s) return '';
  // A heading that is only punctuation/digits carries no topic.
  if (!/[a-z]/i.test(s)) return '';
  if (s === s.toUpperCase()) {
    s = s.toLowerCase();
  }
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// "From the bill" excerpt, for display. The italic grey type already reads as a
// quotation, so the excerpt carries no quotation marks; and it
// never ends unpunctuated, which reads as a rendering bug rather than a quote
// ("…consists of the following members"). Where the source was cut, close with a
// single ellipsis character (U+2026), never three periods.
//
// Only the wrapping quotes and the closing mark are touched — the source's
// internal punctuation and capitalization pass through verbatim, so this can
// never introduce a claim the bill text didn't make (grounded-answers rule 1).
export function citationExcerpt(excerpt: string): string {
  let s = (excerpt ?? '').trim();
  if (!s) return '';

  // Wrapping quotes (curly or straight, single or double), possibly doubled up.
  // Only ever a pair the model added AROUND the excerpt — a statutory definition
  // opens with the defined term in quotes ('"Child" means an individual …') and a
  // list can close on one, so a pair whose interior holds another quote mark is
  // the bill's own punctuation and must survive verbatim. Stripping those left
  // unbalanced quotes behind and swallowed the source's final period.
  for (let i = 0; i < 2; i++) {
    const m = s.match(/^["“'‘]([^"“”'‘’]*)["”'’]$/s);
    if (!m) break;
    s = m[1].trim();
  }

  // Collapse an ASCII "..." (or a longer run of dots) to the single glyph — but
  // only where it marks an elision. A dot run attached to a dollar sign is the
  // bill's own blank-fill for an amount it left undecided ("…is appropriated:
  // $......."), and a run after a space is a table leader; both are source text,
  // so collapsing them would rewrite the bill rather than mark our own cut.
  // (A preceding dot must block it too, or the match just starts one dot later and
  // eats the rest of a blank-fill run.)
  s = s.replace(/([^$\d\s.])\.{3,}\s*$/, '$1…');
  // A trailing comma / semicolon / colon / dash marks a cut mid-clause.
  s = s.replace(/[,;:]\s*$/, '…').replace(/\s*[—–-]\s*$/, '…');

  // Anything still ending without a terminal mark was cut mid-sentence. A closing
  // quote mark can sit after the period ('… or "Tribal governments."'), so look
  // past one before deciding the excerpt was cut off.
  if (!/[.!?…]["”'’]?$/.test(s)) s = `${s}…`;
  // The ellipsis is the only terminal mark it carries, so drop a comma or
  // semicolon the source left immediately before it ("until June 30,…").
  s = s.replace(/[,;:]\s*…$/, '…');
  return s;
}

// Safe, bill-scoped Ask suggestions that route to /ask and can't lead to a
// refusal (grounded-answers rule 2) — used when a bill has no served
// question_prompts yet (pre-re-enrichment).
export const DEFAULT_ASK_CHIPS = [
  'What does this bill do?',
  'When does it take effect?',
  'Who does it affect?',
];

// Derive the "Ask about this bill" card's chips from a bill's generated
// question_prompts. The first prompt is held back (it seeded the card's
// placeholder before the card became chips-only); the next three become chips;
// falls back to DEFAULT_ASK_CHIPS when the bill has none. Single source for web
// (SummaryTab) and mobile (BillDetailScreen) so the chip set stays identical on
// both surfaces. `placeholder` is retained for callers but no longer displayed.
export function askCardPrompts(questionPrompts: string[] | undefined): {
  placeholder: string | undefined;
  chips: string[];
} {
  const prompts = (questionPrompts ?? []).filter((p) => p.trim().length > 0);
  return {
    placeholder: prompts.length ? prompts[0] : undefined,
    chips: prompts.length > 1 ? prompts.slice(1, 4) : DEFAULT_ASK_CHIPS,
  };
}

// Scope a system-suggested chip to its bill so the /ask bill_text path resolves
// it via the HF/SF regex — a chip can never dead-end in a refusal
// (grounded-answers rule 2). The user's own typed text is left as-is.
export function scopedChipQuery(identifier: string, chip: string, sessionLabel?: string): string {
  // A special session numbers its files from 1 again, so "HF 5: …" sent from the
  // special session's own page names two bills and comes back as "pick one" instead
  // of an answer about the page you are standing on (#810). Naming the session in
  // the submitted question is what keeps a chip on its own bill. Only added when the
  // bill is not from the regular session, so every other chip is unchanged.
  const special = (sessionLabel || '').match(/\b(\w+)\s+special session\b/i);
  const scope = special ? ` in the ${special[1].toLowerCase()} special session` : '';
  return `${identifier}${scope}: ${chip}`;
}

// The chief author for THIS file's own chamber. A companion-paired bill carries
// BOTH chambers' authors as its own sponsorship rows (ingest writes the House
// companion's authors onto the Senate file and vice-versa), so a bill can have two
// chief_author entries — one per chamber — with no reliable order between them.
// Scope to the bill's own chamber first, then take the chief_author role (else the
// first sponsor). Falls back to the full list when no sponsor carries a chamber, so
// behavior is unchanged for bills without per-sponsor chamber data.
export function chiefAuthor(bill: Pick<Bill, 'sponsors' | 'chamber'>) {
  const sponsors = bill.sponsors ?? [];
  const ownChamber = bill.chamber ? sponsors.filter((s) => s.chamber === bill.chamber) : [];
  const pool = ownChamber.length > 0 ? ownChamber : sponsors;
  return pool.find((s) => s.role === 'chief_author') ?? pool[0];
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

// The document a "Read the full law / Read the bill text" link should open (spec
// `docs/mockups/bill-detail-mobile/NEXT-bill-detail-spec.md` §Official-link naming
// rules): an enacted bill's Session Law chapter, otherwise the bill's current text.
//
// The rail used to take `versions[0]`, i.e. whatever row the payload happened to
// list first — which is the "As introduced" draft. So an enacted bill's "Read the
// full law" opened the original introduction: HF 719's link went to the February
// 2025 first draft, two engrossments before the text that became Chapter 130.
// Position in the payload carries no meaning (the API sets no ordering), so pick
// the row by what it IS: the synthesized `session-law` row (#438) when the bill is
// law, else the version the record marks current, else the newest with a document.
//
// Returns the label alongside the URL so `readLabel` describes the page this link
// actually opens — see the note there on why status is the wrong input for it.
export function readDocumentLink(
  versions: BillVersion[] | undefined,
  actions: BillAction[] | undefined,
): { url: string | undefined; label: string } {
  const ordered = orderBillVersions(versions ?? [], actions ?? []).filter((v) => v.url);
  const law = ordered.find((v) => v.versionCode === 'session-law');
  const current = ordered.find((v) => v.isCurrent && !v.isCurrentPointer);
  return { url: (law ?? current ?? ordered[0])?.url, label: readLabel(Boolean(law)) };
}

// The bill's revisor STATUS/overview page — the one rail link that is deliberately
// not a document (same spec section). `Bill.official_url` is a *text* URL, because
// ingestion stores the source URL of the version it parsed, so drop the
// "versions/…" tail: both shapes the corpus holds (`/versions/2/` and the
// unofficial-engrossment `/versions/ue/1/`) resolve to the bill's status page once
// stripped. Without this, "Bill overview" opened an engrossment — the same document
// the citation links already open.
export function billOverviewUrl(officialUrl: string | undefined): string | undefined {
  if (!officialUrl) return undefined;
  return officialUrl.replace(/\/versions\/.*$/, '/');
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
