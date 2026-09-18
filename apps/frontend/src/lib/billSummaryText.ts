/**
 * The 3 cleaners that turn a stored AI bill summary into a plain-language line.
 *
 * They live in their own file rather than in `billDetail.ts` because the shared
 * page-wording file (`share.ts`) needs one of them, and `share.ts` loads with
 * every page: importing 1 name from `billDetail.ts` would drag that whole module
 * and its own 4 imports into every reader's first download, which measured 12,332
 * bytes over the first-load limit (`scripts/check-first-load-budget.mjs`, 18 Sep
 * 2026). Nothing here imports anything, so the cost is the 3 functions alone.
 *
 * `billDetail.ts` re-exports all 3, so every existing caller is unchanged.
 */

// First sentence of a block of prose (used for card teasers).
export function firstSentence(text: string | null | undefined): string {
  const s = (text ?? '').trim();
  if (!s) return '';

  for (let index = 0; index < s.length; index += 1) {
    const mark = s[index];
    if (mark !== '.' && mark !== '!' && mark !== '?') continue;

    let end = index + 1;
    while (/^["'”’\)\]}]$/.test(s[end] ?? '')) end += 1;

    // Punctuation inside a word or number (including a decimal) is not a boundary.
    if (end < s.length && !/\s/.test(s[end])) continue;

    // The final dot in an initialism belongs to the word when more prose
    // follows, whether that next word starts lower-case (`U.S. citizens`) or
    // upper-case (`U.S. Department`). No lookbehind, so Hermes can run it too.
    const hasMoreText = s.slice(end).trim().length > 0;
    const isInitialism = /(?:^|[^A-Za-z])(?:[A-Za-z]\.){2,}$/.test(s.slice(0, index + 1));
    if (mark === '.' && end === index + 1 && hasMoreText && isInitialism) continue;

    return s.slice(0, end).trim();
  }

  return s;
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
