# How sharing works

<!-- describes: apps/frontend/src/lib/share.ts, apps/frontend/src/lib/pageSnapshot.ts, apps/frontend/src/lib/pageData.ts, apps/frontend/src/lib/legislatorProfile.ts, apps/frontend/src/components/billDetail/SharePopover.tsx, apps/frontend/src/components/share/MobileShareSheet.tsx, apps/frontend/src/screens/redesign/BillDetailScreen.tsx, apps/frontend/src/screens/redesign/BillDetailWebScreen.tsx, apps/frontend/src/screens/redesign/LegislatorProfileMobileScreen.tsx, apps/frontend/src/screens/redesign/LegislatorProfileWebScreen.tsx, apps/frontend/src/screens/redesign/AskAnswerScreen.tsx, apps/frontend/src/navigation/documentTitle.ts, apps/frontend/public/index.html, apps/frontend/public/robots.txt, apps/frontend/scripts/generate-brand-assets.mjs, api/page.ts, api/sitemap.ts, vercel.json -->

Share sends the page a reader chose, with enough plain-language context for another person to know why the link matters. Copy link remains the dependable choice when another app cannot accept prepared text.

## What each page shares

| Page       | Title                                                       | Description                                                                                | Link                                                                                                                 |
| ---------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| Bill       | Bill code, session year, and the short plain-language title | The first sentence of the plain-language summary                                           | The bill profile, without a selected tab                                                                             |
| Legislator | Name, plus chamber and district when serving now            | A fixed sentence naming committees, chief-authored bills, and contact information          | The readable legislator profile address                                                                              |
| Ask answer | The reader's question                                       | A fixed sentence saying the answer is cited and links to the official record               | The public Ask address, keeping only the question, bill, legislator, and saved-suggestion fields needed to rebuild it |

A bill's title reads `HF 719 (2025): Statewide Capital Projects and Bonding Bill`. The year is there
because bill numbers repeat every two years, so the number alone never identifies one bill for good.
A bill with no plain-language short title yet is named by its number and year alone — never by its
official statutory title, which is a paragraph of legal cross-references
(`.claude/rules/grounded-answers.md` rule 10). A bill without a generated summary uses an honest
fixed description instead.

Dotted abbreviations such as `U.S. citizens` and `U.S. Department` stay inside
the complete summary sentence. Decimal numbers and closing quotation marks also
survive the sentence cut; the words are never rewritten for a search preview.

A legislator's title carries no party label. District and chamber identify a person just as well,
never go stale mid-term, and keep a partisan word out of a link preview or a search result read on
its own. A former member's title is their bare name, because they hold no chamber or district
for it to name.

