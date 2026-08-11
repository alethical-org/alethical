# How sharing works

<!-- describes: apps/frontend/src/lib/share.ts, apps/frontend/src/components/billDetail/SharePopover.tsx, apps/frontend/src/components/share/MobileShareSheet.tsx, apps/frontend/src/screens/redesign/BillDetailScreen.tsx, apps/frontend/src/screens/redesign/BillDetailWebScreen.tsx, apps/frontend/src/screens/redesign/LegislatorProfileMobileScreen.tsx, apps/frontend/src/screens/redesign/LegislatorProfileWebScreen.tsx, apps/frontend/src/screens/redesign/AskAnswerScreen.tsx, apps/frontend/public/index.html, apps/frontend/scripts/generate-brand-assets.mjs, api/social-preview.ts, vercel.json -->

Share sends the page a reader chose, with enough plain-language context for another person to know why the link matters. Copy link remains the dependable choice when another app cannot accept prepared text.

## What each page shares

| Page       | Title                                         | Description                                                                                             | Link                                                                                                                  |
| ---------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Bill       | Bill code plus the short plain-language title | The first sentence of the plain-language summary                                                        | The bill profile, without a selected tab                                                                              |
| Legislator | Name, party, chamber, and district            | A fixed sentence naming committees, chief-authored bills, and recent votes — **the votes part is wrong, see below** | The readable legislator profile address                                                                               |
| Ask answer | The reader's question                         | A fixed sentence saying the answer is cited and links to the official record                            | The public Ask address, keeping only the question, bill, legislator, and saved-suggestion fields needed to rebuild it |

A bill without a generated summary uses an honest fixed description instead of the long statutory title. The title, description, and link shown in the Share panel are the same source values used for every destination.

**Known defect: the legislator sentence promises something the profile does not have.** It says
"committee assignments, chief-authored bills, and recent votes." The profile shows Biography,
Committees, Chief-Authored Bills, Contact, Legislative Service, and Leadership. Votes appear only
inside the deliberately-unfinished "On the roadmap" area, so a reader who follows a shared link
looking for votes will not find them. That breaks `.claude/rules/grounded-answers.md` rule 6 (copy
claims match shipped capability). The fix is to swap "recent votes" for "contact information" in
`buildLegislatorShareContent` (`apps/frontend/src/lib/share.ts`) and update the row above in the
same change. Tracked in
[#1325](https://github.com/alethical-org/alethical/issues/1325), which found it; see
`docs/architecture/page-metadata-for-search-and-sharing-decisions.md` §3.

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

Facebook, LinkedIn, X, messaging apps, and work-chat apps usually read preview data from the shared page rather than from the Share button. Recognized preview readers receive page-specific title, description, canonical link, and the 1200×630 Alethical image. Everyone else receives the normal app.

Bill and legislator preview text comes from the same public API data the page uses. Ask preview text uses the public question and the fixed cited-answer description. If that public data is temporarily unavailable, the preview falls back to a narrow factual label rather than inventing page details.

Preview services keep their own caches, so a card already posted elsewhere may take time to refresh after a bill summary changes.
