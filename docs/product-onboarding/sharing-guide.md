# How sharing works

<!-- describes: apps/frontend/src/lib/shareIntents.ts, apps/frontend/src/components/share/SharePanelContent.tsx, apps/frontend/src/components/share/ShareDestinationIcon.tsx -->

<!-- describes: apps/frontend/src/screens/redesign/CommitteeMoneyScreen.tsx, apps/frontend/src/lib/committeeMoneyPreferences.ts, apps/frontend/src/lib/share.ts, apps/frontend/src/lib/pageSnapshot.ts, apps/frontend/src/lib/pageData.ts, apps/frontend/src/lib/legislatorProfile.ts, apps/frontend/src/components/billDetail/SharePopover.tsx, apps/frontend/src/components/share/MobileShareSheet.tsx, apps/frontend/src/screens/redesign/BillDetailScreen.tsx, apps/frontend/src/screens/redesign/BillDetailWebScreen.tsx, apps/frontend/src/screens/redesign/LegislatorProfileMobileScreen.tsx, apps/frontend/src/screens/redesign/LegislatorProfileWebScreen.tsx, apps/frontend/src/screens/redesign/AskAnswerScreen.tsx, apps/frontend/src/navigation/documentTitle.ts, apps/frontend/public/index.html, apps/frontend/public/robots.txt, apps/frontend/scripts/generate-brand-assets.mjs, api/page.ts, api/sitemap.ts, vercel.json -->

Share sends the page a reader chose, with enough plain-language context for another person to know why the link matters. Copy link remains the dependable choice when another app cannot accept prepared text.

## What each page shares

