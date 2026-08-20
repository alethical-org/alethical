<!-- describes: api/page.ts, api/sitemap.ts, apps/frontend/src/lib/share.ts, apps/frontend/src/navigation/documentTitle.ts, apps/frontend/public/index.html, apps/frontend/public/robots.txt, apps/frontend/scripts/generate-brand-assets.mjs, vercel.json -->

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

**Shipped 11 Aug 2026.** The one card uses the ink background and green twin-peak mark, then says
“Minnesota’s legislative record in plain language” and “With links to official sources.” It carries
no portrait, party colour, call to action, gradient, or attention-seeking decoration. The same
wording is now the image’s Open Graph and X alternative text.

The recipe lives in `apps/frontend/scripts/generate-brand-assets.mjs`. It uses a pinned SVG-to-PNG
renderer plus committed Libre Franklin and Space Grotesk font files whose open-font licences sit
beside them. `apps/frontend/scripts/check-brand-assets.mjs` rebuilds the picture and compares every
pixel, then also checks that the useful light text is present. A hand-edited image cannot drift in.

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

**At release 1, filtered list addresses pointed back at the plain list.** The bill list accepts ten
filter values (`q`, `topic`, `scope`, `chamber`, `status`, `session`, `issue`, `omnibus`, `sort`,
`page`), which combine into effectively unlimited near-identical addresses. §18 replaces that rule:
filtered pages now carry `noindex` and no canonical address, so they do not send two competing
indexing signals.

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

`api/page.ts` reads the built `index.html` bundled inside its function, replaces the block between
`<!--alethical:page-head-->` and `<!--/alethical:page-head-->` with that address's own tags, and
returns the page with the app body untouched. `vercel.json` sends every public path to it
**that matches one of its rewrites** — a path that misses them all falls through to the catch-all and
gets the home page instead, which is §15's subject. The user-agent-matched rewrites and
`api/social-preview.ts` are deleted; one path serves everyone.

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

**Removed in code on 11 Aug 2026**, from `pageJsonLd` and the `PageMetadata.breadcrumb` field it
read (`apps/frontend/src/lib/share.ts`). `WebSite` and `Organization` stay on the home page, and a
bill or legislator page now carries no machine-readable block at all.

**The web behaviour makes the ruling stronger than the native one it was argued from.** The
paragraph above cites `navigation.goBack()`, which is the *native* path. On the web — the only
target that ships, and the only one a search engine sees — the control is a real anchor whose
address is the list, and it intercepts the click only when this tab already has an in-app history
entry (`backLinkProps` and `hasInAppBackEntry`, `apps/frontend/src/navigation/links.ts`). So a
reader arriving from a search result, who is exactly the reader a breadcrumb feature would be shown
to, follows it to the list; a reader who came from the list goes back where they were. One control,
labelled "Go back", with two destinations decided by history. There is no fixed hierarchy to assert.

### Two defects the build found and fixed on the way

- **A bill with no plain-language short title was titled by its statutory title.** Every caller
  passed `shortTitle ?? bill.title`, and `bill.title` is the 400-character run-on of legal
  cross-references that `.claude/rules/grounded-answers.md` rule 10 exists to keep off the page. It
  would have gone straight into `<title>` for every un-enriched bill. Such a bill is now named by its
  number and year alone, and the fallback is gone from every caller.
- **Postgres returned the sitemap's dates in the session timezone, not UTC.** Reading `.date()` off a
  midnight-UTC timestamp reported the previous day. Normalised before the date is read.

### What shipped after release 1

