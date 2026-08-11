# How sharing works

<!-- describes: apps/frontend/src/lib/share.ts, apps/frontend/src/lib/pageSnapshot.ts, apps/frontend/src/lib/legislatorProfile.ts, apps/frontend/src/components/billDetail/SharePopover.tsx, apps/frontend/src/components/share/MobileShareSheet.tsx, apps/frontend/src/screens/redesign/BillDetailScreen.tsx, apps/frontend/src/screens/redesign/BillDetailWebScreen.tsx, apps/frontend/src/screens/redesign/LegislatorProfileMobileScreen.tsx, apps/frontend/src/screens/redesign/LegislatorProfileWebScreen.tsx, apps/frontend/src/screens/redesign/AskAnswerScreen.tsx, apps/frontend/src/navigation/documentTitle.ts, apps/frontend/public/index.html, apps/frontend/public/robots.txt, apps/frontend/scripts/generate-brand-assets.mjs, api/page.ts, api/sitemap.ts, vercel.json -->

Share sends the page a reader chose, with enough plain-language context for another person to know why the link matters. Copy link remains the dependable choice when another app cannot accept prepared text.

## What each page shares

| Page       | Title                                                       | Description                                                                                | Link                                                                                                                 |
| ---------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| Bill       | Bill code, session year, and the short plain-language title | The first sentence of the plain-language summary                                           | The bill profile, without a selected tab                                                                             |
| Legislator | Name, chamber, and district                                 | A fixed sentence naming committees, chief-authored bills, and contact information          | The readable legislator profile address                                                                              |
| Ask answer | The reader's question                                       | A fixed sentence saying the answer is cited and links to the official record               | The public Ask address, keeping only the question, bill, legislator, and saved-suggestion fields needed to rebuild it |

A bill's title reads `HF 719 (2025): Statewide Capital Projects and Bonding Bill`. The year is there
because bill numbers repeat every two years, so the number alone never identifies one bill for good.
A bill with no plain-language short title yet is named by its number and year alone — never by its
official statutory title, which is a paragraph of legal cross-references
(`.claude/rules/grounded-answers.md` rule 10). A bill without a generated summary uses an honest
fixed description instead.

A legislator's title carries no party label. District and chamber identify a person just as well,
never go stale mid-term, and keep a partisan word out of a link preview or a search result read on
its own.

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
- On a phone, every Share button opens the same bottom sheet on bill, legislator, and answered Ask pages. It adds **Share using another app** when the phone or browser supports the normal Share menu.
- Copy link confirms the copy for about 2 seconds. The native app and website both copy the real link.
- No share includes a reader's account details, saved bills, address, or sign-in information.

## Link preview cards

Facebook, LinkedIn, X, messaging apps, and work-chat apps usually read preview data from the shared page rather than from the Share button. Every visitor to a public page — a person, a messaging app, or a search engine — now receives the same page, carrying that page's own title, description, real address, and the 1200×630 Alethical image. There is no separate version for robots.

Bill and legislator preview text comes from the same public API data the page uses. Ask preview text uses the public question and the fixed cited-answer description.

Preview services keep their own caches, so a card already posted elsewhere may take time to refresh after a bill summary changes.

## What search engines get

Search engines used to receive the same nameless page for every address, which made ~10,700 pages look like one page repeated. Each address now names itself in the very first response, before any of the app's own code runs, and a bill or legislator page also carries a short factual summary in that same response.

- **The browser tab and the preview say the same thing.** A bill page opens with the bill's number and year straight away, and gains its short title the moment the bill loads.
- **An address with no record behind it says so.** A bill or legislator that does not exist answers "not found" rather than a blank page that looks successful.
- **A brief outage does not unlist real pages.** If the data service cannot be reached, the page says "temporarily unavailable" instead of "gone".
- **`robots.txt`** (`https://www.alethical.com/robots.txt`) blocks nothing from being read. It points at the sitemap, and turns away only the two crawlers that exist to collect writing for training future AI models. Every search crawler and every "someone asked a question about this page" crawler is welcome.
- **`sitemap.xml`** (`https://www.alethical.com/sitemap.xml`) lists every bill and every legislator, not a popular subset, each with the date its record really last changed. It is built when asked for and then cached, so a newly ingested bill appears without waiting for a release.
- **Answer pages are readable but unlisted.** An `/ask` page asks not to appear in results, in its own response. It is deliberately not blocked in `robots.txt`, because a crawler that is blocked from fetching a page can never read the instruction inside it.

## The text that arrives before the page finishes loading

A bill page and a legislator page arrive with real words already in them, rather than an empty page
the app fills in a second later. Correct titles alone were not enough: Google often ignores the
description a page supplies and writes the result text from what it can actually see on the page.

A **bill** arrives with its plain-language title, its bill code and session, its key points (or its
summary, when a bill has no key points), where it stands, its chief author, and links to the bill on
revisor.mn.gov, to that author's profile, and to the bill list. A **legislator** arrives with their
name, chamber and district, party, committee assignments, capitol office and phone, and links to
their official chamber profile and to the member list. Lists, answer pages, and the legal pages carry
no such summary, because a list is a list of other records rather than a record of its own.

**Every word of it is a word the page itself then shows.** There is no separate version written for
robots. The served text is built from the very same functions the screens use, and a test renders the
real bill header and summary tab from a real bill and fails if any served line is missing from what
they draw (`apps/frontend/src/lib/__tests__/pageSnapshot.test.tsx`). One thing is deliberately left
out rather than added: a bill with no plain-language title is headed by its number alone, never by
its official statutory title, which is a paragraph of legal cross-references
(`.claude/rules/grounded-answers.md` rule 10).

The summary sits inside the app's own mount point, which the app empties the instant it draws its
first screen, so the two are never on screen together. Measured on a real browser against the live
program: one change to that element, at 60 milliseconds, and no moment showing both. If the program
fails to load at all, the summary simply stays, which is the other reason for putting it there.

The reasoning behind each of those choices, and the options that lost, are in `docs/architecture/page-metadata-for-search-and-sharing-decisions.md`.
