# How Bill Detail works

<!-- describes: apps/frontend/src/components/billDetail/*.tsx, apps/frontend/src/lib/billDetail.ts, apps/frontend/src/lib/billText.ts, apps/frontend/src/screens/redesign/BillDetailScreen.tsx, apps/frontend/src/screens/redesign/BillDetailWebScreen.tsx -->

Bill Detail helps a reader understand a proposal quickly, then check the public
record behind it. It starts with a short plain-language view and keeps the full
actions, votes, versions, and bill text close by.

## Page structure

On a wide screen, Bill Detail uses 5 addressable tabs in this order:

1. Summary
2. Actions
3. Votes
4. Bill Text
5. Versions

The active tab stays in the web address, so a shared link can open the same view.
Bill Text comes before Versions because cited passages lead there and Versions is the
lower-priority archive.

On a phone, the same record is 1 page with sticky jump controls. The order is Summary,
Actions, Votes, Versions, and Bill Text. Bill Text closes the page so the phone needs
only 1 source line.

The heading uses the short plain-language title. The full statutory title remains
available as extra context on a computer, but it does not replace the readable heading
for a screen reader.

## Summary

The Summary view leads with a short description and plain-language key points. Cited
locations stay visible. On web, **From the bill** cards show the matching quoted
passages. On phone, the lighter **CITED SECTIONS** strip links to Bill Text without
putting long quotations ahead of the record.

A cited location opens the exact Bill Text section and highlights it. The link carries
both the source id and its position because the Minnesota Revisor can reuse 1 id for
several sections. If the exact section no longer resolves, the product uses the official
source rather than sending the reader to the wrong passage.

The facts area shows where the bill stands, its chief author, companion bill, issues,
and official record links. A law with several proven start dates says **From {date}** or
**Various dates** and points to Actions for the full schedule. Alethical never invents
an effective date when the record cannot prove 1.

## Actions

Actions are shown newest first and rewritten into plain language without changing the
recorded facts.

- Green marks an enacted milestone.
- Black marks a recorded vote.
- A hollow mark means a procedural step.
- Red marks a failed or not-adopted result.
- A dashed mark and **SCHEDULED** label mean the date is still in the future.

A reference to another bill links only when the server resolved that bill inside the
same legislative session. A special-session reference, self-reference, chapter-only
reference, or unresolved bill stays plain text. Alethical may describe the target bill's
stored title and status, but it must not invent how the 2 bills are related.

An author-added row uses the bill's own sponsor list to show the person's full name and
link to their profile. If a surname could mean 2 people, the recorded name stays plain
text. The product does not guess.

The plain-language key is built only from terms that appear in that bill's actions. A
partial key is worse than none because it makes unexplained terms look accidental.

## Votes

Votes shows only roll calls that decided an outcome. Administrative motions remain in
Actions. Each roll-call card keeps its own passed or failed result even if a later event,
such as a veto, changed the bill's final status.

When member-level records are available, names are grouped by party and the card can mark
members who voted against their party's majority. That mark is descriptive, not praise or
criticism. Filters and name search work inside an opened roll call. Web may keep several
rolls open; phone keeps 1 open at a time.

If no outcome-setting roll call is recorded, the page says so and offers a grounded
question about the bill. It does not imply nobody voted.

## Versions and Bill Text

Versions lists official documents newest first. An enacted version links as **Read the
full law**. A proposal links as **Read the bill text**. The code chooses the current law
or bill document from the record rather than guessing from a file name.

Bill Text renders the current official text with section headings, change markings,
tables, an index, and linkable section positions. Its deeper parsing and completeness
rules live in [`bill-text-tab-spec.md`](bill-text-tab-spec.md).

## Track, Share, and Ask

Track and Share remain in the header at every tab. Track follows
[`bill-tracking-spec.md`](bill-tracking-spec.md). Share always points to the bill page,
not a private account state or the reader's current tab, and follows
[`sharing-guide.md`](sharing-guide.md).

The Summary view offers preset grounded questions about this bill. A bill with no roll
calls can offer the same route from Votes. Reader-written questions and unsupported
prompts are not added just because a design preview included them. The answer contract
lives in [`grounded-ask-spec.md`](grounded-ask-spec.md).

## Source line

Every web tab closes with the same quiet source line because only 1 tab is visible at a
time. The phone's single scrolling page shows the line once, at the end of Bill Text.
The wording is built in 1 place (`SourceLine.tsx`):

**Source: Minnesota Legislature · revisor.mn.gov · {updated date}**

The date is the bill record's last pull date. When no date exists, the date segment is
omitted instead of filled with another timestamp.

## Lasting source of truth

This guide owns Bill Detail's screen behavior. The shared visual and accessibility rules
live in [`design-principles.md`](../design/design-principles.md). Exact rendering lives in
the components under `apps/frontend/src/components/billDetail/`. Design previews are
temporary working files and are not permanent product records.
