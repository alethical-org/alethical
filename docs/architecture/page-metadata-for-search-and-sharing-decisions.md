<!-- describes: api/page.ts, api/sitemap.ts, apps/frontend/src/lib/share.ts, apps/frontend/src/navigation/documentTitle.ts, apps/frontend/public/index.html, apps/frontend/public/robots.txt, vercel.json -->

# What each page tells search engines and link previews — decisions

**Net:** Sharing a link on social media already works and shows the right title. Search engines are
the half that is broken: every one of our 10,671 pages hands them the same nameless page, so they
look like one page repeated. The fix is two releases — first give every visitor, person or robot,
the same page with the right title in it, then put a short factual summary into that page as well.
This doc proposes both and asks Eugene to approve the approach before anything is built.

For [#1325](https://github.com/alethical-org/alethical/issues/1325). The recommendation below was
pressure-tested against an outside review; where that review corrected the first draft, this doc
says so, because those corrections changed what got built.

**Approved and built. Release 1 shipped — read §12 for what is live, and for the three places the
build had to decide something this proposal left open or got slightly wrong.** Everything above §12
is kept as written, because it is the record of *why*, and §12 is the record of *what*.

---

## 1. What is actually broken, measured

Measured 11 Aug 2026 by asking the server for the raw page (`curl`), not by looking at the browser
after the page finishes loading.

**Confirmed broken.** The home page, the legislator list, and Aisha Gomez's profile all return the
exact same file, byte for byte (same `md5` fingerprint: `393a4e47…`). Every one says
`<title>Alethical</title>`, carries the same one-line description, and points at the same preview
picture. There is no "this is the real address of this page" tag (`<link rel="canonical">`) and no
machine-readable description of the subject. `robots.txt` and `sitemap.xml` both return 404.

**Not broken, and the issue assumed it was.** Sharing a link already works. When Facebook, X,
LinkedIn, Slack, Discord, WhatsApp, or Reddit fetches a page, the server hands them a different,
correct file:

| What was asked for | What the sharer gets back |
| --- | --- |
| `/legislators/aisha-gomez` | `Rep. Aisha Gomez: Democratic-Farmer-Labor, House District 62A \| Alethical` |
| `/bills/94-2025-HF719` | `HF 719: Statewide Capital Projects and Bonding Bill \| Alethical` |

The bill description is the real plain-language summary of what the bill does. So the machinery to
write a correct title for any page **already exists and already runs in production**: a small
program (`api/social-preview.ts`) whose wording rules live in `apps/frontend/src/lib/share.ts` and
are covered by tests (`share.test.ts`, `socialPreviewEndpoint.test.ts`). It is switched on by a list
of names in `vercel.json` that includes the social networks and **does not include Google or Bing**.

**Search engines get nothing.** Asking as Google (`curl -A Googlebot`) returns the nameless page.

### Being precise about which missing piece actually hurts

The first draft of this doc overstated two things. Both corrections are load-bearing:

- **A missing `robots.txt` is not a problem by itself.** A search engine reads 404 as "no
  restrictions, crawl everything." We need the file to point at the sitemap and to make a
  deliberate choice about AI crawlers, not to fix indexing.
- **"Too late for a crawler" is only half true.** Google and Bing both run a page's programs and
  can eventually see the title the browser sets. What the first response gets you is *reliable and
  immediate*; what rendering gets you is *deferred and not guaranteed*. So the honest case for
  fixing the first response is dependability for every reader, not that Google is blind.

The headline damage is the identical titles. Pages that look the same get folded together and only
one is kept, so the other 10,670 are effectively invisible however well they are crawled.

---

## 2. The cause

**The site is built as one file.** The app is Expo / React Native Web. Its build step
(`expo export --platform web`) produces a single page skeleton, `index.html`, from the template at
`apps/frontend/public/index.html`, plus the program files that fill it in. One skeleton, one title.
The template even hardcodes the home page's address as every page's address (`og:url`).

**The server sends that one file for every address.** `vercel.json` has a catch-all rule: anything
that is not a picture or a program file gets `/index.html`. The app then reads the address bar and
draws the right page — in the visitor's browser, after delivery.

**And the app overwrites the title afterward.** A formatter in
`apps/frontend/src/navigation/RootNavigator.tsx` sets the tab title to `{screen name} | Alethical`,
which produces `Legislator | Alethical` — generic, no person's name. This matters for the fix: a
correct title injected by the server would be **overwritten a moment later** by this formatter, and
a search engine that runs the page would record the generic one anyway.

One thing is already right: `alethical.com` redirects to `www.alethical.com` (a 308), so the site
does not compete with itself across two spellings of its own name.

---

## 3. What each page should say

Rules that generate every page, not examples. They carry over to campaign finance without a rewrite.

1. **Be as specific as the address is.** If the address names one person, the title names that
   person.
2. **Promise only what the page shows**, checked against the page's real sections, and only when
   those sections have data in them.
3. **Use the word a person would use.** Never a bill's official statutory title, which is a
   paragraph of legal cross-references.
4. **Never state a number, total, or status the page cannot back.**
5. **Prefer accuracy over variety.** Two pages sharing a description is not penalised; a
   description varied into inaccuracy is worse than a repeated one.
6. **The title ends with `| Alethical`. The description never mentions Alethical.**

| Page | Title | Description |
| --- | --- | --- |
| Legislator | `{Name}, Minnesota {chamber} District {code} \| Alethical` | `See {Name}'s committee assignments, chief-authored bills, and contact information in the Minnesota Legislature.` |
| Bill | `{HF\|SF} {number} ({year}): {plain-language short title} \| Alethical` | First sentence of the plain-language summary. |
| Bill, no summary yet | `{HF\|SF} {number} ({year}) \| Alethical` | `See what {HF\|SF} {number} would do and where it stands in the Minnesota Legislature.` |
| Bill list | `Search Minnesota bills \| Alethical` | `Search bills in the Minnesota Legislature by topic, chamber, and status.` |
| Legislator list | `Minnesota House and Senate members \| Alethical` | `Find a Minnesota legislator by name, chamber, or party.` |
| Home | `Alethical: Minnesota's legislative record in plain language` | Current wording is correct; keep it. |
| Campaign finance (Sept 2026) | `{Name}: campaign finance, Minnesota {chamber} District {code} \| Alethical` | `See who contributed to {Name}'s campaign, from official Minnesota filings.` |

Two changes from what ships today, both from the outside review:

- **The year moves into the bill title.** Bill numbers repeat across sessions, so `HF 719` alone is
  ambiguous forever. The year is already in the record ID (`94-2025-HF719`).
- **Party comes out of the legislator title, and does not go into the description either.**
  District and chamber identify a person just as well, never go stale mid-term, and keep the title
  free of a partisan label that a search result shows out of context. **An earlier version of this
  bullet said party "moves into the description", which contradicted the table directly above it,
  where no description carries a party.** The table is the normative artifact and it is right: a
  description says what a reader will *find on the page*, and party is an attribute of the person,
  not a section of the profile. Mixing the two makes the sentence longer and less true to its job.
  Party stays plainly visible on the page itself.

### One live wording bug this found

The legislator description promises **"committee assignments, chief-authored bills, and recent
votes."** The profile page shows Biography, Committees, Chief-Authored Bills, Contact, Legislative
Service, and Leadership. Votes appear **only** inside the deliberately-unfinished "On the roadmap"
preview area.

That breaks `.claude/rules/grounded-answers.md` rule 6, which requires copy to claim only what the
page delivers. The outside review agreed this is a real shipped defect, not a nitpick: preview and
search text are product promises. The table above drops "recent votes." **This one-line fix should
ship regardless of what else is approved.**

---

## 4. Personalized, not generic — settled

Every legislator page carries that person's name, chamber, and district.

- **A generic phrase on 200 pages is worse than no phrase.** Search engines fold near-identical
  pages together and show one, or none.
- **A person searching searches for a name.** Someone types "Aisha Gomez district," not "Minnesota
  legislator profile." A title without the name cannot answer that.

This does not conflict with "we are not competing for attention" (`docs/philosophy.md` principle
10). Naming the page's actual subject is accuracy. What that principle forbids is keyword stuffing,
invented urgency, and titles written to be clicked rather than to be true, and rules 3–6 above
forbid all three.

---

## 5. The preview picture — one neutral card, and portraits are blocked

**Recommendation: replace the current logo with one purpose-made 1200×630 card, and do not generate
per-page images.** About half a day of work.

Per-page cards are not blocked by cost. Rendering all 10,671 once, cached, would cost well under $1
in server time. They are blocked by rights, and this is verified from the primary source rather
than assumed. The Minnesota House's photo policy (`house.mn.gov/hinfo/photo_use.htm`, updated
23 Oct 2024) states that the House **retains copyright in perpetuity**, that permission **must be
obtained in advance**, that a required credit line must accompany use, and that an image **"may not
be digitally altered in any way, including cropping."** Composing a portrait into a share card is
exactly that alteration. Storing a photo's address (`photo_url`) is not permission to place the
photo inside something new.