| Page            | Title                                                       | Description                                                                       | Link                                                                                                                                                                        |
| --------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bill            | Bill code, session year, and the short plain-language title | Bill text, legislative progress, and official sources (a search result instead shows the summary's first sentence) | The bill profile, without a selected tab |
| Legislator      | Name, plus chamber and district when serving now | General profile: committees, chief-authored bills, and contact information. Money view: campaign money and its selected filing year | The readable legislator profile address; Campaign money retains its selected year and open contribution rows |
| Ask answer      | The reader's question                                       | A fixed sentence saying the answer is cited and links to the official record      | The public Ask address, keeping only the question, bill, legislator, and saved-suggestion fields needed to rebuild it                                                       |
| Committee money | The committee's filed name | Campaign money from Minnesota’s official filings | The committee address, retaining the year, section, donor category and sort, independent-spending sort, open contribution rows, ownership evidence and earlier-year choices |
| Research and guide | The published title | The existing publication and records-through dates, without figures or article text | The published article address |
| Lobbyist | The record's existing title | The existing description for its registration state | The lobbyist's public record address |
| Lobbying principal | The organisation's existing title | Its reported spending and registered lobbyists | The organisation's public record address |
| Name-search results | The searched name | The kinds of records searched | The public name-search address and query |
| Payments under a name | Payment direction and exact filed name | Coverage across the years held and newest-first order | The exact name, direction, and originating search |
| Committee payments | Committee name | Payment direction, filing year, and largest-first order | The committee, year, and received/made section |
| Money by race | Money by race | Office or selected race, filing year, and separate committee figures | Year, office filter, and valid race link target |
| Outside-spending results | Group or committee name, or Outside spending for the browse view | Direction, filing year, and sort or browse context | Subject, year, sort, page, and any browse mode/name filter |

A bill's title reads `HF 719 (2025): Statewide Capital Projects and Bonding Bill`. The year is there
because bill numbers repeat every two years, so the number alone never identifies one bill for good.
A bill with no plain-language short title yet is named by its number and year alone — never by its
official statutory title, which is a paragraph of legal cross-references
(`.claude/rules/grounded-answers.md` rule 10). The description names what readers can
find instead of paraphrasing the title. The bill's full summary remains on its own page.

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

Sharing a legislator's Campaign money view retains `tab=money`, the selected year and
open contribution rows for each committee. Its description names campaign money and
the selected filing year instead of the general profile's sections. The same link reopens that view on phones
and computers. Committee Share also retains open ownership evidence and earlier-year
choices. Independent spending keeps its own Newest first or Largest first order through
`spendingSort`; this does not overwrite the donor browser's separate saved sort.

The visible panel heading names what is shared: **Share this committee**,
**Share this bill**, **Share these search results**, **Share these payment records**,
**Share this race comparison**, or **Share these outside-spending results**. The
accessible name uses the same words. This is a window label, never part of the
outgoing message. The title identifies the record
once. The description adds context rather than repeating the name, title, or an
Alethical suffix. Do not manufacture a decorative heading. This applies to every
subject and outgoing destination. A shared whole-line guard also omits descriptions
identical to their title after case and punctuation normalization; it does not
remove words from distinct facts.

Research and
guides can show a shorter date description inside the panel while retaining their
existing outgoing date description. Each destination receives the fields it supports.
Destination addresses are built in `apps/frontend/src/lib/shareIntents.ts`, kept
with the screens that use sharing rather than the program every first page loads.
The bill, legislator and Ask share text comes from `apps/frontend/src/lib/share.ts`.
The committee screen supplies its record-specific share text and selected address
(`apps/frontend/src/screens/redesign/CommitteeMoneyScreen.tsx`). Browser-tab titles
and search previews use the page's metadata, drawn from the same record fields.

Result Share controls sit beside headings on wide layouts and below headings on
phones. They share the accepted, displayed response rather than a pending filter
change. Unavailable or invalid results do not offer a misleading Share control.
The landing at `/money`, `/money/lobbying`, and directories used only to choose a
record remain without Share. Individual payment rows do not gain Share buttons.

## What each destination receives

| Destination      | What Alethical sends                                            | Important limit                                                                                                                           |
| ---------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Copy link        | The exact public page link                                      | No title or description is copied                                                                                                         |
| Email            | Title in the subject; complementary description and link in the body | The reader can edit everything before sending |
| WhatsApp         | Full title, description, and page link | Opens a prepared message; the reader chooses where to send it |
| Facebook         | The page link                                                   | Facebook builds the visible title, description, and image from the page preview data; its share address does not accept our prepared text |
| LinkedIn         | The page link                                                   | LinkedIn builds the visible title, description, and image from the page preview data; its share address does not accept our prepared text |
| X                | Title, description, and page link                               | The prepared words are shortened so the post stays within 280 characters after X counts the shortened link                                |
| Bluesky          | Title, description, and the exact page link | Prose is shortened to fit its text limits; a long link is sent alone, never cut |
| Device Share menu | One complete message containing title and context, plus one link | No second title field repeats the message title; the receiving app decides which fields it keeps |

Instagram has no direct button. It cannot open a prepared visitor post containing this text, a dependable clickable Alethical link, and a website preview card. On a phone, Instagram may appear inside the normal Share menu if the installed app says it can receive the share. Instagram still decides what it keeps.

## What readers see

- Share opens one panel showing the title, description, and selectable link. Copy appears first, followed by Email, WhatsApp, Facebook, LinkedIn, X, and Bluesky.
- At 1,100 pixels and wider, the 366-pixel panel hangs from the existing Share button. It opens above the button when needed and stays inside the window. Long content scrolls inside the panel while Close stays reachable.
- Three ways to close it, all of which work: click or tap anywhere outside it, press Esc, or use the X in its corner. The keyboard goes into the panel when it opens, stays inside it while it is open, and comes back to the Share button when it closes.
- Below 1,100 pixels, the existing Share buttons open the same bottom sheet over a dimmed page. Phone screens below 768 pixels use 2 rows of 3 destinations and a full-width copy button. Tablet screens use 1 row of 6 and an inline copy button.
- **Share using another app** appears only when the browser or device can share the supplied content, including on supported desktop browsers. Cancelling that menu is not an error.
- A successful copy shows **Copied** on desktop or **Link copied** on a sheet for about 2 seconds. A failed copy gives a visible explanation and leaves the full link available to select and copy manually.
- All 9 content types, including results, use `SharePanelContent.tsx`; `SharePopover.tsx` and `MobileShareSheet.tsx` own its placement. Shared platform artwork lives in `ShareDestinationIcon.tsx`.
- No share includes a reader's account details, saved bills, address, or sign-in information.

## Link preview cards

Facebook, LinkedIn, X, messaging apps, and work-chat apps usually read preview data from the shared page rather than from the Share button. Every visitor to one of our real pages — a person, a messaging app, or a search engine — receives the same page, carrying that page's own title, description, real address, and the 1200×630 Alethical image. There is no separate version for robots. An address that is not one of our pages, or that has the capital letters wrong, receives the missing-page preview and a 404 answer.

The one image uses Alethical’s ink background, green mark, and the words “Minnesota’s legislative
record in plain language” and “With links to official sources.” It has no legislator photo, party
colour, or per-page version. Its open-licensed fonts and drawing recipe are committed beside the
image, and the release check rebuilds and compares it pixel for pixel.

Bill and legislator preview text comes from the same public API data the page uses. Ask preview text uses the public question and the fixed cited-answer description.

Preview services keep their own caches, so an existing card may take time to refresh after preview text changes. A receiving platform may also add its own link card beside the prepared message; Alethical controls the supplied text, not that platform's presentation.

## What search engines get

Every address names itself in the very first response, before any of the app's own code runs — without that, all ~10,700 pages would hand a search engine the same nameless page, reading as one page repeated — and a bill page, a legislator page, or one of our own published reports also carries readable words in that same response.

- **The browser tab and the preview say the same thing.** A bill page opens with the bill's number and year straight away, and gains its short title the moment the bill loads. A bill's search-result description is the first sentence of its plain-language summary, so every bill tells a search engine something different; its share card keeps the fixed line in the table above.
- **A bill or legislator that does not exist says so.** An address like `/bills/94-2025-HF999999` answers "not found" rather than a blank page that looks successful.
- **An address that is not a page answers 404.** `/foo` and wrong-case shapes such as `/BILLS/94-2025-HF719` show a useful missing-page screen with links to Home, Bills, and Legislators. Retired addresses such as `/search`, old vote links, `/chat`, and `/account` still land on their intended live page. Putting a slash on the end sends the reader to the same address without the slash.
- **A brief outage does not unlist real pages.** If the data service cannot be reached, the page says "temporarily unavailable" instead of "gone".
- **`robots.txt`** (`https://www.alethical.com/robots.txt`) blocks nothing from being read. It points at the sitemap, and turns away only the two crawlers that exist to collect writing for training future AI models. Every search crawler and every "someone asked a question about this page" crawler is welcome.
- **A record reached under another spelling forwards to its own address.** A committee or lobbying address whose name part is old or mistyped, and a legislator's long-code address, answer with a permanent forward to the record's one real address, keeping any `?year=` or `?tab=` in the address, instead of serving a second copy.
- **`sitemap.xml`** (`https://www.alethical.com/sitemap.xml`) lists every bill, every legislator, every campaign committee whose page holds a filed record, every lobbying principal with spending rows and every currently registered lobbyist (`/sitemaps/lobbying-principals.xml`, `/sitemaps/lobbying-lobbyists.xml`), and every real numbered Bills, Legislators and Committees directory page. Bills and legislators carry the date they really last changed; a committee carries none, because we hold no date on which one committee's own record changed and a wrong date on 1,603 entries would cost us Google's trust in the field across the whole site. It is built when asked for and then cached, so a newly ingested bill appears without waiting for a release.
- **Answer pages are readable but unlisted.** An `/ask` page asks not to appear in results, in its own response. It is deliberately not blocked in `robots.txt`, because a crawler that is blocked from fetching a page can never read the instruction inside it.
- **The little logo beside a result has an opaque background on purpose.** Google throws away any see-through border around a site's icon and blows the artwork up to fill the whole square, then draws it inside a circle — so the two bottom corners of our triangle mark got sliced off, which is what made it look off-center. An icon whose background is filled in has no see-through border to throw away, so the spacing we choose is the spacing Google shows (`apps/frontend/assets/favicon.png`, generated by `apps/frontend/scripts/generate-brand-assets.mjs`). Why it works this way, and the earlier see-through version it replaced, are in `docs/architecture/page-metadata-for-search-and-sharing-decisions.md` §14 (the search-result icon).

## The text that arrives before the page finishes loading

A bill page and a legislator page arrive with real words already in them, rather than an empty page
the app fills in a second later. Correct titles alone were not enough: Google often ignores the
description a page supplies and writes the result text from what it can actually see on the page.

A **bill** arrives with its plain-language title, its bill code and session, its key points (or its
summary, when a bill has no key points), where it stands, its chief author, the cited-section labels
the Summary tab shows, and links to the exact current-version passages when their positions are
known. It also links to the bill on revisor.mn.gov, to that author's profile, to its companion bill
in the other chamber when the Legislature links the pair, and to the bill list. A
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
would have no link anywhere on the site. **One committee’s Campaign money view**
arrives with its filed name, the register's kind and its registration number, the seat it registered
for where the register states one, the sentence saying whose committee it is — carrying, once a
person here has confirmed the link, that member's name and an ordinary link to their campaign money
— the period its figures cover, its held official contribution total and itemized contributions,
the official spending total when held or the sentence saying Alethical does not hold it, and the
day we copied the files. Its money-in figures keep their source and split explanations. The first
response links to the selected year's full received and outgoing lists, the year choices and
Filed reports. Those Year and Filed reports links keep the selected donor category and sort.
The donor chart and grouped tabs appear after their complete selected-year records load.
The shared committee address restores the same donor category and sort when the app starts;
those choices do not change the financial facts in the first response. Individuals and
Largest first are the defaults and need no address fields. An explicit category takes
precedence over an older `tab=spent` address.
**Its payments page** arrives with the same identity and period plus
the first 50 named payments, each with its own date and amount. Every one of those figures goes
through the same functions the screen uses, so a missing itemized figure reads "Not reported" and a filed zero
reads "$0", and a test fails if the served page ever prints an amount the filing does not carry
([`.claude/rules/grounded-answers.md` rule 12](../../.claude/rules/grounded-answers.md)). A year named in the
address is the year those figures are for, and on the payments page a direction named in the address
is the direction those payments go, so a shared link never opens on an answer to a different
question. Committee Filed reports and Independent spending responses instead show their
all-years heading and scope, with the Board record link. They omit selected-year figures,
year controls and money footers. Their rows load when the app starts, and the initial
response invents no empty result. Bill first responses continue to serve Summary whichever
tab the address names.

**The bare `/money/races` address** arrives as a compact directory of group headings,
committee counts and ordinary links to the complete groups. It includes the introduction,
ballot warning, register-copy date and limits, without printing every committee or money
amount. A selected group address arrives with that group's complete committee list, its
2 labelled figures with separate dates, and the same explanations and limits as the app.
Filtered and shared group addresses keep their instruction not to appear in search results
but now receive their corresponding first-response content and the all-office data reused
by the screen. Missing amounts never become $0.

A selected group uses its existing server identifier in the address, such as
`/money/races?office=House&year=2026&group=house-12a`. Legacy `#house-12a` targets still
resolve. Directory search text is stored as `q`. Opening a group clears that search from
the new address; Back restores the previous directory search, office and position. Search
can reach another office directly, shows the whole chosen group and moves focus to its
heading. Browser Back and Forward restore the selected view. Committee links retain the
selected year and allow the reader to return to the group and its position.

**The outside-spending record** arrives with the total the file holds, how many
payments and which years that total covers, how many of them the filings call supporting and how
many opposing, how many were given as goods rather than cash, the day we read the Board's file, and
the words introducing the group-and-committee directory. **The name search**
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
a piece's text at all), and whether a search engine may _list_ a piece is still the separate,
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