- **Unknown-address 404s shipped in release 3.** `/foo`, `/BILLS/…`, and `/Home` now answer 404
  with a useful missing-page screen. The route table also keeps the retired addresses working. §16
  records the choice and proof ([#1341](https://github.com/alethical-org/alethical/issues/1341)).
- **The preview picture became the one neutral card in §5.** It carries text and brand only, with
  no portrait or party colour ([#1340](https://github.com/alethical-org/alethical/issues/1340)).
- **Release 2 — real text in the first response** — shipped; see §13.

---

## 13. What release 2 actually shipped, and what it had to decide

Built 11 Aug 2026 against §8C. §1–§11 stay as written, as the record of why.

### What arrives

`apps/frontend/src/lib/pageSnapshot.ts` builds a short factual snapshot for a **bill** (plain-language
title, bill code and session, key points or summary, where it stands, chief author, cited-section
labels with exact current-version links when the passage is known, and links to the bill on
revisor.mn.gov, to that author's profile, and to the bill list) and for a **legislator** (name, chamber
and district, party, committees, stored biography and legislative service when present, capitol
office and phone, and links to their official chamber profile and to the member list). `api/page.ts`
drops it between the markers inside `<div id="root">`.

At release 2, lists, `/ask` and static pages got no snapshot. A list is a list of *other* records, so
that release did not invent a summary of a result set that changes per reader. §18 later replaces the
list boundary for unfiltered public directory pages only: it serves the exact records and page links,
not a generated summary. Find My Legislator also receives its fixed instructions. Filtered lists,
`/ask`, and static pages other than Home and Find My Legislator still get none.

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
providers), so its guarantee is structural: the name, district, and legislative-service wording come
from shared helpers (`legislatorDisplayName`, `legislatorDistrictLine`, and
`legislativeServiceFromHistory` in `apps/frontend/src/lib/legislatorProfile.ts`), both profile screens
and the snapshot use those helpers, and tests fail if either screen grows its own name formatter
again. The stored biography passes through unchanged. Before this, name and district formatting
existed **three** times — in each screen and again in `api/page.ts` — and legislative-service wording
existed separately in the API mapper.

### One thing the build found

`statusLabel` and its `status_key` → label map lived in `apps/frontend/src/data/api.ts`, which the
serving function cannot load. Rather than copy the map (the drift this whole release is written
against), both moved to `apps/frontend/src/lib/billDetail.ts` beside `stageLabel`, and `data/api.ts`
imports them from there.

### One risk this created, and how it is held down

`api/page.ts` returns 503 when the bundled shell it reads has lost its head markers, because a nameless
page is worse than a brief outage. The body text does **not** get that treatment: it improves a page
that already works, so if its slot in the shell ever goes missing the page is served exactly as
release 1 served it — correct tags, empty body — rather than failing every bill and legislator
address at once.
The alarm for that case is a test on the shipped `apps/frontend/public/index.html`, which runs on
every pull request.

### What release 2 deliberately does not do

- **No snapshot on a list page in release 2.** §18 later replaces this boundary for unfiltered public
  directories after the internal-link measurement showed that the sitemap was their only useful path.
- **No second look at the styling.** The snapshot uses the site's font and a plain column; it is on
  screen for well under a second for anyone whose program loads.
- **Not [#502](https://github.com/alethical-org/alethical/issues/502).** Navigation is untouched and
  the public site is not split out. #502 is neither started nor blocked by this.

---

## 14. The search-result icon — settled

**Net:** The small logo beside an Alethical search result was being redrawn by Google in a way that
sliced the corners off our mark. The favicon now ships an opaque brand-ink background with the mark
inset, which is the only framing Google preserves. This reverses the transparent background chosen in
[#371](https://github.com/alethical-org/alethical/pull/371); that PR's reasoning was sound for browser
tabs and had not been measured against search results.

### What Google actually does to a favicon, measured

Google's own guidance
([Favicon in Search](https://developers.google.com/search/docs/appearance/favicon-in-search)) states
only that the icon must be square and at least 8×8, and recommends larger than 48×48. It says nothing
about resizing, cropping, transparency, or the shape the icon is displayed in. Those were measured
directly on Aug 11 2026 by comparing what a site serves against what Google stores for it
(`https://t1.gstatic.com/faviconV2?...&url=<site>&size=<n>`, the endpoint the results page reads):

- **Google trims the transparent margin away and rescales the artwork to fill the square, preserving
  aspect ratio.** Our own icon was the proof. We served a mark occupying 78% of its canvas, with ~10%
  transparent padding on every side; Google stored it at 48×48 with the mark filling the full height.
  `docker.com` confirms the rule rather than contradicting it: its source is a wide mark with zero
  horizontal padding and ~9%/11% top/bottom padding, and Google's copy reproduces that padding almost
  exactly — because an aspect-preserving fit of a wide mark *recreates* vertical padding. `nodejs.org`
  looks untouched for the same reason: its artwork already fills the full height.
  **So padding inside a transparent favicon cannot be relied on. It is discarded.**
- **An opaque favicon's framing is preserved exactly.** The trim operates on the transparent bounding
  box, which for an opaque image is the entire canvas, so there is nothing to remove. Measured on
  three sites that inset their mark inside an opaque square and get that inset back unchanged:
  `openai.com` (15.6% per side), `anthropic.com` (16%), `mozilla.org` (17%).
- **The results page then draws the icon inside a circle.** With a transparent icon the container's
  own fill shows through, which is the white disc visible in a dark-mode result.

Put together, those three explain the reported bug: our padding was discarded, the mark was scaled to
the full square, and the circular crop then cut through the mark's two widest points — its bottom
corners — leaving it looking low and off-center.

### The decision

`apps/frontend/scripts/generate-brand-assets.mjs` now generates `assets/favicon.png` with
`background: BRAND_INK` and `scale: 0.65`, replacing `background: null` and `scale: 0.78`.

- **Opaque, because nothing else survives the pipeline.** There is no transparent framing that works:
  any padding is removed, so the mark always ends up edge-to-edge and always meets the circle.
- **Brand ink, because every other icon we ship already uses it.** `assets/icon.png`,
  `public/icon-192.png`, `public/icon-512.png`, and `public/apple-touch-icon.png` are all a `#11150f`
  square carrying the green mark. The shared-link card keeps that same ground and mark while adding
  its factual wording. The favicon was the only transparent one. Green on ink is also far more
  legible than green on white, and a light-mode result went nearly invisible with a transparent icon.
- **0.65, because that is the largest mark whose corners clear the circle.** The mark's widest points
  are its bottom corners, at `sqrt(1 + (84/82)²) / 2 = 0.716` of the mark's height from center, so a
  circular crop starts cutting them once the mark passes 0.699 of the canvas. 0.65 keeps a ~6.8%
  margin and lands at a 16.6% inset per side — the same band as the three opaque sites above.
- **What #371 gave up.** A transparent icon blends into a light or dark browser tab strip; an opaque
  one is always an ink tile there. That was #371's stated reason and it is a real cost. It loses to a
  broken search result, and it is the majority choice among comparable sites: of six measured,
  `openai.com`, `anthropic.com`, `mozilla.org`, `github.com` and `figma.com` all ship opaque favicons.

### Reconsider only if

Google stops trimming transparent margins, or stops drawing the icon in a circle. Both are observable
with the `faviconV2` endpoint above; neither is documented, so neither should be assumed stable.
The mark's own geometry (`MARK_PATH` in `generate-brand-assets.mjs`) is unchanged by this.

### Not changed, deliberately

Our `favicon.ico` tops out at a 48×48 layer, and Google recommends larger. It is not a defect here:
Google stores 48×48 and the results page displays ~18px, so 48 is already more than a 2× display
needs. Raising it would mean a second declared icon file competing with the one Expo injects, for no
visible gain.

---

## 15. What Google Search Console actually reports, and the one bug it exposed

**Net:** Search health is sound and there is nothing structurally wrong. The sitemap had never been
submitted, and now is. The one real defect found is that a valid address with a trailing slash served
the **home page** instead of the record — fixed here by a one-line redirect.

Measured in Search Console and against production on 11 Aug 2026, after release 2 shipped.

### The account setup

| Question | Answer |
| --- | --- |
| Property type | **Domain** property (`sc-domain:alethical.com`), so it covers `www` and the bare domain together. A URL-prefix property would have missed one of them. |
| Verification | Verified owner. Property added **1 Aug 2026**, so every number below covers at most 10 days. |
| Sitemap | **Was never submitted.** Submitted 11 Aug 2026. |
| Security issues | None detected. |
| Manual actions | None detected. |
| `robots.txt` status | "All files are valid". |
| Search generative AI | Set to **Include**. |
| Crawl volume | 6,420 crawl requests in 90 days. |

### What Google has indexed, and what it has not

**557 pages indexed, 15 not.** All 557 were crawled between 1 and 7 Aug 2026 — *before* release 1 —
so they are indexed against the old identical-metadata pages and will improve as Google re-crawls.
`/bills/94-2025-HF719` itself is still **unknown to Google**: never crawled, no referring page. The
live test on it returns "URL is available to Google", so the only thing missing was discovery, which
is what submitting the sitemap addresses.

The 15 exclusions are all classes **release 1 already fixed**, which is why no further work follows
from them:

| Reason | Count | What they actually are | Status |
| --- | --- | --- | --- |
| Duplicate without user-selected canonical | 10 | 8 legislator profiles reached by database id (`/legislators/288c5211-…`), one `?tab=text` address, and `/Home` | The id address now declares the slug address as canonical, and `?tab=text` declares the plain bill. Verified live. |
| Page with redirect | 4 | The bare domain redirecting to `www` | Intended. |
| Not found (404) | 1 | — | Intended. |

**Answer pages were indexed before `noindex` shipped.** Two `/ask?q=…` addresses are in the index,
crawled 5 Aug. They now serve `X-Robots-Tag: noindex`, so Google drops them on re-crawl. No removal
request is needed; the mechanism is already correct.

### There is real search demand, and it is exactly our corpus

Over 31 Jul – 9 Aug: **239 impressions, 2 clicks, average position 14.7.** Small, and expected for a
10-day-old property. The queries are the informative part — they are legislator names and bill
contents, not brand searches: *"lucille rehm recall minnesota house 2025"*, *"senator heather
gustafson"*, *"leah hanson mankato"*, *"pete johnson mn"*, *"minimum wage senate bill 1052 newest
text phased minimum wage dates"*. People are already asking Google the questions this product exists
to answer, and landing on pages that until 11 Aug had no title of their own.

### Core Web Vitals cannot be judged yet

Both mobile and desktop report "not enough usage data in the last 90 days". This needs real visitors,
not a fix. The known risk is unchanged and already tracked: a single 1.79 MB JavaScript file plus a
render-blocking Google Fonts stylesheet is what a first visit waits on
([#502](https://github.com/alethical-org/alethical/issues/502)).

### Crawling 10,725 addresses does not need staging

The three sitemap files are 8, 10,517 and 200 addresses, all far under the 50,000-URL and 50 MB
per-file limits (`bills.xml` is 1.0 MB). Splitting by record type is already the staging that
matters. Deliberately withholding addresses would slow discovery rather than protect anything: a
sitemap is a hint about what exists, and Google sets its own crawl rate.

### The bug: a trailing slash served the home page

Every rewrite in `vercel.json` matches **one** path segment (`/bills/:id`). A trailing slash adds an
empty segment, so the address misses its rewrite, falls through to the catch-all, and is served
`/index.html` — the static export, which carries the **home page's** title, description and
`<link rel="canonical" href="https://www.alethical.com/">`. Measured byte-for-byte identical to the
home page:

| Address | Served before | Did a person reach the record? |
| --- | --- | --- |
| `/bills/94-2025-HF719/` | Home page | Yes — the app strips the slash after loading |
| `/legislators/aisha-gomez/` | Home page | Yes — same |
| `/bills/` and `/legislators/` | Home page | Yes — same |
| `/BILLS/94-2025-HF719`, `/Bills`, `/Home` | Home page | **No** — stranded on the home page |
| `/foo` | Home page, HTTP 200 | No such record |

**The fix is `"trailingSlash": false` in the root `vercel.json`.** Vercel then answers any
slash-terminated address with a 308 redirect to the same address without the slash, which reaches the
right rewrite and serves the right page. The site root is unaffected. Verified on this change's
preview deployment before merging, because the behaviour belongs to Vercel's router and no local test
can produce it; `trailingSlashRedirect.test.ts` then holds the setting in place so it cannot be
dropped silently.

Chosen over adding a second rewrite for each slash-terminated form, because a redirect leaves **one**
address per record rather than two that both work.

### What release 3 later fixed

- **Wrong-case and unknown addresses now answer 404.** `/BILLS/94-2025-HF719`, `/Home`, and `/foo`
  use the useful missing-page response described in §16. They do not redirect because changing the
  letters could silently guess at a page the reader did not ask for.
- **Detail pages carry no structured data.** `BreadcrumbList` was deliberately removed in
  [#1357](https://github.com/alethical-org/alethical/pull/1357); §6 already explains why `Person` and
  `Legislation` were dropped. Nothing here changes that.

### A latent title risk that #1355 removed the same day, measured before and after

Worth recording because it was invisible to everything above: the **first response** has always
carried exactly one `<h1>` and one `<h2>` on a record page, correctly. The page **after the app
loads** did not, and that is also what Google sees, because it runs our JavaScript.

Measured on `https://www.alethical.com/bills/94-2025-HF719`, before and after
[#1363](https://github.com/alethical-org/alethical/pull/1363):

| | Before | After |
| --- | --- | --- |
| `<h1>` count | **52** | **1** — the bill's own title |
| First `<h1>` in document order | `Grounded answers on Minnesota law`, **hidden**, the home page's hero | the bill's own title, visible |
| `<h2>` / `<h3>` | 1 / 0 | 7 / 44 |

**Why it was a search risk and not only an accessibility one.** Google's title-link guidance treats
a heading that is boilerplate and repeated across a site as a reason to *replace* what a page
declares about itself. That heading was identical on every page and sat first. The practical risk
was low — Google discounts hidden text, and since release 1 every page declares a strong unique
`<title>` — but it pointed one way only.

**Resolved rather than reduced:** the hero text is still in every page's markup, but it is a heading
only while Home is the **focused screen** (`useIsFocused()`), not merely while the address is `/` —
these are tabs in one app, so focus is the honest condition. Everywhere else it is a plain
container, which the heading fallback cannot reach. On Home it is the `<h1>`, which is correct.

**A CI test now guards this, but read what it actually guards.**
`apps/frontend/src/lib/__tests__/headingLevels.test.ts` matches **patterns in the source** — every
`header` role carries an explicit level across 20+ files, a bill screen and a profile screen each
declare exactly one `aria-level={1}`, and the hero's level is gated on focus. That catches the
regression that caused this, which was a missing level rather than a wrong one. It does **not** read
a rendered page, so it cannot count the 52 `<h1>`s that made this visible: **a rendered-DOM check in
a real browser is still the only way to see what Google sees**, and the numbers above came from one.
Do that, rather than trusting the suite, before claiming a heading count to anyone outside the repo.

**The list pages were the case to watch**, because they serve no heading at all, so the app's
heading is Google's only one. Verified they do not contradict the served title: `/bills` declares
`Search Minnesota bills` and heads `Search bills`; `/legislators` declares `Minnesota House and
Senate members` and heads `Search legislators`.

### The two pages whose heading disagrees with their title — ruled

[#1363](https://github.com/alethical-org/alethical/pull/1363) checked all six pages that serve no
heading of their own, since on those the app's heading is Google's only one. Four agree with the
served title (`/bills`, `/legislators`, `/find-my-legislator`, `/tracked`). Two do not, and both were
referred here because changing either means changing **visible copy**, not markup.

**`/about` — left as it is, deliberately.** Its only top-level heading is the slogan
`TRUTH, UNCONCEALED`, while it serves `<title>About us | Alethical</title>`. It was put to this
section as the boilerplate-repeated-across-the-site case that Google's title-link guidance describes.
**Measured, it is not that case:**

- The slogan sits in **2 to 4 places in every page's markup** (the footer, the home eyebrow) but is a
  **heading on exactly one page — `/about`.** Not a heading on Home, `/bills` or a legislator profile,
  and never in any served HTML. Repeated *text* is not a repeated *heading*, and Google's fallback
  keys off the latter.
- `/about` serves a specific, unique, accurate `<title>` plus a real description, so the fallback has
  no reason to fire at all.

So the search argument does not carry, and the remaining argument is a weaker one: the page's heading
does not name the page, which every other page now does, and a reader navigating by headings hears a
slogan where they expect a location. That is real but minor — a screen reader announces the page
title on load, so the reader is not lost — and the fix needs a headline that does not exist on the
page today, which is designed copy and a product call rather than a correction. **Not worth spending
new visible copy on. Left alone as a decision, not an oversight.**

**`/ask` — not a search matter at all, and the referral misread it.** It was flagged as having no
heading and as a thin page worth attention. The second half does not hold: **`/ask` serves
`X-Robots-Tag: noindex` and appears 0 times across all three sitemap files** (§7, and verified again
here). A page we ask Google not to index cannot lose a title to a heading, and cannot be judged as
thin content. There is nothing here for search to win or lose.

What is left is a genuine accessibility gap — zero headings on a real page — which belongs to
[#1355](https://github.com/alethical-org/alethical/issues/1355)'s one-heading-per-page convention
rather than to this section. **The conservative fix is to head it with the words it already serves as
its title, `Ask about Minnesota legislation`**: it invents no copy, claims no capability the title
does not already claim, and cannot contradict the served title. Worth naming the tension rather than
hiding it: `.claude/rules/grounded-answers.md` rule 2 says a surface may only name intents the router
can answer, and this page cannot take a question — its body says to pick a bill and ask from there.
The heading is acceptable because the **title already says exactly this** and the body corrects it
immediately; a heading that invited a question here would not be.

### Reconsider only if

Google reports trailing-slash addresses as duplicates *after* the redirect ships, which would mean
the redirect is not being followed. Observable in the Page indexing report under "Page with
redirect".

---

## 16. Release 3: one route reader decides whether an address exists

Built 11 Aug 2026 for [#1341](https://github.com/alethical-org/alethical/issues/1341).

### Decision

At release 3, `apps/frontend/src/navigation/webRoutes.ts` was the only list that decided whether an
app address was real, retired but supported, or unknown. The browser used that result to choose a
screen, and `api/page.ts` used the same result to choose an HTTP response. The final rewrite in the
root `vercel.json` sent every non-file app address through that page function. §18 later moved
retired Search, Chat, and Account addresses into host redirects that run before the page function.

This replaces the earlier split in which `vercel.json` knew only current public pages,
`webRoutes.ts` knew retired forwards, and the final catch-all sent everything else to Home. The split
made a typo look like a successful page even though the server already knew how to return 404.

### Result

- `/foo`, `/Home`, and wrong-case record shapes answer **404**, carry `noindex`, have no canonical
  address, and show the normal site frame with links to Home, Bills, and Legislators.
- A missing bill or legislator keeps its record-specific missing state and the same 404 status.
- `/search` still opens Bills with its filters. Old vote addresses still open that bill's Votes tab.
  `/chat`, `/chat/new`, `/chat/sessions/{id}`, and `/account` still open Home.
- Real files, the site root, the sitemap functions, and the app's own program files are checked before
  the final app-address rewrite and keep their existing responses.
- Paths are case-sensitive. A wrong-case address is not corrected because guessing at capital letters
  could turn an honest typo into a different page later.

### Proof held in the repository

`webRoutes.test.ts` pins unknown, wrong-case, real, and retired route results.
`pageEndpoint.test.ts` sends those public addresses through the same entry the host calls and checks
their status, tags, body, and data-service failure behavior. `trailingSlashRedirect.test.ts` pins the
single final page rewrite and proves no route can fall through to `index.html` as Home.

---

## 17. Protected previews read the page shell locally

Built 11 Aug 2026 for [#1359](https://github.com/alethical-org/alethical/issues/1359).

### The failure

The page function used to fetch `index.html` from its own public preview address. Vercel protects
preview addresses with its login gate, and the second request did not carry the reader's login. The
function therefore returned its 503 outage message for every bill, legislator, list, and unknown
address on a preview even though production worked.

### The fix

The root `vercel.json` now includes `apps/frontend/dist/index.html` in the `api/page.ts` function.
The function reads that deployed, read-only file once per warm instance. Vercel's build output maps
the generated file to the same path inside the function, so it contains the final program filename
and other changes made by the web build.

This removes the request through Vercel's login gate and removes a network request from every cold
function instance. Preview protection remains on. The existing automation-bypass secret remains
available for outside test tools, but page serving does not depend on it.

### Alternatives rejected

- **Send the automation-bypass secret on the self-request.** It is smaller code, but it keeps the
  self-request, adds a secret to the serving path, and lets a missing project setting make every
  preview page look down.
- **Forward the reader's preview login cookie.** It still keeps the self-request and works only for
  readers whose first request used that cookie. It does not make the function independent of the
  login gate.
- **Turn preview protection off.** It would make unfinished releases public to fix an internal
  request the site no longer needs.

### Proof

`pageEndpoint.test.ts` supplies the bundled file separately from data-service requests, proves the
function never asks its own deployment for `index.html`, and keeps the real data-outage 503 checks.
`releaseCaching.test.ts` pins the build-file inclusion in the root `vercel.json`. A protected Vercel
preview must serve a real bill title and snapshot before this change merges.

---

## 18. Crawlable public directories

Decided 11 Aug 2026 for [#1396](https://github.com/alethical-org/alethical/issues/1396).

### What the next measurement found

The sitemap was accepted with 10,725 addresses, but Google Search Console's Links report counted only
769 internal links: 474 to Home, 289 to Terms, 2 to Privacy, and 1 each to four record pages. The
first response for `/bills` and `/legislators` had the right title but an empty body, so the sitemap
was doing almost all of the discovery work for the record corpus. A sitemap is a discovery hint; it
does not replace the ordinary links Google asks every important page to have.

The answer is not the full navigation rebuild in
[#502](https://github.com/alethical-org/alethical/issues/502). Detail pages already serve useful
text. The smaller missing piece is a walkable path from Home through both directories to every
record.

### Decision

- The static Home shell carries the exact signed-out heading, introduction, and links to Bills,
  Legislators, and Find My Legislator. `/` never reaches the page function, so Home's body has to live
  in `apps/frontend/public/index.html`; a test compares it byte-for-byte with the shared builder.
- Find My Legislator serves its fixed heading and instructions before the app loads, so the 3rd Home
  link does not lead a non-program reader back to an empty body.
- An unfiltered Bills page serves the same 10-record slice the app requests: whole-legislature scope,
  progress order, and normal links to each bill. An unfiltered Legislators page reads the complete
  current roster, applies the app's name order, and serves the same 12-record slice.
- The page function asks the Bills endpoint for its small directory view: bill id, plain short title,
  status, and special-session identity. It does not fetch card actions, sponsors, statistics, or
  effective dates merely to print 10 links on a first response.
- Page 1 keeps `/bills` or `/legislators` as its canonical address. Page 2 and later use their own
  `?page=N` canonical address and add `Page N` to their titles and descriptions. Previous/Next plus
  jumps of 10, 100, and 1,000 pages keep every bill within a few dozen normal links instead of a
  chain about 1,000 pages long. A requested page beyond the real last page answers 404 with
  `noindex`; after the app starts it stays on the same useful missing-page screen instead of being
  clamped to a real last page or changed into an ordinary empty list.
- Typed searches and filter combinations receive no canonical address, no record snapshot, and a
  `noindex` instruction. They remain useful to a person after the app runs without becoming
  thousands of near-copy search pages. [Google's current pagination guidance](https://developers.google.com/search/docs/specialty/ecommerce/pagination-and-incremental-page-loading)
  recommends `noindex` for unwanted filtered or sorted results. Omitting the canonical tag also
  avoids calling a filtered result set a duplicate of the different plain directory.
- The app and the serving function import the same 10- and 12-record page-size constants. Bill link
  text uses the bill code, its plain short title when one exists, and its session so repeated bill
  codes from special sessions stay distinct; it never puts the statutory cross-reference title into
  the first response. Legislator links use the same name, chamber, and district the cards show.
- Explicit resting Bills settings (`scope=legislature`, `sort=progress`) are normalized before the
  filtered-page decision. They receive the same requested directory page and canonical address as
  the plain URL instead of a blank first response that disagrees with the loaded app.
- The pages sitemap lists every real numbered directory address from totals produced by the same
  bill and legislator list rules. The record sitemap still lists every detail page directly, which is
  the completeness guarantee when progress ordering moves a bill between directory pages mid-crawl.
- A directory data failure answers 503 with `Retry-After`, as detail failures already do. It never
  turns a temporary outage into an empty successful page or a false 404. That includes a 404 from a
  list endpoint, which means its current-session data selection failed, not that Bills or Legislators
  ceased to be public pages.
- Retired `/search` addresses permanently redirect to Bills. Chat and Account addresses temporarily
  redirect Home because those features may return. They still lead somewhere useful without making
  a browser remember a permanent move that later blocks the restored feature.
- The research shelf moved from `/money/reports` to `/reports`, and one report from
  `/money/reports/{slug}` to `/reports/{slug}`, on 20 Aug 2026
  ([#1698](https://github.com/alethical-org/alethical/issues/1698)). Both old addresses redirect
  **permanently**, because the page genuinely moved and is not coming back to the old address —
  the opposite of the Chat and Account case above. `/money/reports` had been in the pages sitemap
  since the shelf shipped, so a permanent redirect is what tells a search engine to carry its
  standing over rather than treat `/reports` as a new page competing with a live one. The sitemap
  and the served canonical address now name `/reports` only, so nothing we publish points at the
  redirect. The route table resolves the old addresses too, which is what keeps them working on a
  host with no redirect rules — the dev server and a local static export. The cost of choosing
  permanent, accepted here: a browser may cache a 308 and keep forwarding even after the rule is
  removed, so this is not a cheap decision to reverse. That is the right trade for a page that
  moved for good, and the wrong one for Chat and Account above, which may come back.

### What this deliberately does not do

- It does not make filtered result combinations indexable.
- It does not add issue landing pages. Those need a small set chosen from real search demand and
  enough original context to be useful, not a page for every filter value.
- It does not add special AI files or AI-only wording. The same text and links go to people and every
  crawler, and React replaces that text when the full app starts.

---

## 19. Exact bill evidence and fuller legislator facts in the first response

Decided 11 Aug 2026 for [#1405](https://github.com/alethical-org/alethical/issues/1405).

### Decision

- A bill snapshot names the cited sections that its loaded Summary tab shows. When a citation has
  both a section id and a positive whole-number position, the label is a normal link to that exact
  passage in the current bill version (`?tab=text#ft-<section-id>-<position>`). A label with no exact
  position remains plain text, because an id alone can name several sections.
- The same exact link is present on the loaded desktop and phone-width citation control. It can be
  copied, opened in a new tab, and followed without depending on an in-app click handler.
- A legislator snapshot includes the stored biography and the same election-history and term wording
  the loaded profile shows. Missing biography or service data produces no empty heading and no
  substitute prose.
- The bill request already included citation data, and the legislator detail response already
  included biography. The only added field request is the existing legislator service-history
  include. No database, migration, ingestion, or new public endpoint is needed.

### Boundaries

- The fragment identifies evidence inside the current bill page. It is not a new indexable page, and
  it is not promised as a permanent pinpoint after the Legislature publishes a changed bill version.
- Citation excerpts stay out of the first response. The phone-width page shows citation labels, not
  excerpts, and the served text must not claim richer visible content than the loaded page.
- No bill count, contact fact, generated biography, new structured data, canonical-address change,
  or ranking promise is added.
