<!-- describes: api/social-preview.ts, apps/frontend/src/lib/share.ts, apps/frontend/public/index.html, vercel.json -->

# What each page tells search engines and link previews — decisions

**Net:** Sharing a link on social media already works and shows the right title. Search engines are
the half that is broken: every one of our 10,671 pages hands them the same nameless page, so they
look like one page repeated. The fix is two releases — first give every visitor, person or robot,
the same page with the right title in it, then put a short factual summary into that page as well.
This doc proposes both and asks Eugene to approve the approach before anything is built.

Proposal for [#1325](https://github.com/alethical-org/alethical/issues/1325). Nothing here is built.
The recommendation below was pressure-tested against an outside review; where that review corrected
the first draft, this doc says so, because those corrections change what gets built.

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
- **Party moves out of the legislator title and into the description.** District and chamber
  identify a person just as well, never go stale mid-term, and keep the title free of a partisan
  label that a search result shows out of context.

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

**An open question this surfaced, outside the scope of this issue.** The portraits we display today
come from the Legislative Reference Library (`lrl.mn.gov/legdb/MemberPhotos/…`), a joint legislative
department, not from House Public Information Services. Whether the House policy above governs
those specific files is unresolved. Displaying an unaltered photo with credit is a much weaker claim
than compositing one, so this is not urgent, but it should be answered rather than assumed. Filed
separately rather than settled here.

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
- `BreadcrumbList` on detail pages, but only where the page really shows that path. It is eligible
  for a visible feature in results.

**Skip for now:** `Person`, `ProfilePage`, and `Legislation` for bills. The `Legislation` type
exists and genuinely fits, but Google does not list it as supported, so it buys nothing today.

---

## 7. robots.txt and sitemap.xml

**`robots.txt`** should exist to point at the sitemap and to make a deliberate choice about AI
crawlers. The review's recommendation, which this doc adopts: **allow the search crawlers**
(`OAI-SearchBot`, `Claude-SearchBot`, `PerplexityBot`) because they are how people increasingly find
answers, and treat the training crawlers (`GPTBot`, `ClaudeBot`) as a separate data-policy decision
for Eugene rather than an SEO one.

**A correction to the first draft, and to [#823](https://github.com/alethical-org/alethical/issues/823).**
Do **not** block the answer pages in `robots.txt`. A crawler that is blocked from fetching a page
cannot read the "do not index" instruction inside it, so blocking actively prevents the exclusion
from working. Answer pages should instead be left crawlable and served `X-Robots-Tag: noindex` in
the first response, and simply left out of the sitemap. #823's acceptance criteria should be
amended accordingly, and its write-up also names the wrong config file — the live one is the
**root** `vercel.json`, not `apps/frontend/vercel.json`.

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
2. **AI training crawlers** — `GPTBot` and `ClaudeBot` allowed or blocked in `robots.txt`. This is a
   data-policy call, not an SEO one. The search crawlers should be allowed either way.
3. Whether the portrait-rights question in §5 gets its own issue now or waits for campaign finance.