If per-page cards are ever built, build them **without portraits** — name, chamber, district, and
an "as of" date as text — and never with party colours, which a search result or feed would read as
the product taking a side.

### The same policy already touches what we ship today, which makes this worth asking about now

An earlier draft of this section called the display case "a much weaker claim than compositing one,
so this is not urgent." **That was wrong, and the correction matters more than the share-card
question it was a footnote to.**

We do not display these portraits unaltered, and this was measured rather than assumed. Source
portraits are **160 × 206**. Our boxes are a different shape, and `cover` fills the box and clips
the overflow:

| Surface | Box | Cut off the bottom |
| --- | --- | --- |
| Search result card (`LegislatorResultCard.tsx`) | 64 × 74 | ~10% |
| Legislator profile (`LegislatorProfileWebScreen.tsx`) | 128 × 146 | ~11% |

The same treatment is on `LegislatorProfileMobileScreen.tsx` and `RepresentativeCard.tsx`, so all
four portrait surfaces clip. Rounded corners mask the corners on top of that.

**Both chambers forbid exactly this, in the same words.** The Senate policy
(`assets.senate.mn/info/Senate Photo Use Policy.pdf`) matches the House's: copyright retained in
perpetuity, a required credit line we do not show, and an image "may not be digitally altered in any
way, including cropping." The Senate omits the House's advance-permission sentence.

