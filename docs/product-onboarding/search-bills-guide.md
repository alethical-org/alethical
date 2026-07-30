# How Search works on Alethical (plain-English guide)

<!-- describes: apps/frontend/src/screens/redesign/SearchBillsScreen.tsx, apps/frontend/src/components/search/BillResultCard.tsx, apps/frontend/src/components/search/searchPieces.tsx, alethical/api/routers/public.py -->

A quick, non-technical walkthrough of the **Search Bills** page — what you type, what
you can narrow by, and what each result shows. This is the "browse the library" page:
it finds bills by keyword or bill number. If you have a real *question*
("what bills help teachers?"), that's what **Ask** is for.

---

## Searching

- **Results update as you type** — no need to hit a button or press Enter.
- **Every word has to appear.** If you type `school funding`, you'll only see bills
  that mention *both* "school" *and* "funding" — in any order. Adding words narrows
  things down; it never broadens them.
- **Near-misses still count.** Common word variations match too, so `tax` also finds
  "taxes" and "taxing". Typos are forgiven in longer words (5 letters or more), so
  `establishng` still finds "establishing" — but a typo in a short word like `tax`
  won't match.
- **A bill number searches for that bill alone.** Entering something like `HF 2904`
  (or even just `2904`) is treated as looking up that bill by its number, not as
  keywords, so you get only that bill (`2904` on its own returns both the House and
  Senate bills with that number). You stay on the results list and tap the card to
  open it.
- **Best matches float to the top** when you've searched — the closest, most relevant
  bills come first, unless you change the order with the "sorted by" control below.

*It matches the words you type. It doesn't answer questions or find bills by concept
when the wording is different — that's Ask.*

---

## Filters (each one narrows further)

You can layer filters on top of a search — or use them on their own to browse. They
stack: every filter you add trims the list down more.

- **Chamber** — All, House, or Senate.
- **Stage** — where a bill is in the process: Introduced → In Committee → Passed House
  → Passed Senate → Passed both chambers → Signed into Law, plus Vetoed as a separate
  end state.
- **Session** — which legislative session (e.g. the 2025–2026 session).
- **Omnibus only** — show just the big, bundled "omnibus" bills.
- **Issues** — pick from tagged issues like Health, Education, Taxation. Each shows a
  live count of how many bills fall under it. You can **pick several at once**, and
  you'll see bills in *any* of them — choose Health and Education and you get bills
  about either one.

---

## Your active filters, at a glance

Every filter you turn on shows up as a little removable tag near the top:

- Tap the **✕** on any tag to drop just that one filter — the rest stay put.
- **Clear all** wipes them all in one go (your chosen session stays).

So you can experiment freely without losing your place.

---

## The results summary

Above the list you always see:

- **A running count** of how many bills match, with the "data as of" date right after
  it — for example *"420 bills as of Jul 22, 2026"*. What you're narrowing by isn't
  repeated here as a sentence: the removable tags above already name every filter
  you've turned on, and the session is always visible in its own dropdown.
- **A "sorted by" control** to change the order, and each choice really does reorder
  the list: **Best match** (offered, and the default, only once you've typed a search)
  puts the closest wording first, **Legislative progress** puts the bills furthest
  along first, so signed-into-law bills lead, and **Latest action** puts the most
  recent activity first. **Most tracked** is shown as a planned option and can't be
  picked yet.

---

## What each result (bill card) shows

- **Bill code** (like "HF 2904") and its **current stage**, with a small progress
  motif showing how far along it is.
- **A plain-language summary** of what the bill actually does, written to be readable
  rather than legalese. Both this and the headline above it are **written by AI from the
  bill's own text**, not quoted word for word from the official record. There's no badge
  on the card saying so, and that's on purpose: the bill's own page names where its
  information came from, and shows the official wording in its own "Bill Text" section, so
  you can always get to the real thing. If you want the legal wording of a bill, open the
  bill and use that section, or follow the source link to the Legislature's own site
  (revisor.mn.gov).
- **An "OMNIBUS" tag** when the bill is one of the big bundled bills.
- **Chief author** — the lead legislator, clickable to their profile.
- **The latest action and its date** — e.g. "Referred to Ways and Means · Mar 12, 2026".
- **Effective date** — for bills that became law, when the law takes effect.
- **Issue tags** for the bill.
- **A votes link** when there were recorded votes, taking you straight to how
  everyone voted.

Tap a card to open the full bill; results are split into pages with Previous / Next.

---

## When nothing matches

You get a calm message that fits what you actually did, and a **"Clear all"** button
to wipe your filters and start over:

- If you had **two or more filters on**, it says **"No bills match all of these
  filters"** and suggests removing some above, or clearing them all.
- If the only thing you did was **type a search**, it repeats your words back —
  **"No bills match 'porpoise'"** — and suggests fewer or different words, or a
  spelling check.
- If the only thing you did was **pick one filter** (an issue, a chamber, a status,
  omnibus-only), it says **"No bills match that filter"** and suggests trying a
  different one.

Your filter tags stay visible just above the message, so you can drop one without
starting over.
