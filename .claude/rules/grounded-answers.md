# Grounded-answer invariants

These rules govern **shipped product surfaces**, not the agent's conversation,
analysis, commits or code comments. They bind anything that generates, displays or
advertises an answer, including prose, previews and marketing. The full rules,
exceptions and supporting evidence live in
[grounded-answer-policy.md](../../docs/architecture/grounded-answer-policy.md).
Read each linked rule whose subject the task touches before dependent work; file
extensions do not decide applicability. A missing required guide holds that work.
The numbers preserve existing references. [Workflow](workflow.md) governs how we work;
[philosophy](../../docs/philosophy.md) explains the product's purpose.

1. **Cite or refuse.** No generated answer ships without at least 1 citation resolving
   to an official source URL. Weak retrieval refuses; an honest gap is a valid result.
   Read [rule 1: citation contract and acceptance tests](../../docs/architecture/grounded-answer-policy.md#rule-1)
   for generated-answer work.
2. **Never advertise what you cannot answer.** System suggestions must not lead to
   refusal; chips, placeholders, empty states and marketing only name supported intents.
   Read [rule 2](../../docs/architecture/grounded-answer-policy.md#rule-2) before writing them.
3. **Grounded neutrality.** Describe records and directly supported relationships,
   never infer motive, causation, positions, corruption or influence. Use author/co-author
   in displayed legislative copy; code identifiers keep their actual meanings.
   Read [rule 3](../../docs/architecture/grounded-answer-policy.md#rule-3) for record-based
   claims. Signed research has only the conditioned exception in rule 13.
4. **Records and generated answers have different contracts.** DB facts on record
   surfaces do not authorize uncited generated answers or interim leaks.
   Read [rule 4](../../docs/architecture/grounded-answer-policy.md#rule-4) for data/answer boundaries.
5. **Every linked location is URL-addressable.** A tab, passage or roll-call row cannot
   depend only on local component state. Read [rule 5](../../docs/architecture/grounded-answer-policy.md#rule-5)
   and [contextual page-return links](../../docs/design/design-principles.md#contextual-page-return-links)
   for navigation, citations and sharing; a contrary Design or peer handoff cannot waive them.
6. **Copy matches shipped capability.** Trim a claim in the release that removes its
   support. Read [rule 6](../../docs/architecture/grounded-answer-policy.md#rule-6) before
   capability copy or a change that makes existing copy untrue.
7. **Answerable means ingested and fresh.** Current-law framing requires current
   records; honest refusal does not close a real corpus gap. Read
   [rule 7](../../docs/architecture/grounded-answer-policy.md#rule-7) for ingestion, current-law
   answers, freshness copy and the standing canonical acceptance checks.
8. **Chat follows a one-shot answer; the router never opens chat.** Preserve bill-scoped
   chat. The signed-out `bill_text` page has no composer; signed-in placement needs Design.
   Read [rule 8](../../docs/architecture/grounded-answer-policy.md#rule-8) and the referenced
   Ask spec before Ask/chat work, including the existing reachability gap and API-test limits.
9. **Bill summaries use plain language.** No bill-number prefix or raw statute
   citations; display cleaners cannot break grammar, alter stored records or change the
   Ask disambiguator's formal-summary input. Read
   [rule 9](../../docs/architecture/grounded-answer-policy.md#rule-9) for summaries/key points,
   retained statutory-name exceptions and the required corpus replay.
10. **Plain language governs what a surface adds.** Do not add repeated AI badges or
    statutory titles to prove provenance; keep the official text reachable. The accessible
    heading names the same plain-language title readers see. Read
    [rule 10](../../docs/architecture/grounded-answer-policy.md#rule-10) for bill-surface additions.
11. **Scope every answer to what it read.** A partial read cannot establish whole-bill
    absence. Never vouch for a generated list's completeness, even after a full read, or
    present a partial list's count as the true total. Read
    [rule 11](../../docs/architecture/grounded-answer-policy.md#rule-11) for answer scope,
    enforcement, layout-owned notes and tests; more retrieval does not replace those guards.
12. **Money figures keep their source, scope and differences.** Reported totals and
    listed-payment sums differ; missing is never zero. Transfers are separate facts,
    never a traced money chain. Current identity claims expire independently of dated figures.
    Read [rule 12](../../docs/architecture/grounded-answer-policy.md#rule-12) **before any finance
    figure, label, explanation, research or marketing**, including annual thresholds,
    ballot-question and lobbyist-directory exceptions, missing-value wording and date rules.
13. **Signed research has its own narrow publication contract.** Only this surface may
    conclude through reproducible aggregation and classifications, under its source/method
    conditions. No motive, money-chain, completeness or unconfirmed-person claims.
    Read [rule 13](../../docs/architecture/grounded-answer-policy.md#rule-13) **before research,
    publishing, editing, indexing or preview/metadata work**. Preserve author words and explicit
    publication holds; when publication is authorized, the rule's immediate-posting,
    subsequent-checking, correction and search-visibility order applies. Do not silently
    turn an ordinary generated-answer check into a prepublication gate for signed research.

## Campaign record counts and matching claims

Read [the complete counts and matching rules](../../docs/architecture/grounded-answer-policy.md#campaign-record-counts-and-matching-claims)
before using imported-record counts, source-name/registration matching or deduplication.
A row count is not a distinct-donation count; names do not establish identity; missing
named rows do not invalidate an official total. Keep source-release dates, scope,
known-discrepancy notices and existing withholding gates. Never drop identical-looking
records without source evidence or treat generic caveats as a cure for a known error.