**The limit on that, which matters.** The Library states its photos come from the Legislative
Manuals *and* from legislative staff photographers, so a given file may not be one either chamber
controls. Since both chambers say the same thing about cropping, the practical answer is unchanged;
ownership still decides the credit wording and whether permission is needed.

**The fix is smaller than "stop showing portraits."** Match each box to the source's 160:206 shape
(64 × 82 and 128 × 165), and `cover` clips nothing because there is no overflow. Switching to
`contain` instead would letterbox every portrait and look worse for no additional compliance. Add
the credit line both chambers require. Neither change waits on an answer from anyone.

Then send **three separate requests on the same day** — Library, House, Senate — rather than one
combined email that invites a partial answer. Tracked in
[#1334](https://github.com/alethical-org/alethical/issues/1334), which carries the full arithmetic.

---

## 6. Machine-readable description (structured data) — less than the first draft proposed

The first draft proposed describing each legislator as a `Person`. **The outside review argued that
out, and the argument holds**: Google lists no search feature that consumes a standalone `Person`
block, so it is tidy labelling with no demonstrated return. The related `ProfilePage` type is worse
than useless here — it requires the person to be affiliated with the site, and Minnesota legislators
are the subjects of our reporting, not our authors.

**Add only what a search engine actually does something with:**

- `WebSite` and `Organization` on the home page. These influence the site name and logo shown in
  results.
- `BreadcrumbList` on detail pages, but **only where the page really shows that path**. It is
  eligible for a visible feature in results. **Measured against the shipped page, ours does not
  qualify, so this comes back out — see the ruling in §12.**

**Skip for now:** `Person`, `ProfilePage`, and `Legislation` for bills. The `Legislation` type
exists and genuinely fits, but Google does not list it as supported, so it buys nothing today.

---

## 7. robots.txt and sitemap.xml

**`robots.txt`** should exist to point at the sitemap and to make a deliberate choice about AI
crawlers.

**These are two different kinds of robot, and only one of them affects whether we get found.**
Confirmed from each vendor's own documentation:

| Robot | What it does | Does allowing it help us appear in AI answers? |
| --- | --- | --- |
| `OAI-SearchBot` | Surfaces sites in ChatGPT's search | **Yes.** OpenAI states that blocking it stops the site appearing in ChatGPT search answers. |
| `Claude-SearchBot` | Improves Claude's search results | **Yes.** |
| `PerplexityBot` | Powers Perplexity's answers | **Yes.** |
| `ChatGPT-User`, `Claude-User`, `Perplexity-User` | Fetches a page when a person asks a question about it | **Yes**, for that live lookup. |
| `Google-Extended` | Two things at once: training future Gemini models **and** grounding live Gemini answers | **Yes, for the grounding half.** Google states it has no effect on ordinary Google Search either way. |
| `GPTBot` | Collects text to train future OpenAI models | **No.** OpenAI states it has "no direct impact on search appearance." |
| `ClaudeBot` | Collects text to train future Anthropic models | **No.** Anthropic describes it as the training crawler only. |

**Allow the search and user-question robots, and allow `Google-Extended`.** The first group is the
decision that affects being found. `Google-Extended` joins them because Google bundles training and
live grounding under one switch, so blocking it to avoid training would also stop our pages
supporting live Gemini answers, which is a real loss of reach for no gain.

**Recommendation on the training-only robots (`GPTBot`, `ClaudeBot`): block them for now.** This
reverses an earlier lean in this doc, which argued that allowing them fits a legibility mission.
The reversal rests on three things:

- **There is no search benefit to trade away.** Confirmed above. The only upside is that a future
  model might remember our wording without looking us up — weak, delayed, unmeasurable, and carrying
  no promise of a citation or a link back.
- **What they take is our writing, not the public record.** The underlying facts are public and free
  for anyone to use. Our plain-language summaries are original expression, and that is the part a
  training crawler collects.
- **Blocking is the reversible direction.** Allowing later costs nothing; text already absorbed into
  a trained model cannot be recalled.

The honest counter, stated plainly: allowing would fit the mission of making this record legible
wherever people ask, and a model that has read us may serve Minnesotans better. No provider promises
that outcome, which is why it loses to the reversibility argument rather than to the principle.

**A correction to the first draft of this doc.** Do **not** block the answer pages in `robots.txt`.
A crawler that is blocked from fetching a page cannot read the "do not index" instruction inside
it, so blocking actively prevents the exclusion from working. Answer pages are instead left
crawlable, served `X-Robots-Tag: noindex` in the first response, and simply left out of the sitemap.

**This doc then got [#823](https://github.com/alethical-org/alethical/issues/823) wrong, and the
correction runs the other way.** Earlier versions said #823's acceptance criteria ask to block
answer pages in `robots.txt` and should be amended. They do not. They ask for the answer route to
be "excluded from sitemaps and internal crawl discovery where practical", which is exactly right
and is what shipped. Nothing in #823 needed amending on that point. Its real error is a file path:
it names `apps/frontend/vercel.json`, which Vercel never reads. The live config is the **root**
`vercel.json`; removing the dead duplicate is
[#1343](https://github.com/alethical-org/alethical/issues/1343).

**`sitemap.xml`** should list every bill, every legislator, the home page, and the list pages. Not a
popular subset: an obscure bill is exactly the kind of question this product exists to answer.
Generated on request and cached, so a newly ingested bill appears without waiting for a deploy.
Split into one file per page type under an index, each entry carrying the **record's real last-changed
date** — not the time the sitemap was generated, which tells a search engine nothing. Leave out
`priority` and `changefreq`; they are ignored.

**Filtered list addresses must point back at the plain list.** The bill list accepts ten filter
values (`q`, `topic`, `scope`, `chamber`, `status`, `session`, `issue`, `omnibus`, `sort`, `page`),
which combine into effectively unlimited near-identical addresses. Declaring the unfiltered list as
their real address collapses them.

---

## 8. The options, and the recommendation

A single-file site cannot vary its title per address without changing how pages are served.

### A. Add Google and Bing to the existing list of names — rejected

One line of config. **The first draft rejected this as cloaking; that was overstated.** Google
permits serving robots a separately-rendered page when both get materially the same content. It
still loses, for two plainer reasons: the page our robots receive has almost no content in it, which
fails that equality test outright, and a hand-maintained list of robot names silently fails for
every crawler nobody remembered to add.

### B. Put the right tags into the same page everyone gets — recommended, release 1

A small program runs at the edge for public addresses, takes the same `index.html` the site already
serves, and writes the correct title, description, real page address, and machine-readable block
into its head before sending it. The body is untouched, so the app loads and behaves as it does now,
and robots and people receive identical HTML.

- Reuses the wording rules already written and tested in `apps/frontend/src/lib/share.ts`.
- Replaces the name-matching rules in `vercel.json` and the near-empty page in
  `api/social-preview.ts`. One path serves everyone.
- Near-zero running cost: pages are already cached at the edge (`x-vercel-cache: HIT`), so the
  program runs on a cache miss, not every visit.
- **Effort: small-to-medium.** Days.

Four things must land inside this release or it is worse than nothing:

- **Fix the title formatter** in `RootNavigator.tsx` so the app does not overwrite the correct
  title a second after the page arrives.
- **Return a real 404** for a bill or legislator that does not exist. The catch-all currently
  answers 200 to any address under `/bills/`, which at this scale means unlimited blank pages that
  look successful.
- **Return 503, not 404,** when the data service is briefly unavailable, so a hiccup does not tell
  search engines our pages are gone.
- **Escape every stored title and summary** before putting it in a tag. 10,471 AI-written strings
  are 10,471 chances to break the page.

### C. Put a short factual summary into that page too — recommended, release 2

**This is the correction that most changes the plan.** The first draft treated release 1 as "nearly
all of the SEO win." It is not. Google frequently ignores a supplied description and builds the
result text from what is visible on the page, and it weighs headings and body text when choosing a
title. A page whose body is empty on arrival has none of that to offer, gives non-rendering readers
nothing at all, and makes a JavaScript failure indistinguishable from a blank page.

So release 2 puts a small, honest snapshot into the body of the same response: the page heading, the
plain-language summary, a few key facts, the official source link, and ordinary links onward. The
app still takes over and becomes interactive exactly as now.

This is deliberately *not* the full architectural fork in
[#502](https://github.com/alethical-org/alethical/issues/502) (rebuilding navigation, or splitting
the public site into its own codebase). It is a much smaller step that #502 does not block, and its
side benefit is that a visitor sees real content before the app finishes loading.

### D. Pre-build a file per page — rejected

Generate 10,671 files at build time. The build would fetch the whole corpus every deploy, and titles
would freeze until the next one — a bill's status changes and the page keeps saying the old thing,
which breaks the freshness requirement in `.claude/rules/grounded-answers.md` rule 7.

---

## 9. What this deliberately does not do

- **No keyword-tuned titles.** A title that would rank better by naming things the page does not
  contain is out (`docs/philosophy.md` principle 10).
- **No invented facts in a description.** No count, total, or status the page cannot back.
- **No indexing only the popular records.** Obscure bills stay in the sitemap.
- **No content written for robots that a person would not see.**

---

## 10. Acceptance criteria, if approved

**Release 1 — correct tags for everyone**

- [ ] Every public address returns its own title, description, canonical address, and preview tags
      in the **first** server response, verified with `curl` and no user-agent trickery —
      *Net: the right words arrive before any of our code runs.*
- [ ] Robots and people receive identical HTML for the same address — *Net: nothing different to
      detect, so the equality question never arises.*
- [ ] The browser tab title after the app loads matches the one the server sent — *Net: the correct
      title is not overwritten a second later.*
- [ ] A non-existent bill or legislator returns 404; a data outage returns 503 — *Net: we stop
      producing unlimited blank pages that look fine.*
- [ ] Every stored title and summary is escaped before being placed in a tag — *Net: one odd
      character in an AI summary cannot break the page.*
- [ ] The legislator description no longer claims "recent votes" — *Net: we stop promising a
      section the page does not have.*
- [ ] `robots.txt` and `sitemap.xml` return real content; every bill and legislator is listed with
      its real last-changed date; answer pages are left out but **not** blocked — *Net: a full map,
      minus the pages we want unlisted, without breaking the instruction that unlists them.*
- [ ] Filtered list addresses declare the unfiltered list as their real address — *Net: thousands
      of near-identical addresses collapse into one.*
- [ ] One shared set of wording rules feeds the tab title, the first-response tags, and the share
      preview — *Net: one place to fix wording, so the three cannot drift apart.*
- [ ] Confirmed with Google Search Console's URL inspection, not by reading config — *Net: checked
      the way a search engine actually sees it.*

**Release 2 — real text in the first response**

- [ ] Bill and legislator pages carry a heading, the plain-language summary, key facts, and the
      official source link in the first response — *Net: there is something to read before the app
      loads, and something for a search result to quote.*
- [ ] That text matches what the app then displays — *Net: no separate robot-only version to keep
      honest.*
- [ ] Navigation between public pages uses ordinary links — *Net: a search engine can walk the site
      instead of relying on the sitemap alone.*

---

## 11. What Eugene needs to decide

1. **Approve the two-release shape** (correct tags now, real text next), or approve release 1 only.
   Release 1 alone is a real improvement but leaves search engines writing our result text from a
   blank page.
2. **AI training crawlers** — `GPTBot` and `ClaudeBot`. Recommended: **block for now**, because
   there is no search benefit to give up and blocking is the reversible direction. Search robots,
   user-question robots, and `Google-Extended` get allowed regardless.
3. **The portrait work in §5**, now split in two. The box-shape fix and the credit line are cheap,
   depend on nobody, and should just be done. The three permission requests need Eugene to send
   them or say who does. Both tracked in
   [#1334](https://github.com/alethical-org/alethical/issues/1334).

---

## 12. What release 1 actually shipped, and what it had to decide

Approved by Eugene 11 Aug 2026 and built the same day. This section is the record of what is live;
§1–§11 stay as written, as the record of why.

### The serving path

`api/page.ts` fetches the built `index.html` from the deployment it is running inside, replaces the
block between `<!--alethical:page-head-->` and `<!--/alethical:page-head-->` with that address's own
tags, and returns the page with the app body untouched. `vercel.json` sends every public path to it.
The user-agent-matched rewrites and `api/social-preview.ts` are deleted; one path serves everyone.

All page wording is generated by `apps/frontend/src/lib/share.ts`, which the tab title, the
first-response tags and the share sheet all read.

### Three things this proposal did not settle, and how the build settled them

**1. `/` cannot be rewritten, so the home page's tags ship inside the template.** Vercel applies
`rewrites` *after* the filesystem check, and `/` matches the built `index.html`, so a rewrite for it
would never fire. Nothing in §8 anticipated this. The fix turned out to be better than the plan:
the home page's tags are entirely static, so they live in `apps/frontend/public/index.html` inside
the same markers, and a frontend test asserts that block equals `renderPageHead(homePageMetadata())`.
Two benefits fall out — the home page stays a pure static hit with no function on its path, and a
bug in the function can never take the home page down.

**2. §3's party rule contradicts §3's own table, and the table won.** The bullet says party "moves
out of the legislator title and into the description." The table's description has no party in it.
The table is the normative artifact ("Rules that generate every page, not examples"), the
description is already ~140 characters before adding a party name, and party is plainly visible on
the profile itself. So the shipped description is the table's sentence verbatim and carries no party.
If the bullet was meant literally, it is a one-line change to `buildLegislatorShareContent`.

**Ruled: the build was right, no change.** The table is normative and the bullet was sloppy; §3's
bullet is now corrected to match. A description says what a reader will find *on the page*, and
party is an attribute of the person rather than a section of it.

**3. The breadcrumb is two levels, and the visible path it claims is a link, not a labelled trail.**
§6 says `BreadcrumbList` belongs on detail pages "only where the page really shows that path". What a
detail page shows is a link back to its list, labelled "Go back" rather than "Bills". The shipped
markup claims two levels — the list, then this page — which is the path the link really goes down,
but a reader does not see the parent *named*. If that ever reads as a stretch, the honest fix is to
label the link with its destination, not to delete the markup.

**Ruled: remove the markup, and do not relabel the link to justify keeping it.** The build was right
to flag this, and a detail it surfaced settles it. `GoBackLink` is not a parent link at all: on the
legislator profile it calls `navigation.goBack()` when there is history and only falls through to
the list otherwise. So where it leads depends on how the reader arrived — often the search results
they came from, not the list. A `BreadcrumbList` asserts a *fixed* place in a hierarchy, and this
control does not have one.

Relabelling it to "Bills" was the other option and it loses twice over: it would change shipped
copy on every bill and legislator page to justify a minor search feature, and it would make the
label wrong in the common case where the button genuinely goes back. Letting a small ranking
nicety drive visible copy is the same trade §10 already rejects. If a real breadcrumb trail is ever
designed, the markup comes back with it.

### Two defects the build found and fixed on the way

- **A bill with no plain-language short title was titled by its statutory title.** Every caller
  passed `shortTitle ?? bill.title`, and `bill.title` is the 400-character run-on of legal
  cross-references that `.claude/rules/grounded-answers.md` rule 10 exists to keep off the page. It
  would have gone straight into `<title>` for every un-enriched bill. Such a bill is now named by its
  number and year alone, and the fallback is gone from every caller.
- **Postgres returned the sitemap's dates in the session timezone, not UTC.** Reading `.date()` off a
  midnight-UTC timestamp reported the previous day. Normalised before the date is read.

### What is deliberately still open

- **Unknown addresses still answer 200 with the home page's tags.** The 404 work covers a bill or
  legislator that does not exist, which is the unbounded case (10,517 bills' worth of plausible
  addresses). An arbitrary path like `/foo` still falls through the catch-all to the app, which
  renders Home — so its tags and its content agree, but the status code is wrong.
  [#1341](https://github.com/alethical-org/alethical/issues/1341).
- **The preview picture is still the bare logo.** §5's neutral card is its own piece of work:
  [#1340](https://github.com/alethical-org/alethical/issues/1340).
- **Release 2 — real text in the first response** — shipped; see §13.

---

## 13. What release 2 actually shipped, and what it had to decide

Built 11 Aug 2026 against §8C. §1–§11 stay as written, as the record of why.

### What arrives

`apps/frontend/src/lib/pageSnapshot.ts` builds a short factual snapshot for a **bill** (plain-language
title, bill code and session, key points or summary, where it stands, chief author, and links to the
bill on revisor.mn.gov, to that author's profile, and to the bill list) and for a **legislator** (name,
chamber and district, party, committees, capitol office and phone, and links to their official chamber
profile and to the member list). `api/page.ts` drops it between the markers inside `<div id="root">`.

Lists, `/ask` and the static pages get no snapshot. A list is a list of *other* records, so a snapshot
of it would either restate the page title or invent a summary of a result set that changes per reader.

### Two things §8C did not settle, and how the build settled them

**1. Where the snapshot goes, and how the app takes over.** It goes **inside** `<div id="root">`, the
app's own mount point. React empties that element on its first render, so the snapshot leaving and the
app appearing are the same commit — no second script, no timer, no class to toggle, and no window
where a reader could see both. Measured in a real browser against the live program bundle, with a
`MutationObserver` on `#root`: **one** change, at 60 ms, from the snapshot to the app's single root
view, and no recorded state holding both. The alternative considered was a sibling element hidden by a
script once the app renders; it needs code to run at exactly the right moment, and it fails open — if
that code does not run, the page shows the snapshot *and* the app.

Putting it inside the mount point has a second consequence worth stating plainly: **if the program
fails to load, the snapshot stays**. That is the §8C requirement that a JavaScript failure stop being
indistinguishable from a blank page.

**2. How "the served text matches what the app draws" is proved.** By rendering the app. The Summary
tab and the bill header are ordinary components that render without a browser, so
`apps/frontend/src/lib/__tests__/pageSnapshot.test.tsx` feeds one real production payload through the
app's own mapper into `<BillHeader>` and `<SummaryTab>`, feeds the same payload through the snapshot
builder, and asserts every served line is a **whole text the components drew** — equality, not
containment, so a shortened or re-punctuated line fails. Seven deliberate mutations were run against
it; every one failed the test, including three that a containment check had let through (a truncated
summary, a trimmed bullet, and a count of the layout's own).

The legislator profile screen cannot be rendered that way (it needs navigation, auth and query
providers), so its guarantee is structural: the name and district come from shared helpers
(`legislatorDisplayName`, `legislatorDistrictLine` in `apps/frontend/src/lib/legislatorProfile.ts`),
both profile screens now call them, and a test fails if either grows its own copy again. Before this,
that formatting existed **three** times — in each screen and again in `api/page.ts`.

### One thing the build found

`statusLabel` and its `status_key` → label map lived in `apps/frontend/src/data/api.ts`, which the
serving function cannot load. Rather than copy the map (the drift this whole release is written
against), both moved to `apps/frontend/src/lib/billDetail.ts` beside `stageLabel`, and `data/api.ts`
imports them from there.

### One risk this created, and how it is held down

`api/page.ts` returns 503 when the shell it fetches has lost its head markers, because a nameless page
is worse than a brief outage. The body text does **not** get that treatment: it improves a page that
already works, so if its slot in the shell ever goes missing the page is served exactly as release 1
served it — correct tags, empty body — rather than failing every bill and legislator address at once.
The alarm for that case is a test on the shipped `apps/frontend/public/index.html`, which runs on
every pull request.

### What release 2 deliberately does not do

- **No snapshot on a list page**, per above.
- **No second look at the styling.** The snapshot uses the site's font and a plain column; it is on
  screen for well under a second for anyone whose program loads.
- **Not [#502](https://github.com/alethical-org/alethical/issues/502).** Navigation is untouched and
  the public site is not split out. #502 is neither started nor blocked by this.
