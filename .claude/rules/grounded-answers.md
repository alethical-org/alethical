# Grounded-answer invariants

Standing rules for any surface that generates, displays, or advertises answers. These outlive any single build — current implementation spec: `docs/grounded-ask-spec.md`.

1. **Cite or refuse.** No generated answer ships without at least one citation resolving to an official source URL (bill → `Bill.official_url`, roll call → `VoteEvent.official_url`, legislator → `Legislator.profile_url`). Weak retrieval refuses rather than stretches. An honest "no matches" or "out of scope" is a first-class response, not an error state.

2. **Never advertise what you can't answer.** Placeholders, sample question chips, suggested follow-ups, empty states, and marketing copy may only name intents the router can currently answer. System-suggested questions (chips) must be constructed so they cannot lead to a refusal.

3. **Grounded neutrality.** Describe records, never inferred positions: "authored / co-authored N bills," "voted yes on HF xxxx" — never "supports X" as an opinion claim. Use Minnesota Legislature terminology: author / co-author (not "sponsor"/"co-sponsor") in user-facing copy. This governs *displayed strings only* — code identifiers and the data model keep their names, including the genuine `SponsorshipRole.sponsor` enum value, which is a distinct role from chief/co-author (its semantics are tracked in `docs/grounded-ask-spec.md` §4.2, Sponsorship display). Framing sentences that carry this rule are fixed UI copy owned by the layout, never LLM output.

4. **Records surfaces vs. generated answers.** Data surfaces (bill pages, Votes tab) render facts from the DB and may show anything the record contains. Generated answers carry the citation contract. Never leak record data (e.g., vote tallies) into a generated answer ahead of its cited answer path shipping.

5. **Anything linked to must be URL-addressable.** If a citation, CTA, or cross-page navigation targets a location (a tab, a highlighted passage, a roll-call row), that location must be reachable via URL (`?tab=votes`, `#anchor`) — component state cannot be linked from another page. Shareable URLs are a feature of every such surface, not an afterthought.

6. **Copy claims match shipped capability.** Product copy (hero subhead, deflection text, badges) asserts only what the shipped surfaces deliver — e.g., "how everyone voted" requires visible tallies + official-record links somewhere in the product. If a capability slips, trim the claim in the same release; never mock or ship copy around a gap.