**The legislator sentence lists only sections the profile actually renders**, and this is checked
rather than assumed. The profile shows Biography, Committees, Chief-Authored Bills, Contact,
Legislative Service, and Leadership. Until
[#1325](https://github.com/alethical-org/alethical/issues/1325) measured it, the sentence promised
"recent votes" instead of contact details; votes appear solely inside the deliberately-unfinished
"On the roadmap" area, so a reader following a shared link looking for votes found none. **When a
section is added to or removed from the profile, this sentence changes with it**
(`buildLegislatorShareContent` in `apps/frontend/src/lib/share.ts`, pinned by `share.test.ts`) —
otherwise we advertise a capability we do not ship
(`.claude/rules/grounded-answers.md` rule 6).

The title, description, and link shown in the Share panel are the same source values used for every
destination, for the browser tab, and for what a search engine reads. One file
(`apps/frontend/src/lib/share.ts`) generates all of them, so the three cannot say different things.

## What each destination receives

| Destination      | What Alethical sends                                            | Important limit                                                                                                                           |
| ---------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Copy link        | The exact public page link                                      | No title or description is copied                                                                                                         |
| LinkedIn         | The page link                                                   | LinkedIn builds the visible title, description, and image from the page preview data; its share address does not accept our prepared text |
| X                | Title, description, and page link                               | The prepared words are shortened so the post stays within 280 characters after X counts the shortened link                                |
| Facebook         | The page link                                                   | Facebook builds the visible title, description, and image from the page preview data; its share address does not accept our prepared text |
| Email            | Full title, description, page link, and “Shared from Alethical” | The reader can edit everything before sending                                                                                             |
| Phone Share menu | Title, description, and page link                               | The receiving app decides which fields it keeps                                                                                           |

Instagram has no direct button. It cannot open a prepared visitor post containing this text, a dependable clickable Alethical link, and a website preview card. On a phone, Instagram may appear inside the normal Share menu if the installed app says it can receive the share. Instagram still decides what it keeps.

## What readers see

- On the website, Share opens one panel showing the title, description, and link before the reader chooses LinkedIn, X, Facebook, email, or Copy link.
- On a wide screen that panel hangs from the Share button, lined up with its right edge, and sits in front of everything else on the page. If there is not enough room below the button it opens above it instead, and it always keeps its whole self inside the window, so no row of it is ever cut off or covered. Nothing on the page behind it moves when it opens or closes.
- Three ways to close it, all of which work: click or tap anywhere outside it, press Esc, or use the X in its corner. The keyboard goes into the panel when it opens, stays inside it while it is open, and comes back to the Share button when it closes.
- On a phone, every Share button opens the same bottom sheet over a dimmed page, on bill, legislator, answered Ask, campaign-money report, and committee money pages. It closes the same three ways, and it adds **Share using another app** when the phone or browser supports the normal Share menu.
- Copy link confirms the copy for about 2 seconds. The native app and website both copy the real link.
- No share includes a reader's account details, saved bills, address, or sign-in information.

## Link preview cards

Facebook, LinkedIn, X, messaging apps, and work-chat apps usually read preview data from the shared page rather than from the Share button. Every visitor to one of our real pages — a person, a messaging app, or a search engine — receives the same page, carrying that page's own title, description, real address, and the 1200×630 Alethical image. There is no separate version for robots. An address that is not one of our pages, or that has the capital letters wrong, receives the missing-page preview and a 404 answer.

The one image uses Alethical’s ink background, green mark, and the words “Minnesota’s legislative
record in plain language” and “With links to official sources.” It has no legislator photo, party
colour, or per-page version. Its open-licensed fonts and drawing recipe are committed beside the
image, and the release check rebuilds and compares it pixel for pixel.

Bill and legislator preview text comes from the same public API data the page uses. Ask preview text uses the public question and the fixed cited-answer description.

Preview services keep their own caches, so a card already posted elsewhere may take time to refresh after a bill summary changes.

## What search engines get

Every address names itself in the very first response, before any of the app's own code runs — without that, all ~10,700 pages would hand a search engine the same nameless page, reading as one page repeated — and a bill page, a legislator page, or one of our own published reports also carries readable words in that same response.

- **The browser tab and the preview say the same thing.** A bill page opens with the bill's number and year straight away, and gains its short title the moment the bill loads.
- **A bill or legislator that does not exist says so.** An address like `/bills/94-2025-HF999999` answers "not found" rather than a blank page that looks successful.
- **An address that is not a page answers 404.** `/foo` and wrong-case shapes such as `/BILLS/94-2025-HF719` show a useful missing-page screen with links to Home, Bills, and Legislators. Retired addresses such as `/search`, old vote links, `/chat`, and `/account` still land on their intended live page. Putting a slash on the end sends the reader to the same address without the slash.
- **A brief outage does not unlist real pages.** If the data service cannot be reached, the page says "temporarily unavailable" instead of "gone".
- **`robots.txt`** (`https://www.alethical.com/robots.txt`) blocks nothing from being read. It points at the sitemap, and turns away only the two crawlers that exist to collect writing for training future AI models. Every search crawler and every "someone asked a question about this page" crawler is welcome.
- **`sitemap.xml`** (`https://www.alethical.com/sitemap.xml`) lists every bill, every legislator, every campaign committee whose page holds a filed record, and every real numbered Bills, Legislators and Committees directory page. Bills and legislators carry the date they really last changed; a committee carries none, because we hold no date on which one committee's own record changed and a wrong date on 1,603 entries would cost us Google's trust in the field across the whole site. It is built when asked for and then cached, so a newly ingested bill appears without waiting for a release.
- **Answer pages are readable but unlisted.** An `/ask` page asks not to appear in results, in its own response. It is deliberately not blocked in `robots.txt`, because a crawler that is blocked from fetching a page can never read the instruction inside it.
- **The little logo beside a result has an opaque background on purpose.** Google throws away any see-through border around a site's icon and blows the artwork up to fill the whole square, then draws it inside a circle — so the two bottom corners of our triangle mark got sliced off, which is what made it look off-center. An icon whose background is filled in has no see-through border to throw away, so the spacing we choose is the spacing Google shows (`apps/frontend/assets/favicon.png`, generated by `apps/frontend/scripts/generate-brand-assets.mjs`). Why it works this way, and the earlier see-through version it replaced, are in `docs/architecture/page-metadata-for-search-and-sharing-decisions.md` §14 (the search-result icon).

## The text that arrives before the page finishes loading

A bill page and a legislator page arrive with real words already in them, rather than an empty page
the app fills in a second later. Correct titles alone were not enough: Google often ignores the
description a page supplies and writes the result text from what it can actually see on the page.

A **bill** arrives with its plain-language title, its bill code and session, its key points (or its
summary, when a bill has no key points), where it stands, its chief author, the cited-section labels
the Summary tab shows, and links to the exact current-version passages when their positions are
known. It also links to the bill on revisor.mn.gov, to that author's profile, and to the bill list. A
**legislator who currently holds a seat** arrives with their name, chamber and district, party,
committee assignments, stored biography and legislative service when present, capitol office and
phone, and links to their official chamber profile and to the member list. A **former member** —
someone who resigned, died or lost their seat, and whose record therefore holds no current service —
arrives with their stored name and their past record only: their election history and their authored
bills, when we hold them. Not one current fact is filled in for them, not even a `Sen.` or `Rep.`
before the name, because nothing in the record says which chamber they sat in, which party they
belonged to, or which committees they sat on
([`.claude/rules/grounded-answers.md` rule 12](../../.claude/rules/grounded-answers.md) — a value we
do not hold is reported as missing, never replaced by a plausible one). Home, Find My Legislator,
and the plain Bills and Legislators directories arrive with their own readable text and links. Answer pages, legal pages and filtered
lists carry no first-response snapshot, with 2 deliberate exceptions in the money section below:
where an address would otherwise show a reader nothing at all until the app arrives, it carries the
page's own explanation. Serving those words changes nothing about whether a search engine may list
the address.

When a bill has neither key points nor a generated summary, its first response
and Summary section show the unchanged filed description under **Official
description**, with an **Official bill page** link. They never substitute the
long statutory title. The search-description fallback remains the honest fixed
sentence described above.

The **campaign money** section carries the same first-response text. `/money` arrives with its heading, its one
sentence, the register's size counted live, the day we last copied the Board's files, what the record
does not cover, and links into the 4 indexable destinations: legislators, committees,
races and outside spending. **`/money/committees` arrives with an
ordinary link to every committee on the page**, 50 at a time on numbered addresses — the load-bearing
part: behind a "Show more" button Google will not press, 1,553 of the 1,603 committee pages
would have no link anywhere on the site. **One committee**
arrives with its filed name, the register's kind and its registration number, the seat it registered
for where the register states one, the sentence saying whose committee it is — carrying, once a
person here has confirmed the link, that member's name and an ordinary link to their campaign money
— the period its figures cover, its held official contribution total and itemized contributions,
the official spending total when held or the sentence saying Alethical does not hold it, and the
day we copied the files. Its money-in figures keep their source and split explanations. The first
response links to the selected year's full received and outgoing lists, the year choices and
Filings. The donor chart and grouped tabs appear after their complete selected-year records load.
**Its payments page** arrives with the same identity and period plus
the first 50 named payments, each with its own date and amount. Every one of those figures goes
through the same functions the screen uses, so a missing itemized figure reads "Not reported" and a filed zero
reads "$0", and a test fails if the served page ever prints an amount the filing does not carry
([`.claude/rules/grounded-answers.md` rule 12](../../.claude/rules/grounded-answers.md)). A year named in the
address is the year those figures are for, and on the payments page a direction named in the address
is the direction those payments go, so a shared link never opens on an answer to a different
question. A tab that only picks which part of one record to look at is still ignored by the served
text, which carries the page's plain state, exactly as a bill serves its Summary whichever tab the
address names.

**Money by race** arrives with every contest, and inside each one an ordinary link to every
candidate committee registered for that seat, with each committee's 2 figures and the dates each
figure covers. **The outside-spending record** arrives with the total the file holds, how many
payments and which years that total covers, how many of them the filings call supporting and how
many opposing, how many were given as goods rather than cash, the day we read the Board's file, and
links to the 2 lists that lead to one group's or one committee's own rows. **The name search**
arrives with its heading, what it searches, and the sentence saying what these records do not
cover — never a result for anything typed, since the address is whatever somebody put in the box.
Those last 2 pages used to arrive with a title and nothing else, so a reader looked at a blank
page for about 2 seconds, and on the outside-spending page for as long as 3.

## The records arrive with the page too

The homepage links directly to `/money` and `/read`, as well as bills,
legislators and Find My Legislator. A legislator response also includes up to 2
current-session chief-authored bill links when available. `/about` and
`/about/contact` arrive with their own shared public text and contact links;
private Track links, roadmap promises and the interactive contact form stay out
of those initial snapshots. The bare outside-spending address is in the sitemap,
while its filtered addresses retain their existing exclusion.

Building the words above means reading the same records the page itself needs, so those records now
travel in the same response and the page draws them straight away. Before this, the app asked for
the identical records a second time about a second later, and a reader watched a loading state for
another half-second — or as long as 3 seconds when our caches had gone cold — for figures that had
already arrived.

Nothing about a figure changes on the way through. The records travel exactly as the data service
sent them, and the page reads them with the same code it uses for records it fetches itself, so a
figure cannot come out differently for having arrived early. Each set travels whole, so a figure and
the freshness date printed beside it always come from the same reading of the files. If any of it is
missing or unreadable, the page simply asks for the records itself, which is what every page did
before this.

One of **our own published pieces** arrives with the whole thing, whether it is a research piece or a
guide: its title, its standfirst or the set it belongs to, its own masthead line, its short version
where it has one, every section under its own heading, every sentence, bullet and table in the order
the piece reads, and the closing sources block. **Every address that block names arrives as a real
link**, not as words with nothing to click: the guide "Who has to report their money" cites 11 of
them, 8 at the Campaign Finance Board and 3 at the state's own statutes, and a citation a reader can
only follow after the app has run is not reachable by address at all
([`.claude/rules/grounded-answers.md` rule 5](../../.claude/rules/grounded-answers.md)). Until this
shipped, our own writing was the one thing on the site whose words a search engine could only read
after running the app, while every bill page handed its text over immediately. The **`/read` page**
arrives with its heading, its introduction, and an ordinary link to every posted piece, at that
piece's own address, which is what keeps an older piece reachable on a first visit rather than only
after the app starts. Not a word of a piece is
rewritten, shortened or summarised for this: the served sentences are the stored sentences
([`.claude/rules/grounded-answers.md` rule 13](../../.claude/rules/grounded-answers.md) forbids editing
a piece's text at all), and whether a search engine may *list* a piece is still the separate,
per-piece decision described in
[campaign-money-section-guide.md](campaign-money-section-guide.md) — a piece marked to be skipped is
served in full and still asks to be skipped.

**The first response and the running app use the same facts and fixed wording.**
The app can add records and controls as they load, but it cannot add unsupported claims.
There is no separate version written for robots. A former member's served page said only
their name while the app redrew it about a second
later as `Sen. <name>` of `Senate District Unknown`, with a party and 3 committees the record does
not hold ([#2061](https://github.com/alethical-org/alethical/issues/2061)). Both halves now decide
it with the same 2 shared functions (`currentChamber` and `servesNow` in
`apps/frontend/src/lib/legislatorProfile.ts`), and a test mounts each real profile layout and reads
the words off it
(`apps/frontend/src/screens/redesign/__tests__/LegislatorProfileNoCurrentService.test.tsx`).
The served text is built from the very same functions the screens use, including the shared
legislative-service formatter, and a test renders the real bill header and summary tab from a real
bill and fails if any served line or exact evidence link is missing from what they draw
(`apps/frontend/src/lib/__tests__/pageSnapshot.test.tsx`). One thing is deliberately left out rather
than added: a bill with no plain-language title is headed by its number alone, never by its official
statutory title, which is a paragraph of legal cross-references
(`.claude/rules/grounded-answers.md` rule 10).

The summary sits inside the app's own mount point, which the app empties the instant it draws its
first screen, so the two are never on screen together. Measured on a real browser against the live
program: one change to that element, at 60 milliseconds, and no moment showing both. If the program
fails to load at all, the summary simply stays, which is the other reason for putting it there.

The reasoning behind each of those choices, and the options that lost, are in `docs/architecture/page-metadata-for-search-and-sharing-decisions.md`.
