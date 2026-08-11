<!-- describes: api/social-preview.ts, apps/frontend/src/lib/share.ts, apps/frontend/public/index.html, vercel.json -->

# What each page tells search engines and link previews — decisions

**Net:** Sharing a link on social media already works and shows the right title. Search engines are
the half that is broken: Google and Bing see the same nameless page at every address, so our 10,671
pages look to them like one page repeated. The fix is to give every visitor, person or robot, the
same page with the right title in it — a small change on top of machinery we already run. This doc
proposes that and asks Eugene to approve the approach before anything is built.

Proposal for [#1325](https://github.com/alethical-org/alethical/issues/1325). Nothing here is built.

---

## 1. What is actually broken, measured

Measured 11 Aug 2026 by asking the server for the raw page (`curl`), not by looking at the browser
after the page finishes loading. That distinction matters: the browser fixes the title a second or
two after the page arrives, which is too late for a robot that never waits.

**Confirmed broken.** The home page, the legislator list, and Aisha Gomez's profile all return the
exact same file, byte for byte (same `md5` fingerprint: `393a4e47…`). Every one says
`<title>Alethical</title>`, carries the same one-line description, and points at the same preview
picture. There is no "this is the real address of this page" tag (`<link rel="canonical">`) and no
machine-readable description of who the person is. `robots.txt` and `sitemap.xml` both return "not
found" (404).

**Being precise about which of those actually hurts.** A missing `robots.txt` is *not* itself a
problem — a search engine reads "not found" as "you may crawl everything," which is what we want
for most of the site. We need the file only to keep the answer pages out. The missing sitemap is a
real loss, because it is how a search engine learns that 10,671 pages exist when almost nothing
links to us yet. But the headline damage is the identical titles: pages that look the same get
folded together and only one is kept, so the other 10,670 are effectively invisible no matter how
well they are crawled.

**Not broken, and the issue assumed it was.** Sharing a link already works. When Facebook, X,
LinkedIn, Slack, Discord, WhatsApp, or Reddit fetches a page, the server quietly hands them a
different, correct file:

| What was asked for | What the sharer gets back |
| --- | --- |
| `/legislators/aisha-gomez` | `Rep. Aisha Gomez: Democratic-Farmer-Labor, House District 62A \| Alethical` |
| `/bills/94-2025-HF719` | `HF 719: Statewide Capital Projects and Bonding Bill \| Alethical` |

Those descriptions are real too — the bill one is the plain-language summary of what the bill does.

So the machinery to write a correct title for any page **already exists and already runs in
production**. It is a small program (`api/social-preview.ts`) whose wording rules live in
`apps/frontend/src/lib/share.ts`. It is switched on by a list of names in `vercel.json` that
includes the social networks and **does not include Google or Bing**. That is the whole gap.

**Search engines get nothing.** Asking as Google (`curl -A Googlebot`) returns the nameless page.

---

## 2. The cause

Two things combine.

**The site is built as one file.** The app is Expo / React Native Web. Its build step
(`expo export --platform web`) produces a single page skeleton, `index.html`, from the template at
`apps/frontend/public/index.html`, plus the program files that fill it in. There is one skeleton,
so there is one title in it. The template even hardcodes the home page's address as every page's
address (`og:url` is always `https://www.alethical.com/`).

**The server sends that one file for every address.** `vercel.json` has a catch-all instruction:
anything that is not a picture or a program file gets `/index.html`. So `/bills/94-2025-HF719` and
`/legislators/aisha-gomez` are the same response. The app then reads the address bar and draws the
right page — but that happens in the visitor's browser, after the file has already been delivered.
A robot that does not run programs, or that gives up waiting, only ever sees the skeleton.

One thing is already right: `alethical.com` redirects to `www.alethical.com` (a 308), so the site
does not compete with itself across two spellings of its own name.

---

## 3. What each page should say

These are rules that generate every page, not examples. Five rules produce all of them, and they
carry over to campaign finance pages without a rewrite.

1. **Be as specific as the address is.** If the address names one person, the title names that
   person. A page about one thing never borrows the site's generic title.
2. **Promise only what the page shows.** The description lists what a reader will actually find,
   checked against the page's real sections.
3. **Use the word a person would use.** Spell out the party. Never use a bill's official statutory
   title, which is a paragraph of legal cross-references.
4. **Never state a number or fact the page cannot back.** No counts, no totals, no claims that
   depend on data the page did not load.
5. **The title ends with `| Alethical`. The description never mentions Alethical.**

Applied:

| Page | Title | Description |
| --- | --- | --- |
| Legislator | `{Rep.\|Sen.} {Name}: {party spelled out}, {chamber} District {code}` | `See {Name}'s committee assignments, chief-authored bills, and contact information in the Minnesota Legislature.` |
| Bill | `{HF\|SF} {number}: {plain-language short title}` | First sentence of the plain-language summary. |
| Bill, no summary yet | `{HF\|SF} {number}: Minnesota bill` | `See what {HF\|SF} {number} would do and where it stands in the Minnesota Legislature.` |
| Bill list | `Search Minnesota bills \| Alethical` | `Search bills in the Minnesota Legislature by topic, chamber, and status.` |
| Legislator list | `Minnesota House and Senate members \| Alethical` | `Find a Minnesota legislator by name, chamber, or party.` |
| Home | `Alethical: Minnesota's legislative record in plain language` | Current wording is correct; keep it. |
| Campaign finance (Sept 2026) | `{Rep.\|Sen.} {Name}: campaign finance \| Alethical` | `See who contributed to {Name}'s campaign, from official Minnesota filings.` |

Most of this is already written and shipping in `apps/frontend/src/lib/share.ts`. The proposal is to
keep that code as the single source of wording and extend it to the list pages and the home page,
which have no rule today.

### One live wording bug this found

The legislator description currently promises **"committee assignments, chief-authored bills, and
recent votes."** The profile page shows Biography, Committees, Chief-Authored Bills, Contact,
Legislative Service, and Leadership. Votes appear **only** inside the deliberately-unfinished "On the
roadmap" preview area. So the description promises a section that does not exist.

That breaks `.claude/rules/grounded-answers.md` rule 6, which requires copy to claim only what the
page delivers. The table above drops "recent votes" and puts "contact information" in its place.
This is a one-line fix and should ship whatever else is approved.

---

## 4. Personalized, not generic — settled

Every legislator page carries that person's name, party, and district. Two reasons, and the second
is the decisive one.

- **A generic phrase on 200 pages is worse than no phrase.** Search engines fold near-identical
  pages together and show one, or none. Two hundred pages all titled "Minnesota legislator profile"
  compete with each other and lose to the official state site every time.
- **A person searching searches for a name.** Someone types "Aisha Gomez district" — not "Minnesota
  legislator profile." A title that does not contain the name cannot answer that.

This is not a tension with "we are not competing for attention" (`docs/philosophy.md` principle 10).
Naming the page's actual subject is accuracy, not persuasion. What that principle forbids is
keyword stuffing, invented urgency, and titles written to be clicked rather than to be true — and
the rules in §3 forbid all three.

---

## 5. robots.txt and sitemap.xml

Both are missing and both should exist.

**`robots.txt`** — a short file that says who may look and where the map is. It should allow
everything except the answer pages, and point at the sitemap. Answer pages are excluded because
[#823](https://github.com/alethical-org/alethical/issues/823) already decided they should not appear
in search results.

**`sitemap.xml`** — the list of every page worth finding. 200 legislators plus bills. Well under
the 50,000-URL limit, so one file, no index needed.

Open calls in this section are settled in §7 alongside the build recommendation, since they depend
on it.

**A trap worth naming now.** The bill list accepts ten filter values in the address
(`q`, `topic`, `scope`, `chamber`, `status`, `session`, `issue`, `omnibus`, `sort`, `page`). Those
combine into effectively unlimited addresses that are all thin variations of one page. If a search
engine crawls them it wastes its budget there instead of on the 10,471 bills. Every filtered list
address must therefore declare the plain unfiltered list as its real address (`canonical`), so the
variations collapse into one.

---

## 6. Structured data

Adding a small machine-readable block (JSON-LD) that says "this page is about a person, this is
their job, this is their official profile" is worth doing for legislators. Every field comes from a
record we already store, including `profile_url`, the official Minnesota page for that person — so
it asserts nothing we cannot source, which is the bar `.claude/rules/grounded-answers.md` sets.

What it buys and what it does not is answered in §7 with the rest of the costed options.

---

## 7. The options, and the recommendation

A single-file site cannot vary its title per address without changing how pages are served. Four
ways to change that, cheapest first.

### A. Add Google and Bing to the existing list of names — rejected

One line of config. Search engines would start getting the good titles tomorrow.

**Why it loses:** the page those robots receive has no content in it, just a link. Users get the
full app. Deliberately serving robots a different page than people is called cloaking, and it is
the one thing in this area that can get a site penalised outright rather than merely ranked low.
The list is also a list of names that has to be maintained forever, and it silently fails for every
robot nobody remembered to add.

### B. Put the right title into the same page everyone gets — recommended

A small program runs at the edge for public addresses, takes the same `index.html` the site already
serves, and writes the correct title, description, page address, and machine-readable block into
its head before sending it. **The body is untouched**, so the app still loads and behaves exactly as
it does now, and robots and people receive identical HTML. No cloaking, because there is nothing
different to detect.

- **Reuses what exists.** The wording rules in `apps/frontend/src/lib/share.ts` are already written,
  already correct, and already covered by tests (`share.test.ts`, `socialPreviewEndpoint.test.ts`).
- **Replaces rather than adds.** The name-matching rules in `vercel.json` and the near-empty page in
  `api/social-preview.ts` both go away. One path serves everyone.
- **Cost to run is near zero.** Pages are already cached at the edge (`x-vercel-cache: HIT`), so the
  program runs on a cache miss, not on every visit.
- **Effort:** small-to-medium. Days, not weeks.

**One catch that must be fixed in the same change.** The app sets the browser tab title itself once
it loads, through a formatter in `apps/frontend/src/navigation/RootNavigator.tsx` that produces
`Legislator | Alethical` — generic, no name. Left alone, it would **overwrite** the correct title a
moment after the page arrives, and a search engine that runs the page would end up recording the
generic one anyway. The formatter has to produce the same per-page title as the server.

### C. Build the whole page on the server (issue #502) — the eventual destination, not now

Renders the actual content into the HTML, so a robot sees the bill summary without running
anything, and the first paint is instant. Best possible outcome on both counts.

**Why not now:** it is the open architectural fork in
[#502](https://github.com/alethical-org/alethical/issues/502), and every route to it is large —
rebuilding the app's navigation layer, or splitting the public site into a separate codebase.
Option B is not a detour on the way there; it is a prerequisite either way, since the titles and
descriptions have to be written down somewhere regardless, and it delivers most of the benefit now.

### D. Pre-build a file per page — rejected

Generate 10,671 small HTML files during the build. Nothing runs at request time.

**Why it loses:** the build would have to fetch the whole corpus every deploy, and the titles would
be frozen until the next one. A bill's status changes and the description keeps saying the old
thing until someone redeploys, which breaks the freshness requirement in
`.claude/rules/grounded-answers.md` rule 7.

### The settled calls in the earlier sections

- **Sitemap: every bill and every legislator, generated on request and cached for a day.** All
  10,471 bill pages carry genuinely different content, so none of them is filler. Generating on
  request rather than at build time means a newly ingested bill is listed without waiting for a
  deploy. Two files under one index (`/sitemap-bills.xml`, `/sitemap-legislators.xml`) so each can
  carry its own last-changed date, which is what tells a search engine what to re-read first.
- **Answer pages stay out.** Excluded from the sitemap, blocked in `robots.txt`, and served the
  "do not index" instruction that [#823](https://github.com/alethical-org/alethical/issues/823)
  specifies. Note that #823's write-up names the wrong config file; the live one is the **root**
  `vercel.json`, not `apps/frontend/vercel.json`.
- **Filtered list addresses point back at the plain list.** Ten filter values combine into
  effectively unlimited near-identical addresses; declaring the unfiltered list as their real
  address collapses them.
- **Preview picture: keep the single logo for now.** A per-page picture is a real click-through
  gain, but the title beside it is already personalised, and generated cards raise a question we do
  not need to answer yet — whether to put an officeholder's face on a card a stranger will read as
  the product's framing of them. Revisit when campaign finance pages ship, since those are built to
  be shared. If it is built then, build it **without portraits**: name, district, and party as text.
- **Machine-readable block: `Person` for legislators, breadcrumbs on detail pages, `Organization`
  on the home page.** Every field traces to a record we already store, including the official state
  profile address (`profile_url`), so nothing is asserted that we cannot source. Skip anything that
  dresses a page up as something it is not.

---

## 8. What this deliberately does not do

- **No keyword-tuned titles.** Rules, not tuning. A title that would rank better by naming things
  the page does not contain is out, per `docs/philosophy.md` principle 10.
- **No invented facts in a description.** Nothing states a count, total, or status the page cannot
  back. This is the same line `.claude/rules/grounded-answers.md` rule 11 draws for answers.
- **No content written for robots that a person would not see.**

---

## 9. Acceptance criteria, if approved

- [ ] Every public address returns its own title, description, canonical address, and preview tags
      in the **first** server response, verified with `curl` and no user-agent trickery —
      *Net: the right words arrive before any of our code runs.*
- [ ] Robots and people receive identical HTML for the same address —
      *Net: no cloaking, so nothing to be penalised for.*
- [ ] The browser tab title after the app loads matches the one the server sent —
      *Net: the correct title is not overwritten a second later.*
- [ ] The legislator description no longer claims "recent votes" —
      *Net: we stop promising a section the page does not have.*
- [ ] `robots.txt` and `sitemap.xml` return real content; every legislator and bill is listed;
      answer pages are not — *Net: search engines get a map, minus the pages we want left out.*
- [ ] Filtered list addresses declare the unfiltered list as their real address —
      *Net: thousands of near-identical addresses collapse into one.*
- [ ] The existing wording rules in `share.ts` remain the only place page wording is written —
      *Net: one place to fix wording, already covered by tests.*
- [ ] Confirmed from outside with Google Search Console's URL inspection, not by reading config —
      *Net: checked the way a search engine actually sees it.*
