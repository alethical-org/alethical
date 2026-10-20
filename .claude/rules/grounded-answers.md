# Grounded-answer invariants

**Product-behavior rules: these govern what Alethical's shipped surfaces do, not how you work
or talk.** They bind anything you build or change that generates, displays or advertises an
answer to a reader. They do not govern your own conversation, analysis, commit messages or
code comments: a chat reply needs no citations, and cite-or-refuse is a product contract, not
a chat style. The working-process rules live in `.claude/rules/workflow.md`.

Page-return controls also obey the canonical
[contextual page-return links](../../docs/design/design-principles.md#contextual-page-return-links)
requirement, including truthful matching words, copied addresses and activation. A
contradictory Design or peer handoff does not waive it.

Standing rules for any surface that generates, displays or advertises answers. They outlive
any single build; the current implementation spec is
`docs/product-onboarding/grounded-ask-spec.md`.

**Why these exist.** They are `docs/philosophy.md` made checkable: principle 1 (truth before
voice), 2 (uncover, don't translate), 4 (say only what we can do) and 5 (meet people in their
own words), turned into things a test or a reviewer can fail a PR on. Read the philosophy when
a rule feels arbitrary or a case it does not name comes up; read the rule for the line that
decides.

1. **Cite or refuse.** No generated answer ships without at least 1 citation resolving to an
   official source URL (bill → `Bill.official_url`, roll call → `VoteEvent.official_url`,
   legislator → `Legislator.profile_url`). Weak retrieval refuses rather than stretches. An
   honest "no matches" or "out of scope" is a first-class response, not an error state. For
   the generated answer paths, the standing enforcement is the acceptance suite
   `alethical/tests/test_ask_scenarios.py` (cite-or-refuse across `/ask` answer bodies, the
   grounded-neutrality authorship citations of rule 3, and the no-ungrounded-leak interim
   contract of rule 4), alongside the classification and `topic_bills` coverage in
   `alethical/tests/test_api_contract.py`.

2. **Never advertise what you can't answer.** Placeholders, sample question chips, suggested
   follow-ups, empty states and marketing copy may only name intents the router can
   currently answer. System-suggested questions (chips) must be constructed so they cannot
   lead to a refusal.

3. **Grounded neutrality.** Describe records and source-backed relationships, never inferred
   positions or causes: "authored / co-authored N bills", "voted yes on HF xxxx", never
   "supports X" as an opinion claim. Official campaign-finance filings, lobbying disclosures
   and the relationships those records explicitly name are records too; Alethical may show
   and connect them. **Influence tracking means tracking documented money, relationships and
   activity, not deciding that one caused another.** One narrow, conditioned exception
   exists for derived classifications inside signed research pieces (rule 13); nothing in it
   loosens this rule anywhere else. Never claim that a contribution or disclosed
   relationship caused a vote, reveals a hidden motive, proves influence or establishes
   corruption unless a source directly supports that specific claim. Use Minnesota
   Legislature terminology: author / co-author (not "sponsor" / "co-sponsor") in
   user-facing copy. This governs *displayed strings only*: code identifiers and the data
   model keep their names, including the genuine `SponsorshipRole.sponsor` enum value, a
   distinct role from chief/co-author (`docs/product-onboarding/grounded-ask-spec.md` §4.2,
   Sponsorship display). Framing sentences that carry this rule are fixed UI copy owned by
   the layout, never LLM output.

4. **Records surfaces vs. generated answers.** Data surfaces (bill pages, Votes tab) render
   facts from the DB and may show anything the record contains. Generated answers carry the
   citation contract. Never leak record data (e.g. vote tallies) into a generated answer
   ahead of its cited answer path shipping.

5. **Anything linked to must be URL-addressable.** If a citation, CTA or cross-page
   navigation targets a location (a tab, a highlighted passage, a roll-call row), that
   location must be reachable via URL (`?tab=votes`, `#anchor`); component state cannot be
   linked from another page. Shareable URLs are a feature of every such surface.

6. **Copy claims match shipped capability.** Product copy (hero subhead, deflection text,
   badges) asserts only what the shipped surfaces deliver: "how everyone voted" requires
   visible tallies plus official-record links somewhere in the product. If a capability
   slips, trim the claim in the same release; never mock or ship copy around a gap.

7. **Answerable means ingested and fresh: keep the corpus current.** Every answer path is
   only as current as the ingested corpus: Grounded Ask answers solely from what ingestion
   has pulled in, at the state it was pulled in. Any surface
   implying currency (the hero's "Minnesota law … where it stands", a "new law" framing,
   current-session chips) presumes the relevant session is in the corpus and its records
   reflect reality, so the active or most recent legislative session must be ingested and
   refreshed before that copy ships (the currency face of rules 2 and 6). Staleness is the sneakier failure: ingestion is
   human-triggered and skips already-ingested bills by default (`only_missing`), so a bill
   can sit in the corpus at a months-old status, and a status-stale answer misframes
   enacted law as a pending proposal. Canonical current-law questions are standing
   acceptance tests, not one-off examples: "What's in the new social media law for kids?"
   must resolve to the enacted 2026 bill (HF 4138) with a cited answer whose framing says
   *law*, not *bill*; the end-to-end Ask check rides on
   [#79](https://github.com/alethical-org/alethical/issues/79). The test is re-run, never
   retired. A persistent refusal on genuinely enacted current law, or a confidently stale
   answer about it, is a gap to close: the refusal is still correct while a coverage gap
   exists (rule 1), but the gap is a bug against this rule, and it is the maintainer's job
   to notice a canonical use case has gone unanswerable or stale and fix the corpus,
   unprompted.

8. **Follow-up chat is a standing capability: answer-first, never router-opened.** The
   intent: signed-in users can continue a single-bill answer conversationally, and the
   answer page's
   follow-up composer hands off into the existing bill-scoped chat seeded with the Ask
   question plus generated answer (`docs/product-onboarding/grounded-ask-spec.md` §9.2,
   Answer page shared elements). The hero and router never open a chat session directly:
   every Ask produces a one-shot answer page first, and chat is a continuation surface, not
   a routing destination (there is deliberately no `chat` intent in the router). Changes to
   any Ask surface must not regress the bill-scoped chat; the standing enforcement is
   `test_signed_in_chat_session_and_message_flow` and
   `test_bill_scoped_chat_missing_chunks_returns_grounded_fallback`
   (`alethical/tests/test_api_contract.py`).

   **No reader can reach it today** ([#1032](https://github.com/alethical-org/alethical/issues/1032)):
   the server (`POST /me/chat-sessions`, `GET /me/chat-sessions` and
   `GET /me/chat-sessions/{id}` in `alethical/api/routers/me.py`) and the client screen
   (`ChatSessionScreen.tsx`, which calls `useCreateChatSession` when it receives
   `subjectType: 'bill'` + `subjectId` + `title` from route params or its
   `sessionStorage` hand-off, still registered in `RootNavigator.tsx`) both work. What is
   missing is any way in: `apps/frontend/src/navigation/webRoutes.ts` redirects `/chat`,
   `/chat/new` and `/chat/sessions/{id}` to Home (each returns
   `{ kind: 'tab', screen: 'Home' }`), the Chat tab is excluded from `VISIBLE_TABS`, and
   the in-app entry point left with `BillDetailScreen.tsx`, deleted by
   [#1071](https://github.com/alethical-org/alethical/pull/1071). This is a missing door
   on a working room: do not rebuild chat.

   **Before building the composer, read `docs/product-onboarding/grounded-ask-spec.md` §9.5
   (chip-reached answer page). It constrains where a composer may go, and it wins for the
   `bill_text` state by its own opening sentence.** Its Scope paragraph specifies "no question field, no Ask
   button, no composer" on that page and makes it signed-out only, with a Bill Detail chip
   as the only way in. Its deferred-items table (`Upgrade | Issue | Today | Why deferred`)
   says what ships now: for [#137](https://github.com/alethical-org/alethical/issues/137)
   "Submitting navigates to the existing chat screen, seeded with the question + answer
   (§9.2)", and for [#84](https://github.com/alethical-org/alethical/issues/84) "only
   `bill_text` answers thread (into existing bill-scoped chat, §9.2)". Deferred are
   rendering the thread in place (#137) and topic threading (#84); the hand-off into
   bill-scoped chat is current design. Do not read Scope's "auth-gated follow-up model
   stays deferred" sentence as parking the whole capability; the table contradicts that
   reading.

   **The real gap: no section says where a *signed-in* reader continues a bill
   conversation.** §9.5 governs a signed-out page. Treat the signed-in equivalent as
   unspecified and get it framed by Design (#1032) rather than choosing placement, label or
   wording in code; §9.2 pins the Track button to hex values and pixel dimensions while
   saying nothing about the composer's appearance, so the silence is an omission, not
   freedom.

9. **Bill summaries read as plain language: no bill-number prefix, no statute citations.**
   Wherever a bill's AI summary is displayed (cards, teasers, profile bill lists, search
   results), it must read as a plain-language sentence about what the bill does: never
   lead with the bill number ("The bill HF 577 …" / "HF 1116 …"; the identifier already
   shows in the amber code badge), never carry raw statute citations ("Minnesota Statutes
   chapter 626", "section 297A.67, subdivision 40"). Preferred: "Appropriates $6,000,000 from the bond proceeds fund to
   develop new facilities." The durable fix is at ingestion: the enrichment prompt generates
   summaries this way, and a populated `plain_language_summary` wins over the formal
   `summary`.

   `display_summary` (`alethical/api/serializers.py`) implements the preference with a
   fallback, so a bill with only a formal summary still shows it. Across all 10,471 bills
   the 2 fields differ on 10,115; the plain-language one carries 8 statute citations
   against 81, 691 raw 7-digit dollar figures against 1,445, is about 60 characters
   shorter on average, and is never empty. **One deliberate exception:** the Ask router's
   bill-disambiguation step (`_resolve_bill_by_content`, `alethical/api/routers/ask.py`)
   keeps reading the formal `summary`, because that text is an LLM disambiguation aid whose
   specifics separate near-duplicate bills, and changing what it reasons over moves an
   eval-gated path (rule 1's acceptance suite; retrieval quality on
   [#400](https://github.com/alethical-org/alethical/issues/400)). Both halves are pinned by
   `test_display_summary_prefers_plain_language_and_ask_keeps_the_formal_one`. A
   reproducible 20-bill read scored the plain-language field plainer on 13, worse on 5,
   level on 2. Stored summaries for the full corpus (10,471 bills) come from an
   enrichment run on `claude:claude-sonnet-5`, so they read as plain language at source: 0% carry a bill-code prefix, and only about 0.08% of
   summaries (about 0.9% of key points) retain an unavoidable statutory cross-reference,
   almost all recodification or repeal bills whose substance *is* that reference. The
   shared display cleaners (`plainBillSummary` / `plainKeyPoints` in
   `apps/frontend/src/lib/billDetail.ts`) stay as defense in depth and apply at every
   surface that displays a summary or key points, so no surface can print a code preamble
   the others strip.

   **A display cleaner may only remove a citation where removing it cannot break the
   sentence: a leading amendatory clause ("Amends Minnesota Statutes 2024, section
   120B.123, to require …"), or a parenthetical aside.** Breaking a sentence's grammar is
   re-authoring, which this rule forbids. Stripping citations anywhere in the sentence
   damages plain-language text where a citation is load-bearing (9 of the 10 summaries it
   touches): "formed under chapter 116A to the definition" becomes "formed under to the
   definition"; "like Section 8 vouchers" becomes "like vouchers"; "a federal change to
   section 179 business expensing" becomes "…to business expensing"; "Renames … throughout
   Minnesota Statutes." becomes "Renames … throughout." **"Section 8" and "section 179" are the names of a housing program and a
   federal tax provision, not Minnesota Statutes citations.** The residual about 0.08% is
   left as written. Position-limited stripping changes 1 summary and 36 key-point lists
   corpus-wide, breaking none.

   **Two standing tests for these cleaners, covering different things.** The frontend test
   runner (Vitest) runs `apps/frontend/src/lib/__tests__/billDetail.test.ts`, which pins
   every one of the 9 production summaries an unrestricted citation strip damages, as
   must-not-change cases on every PR. **A corpus-wide change is still verified by the
   corpus replay**: transpile `lib/billDetail.ts`, run every production summary through old
   and new, and assert 0 newly broken strings and 0 emptied summaries (method: memory
   `replay-corpus-through-transpiled-lib`). The committed tests cannot see a summary nobody
   has thought of yet.

   This governs display only; the stored record and the text the `/ask` answer path reasons
   over are untouched (rule 4).

10. **Plain language is the product, so it governs what you ADD to a surface, not just how
    summaries are written.** Rule 9 constrains generated text; this constrains proposals.
    Before adding anything to a bill surface, check it against the plain-language promise,
    not only against accuracy. Two accurate proposals were rejected
    ([#731](https://github.com/alethical-org/alethical/issues/731)) because accuracy was
    never the constraint they violated:

    - **An "AI summary" badge on every bill card.** Nothing is confusable in the first
      place: the bill page names its source, official text sits in its own **Bill Text**
      section, and generated answers cite or refuse (rule 1), so the badge buys no
      separation and spends visual weight on every row. The scope doc's "clear distinction
      between official data and AI-generated analysis"
      (`docs/product-onboarding/product-scope.md` § Frontend Expectations) is met
      structurally, not by per-element provenance chrome.
    - **Displaying each bill's official statutory title** under the plain-language
      headline. A real title can be a 400-character run-on of statutory cross-references,
      so surfacing it puts back the legalese this product exists to remove. The official
      wording stays reachable (the **Bill Text** section and the source link to
      revisor.mn.gov) without being pushed at the reader; `BillHeader.tsx` passes the full
      title as a hover tooltip deliberately.

    **Never pass the statutory title as the screen-reader label; that inverts the rule.**
    `accessibilityLabel` replaces an element's visible text for assistive technology rather
    than adding to it, so a bill page can show 43 plain-language characters on screen and
    announce 900 characters of statutory cross-references to a screen-reader user, and
    heading navigation lands there first when that title is the page's only top-level
    heading. **The heading announces the plain-language title, the same words everyone
    else reads** ([#1362](https://github.com/alethical-org/alethical/issues/1362)); the
    statutory wording stays in the **Bill Text** section and behind the source link. An
    accessibility label is a substitution, not a free place for extra text; check the
    computed accessible name, not the attribute you wrote (memory
    `read-the-computed-accessibility-name`).

    The test: does this help someone understand what the bill does, or does it only prove
    we know the legal wording? The second kind belongs behind the source link, never on the
    page. Anything that makes the plain-language sentence harder to reach (a badge before
    it, boilerplate above it, a citation inside it) loses, even when it is true.

11. **An answer may only speak for as much of a bill as it read, and may never vouch for its
    own list.** Two claims, and the difference is the whole rule:

    - **Absence.** "The bill does not specify any counties" is a claim about the whole bill,
      honest only when the whole bill was read. Read 4 passages of 100 and the same
      sentence turns absence-from-a-sample into absence-from-the-bill.
    - **Completeness.** "This list includes all the cities named" is a claim about the
      model's own enumeration. **Nothing can verify that, so it is never honest**, not even
      after reading every word, because reading everything is not reporting everything.

    Both are **enforced in the answer path, not merely requested in the prompt**
    (`alethical/api/routers/me.py`): a prompt is a request, and a model doing exactly as
    instructed has shipped the bug. An absence claim is re-scoped to the text actually
    searched when the read was partial, and left alone when it was complete; a
    completeness claim is removed whatever the coverage. Every phrasing either guard
    handles is pinned by a case in `alethical/tests/test_ask_scenarios.py`, alongside
    must-not-change cases. These guards edit displayed model output, so rule 9's limit
    binds them: only an edit that cannot break the sentence, which is why one swaps a
    singular subject for a singular subject and the other deletes a whole sentence.

    What replaces the false assurance is a **layout-owned note above the answer**, driven
    by a served fact and worded by the page
    (`docs/product-onboarding/grounded-ask-spec.md` §9.5 decision 11). Above, not below:
    the reader most at risk is the one who reads least. The model describes records, the
    layout owns the framing (rule 3), and here the layout is the only half that knows the
    scope.

    **Reading more of the bill is not a substitute for either.** The overclaim rate stays
    flat (80%, 89%, 80%) across 4, 8 and 16 passages; given 4 times the text a model
    produced a longer list with a stronger completeness claim; given all 102 passages of
    HF 719 the writer listed 26 to 35 of its 98 cities. Wider windows buy completeness
    where it is affordable, not honesty, and a change that widens coverage must check it
    has not removed a caveat by making `used == total`.

    **And no count of the things asked about, however derived.** A layout-computed label
    ("Nineteen cities are named") is banned too: a reader takes "19" to mean 19 exist. HF
    719 names 98 cities and 20 counties (counted in `alethical/eval/ground_truth.py`);
    production once answered with 19 cities and "the bill does not specify any counties",
    with real, resolvable citations to the 4 passages it had read
    ([#868](https://github.com/alethical-org/alethical/issues/868)). **A count computed
    honestly from a partial list is still a fabricated fact**, in the largest type on the
    page. An answer that looks verified and is wrong is the worst failure this product can
    produce.

12. **Campaign-finance figures: 2 numbers, and never a chain.** Rule 3 forbids saying money
    caused anything; this is the display half, and both failures below are ways of being
    wrong while every number on screen is correct.

    - **The reported total and the sum of listed payments are different figures, and both
      are shown.** Minnesota names a donor only once their giving passes $200 in aggregate
      **within a calendar year** (Minnesota Statutes 10A.20 subd. 3(c); $500 for ballot
      questions); everything below reaches us as 1 unnamed lump on the filing. Read that
      precisely: it is a test on the donor's yearly total, never on the size of a gift, so
      **no surface may say that gifts of $200 or less are never named** (327,759 of the
      583,152 published rows are individually under $200). **And it is a floor on who a
      committee MUST name, never a ban on naming anyone smaller**, so no surface may say
      that a donor at $200 or less for the year is never named: the statute's words are
      that a contributor "must then be listed" once the aggregate exceeds the threshold,
      the Board's candidate handbook says sub-threshold money "should be added together and
      listed as a lump sum", and filer 18135's 2026 pre-general itemizes 215 donors at or
      under $200, $10,136.05 of them, reconciling to the cent
      (`docs/architecture/campaign-finance-system-design.md` §2.3). The sentence a page may
      print is "donors who gave $200 or less in total for the year need not be named", and
      where the page has room for the reason, "a committee may name a smaller donor but
      does not have to". The payments we can list never add up to the official total, and
      the gap is legitimate money, not an error or a hole in our data. A surface that
      prints only the sum of visible rows understates the truth and looks authoritative
      doing it. Show both and say what the difference is.
    - **A ballot-question filer's page prints $500, and every other filer's prints $200.**
      [10A.20 subd. 3(c)](https://www.revisor.mn.gov/statutes/cite/10A.20) attaches its
      figures to what the money is **for** (a candidate, or a ballot question), not to who
      files, and sets $500 for a ballot question. The Board's
      [*Independent Expenditure and Ballot Question Political Committee and Fund Handbook*](https://cfb.mn.gov/pdf/publications/handbooks/IE_BQ_handbook.pdf)
      (Last Revised 08/27/2026, the newest of the Board's 7) says $500 for these filers too
      ("over $200 to an independent expenditure committee or fund and over $500 to a ballot
      question committee or fund") and works an example on that difference. Everything the
      $200 paragraph says binds this figure unchanged.

        **Never write that our 2 sources disagree about the ballot-question threshold.**
        The apparent disagreement rests on the
        [*Political Committee and Political Fund Handbook*](https://cfb.mn.gov/pdf/publications/handbooks/PCF_handbook.pdf),
        (Last Revised 06/15/2026), which states $200 with no ballot-question carve-out (its
        only `$500` is a fundraiser guest-speaker example), but it is not the handbook
        those filers are given: its reporting instructions are for the general-purpose
        kind, and its ballot-question content concerns *local* ballot-question expenditures
        and a $5,000 **registration** threshold, a different rule from itemization that
        must never be read as a third figure. The 2 sources never disagreed; 1 answered a
        different question. `unnamedMoneyExplanation` must never say "official sources
        disagree about that threshold for ballot-question committees, so we do not state
        it", a claim about Minnesota's records contradicting each other that the records do
        not support ([#1661](https://github.com/alethical-org/alethical/issues/1661)).

        **The one thing still unread is the Board's ballot-question forms**, to see whether
        their non-itemized line carries $200 or $500. Until someone does that form read,
        $500 is the approved treatment, standing on the statute and the handbook written
        for these filers.
    - **A verified zero reads "0"; a missing value never becomes zero.** Missing itemized
      contribution figures read "Not reported". **Scoped exception for `/money/races`:**
      the compact directory reads "No itemized contributions in our records for {year}",
      naming Alethical's gap and the requested year. A missing official committee report
      total reads "Report total unavailable"; an empty itemized list does not establish a
      zero report total. A missing official money-out total follows the summary-card rule
      below: the official line is omitted and the card names Alethical's data gap. It never
      implies that the committee failed to file.
    - **Scoped lobbyist-directory order.** `/money/lobbying/lobbyists` may sum unchanged
      held Contribution rows for a completed source year, supported by the receiving
      committee's full-year comparison or complete donor-specific official-report
      evidence. An explicit report registration plus an exact name/date/amount and
      unambiguous transaction match may establish a held row's missing registration; name
      alone never does. A known unresolved donor record withholds the entire annual
      amount. Keep previously established donor and recipient relationships unresolved
      when a newer check fails; never silently drop them from an amount. Compare
      transaction multiplicity, not totals alone. Account for effective amendments and
      regular and special report periods without double-counting cumulative reports; a
      late start needs all effective period headers and makes no earlier-zero claim.
      Preserve repeated rows, signed cash and in-kind values. PDFs never create payments.
      Missing records are not $0. Label year, source dates, coverage and source links.
      This is not complete giving or influence. The exact guard is in
      [lobbying-guide.md, annual donation order](../../docs/product-onboarding/lobbying-guide.md#annual-donation-order-in-the-lobbyist-directory),
      and safe proof publication is in
      [lobbyist-donor-evidence.md](../../docs/operations/lobbyist-donor-evidence.md).
    - **Separate transfers, never a chain.** That a party gave a caucus $100,000 and the
      caucus later gave a candidate $5,000 are 2 documented facts. That the same dollars
      travelled between them is not a fact, and no filing establishes it: money is
      fungible, and once it lands in an account no record says which dollar went out. Show
      each transfer with its own amount, date and source. A network view may show the
      shape; it may not imply continuation, and no label may assert the meaning (no
      "pay-to-play", no "funding signature").

    Dates are 3 rules: each payment shows its own payment date and source; each total
    states the period it covers and its source; each page that prints a money figure shows
    1 clearly labelled freshness date
    ([#861](https://github.com/alethical-org/alethical/issues/861)).

    **A claim about who currently holds office, or whose committee this currently is,
    expires; a dated figure does not.** Those 2 take opposite treatment on the same page,
    and collapsing them either empties a page of correct figures or keeps naming a person
    nobody stands behind. A figure carries the period it covers and the day
    we copied it, so an old one is labelled rather than wrong. A current claim carries no
    such date and goes silently false the moment somebody withdraws a confirmation, so it
    is withheld once it passes its deadline, in its own words rather than the "nobody has
    confirmed one" state, while every figure beside it stays. The deadline, its arithmetic
    and the served field that carries it are in
    `docs/operations/page-load-performance-decisions.md` ("How old a current claim can be,
    end to end"); a surface never invents its own
    ([#2023](https://github.com/alethical-org/alethical/issues/2023)).

    **A count of what we hold is not a money figure, and carries no date.** "1,603
    campaigns, parties, and funds" going stale by a few dozen misleads nobody: no person is
    described by it and no amount is claimed. A dollar figure going stale misdescribes a
    named person. **The line is what the figure is, never which surface it sits on**: a
    promo, a homepage card and a marketing page all carry the date the moment they print a
    money amount, a total, or any figure attributed to a person or a committee. A count is
    still read live from the register and never pasted.

    **A label never encodes the naming rule; a sentence does.** "Individual donors over
    $200" is refused as the itemized figure's label: it names only people when named
    donors include lobbyists, other campaigns, committees, funds and party units; it reads
    as a gift size when the test is a donor's yearly total; and it reads as a bar when the
    rule is a floor. The itemized figure's label is the Board's own term, **Itemized
    contributions**, and the rule is 1 sentence under it, printed once per card.

    **A summary card prints the figures the filing states; a figure we add up ourselves
    lives where its rows are.** When an official spending total is held, show
    "Expenditures" and that total, including zero with its own sentence. When it is
    absent, show no amount and only "We do not hold an official spending total for this
    committee for this year". The sentence describes Alethical's records and never implies
    that the committee failed to file. Sums of listed payments stay beside their rows,
    never on the summary card.

    Full design: `docs/architecture/campaign-finance-system-design.md` §7. Measured
    evidence for why each of these is a real failure mode:
    `docs/research/base44-campaign-finance-findings.md`.

13. **Signed research is the one surface that may conclude, and only what a reader can
    recompute.** Alethical publishes its own research on the campaign-finance records it
    holds, as signed, dated pieces (1 piece at `/read/research/<name>`, listed on the
    `/read` page, reached from the top bar's own **Read** item, 1 destination with no
    dropdown; the `/money/reports`, `/reports` and `/reading` addresses all forward there
    permanently and directly, in 1 hop). **Research reports** names the research
    collection at `/read/research`; an individual article uses **Research** and a short
    explanatory article uses **Guide**. Minnesota's Campaign Finance Board also calls a
    campaign's filed disclosure document a report, and the reader-facing strings in
    `apps/frontend/src/lib/committeeMoney.ts` retain that distinct meaning
    (`docs/architecture/published-writing-decisions.md` §2.6, which holds the ratified
    count and the reasoning). A signed research piece is a
    distinct surface class, the only one that may do 3 things every other surface is
    banned from, each with its own condition:

    - **Add figures up across members.** Every cross-member figure recomputes from 1 pinned
      release of our loaded data, and coverage, amendments and filer identities reconcile
      against the official filings, not just the totals. The recompute runs on the live
      piece and never gates whether it posts; search-engine visibility follows point 4 of
      the publishing order (rule 9 of that order is the date it carries).

        **Where the records are ones we do not hold, that recompute is impossible, and a
        method inset takes its place.** A cross-member figure computed from records outside
        our data (such as a lobbying-spending total summed from the Board's own published
        rows) carries an inset beside its first use stating 4 things: **where the records
        came from**, named and linked; **what was added up**, precisely enough that a reader
        can pick the same column; **how far the records run**, the source's own coverage
        boundary rather than the day we read it; and **which choice in the counting could
        have moved the answer**, with what it does to the figure. A reader must be able to
        reproduce the total from the linked source; if they cannot, the figure does not
        publish. This is a substitute safeguard, not a lesser one: our own recompute is a
        check we perform and report; a reproducible method is a check the reader performs
        on us. The source can move or vanish underneath the figure, which is why
        [issue 1798](https://github.com/alethical-org/alethical/issues/1798) keeps our own
        copy of every source a published page cites. *The Money Only Goes One Way* carries
        such a figure ($886 million of lobbying spending across 3,056 organisations, from
        the Board's own rows). The inset is required by this condition, so adding one to a
        posted piece is compliance, not an edit on our own initiative, and point 2's bar on
        editing a posted piece is not engaged by it; its words are ours, as the layout's
        framing always is (rule 3), and the author's text does not change.
    - **Cite records filed with bodies other than Minnesota's Campaign Finance Board**,
      named and linked at their source. The Minnesota-only promise in
      `docs/product-onboarding/campaign-finance-roadmap.md` is a record-page promise; a
      piece says plainly, in its own sources block, every filing body it used.
    - **Define derived classifications of filers, including terms applied to named
      politicians.** A classification publishes its complete method beside its first use,
      reads only filing-derived measures (never votes, statements or anyone's politics),
      carries the records-through date it was computed on, and is introduced as our term,
      not a filing category. The test: a reader can re-run the arithmetic from the linked
      records and argue with the counting. The accepted risk: a label can travel in
      headlines without its method; the method inset, the snapshot dating and the metadata
      guards below are the mitigation, not a cure.

    What stays banned in a research piece, as everywhere else: motive and causation (rule
    3), money chains (rule 12), vouching for a list's completeness (rule 11), and
    attributing an unconfirmed committee to a person
    (`docs/architecture/campaign-finance-system-design.md` §5.1); a piece names the
    committee it read.

    **Publishing order.** The author's words go up untouched and fast, and a posted piece
    is live the same day. Our checking never delays it and never edits it.

    1. A piece's first line is its title. Its second line is the standfirst beneath it.
    2. A piece posts exactly as its author wrote it. No figure is checked before it posts,
       and no word is changed to fit a check.
    2a. The Alethical team may direct a wording change to a posted piece, and then the
        change is made. Point 2 binds us, not the team: it forbids editing an author's
        words to make a check pass or a claim safer on our own initiative; it never blocks
        a correction, clarification or addition the team asks for. A directed change is
        made in full, carries the same day's date in the piece's own history, and is
        reported back rather than negotiated. Where it alters a figure a reader has
        already seen, points 7a and below apply.
    3. Posting puts a piece on the site immediately: at its own address and on the
       `/read` page. Posting is never staged behind a check. The `/money` page carries no
       count of our pieces (`apps/frontend/src/lib/moneyLanding.ts` holds 2 lane links, and
       its counting helpers count registered filers, never our own writing).
    4. **A posted piece is visible to search engines from the day it posts.** It goes into
       the sitemap, carries no skip instruction and carries its canonical address, all
       from the 1 `indexed` flag, which is `true` on everything we publish. A hold-back
       from search stays available for a piece the maintainer identifies, never a gate
       every piece waits behind. The cost: a figure nobody has recomputed is published to
       search engines the day it posts, so the checking in points 5 and 6 is all that
       stands between a wrong figure and a search result (`docs/philosophy.md` principle
       11).
    5. Once live, every figure is checked against the records we hold and linked to them.
       A check covers that piece alone.
    6. A claim we cannot check stays in the piece and is reported to the maintainer in
       chat. Nothing is cut for being uncheckable.
    7. A line we would otherwise refuse to publish stays in the posted piece and is raised
       with the maintainer. Disagreements are settled then, never by editing what is
       already posted; the piece is already visible to search engines while that
       conversation happens, so raising it promptly is the whole protection.
    7a. When a correction is agreed, the piece's own text is updated to the corrected
        wording and the earlier wording is gone. A dated correction note at the top says
        what changed, unless the team directs that the correction carries none. Leaving a
        wrong figure visible with a line through it is 2 numbers where the reader needs 1.
    8. The masthead carries the publication date and the records-through date, and
       nothing else. Authorship and the filing bodies live in the piece itself: a piece
       published in Alethical's own name carries no byline, because the site is the
       author, and the sources block names every filing body used. A piece by a named
       outside author names them in its own text.
    9. The publication date is the day the piece posts, in Minnesota time, and it does not
       move afterwards.
    10. The records-through date is the end of the newest reporting period in the records
        the piece was computed from.
    11. A figure drawn from records we do not hold is never given another figure's date.
        The masthead's records-through date speaks only for our loaded data; the sources
        block names the outside records and the years they cover. Such a figure is not
        marked as undated in the masthead (point 8), and the cost is real: a reader may
        read the records-through date as covering every figure on the page.

    Containment keeps this exception from leaking into the record surfaces. Links run 1
    way: a piece links to record pages, a record page never links back. A piece's claims
    and derived labels appear in no record-page text and in no social-share preview or
    metadata (share previews carry title and dates only). **A guide's search-result line
    describes what that guide covers, in the guide's own words, and states no amount.**
    Describing the subject is not making the claim; the line carries no figure and no
    finding, and the share preview stays on the dates-only wording (`searchDescription` on
    each entry, `apps/frontend/src/lib/researchIndex.ts`). A research piece keeps its 2
    dates, beside a title that already names its subject. Ordinary snippets of a piece's
    body stay on: a snippet links to the page holding the method, and suppressing body
    text on a transparency product reads as hiding the very thing it publishes. Site search
    presents our own writing as its own labeled group. Every piece opens with a masthead
    carrying its publication date and its records-through date. A piece is a snapshot of
    its records-through date: newer filings earn a dated newer-data notice, never a silent
    edit. **A corrected figure is replaced by the corrected one, and the wrong figure is
    not left on the page.** No strike-through. What records the change is a dated
    correction note at the top saying what moved, so the update is never silent; the team
    may direct that a particular correction carries no note (point 7a). Both the note and
    the corrected text stay out of metadata.

    Why the risk is accepted: `docs/philosophy.md` principle 2: some truths in the record
    are visible only added up, and a named pattern with its arithmetic attached is more
    checkable, not less, than a page of raw rows.

## Campaign record counts and matching claims

- A count of imported rows is a count of records, not proof of that many distinct donations
  or payments. Mixed received-payment sources must not be labelled contribution-only.
- Name matching describes the exact source spelling, not an established identity.
  Registration matching excludes rows without that number. Explain this distinction where
  the counts appear; neither method establishes complete giving. Do not infer an identity
  link from similar names.
- Keep essential scope beside a number, with supporting detail expandable. Source copy
  dates belong to the same pinned source release as the number, not a separate
  latest-source fetch. Copy dates and filing coverage dates are different facts.
- Official report totals can include unnamed contributions; missing named rows do not by
  themselves invalidate the official total. Retain existing comparison and withholding
  gates.
- A specific known discrepancy needs a source-scoped notice. Generic limitations do not
  excuse an incorrect sum, misleading count label or unresolved known error. Do not claim
  complete trust, a confidence percentage or a distinct-donation count that the evidence
  cannot support.
- Never drop records based only on identical names, dates and amounts. Corrected and
  repeated filings require source evidence. Data replacement and calculation changes retain
  their own authorization and verification requirements.
